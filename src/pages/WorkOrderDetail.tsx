import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Badge, Card, CardHead, DataTable, Donut, Field, KeyValue, Loading, Modal, NumberInput,
  Section, Select, StatusBadge, Tabs, TextArea, type Column,
} from '../components/ui';
import { api, useRecord } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing, useAlsoHere } from '../lib/realtime';
import { useCustomers, useFormulas, useProjects, useUsers } from '../lib/lookups';
import { Avatar } from '../components/ui';
import { date, dateTime, number, percent, qty, relative } from '../lib/format';
import { PRIORITIES, WORK_ORDER_STAGES, findOption } from '@shared/domain';
import type { WorkOrder } from '../lib/types';

interface Availability {
  rows: {
    itemId: string; itemCode: string; name: string; lotId: string; lotNumber: string;
    plannedQty: number; issuedQty: number; uom: string;
    available: number; required: number; short: number;
    lots: { id: string; lotNumber: string; qtyOnHand: number; uom: string; expiresAt: string | null; locationId: string }[];
  }[];
  shortCount: number;
}

export function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { error, success, confirm } = useUi();
  const { can } = useSession();
  const customers = useCustomers();
  const users = useUsers();
  const formulas = useFormulas();
  const projects = useProjects();

  const { data: wo, isLoading } = useRecord<WorkOrder>('workOrders', id);
  useViewing(wo ? `${wo.woNumber}` : null);
  const alsoHere = useAlsoHere(wo ? `${wo.woNumber}` : null);

  const { data: availability } = useQuery<Availability>({
    queryKey: ['production', 'availability', id],
    queryFn: () => api.get<Availability>(`/production/${id}/availability`),
    enabled: Boolean(id),
  });

  const [tab, setTab] = useState('batch');
  const [issueRow, setIssueRow] = useState<number | null>(null);
  const [deviationOpen, setDeviationOpen] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['record', 'workOrders', id] });
    queryClient.invalidateQueries({ queryKey: ['production'] });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
  };

  if (isLoading || !wo) return <div className="page"><Loading rows={8} /></div>;

  const stepsDone = wo.steps.filter((s) => s.done).length;
  const staged = wo.materials.filter((m) => m.issuedQty > 0).length;
  const openDeviations = wo.deviations.filter((d) => d.status === 'open');
  const writable = can('production.write');

  const advance = async (target: string) => {
    let holdReason: string | undefined;
    if (target === 'qc_hold') {
      const reason = await confirm({
        title: 'Place this batch on QC hold',
        body: 'The floor needs to know what the batch is waiting on.',
        requireReason: 'Reason for the hold',
        confirmLabel: 'Place on hold',
        tone: 'warning',
      });
      if (!reason) return;
      holdReason = reason;
    }
    try {
      await api.post(`/production/${wo.id}/move`, { stage: target, holdReason });
      refresh();
      success(`Moved to ${findOption(WORK_ORDER_STAGES, target).label}`);
    } catch (err) {
      error(err);
    }
  };

  const toggleStep = async (index: number) => {
    try {
      await api.post(`/production/${wo.id}/steps/${index}`, { done: !wo.steps[index].done });
      refresh();
    } catch (err) { error(err); }
  };

  const stageIndex = WORK_ORDER_STAGES.findIndex((s) => s.value === wo.stage);
  const nextStage = WORK_ORDER_STAGES[stageIndex + 1];

  const materialColumns: Column<Availability['rows'][number] & { id: string }>[] = [
    { key: 'item', header: 'Material', render: (row) => (
      <div>
        <div className="cell-primary truncate">{row.name}</div>
        <div className="cell-sub mono">{row.itemCode}</div>
      </div>
    ) },
    { key: 'planned', header: 'Planned', numeric: true, render: (row) => qty(row.plannedQty, row.uom) },
    { key: 'issued', header: 'Issued', numeric: true, render: (row) => (
      <span className={row.issuedQty >= row.plannedQty ? 'tone-text' : ''} data-tone={row.issuedQty >= row.plannedQty ? 'success' : undefined}>
        {qty(row.issuedQty, row.uom)}
      </span>
    ) },
    { key: 'lot', header: 'Lot', render: (row) => row.lotNumber ? <span className="mono">{row.lotNumber}</span> : <span className="faint">—</span> },
    { key: 'available', header: 'Released stock', numeric: true, render: (row) => (
      row.short > 0
        ? <span className="tone-text" data-tone="danger">{qty(row.available, row.uom)} · short {qty(row.short, row.uom)}</span>
        : qty(row.available, row.uom)
    ) },
    { key: 'action', header: '', align: 'right', render: (_row, index) => (
      writable && wo.stage !== 'complete' ? (
        <button type="button" className="btn btn-sm" onClick={() => setIssueRow(index)}>Issue</button>
      ) : null
    ) },
  ];

  return (
    <div className="page">
      <PageHeader
        back={{ to: '/production', label: 'Production board' }}
        title={wo.woNumber}
        badge={
          <>
            <StatusBadge list={WORK_ORDER_STAGES} value={wo.stage} large />
            {wo.priority !== 'normal' && <StatusBadge list={PRIORITIES} value={wo.priority} />}
            {alsoHere.length > 0 && (
              <span className="row-tight cell-sub" title={`${alsoHere.map((p) => p.name).join(', ')} also viewing`}>
                {alsoHere.slice(0, 3).map((person) => <Avatar key={person.id} name={person.name} color={person.accentColor} size="sm" />)}
                also here
              </span>
            )}
          </>
        }
        subtitle={
          <>
            {wo.productName} · batch <span className="mono">{wo.batchNumber}</span> · {customers.name(wo.customerId)}
            {wo.formulaId && <> · <Link to={`/formulations/${wo.formulaId}`}>{formulas.get(wo.formulaId)?.code ?? 'formula'}</Link></>}
            {(() => {
              // Resolve the project from either side of the link.
              const pid = formulas.get(wo.formulaId)?.projectId || projects.rows.find((p) => p.formulaId === wo.formulaId)?.id;
              return pid ? <> · <Link to={`/development/${pid}`}>project</Link></> : null;
            })()}
          </>
        }
        actions={
          writable && (
            <>
              <button type="button" className="btn" onClick={() => window.open(`/print/batch/${id}`, '_blank')}><Icon name="printer" size={13} /> Batch record</button>
              {wo.stage !== 'qc_hold' && wo.stage !== 'complete' && (
                <button type="button" className="btn" onClick={() => advance('qc_hold')}>
                  <Icon name="pause" size={13} /> QC hold
                </button>
              )}
              {wo.stage === 'qc_hold' && (
                <button type="button" className="btn" onClick={() => advance('in_process')}>
                  <Icon name="play" size={13} /> Release hold
                </button>
              )}
              {nextStage && wo.stage !== 'qc_hold' && (
                <button type="button" className="btn btn-primary" onClick={() => advance(nextStage.value)}>
                  Move to {nextStage.label} <Icon name="arrow-right" size={13} />
                </button>
              )}
            </>
          )
        }
      />

      {wo.stage === 'qc_hold' && wo.holdReason && (
        <div className="flag" data-tone="danger" style={{ marginBottom: 'var(--s-4)' }}>
          <span className="flag-mark"><Icon name="alert" size={15} /></span>
          <div>
            <div className="flag-title">On QC hold</div>
            <div className="flag-detail">{wo.holdReason}</div>
          </div>
        </div>
      )}

      <div className="split">
        <div className="col">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'batch', label: 'Batch record', count: `${stepsDone}/${wo.steps.length}`, icon: 'clipboard' },
              { value: 'materials', label: 'Materials', count: `${staged}/${wo.materials.length}`, icon: 'boxes' },
              { value: 'quality', label: 'Quality', count: wo.qcChecks.length, icon: 'shield' },
              { value: 'deviations', label: 'Deviations', count: wo.deviations.length, icon: 'alert' },
            ]}
          />

          {tab === 'batch' && (
            <Card style={{ marginTop: 'var(--s-4)' }}>
              <CardHead
                title="Batch steps"
                subtitle={`${stepsDone} of ${wo.steps.length} signed off`}
                actions={<Donut value={stepsDone} total={wo.steps.length} size={40} tone="accent" label={`${Math.round((stepsDone / Math.max(1, wo.steps.length)) * 100)}%`} />}
              />
              <div className="card-body">
                <div className="stepper">
                  {wo.steps.map((step, index) => (
                    <div className="step" key={`${step.name}-${index}`} data-done={step.done ? 'true' : 'false'}>
                      <button
                        type="button"
                        className="step-mark"
                        disabled={!writable || wo.stage === 'complete'}
                        onClick={() => toggleStep(index)}
                        aria-label={step.done ? `Undo ${step.name}` : `Sign off ${step.name}`}
                      >
                        {step.done ? <Icon name="check" size={12} /> : <span style={{ fontSize: 10 }}>{index + 1}</span>}
                      </button>
                      <div className="grow">
                        <div className="row-tight">
                          <span className="step-name">{step.name}</span>
                          {step.requiresSignature && <Badge tone="warning">signature</Badge>}
                        </div>
                        <div className="step-meta">
                          {step.done ? `${users.name(step.doneBy)} · ${dateTime(step.doneAt)}` : 'Not signed'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {tab === 'materials' && (
            <Card style={{ marginTop: 'var(--s-4)' }}>
              <CardHead
                title="Materials"
                subtitle={availability?.shortCount ? `${availability.shortCount} line(s) short of released stock` : 'All lines covered by released stock'}
                icon="boxes"
              />
              <DataTable
                columns={materialColumns}
                rows={(availability?.rows ?? []).map((row, index) => ({ ...row, id: `${row.itemId}-${index}` }))}
                empty={<div className="cell-sub" style={{ padding: 'var(--s-5)' }}>This work order has no bill of materials.</div>}
              />
            </Card>
          )}

          {tab === 'quality' && (
            <Card style={{ marginTop: 'var(--s-4)' }}>
              <CardHead title="In-process quality checks" icon="shield" />
              <div className="card-body-flush">
                {wo.qcChecks.map((check, index) => (
                  <div key={check.name} className="list-row">
                    <span className="grow">
                      <span className="cell-primary" style={{ display: 'block' }}>{check.name}</span>
                      <span className="cell-sub">Specification: {check.spec}</span>
                    </span>
                    <span className="mono">{check.result || '—'}</span>
                    <Badge tone={check.status === 'pass' ? 'success' : check.status === 'fail' ? 'danger' : 'neutral'}>{check.status}</Badge>
                    {writable && wo.stage !== 'complete' && (
                      <QcRecorder workOrderId={wo.id} index={index} onDone={refresh} />
                    )}
                    <span className="cell-sub nowrap" style={{ width: 120 }}>
                      {check.checkedBy ? `${users.name(check.checkedBy)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {tab === 'deviations' && (
            <Card style={{ marginTop: 'var(--s-4)' }}>
              <CardHead
                title="Deviations"
                subtitle={openDeviations.length ? `${openDeviations.length} open` : 'None open'}
                icon="alert"
                actions={writable && <button type="button" className="btn btn-sm" onClick={() => setDeviationOpen(true)}><Icon name="plus" size={12} /> Raise</button>}
              />
              <div className="card-body-flush">
                {wo.deviations.length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-5)' }}>No deviations recorded on this batch.</div>}
                {wo.deviations.map((deviation) => (
                  <div key={deviation.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                    <Badge tone={deviation.status === 'open' ? 'danger' : 'success'}>{deviation.id}</Badge>
                    <div className="grow">
                      <div className="cell-primary">{deviation.summary}</div>
                      <div className="cell-sub">
                        Raised by {users.name(deviation.raisedBy)} · {relative(deviation.raisedAt)}
                        {deviation.disposition && ` · Disposition: ${deviation.disposition}`}
                      </div>
                    </div>
                    {deviation.status === 'open' && can('production.release') && (
                      <CloseDeviation workOrderId={wo.id} deviationId={deviation.id} onDone={refresh} />
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="col">
          <Section title="Run summary" icon="factory">
            <KeyValue
              items={[
                { label: 'Stage', value: <StatusBadge list={WORK_ORDER_STAGES} value={wo.stage} /> },
                { label: 'Line', value: wo.line || '—' },
                { label: 'Planned', value: `${number(wo.plannedQty)} ${wo.uom}` },
                { label: 'Actual', value: wo.actualQty ? `${number(wo.actualQty)} ${wo.uom}` : '—' },
                { label: 'Yield', value: wo.yieldPct ? percent(wo.yieldPct, 1) : '—' },
                { label: 'Planned start', value: date(wo.plannedStart) },
                { label: 'Planned end', value: date(wo.plannedEnd) },
                { label: 'Actual start', value: dateTime(wo.actualStart) },
                { label: 'Supervisor', value: users.name(wo.supervisorId) },
                { label: 'Operators', value: wo.operatorIds.map((operatorId) => users.name(operatorId)).join(', ') || '—' },
                { label: 'Released by', value: wo.releasedBy ? `${users.name(wo.releasedBy)} · ${date(wo.releasedAt)}` : '—' },
                { label: 'In this stage', value: relative(wo.stageEnteredAt) },
              ]}
            />
          </Section>

          {writable && wo.stage !== 'planned' && (
            <Section title="Record output" icon="scale" subtitle="Posts finished goods and computes the yield">
              <RecordOutput workOrderId={wo.id} plannedQty={wo.plannedQty} actualQty={wo.actualQty} onDone={refresh} />
            </Section>
          )}

          <Section title="Stage history" icon="history">
            <div className="timeline">
              {[
                { label: 'Created', at: wo.createdAt, tone: 'neutral' },
                ...(wo.actualStart ? [{ label: 'Run started', at: wo.actualStart, tone: 'progress' }] : []),
                ...(wo.actualEnd ? [{ label: 'Run finished', at: wo.actualEnd, tone: 'success' }] : []),
                ...(wo.releasedAt ? [{ label: 'Released by QA', at: wo.releasedAt, tone: 'success' }] : []),
              ].map((entry) => (
                <div className="timeline-item" key={entry.label}>
                  <span className="timeline-mark" data-tone={entry.tone}><Icon name="clock" size={11} /></span>
                  <div className="timeline-body">
                    <div className="timeline-title">{entry.label}</div>
                    <div className="timeline-meta">{dateTime(entry.at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>

      {issueRow !== null && availability && (
        <IssueMaterial
          workOrderId={wo.id}
          index={issueRow}
          row={availability.rows[issueRow]}
          onClose={() => setIssueRow(null)}
          onDone={() => { setIssueRow(null); refresh(); }}
        />
      )}

      <RaiseDeviation open={deviationOpen} onClose={() => setDeviationOpen(false)} workOrderId={wo.id} onDone={() => { setDeviationOpen(false); refresh(); }} />
    </div>
  );
}

function QcRecorder({ workOrderId, index, onDone }: { workOrderId: string; index: number; onDone: () => void }) {
  const { error } = useUi();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState('');
  const [status, setStatus] = useState('pass');

  const save = async () => {
    try {
      await api.post(`/production/${workOrderId}/qc/${index}`, { result, status });
      setOpen(false);
      onDone();
    } catch (err) { error(err); }
  };

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>Record</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record the result"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={!result} onClick={save}>Save</button>
          </>
        }
      >
        <div className="col">
          <Field label="Measured result">
            <input className="input input-mono" value={result} onChange={(e) => setResult(e.target.value)} placeholder="e.g. 3.4%" autoFocus />
          </Field>
          <Field label="Outcome" hint="A failed check puts the batch on QC hold immediately.">
            <Select value={status} onChange={setStatus} options={[{ value: 'pass', label: 'Pass' }, { value: 'fail', label: 'Fail' }, { value: 'pending', label: 'Still pending' }]} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

function IssueMaterial({ workOrderId, index, row, onClose, onDone }: {
  workOrderId: string; index: number;
  row: Availability['rows'][number];
  onClose: () => void; onDone: () => void;
}) {
  const { error, success } = useUi();
  const remaining = Math.max(0, row.plannedQty - row.issuedQty);
  const [lotId, setLotId] = useState(row.lots[0]?.id ?? '');
  const [amount, setAmount] = useState(remaining);
  const [busy, setBusy] = useState(false);

  const issue = async () => {
    setBusy(true);
    try {
      await api.post(`/production/${workOrderId}/issue`, { index, lotId, qty: amount });
      success('Material issued', `${qty(amount, row.uom)} of ${row.name} drawn from stock.`);
      onDone();
    } catch (err) {
      error(err);
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Issue ${row.name}`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!lotId || amount <= 0 || busy} onClick={issue}>
            {busy ? <span className="spinner" /> : <Icon name="arrow-right" size={14} />} Issue to batch
          </button>
        </>
      }
    >
      <div className="col">
        <KeyValue items={[
          { label: 'Planned', value: qty(row.plannedQty, row.uom) },
          { label: 'Already issued', value: qty(row.issuedQty, row.uom) },
          { label: 'Remaining', value: qty(remaining, row.uom) },
        ]} />

        <Field label="Lot" hint="Only released lots can be issued. Oldest expiry first.">
          <Select
            value={lotId}
            onChange={setLotId}
            options={row.lots.map((lot) => ({
              value: lot.id,
              label: `${lot.lotNumber} — ${qty(lot.qtyOnHand, lot.uom)} on hand${lot.expiresAt ? ` · expires ${date(lot.expiresAt)}` : ''}`,
            }))}
            placeholder={row.lots.length ? undefined : 'No released stock available'}
          />
        </Field>

        <Field label={`Quantity (${row.uom})`}>
          <NumberInput value={amount} onChange={setAmount} step="0.001" min={0} />
        </Field>

        {row.short > 0 && (
          <div className="flag" data-tone="warning">
            <span className="flag-mark"><Icon name="alert" size={15} /></span>
            <div className="flag-detail">
              This line is short {qty(row.short, row.uom)} of released stock. Issue what is available and raise a purchase order, or ask quality to release a quarantined lot.
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function RecordOutput({ workOrderId, plannedQty, actualQty, onDone }: {
  workOrderId: string; plannedQty: number; actualQty: number; onDone: () => void;
}) {
  const { error, success } = useUi();
  const [value, setValue] = useState(actualQty || plannedQty);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/production/${workOrderId}/output`, { actualQty: value });
      success('Output recorded', `Yield ${percent((value / Math.max(1, plannedQty)) * 100, 1)}`);
      onDone();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <div className="col">
      <Field label="Actual units produced">
        <NumberInput value={value} onChange={setValue} min={0} />
      </Field>
      <div className="row">
        <span className="cell-sub grow">Yield {percent((value / Math.max(1, plannedQty)) * 100, 1)} against {number(plannedQty)} planned</span>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>Record</button>
      </div>
    </div>
  );
}

function RaiseDeviation({ open, onClose, workOrderId, onDone }: {
  open: boolean; onClose: () => void; workOrderId: string; onDone: () => void;
}) {
  const { error } = useUi();
  const [summary, setSummary] = useState('');

  const save = async () => {
    try {
      await api.post(`/production/${workOrderId}/deviations`, { summary });
      setSummary('');
      onDone();
    } catch (err) { error(err); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Raise a deviation"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={summary.trim().length < 8} onClick={save}>Raise</button>
        </>
      }
    >
      <Field label="What happened" hint="Raising a deviation puts the batch on QC hold until quality dispositions it.">
        <TextArea value={summary} onChange={setSummary} rows={4} placeholder="Describe the event, when it happened, and any product that may be affected." />
      </Field>
    </Modal>
  );
}

function CloseDeviation({ workOrderId, deviationId, onDone }: {
  workOrderId: string; deviationId: string; onDone: () => void;
}) {
  const { error } = useUi();
  const [open, setOpen] = useState(false);
  const [disposition, setDisposition] = useState('');

  const close = async () => {
    try {
      await api.patch(`/production/${workOrderId}/deviations/${deviationId}`, { status: 'closed', disposition });
      setOpen(false);
      onDone();
    } catch (err) { error(err); }
  };

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>Close out</button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Close the deviation"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={disposition.trim().length < 8} onClick={close}>Close</button>
          </>
        }
      >
        <Field label="Disposition" hint="What was decided, and what happens to the affected product.">
          <TextArea value={disposition} onChange={setDisposition} rows={4} />
        </Field>
      </Modal>
    </>
  );
}
