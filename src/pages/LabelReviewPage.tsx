import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Badge, Card, CardHead, CopyButton, Donut, Field, Flag, KeyValue, Loading,
  Meter, Modal, Section, Select, StatusBadge, Tabs, TextArea,
} from '../components/ui';
import { api, useRecord } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useCustomers, useUsers } from '../lib/lookups';
import { date, dateTime, number, relative } from '../lib/format';
import { CHECKLIST_STATES, LABEL_REVIEW_STATUS } from '@shared/domain';
import type { ChecklistRow, Finding, LabelReview, SupplementFacts } from '../lib/types';

const PANEL_LABELS: Record<string, string> = {
  pdp: 'Principal display panel',
  information: 'Information panel',
  leftSide: 'Left side panel',
  rightSide: 'Right side panel',
  other: 'Other copy',
};

const NEEDS_LABEL: Record<string, string> = {
  copy: 'Settled from the copy',
  art: 'Needs the artwork',
  file: 'Needs a separate file',
};

interface Proof {
  reviewNumber: string;
  productName: string;
  panels: Record<string, string>;
  applied: (Finding & { panel: string })[];
  manual: Finding[];
  denied: Finding[];
  note: string;
}

export function LabelReviewPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { error, success, confirm } = useUi();
  const { can, user } = useSession();
  const customers = useCustomers();
  const users = useUsers();

  const { data: review, isLoading } = useRecord<LabelReview>('labelReviews', id);
  useViewing(review ? review.reviewNumber : null);

  const [tab, setTab] = useState('findings');
  const [editOpen, setEditOpen] = useState(false);
  const [proofOpen, setProofOpen] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['record', 'labelReviews', id] });
    queryClient.invalidateQueries({ queryKey: ['collection', 'labelReviews'] });
  };

  const grouped = useMemo(() => {
    const map = new Map<string, ChecklistRow[]>();
    for (const row of review?.checklist ?? []) {
      if (!map.has(row.cat)) map.set(row.cat, []);
      map.get(row.cat)!.push(row);
    }
    return [...map.entries()];
  }, [review]);

  if (isLoading || !review) return <div className="page"><Loading rows={8} /></div>;

  const writable = can('labels.write') && review.status !== 'released';
  const metrics = review.metrics ?? { total: 41, pass: 0, fail: 0, na: 0, notReviewed: 41, reviewed: 0, completionPct: 0, requiredCorrections: 0, recommendations: 0 };
  const pending = review.findings.filter((finding) => finding.decision === 'pending');
  const required = review.findings.filter((finding) => finding.type === 'required');

  const decide = async (finding: Finding, decision: 'accepted' | 'denied') => {
    let note: string | undefined;
    if (decision === 'denied') {
      const reason = await confirm({
        title: 'Deny this finding',
        body: finding.issue,
        requireReason: 'Why is the defect not being corrected?',
        confirmLabel: 'Deny',
        tone: 'warning',
      });
      if (!reason) return;
      note = reason;
    }
    try {
      await api.post(`/labels/${review.id}/findings/${finding.id}`, { decision, note });
      refresh();
    } catch (err) { error(err); }
  };

  const setRowState = async (row: ChecklistRow, state: string) => {
    let comment: string | undefined;
    if (state === 'pass' && row.needs !== 'copy') {
      const evidence = await confirm({
        title: `Row ${row.id} needs evidence`,
        body: row.look || 'This row is settled against the artwork or a separate file, not the copy.',
        requireReason: 'What did you look at, and what did you see?',
        confirmLabel: 'Mark compliant',
      });
      if (!evidence) return;
      comment = evidence;
    }
    try {
      await api.post(`/labels/${review.id}/checklist/${row.id}`, { state, comment });
      refresh();
    } catch (err) { error(err); }
  };

  const approve = async () => {
    try {
      if (review.reviewerId === user?.id) {
        const reason = await confirm({
          title: 'You reviewed this label yourself',
          body: 'A label review is signed by two people. Ask a second reviewer to approve, or record why you are signing both roles.',
          requireReason: 'Why is one person signing both roles?',
          confirmLabel: 'Sign both roles',
          tone: 'warning',
        });
        if (!reason) return;
        await api.post(`/labels/${review.id}/approve`, { soleReviewerReason: reason });
      } else {
        await api.post(`/labels/${review.id}/approve`, {});
      }
      refresh();
      success('Label review approved');
    } catch (err) { error(err); }
  };

  return (
    <div className="page page-wide">
      <PageHeader
        back={{ to: '/labels', label: 'Label reviews' }}
        title={`${review.brand ? `${review.brand} · ` : ''}${review.productName}`}
        badge={
          <>
            <StatusBadge list={LABEL_REVIEW_STATUS} value={review.status} large />
            {metrics.requiredCorrections > 0 && <Badge tone="danger">{metrics.requiredCorrections} required</Badge>}
            {pending.length > 0 && <Badge tone="warning">{pending.length} undecided</Badge>}
          </>
        }
        subtitle={
          <>
            <span className="mono">{review.reviewNumber}</span> · {customers.name(review.customerId)}
            {review.labelRevision && ` · ${review.labelRevision}`} · received {relative(review.receivedAt)}
            {review.formulaId && <> · <Link to={`/formulations/${review.formulaId}`}>linked formula</Link></>}
          </>
        }
        actions={
          writable && (
            <>
              <button type="button" className="btn" onClick={() => setEditOpen(true)}><Icon name="edit" size={13} /> Update copy</button>
              <button type="button" className="btn" onClick={() => setProofOpen(true)}><Icon name="wand" size={13} /> Corrected proof</button>
              {can('labels.approve') && review.status !== 'approved' && (
                <button type="button" className="btn btn-primary" disabled={pending.length > 0} onClick={approve}>
                  <Icon name="check-circle" size={14} /> Approve
                </button>
              )}
              {can('labels.approve') && review.status === 'approved' && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    try { await api.post(`/labels/${review.id}/release`, {}); refresh(); success('Released as the final label'); }
                    catch (err) { error(err); }
                  }}
                >
                  <Icon name="lock" size={14} /> Release
                </button>
              )}
            </>
          )
        }
      />

      {pending.length > 0 && (
        <div className="flag" data-tone="warning" style={{ marginBottom: 'var(--s-4)' }}>
          <span className="flag-mark"><Icon name="alert" size={15} /></span>
          <div>
            <div className="flag-title">{pending.length} finding{pending.length > 1 ? 's have' : ' has'} no decision</div>
            <div className="flag-detail">Every finding is accepted or denied by a named reviewer before this label can be approved.</div>
          </div>
        </div>
      )}

      <div className="split">
        <div className="col">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'findings', label: 'Findings', count: review.findings.length, icon: 'alert' },
              { value: 'checklist', label: 'Checklist', count: `${metrics.reviewed}/${metrics.total}`, icon: 'clipboard' },
              { value: 'copy', label: 'Panel copy', icon: 'file' },
              { value: 'panel', label: 'Supplement Facts', icon: 'label' },
            ]}
          />

          <div style={{ marginTop: 'var(--s-4)' }} className="col">
            {tab === 'findings' && (
              <>
                <Card>
                  <CardHead
                    title="Required corrections"
                    subtitle="A defect against 21 CFR Part 101, Part 111 or a stated Enova rule"
                    icon="alert"
                    actions={<Badge tone={required.length ? 'danger' : 'success'}>{required.length}</Badge>}
                  />
                  <div className="card-body-flush">
                    {required.length === 0 && (
                      <div className="cell-sub" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>
                        Nothing on the submitted copy is a required correction.
                      </div>
                    )}
                    {required.map((finding) => (
                      <FindingRow key={finding.id} finding={finding} writable={writable} users={users} onDecide={decide} />
                    ))}
                  </div>
                </Card>

                <Card>
                  <CardHead
                    title="Recommendations"
                    subtitle="Conditional, advisory, or depending on something not on the label"
                    icon="info"
                    actions={<Badge tone="warning">{review.findings.length - required.length}</Badge>}
                  />
                  <div className="card-body-flush">
                    {review.findings.filter((finding) => finding.type !== 'required').map((finding) => (
                      <FindingRow key={finding.id} finding={finding} writable={writable} users={users} onDecide={decide} />
                    ))}
                    {review.findings.filter((finding) => finding.type !== 'required').length === 0 && (
                      <div className="cell-sub" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>No recommendations.</div>
                    )}
                  </div>
                </Card>
              </>
            )}

            {tab === 'checklist' && (
              <Card>
                <CardHead
                  title="Enova Label Review Checklist"
                  subtitle={`${metrics.reviewed} of ${metrics.total} rows settled · ${metrics.notReviewed} need the artwork or a separate file`}
                  icon="clipboard"
                  actions={<Donut value={metrics.reviewed} total={metrics.total} size={44} label={`${metrics.completionPct}%`} />}
                />
                <div className="card-body-flush">
                  {grouped.map(([category, rows]) => (
                    <div key={category}>
                      <div className="checklist-cat eyebrow">{category}</div>
                      {rows.map((row) => (
                        <div key={row.id} className="checklist-row">
                          <span className="checklist-num">{row.row}</span>
                          <div>
                            <div className="checklist-text">{row.text}</div>
                            {row.comment && <div className="checklist-comment">{row.comment}</div>}
                            {row.needs !== 'copy' && (
                              <div className="row-tight" style={{ marginTop: 6 }}>
                                <Badge tone="neutral">{NEEDS_LABEL[row.needs]}</Badge>
                                {row.decidedBy && <span className="cell-sub">{users.name(row.decidedBy)}</span>}
                              </div>
                            )}
                          </div>
                          <div>
                            {writable ? (
                              <Select
                                value={row.state}
                                onChange={(value) => setRowState(row, value)}
                                options={CHECKLIST_STATES.map((state) => ({ value: state.value, label: state.label }))}
                                className="select input-sm"
                              />
                            ) : (
                              <StatusBadge list={CHECKLIST_STATES} value={row.state} />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {tab === 'copy' && (
              <div className="col">
                {Object.entries(review.panels).filter(([, value]) => value).map(([key, value]) => (
                  <Card key={key}>
                    <CardHead title={PANEL_LABELS[key] ?? key} icon="file" actions={<CopyButton text={value as string} />} />
                    <div className="card-body">
                      <div className="panel-preview">{value as string}</div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {tab === 'panel' && <PanelTab review={review} onGenerated={refresh} writable={writable} />}
          </div>
        </div>

        <div className="col">
          <Card>
            <CardHead title="Completion" icon="target" />
            <div className="card-body col">
              <div className="row">
                <Donut value={metrics.reviewed} total={metrics.total} size={82} label={`${metrics.completionPct}%`} sublabel="settled" />
                <div className="grow col-tight">
                  {[
                    { label: 'Compliant', value: metrics.pass, tone: 'success' },
                    { label: 'Correction required', value: metrics.fail, tone: 'danger' },
                    { label: 'Not applicable', value: metrics.na, tone: 'neutral' },
                    { label: 'Not reviewed', value: metrics.notReviewed, tone: 'neutral' },
                  ].map((entry) => (
                    <div key={entry.label} className="row-tight" data-tone={entry.tone}>
                      <span className="badge-dot" style={{ background: 'var(--tone-fg)' }} />
                      <span className="grow" style={{ fontSize: 'var(--t-sm)' }}>{entry.label}</span>
                      <span className="mono">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Meter value={metrics.completionPct} />
              <div className="cell-sub">
                An undecided row is left blank and counted as not done. Ticking it to make the sheet look finished
                defeats the only purpose the sheet has.
              </div>
            </div>
          </Card>

          <Section title="Sign-off" icon="shield">
            <KeyValue
              items={[
                { label: 'Reviewer', value: review.reviewerId ? `${users.name(review.reviewerId)} · ${dateTime(review.reviewedAt)}` : 'Not reviewed' },
                { label: 'Approver', value: review.approverId ? `${users.name(review.approverId)} · ${dateTime(review.approvedAt)}` : 'Not signed' },
                { label: 'Status', value: <StatusBadge list={LABEL_REVIEW_STATUS} value={review.status} /> },
                { label: 'Source', value: review.source },
                { label: 'Label revision', value: review.labelRevision || '—' },
                { label: 'Received', value: date(review.receivedAt) },
              ]}
            />
            {review.notes && <div className="cell-sub" style={{ marginTop: 'var(--s-3)', whiteSpace: 'pre-wrap' }}>{review.notes}</div>}
          </Section>

          <Section title="House rules applied" icon="clipboard">
            <div className="col-tight cell-sub">
              <div>• Net quantity sits in the <strong>bottom third</strong> of the principal display panel.</div>
              <div>• Statement of identity in a size <strong>reasonably similar to the largest print</strong>.</div>
              <div>• The firm relationship reads <strong>“Distributed By” or “Manufactured For”</strong> — a bare “Manufactured:” does not disclose it.</div>
              <div>• Revision mark reads <strong>Rev. # - MM/YY</strong> on the bottom of the left side panel.</div>
              <div>• Nothing is released as the Final Label until every finding has a decision and a named reviewer has signed.</div>
            </div>
          </Section>
        </div>
      </div>

      <EditCopy open={editOpen} onClose={() => setEditOpen(false)} review={review} onSaved={() => { setEditOpen(false); refresh(); }} />
      <ProofModal open={proofOpen} onClose={() => setProofOpen(false)} reviewId={review.id} />
    </div>
  );
}

function FindingRow({ finding, writable, users, onDecide }: {
  finding: Finding;
  writable: boolean;
  users: ReturnType<typeof useUsers>;
  onDecide: (finding: Finding, decision: 'accepted' | 'denied') => void;
}) {
  const tone = finding.decision === 'accepted' ? 'success' : finding.decision === 'denied' ? 'neutral' : finding.type === 'required' ? 'danger' : 'warning';
  return (
    <div className="list-row" style={{ alignItems: 'flex-start', opacity: finding.decision === 'denied' ? 0.7 : 1 }}>
      <span className="tone-text" data-tone={tone} style={{ marginTop: 2 }}>
        <Icon name={finding.decision === 'accepted' ? 'check-circle' : finding.decision === 'denied' ? 'x' : 'alert'} size={15} />
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row-tight">
          <span className="mono cell-sub">row {finding.rowId}</span>
          <Badge tone={finding.type === 'required' ? 'danger' : 'warning'}>{finding.type === 'required' ? 'required correction' : 'recommendation'}</Badge>
          {finding.decision !== 'pending' && <Badge tone={finding.decision === 'accepted' ? 'success' : 'neutral'}>{finding.decision}</Badge>}
        </div>
        <div style={{ fontSize: 'var(--t-sm)', marginTop: 4 }}>{finding.issue}</div>
        {finding.proposedWording && (
          <div style={{ marginTop: 6 }}>
            <span className="eyebrow">Proposed wording</span>
            <div className="panel-preview" style={{ maxHeight: 130, marginTop: 4, padding: 'var(--s-3)' }}>{finding.proposedWording}</div>
          </div>
        )}
        {finding.evidence && <div className="cell-sub" style={{ marginTop: 4 }}>Found: “{finding.evidence}”</div>}
        <div className="row-tight" style={{ marginTop: 6 }}>
          <span className="flag-auth">{finding.authority}</span>
          {finding.decidedBy && <span className="cell-sub">· {users.name(finding.decidedBy)} {relative(finding.decidedAt)}</span>}
        </div>
        {finding.note && <div className="cell-sub" style={{ marginTop: 4 }}>Note: {finding.note}</div>}
      </div>
      {writable && (
        <div className="row-tight">
          {finding.decision !== 'accepted' && (
            <button type="button" className="btn btn-sm" onClick={() => onDecide(finding, 'accepted')}>Accept</button>
          )}
          {finding.decision !== 'denied' && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onDecide(finding, 'denied')}>Deny</button>
          )}
        </div>
      )}
    </div>
  );
}

function EditCopy({ open, onClose, review, onSaved }: {
  open: boolean; onClose: () => void; review: LabelReview; onSaved: () => void;
}) {
  const { error, success } = useUi();
  const [panels, setPanels] = useState<Record<string, string>>({ ...review.panels } as Record<string, string>);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const result = await api.post<LabelReview>(`/labels/${review.id}/rerun`, { panels });
      success('Checklist re-run', `${result.metrics.requiredCorrections} required correction(s) now stand.`);
      onSaved();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      large
      title="Update the panel copy"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? <span className="spinner" /> : <Icon name="refresh" size={14} />} Re-run the checklist
          </button>
        </>
      }
    >
      <div className="col">
        <Flag tone="info" title="Decisions are carried forward" detail="A finding you have already accepted or denied keeps that decision if it still applies after the re-run." />
        {['pdp', 'information', 'leftSide', 'rightSide'].map((key) => (
          <Field key={key} label={PANEL_LABELS[key]}>
            <TextArea
              value={panels[key] ?? ''}
              onChange={(value) => setPanels((current) => ({ ...current, [key]: value }))}
              rows={key === 'information' ? 10 : 5}
            />
          </Field>
        ))}
      </div>
    </Modal>
  );
}

function ProofModal({ open, onClose, reviewId }: { open: boolean; onClose: () => void; reviewId: string }) {
  const { data } = useQuery<Proof>({
    queryKey: ['label-proof', reviewId],
    queryFn: () => api.get<Proof>(`/labels/${reviewId}/corrected-proof`),
    enabled: open,
  });

  return (
    <Modal open={open} onClose={onClose} large title="Corrected proof">
      {!data ? <Loading rows={4} /> : (
        <div className="col">
          <Flag tone="warning" title="This is a proof, not artwork" detail={data.note} />

          {data.applied.length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>{data.applied.length} correction(s) applied to the copy</div>
              {data.applied.map((finding) => (
                <div key={finding.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                  <Badge tone="success">row {finding.rowId}</Badge>
                  <span className="grow cell-sub">{PANEL_LABELS[finding.panel] ?? finding.panel}: “{finding.evidence}” → “{finding.proposedWording}”</span>
                </div>
              ))}
            </div>
          )}

          {data.manual.length > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>{data.manual.length} correction(s) the printer must add</div>
              {data.manual.map((finding) => (
                <div key={finding.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                  <Badge tone="warning">row {finding.rowId}</Badge>
                  <span className="grow cell-sub">{finding.proposedWording || finding.issue}</span>
                </div>
              ))}
            </div>
          )}

          {Object.entries(data.panels).filter(([, value]) => value).map(([key, value]) => (
            <div key={key}>
              <div className="row" style={{ marginBottom: 'var(--s-2)' }}>
                <span className="eyebrow grow">{PANEL_LABELS[key] ?? key}</span>
                <CopyButton text={value} />
              </div>
              <div className="panel-preview">{value}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function PanelTab({ review, onGenerated, writable }: {
  review: LabelReview; onGenerated: () => void; writable: boolean;
}) {
  const { error, success } = useUi();
  const [busy, setBusy] = useState(false);
  const panel = review.supplementFacts as SupplementFacts;
  const hasPanel = Boolean(panel && 'rows' in panel && panel.rows?.length);

  const generate = async () => {
    setBusy(true);
    try {
      await api.post(`/labels/${review.id}/generate-panel`, {});
      success('Panel generated from the master formula');
      onGenerated();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHead
        title="Supplement Facts from the master formula"
        subtitle="What the formula supports — compare it against what was printed"
        icon="label"
        actions={writable && (
          <button type="button" className="btn btn-sm" disabled={busy || !review.formulaId} onClick={generate}>
            {busy ? <span className="spinner" /> : <Icon name="wand" size={12} />} {hasPanel ? 'Regenerate' : 'Generate'}
          </button>
        )}
      />
      <div className="card-body">
        {!review.formulaId && <div className="cell-sub">Link a master formula to this review to generate the panel.</div>}
        {review.formulaId && !hasPanel && <div className="cell-sub">No panel generated yet.</div>}
        {hasPanel && (
          <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--s-5)', flexWrap: 'wrap' }}>
            <div className="sfp">
              <div className="sfp-title">Supplement Facts</div>
              <div className="sfp-rule" />
              <div className="sfp-small">Serving Size: {panel.servingSize}</div>
              {panel.servingsPerContainer && <div className="sfp-small">Servings Per Container: {panel.servingsPerContainer}</div>}
              <div className="sfp-rule-bold" />
              <div className="sfp-row"><span /><b>% Daily Value</b></div>
              <div className="sfp-rule" />
              {panel.rows.map((row) => (
                <div key={row.name}>
                  <div className="sfp-row">
                    <span><b>{row.display}</b> {row.amount} {row.unit}{row.iuEquivalent ? ` (${number(row.iuEquivalent)} IU)` : ''}</span>
                    <b>{row.pctDv === null ? '†' : `${row.pctDv}%`}</b>
                  </div>
                  <div className="sfp-rule" />
                </div>
              ))}
              {panel.footnotes?.map((footnote) => <div key={footnote} className="sfp-foot">{footnote}</div>)}
              {panel.otherIngredients?.length > 0 && (
                <div className="sfp-foot" style={{ marginTop: 6 }}>
                  <b>Other Ingredients:</b> {panel.otherIngredients.join(', ')}.
                </div>
              )}
            </div>
            <div className="grow" style={{ minWidth: 240 }}>
              <KeyValue
                items={[
                  { label: 'Rows', value: panel.rows.length },
                  { label: 'With a Daily Value', value: panel.rows.filter((row) => row.pctDv !== null).length },
                  { label: 'Footnoted', value: panel.rows.filter((row) => row.pctDv === null).length },
                  { label: 'Generated', value: relative(panel.generatedAt) },
                ]}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
