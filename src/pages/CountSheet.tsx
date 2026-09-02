import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Badge, Card, CardHead, KeyValue, Loading, Section } from '../components/ui';
import { api } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing, useAlsoHere } from '../lib/realtime';
import { useLocations, useUsers } from '../lib/lookups';
import { date, dateTime, money, number, relative } from '../lib/format';
import type { CountLine, CycleCount } from '../lib/types';

const STATUS_TONE: Record<string, string> = { scheduled: 'neutral', counting: 'progress', review: 'warning', closed: 'success', cancelled: 'danger' };
const STATUS_BLURB: Record<string, string> = {
  scheduled: 'Sheet is ready. Start counting when the team is on the floor.',
  counting: 'Enter what is physically there for each lot. Save moves to the next line.',
  review: 'Compare counted against book. Recount anything outside tolerance, then post.',
  closed: 'Posted. Every adjusted lot has a count transaction in the ledger.',
  cancelled: 'Cancelled. Nothing was adjusted.',
};

/** One editable line: an input that saves on Enter or blur. */
function CountInput({ line, index, disabled, onSave, autoFocus }: {
  line: CountLine; index: number; disabled: boolean; autoFocus: boolean; onSave: (index: number, value: number | null) => Promise<void>;
}) {
  const [value, setValue] = useState(line.countedQty === null || line.countedQty === undefined ? '' : String(line.countedQty));
  useEffect(() => { setValue(line.countedQty === null || line.countedQty === undefined ? '' : String(line.countedQty)); }, [line.countedQty]);
  const commit = async () => {
    const next = value.trim() === '' ? null : Number(value);
    if (next === (line.countedQty ?? null)) return;
    if (next !== null && (!Number.isFinite(next) || next < 0)) return;
    await onSave(index, next);
  };
  return (
    <input
      className="input mono"
      style={{ width: 120, textAlign: 'right' }}
      inputMode="decimal"
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder="—"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit().then(() => {
            const inputs = [...document.querySelectorAll<HTMLInputElement>('input[data-count-line]')];
            inputs[inputs.findIndex((el) => el === e.currentTarget) + 1]?.focus();
          });
        }
      }}
      data-count-line={index}
      aria-label={`Counted quantity for ${line.lotNumber}`}
    />
  );
}

export function CountSheet() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { error, success, confirm } = useUi();
  const { can } = useSession();
  const locations = useLocations();
  const users = useUsers();

  const { data: count, isLoading } = useQuery<CycleCount>({
    queryKey: ['inventory', 'count', id],
    queryFn: () => api.get<CycleCount>(`/inventory/counts/${id}`),
    enabled: Boolean(id),
  });
  useViewing(count ? count.countNumber : null);
  const alsoHere = useAlsoHere(count ? count.countNumber : null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showBook, setShowBook] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
    queryClient.invalidateQueries({ queryKey: ['collection', 'cycleCounts'] });
    queryClient.invalidateQueries({ queryKey: ['collection', 'lots'] });
    queryClient.invalidateQueries({ queryKey: ['collection', 'inventoryTxns'] });
  };

  if (isLoading || !count) return <div className="page"><Loading rows={8} /></div>;

  const writable = can('inventory.write');
  const open = !['closed', 'cancelled'].includes(count.status);
  const editable = writable && ['scheduled', 'counting', 'review'].includes(count.status);
  const summary = count.summary!;
  // Blind counts hide the book figure while the sheet is being counted.
  const blindNow = Boolean(count.blind) && ['scheduled', 'counting'].includes(count.status) && !showBook;

  const act = async (path: string, body?: unknown, okMessage?: string) => {
    try {
      await api.post(`/inventory/counts/${count.id}/${path}`, body);
      refresh();
      if (okMessage) success(okMessage);
    } catch (err) { error(err); }
  };
  const saveLine = async (index: number, value: number | null) => {
    try {
      await api.post(`/inventory/counts/${count.id}/lines/${index}`, { countedQty: value });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'count', id] });
    } catch (err) { error(err); }
  };
  const toReview = async () => {
    if (summary.counted < summary.lines) {
      const ok = await confirm({ title: 'Some lots have no count', body: `${summary.lines - summary.counted} of ${summary.lines} lots are uncounted. They will be left as they are in the book.`, confirmLabel: 'Go to review anyway', tone: 'warning' });
      if (!ok) return;
      return act('review', { allowUncounted: true }, 'Sheet is in review');
    }
    return act('review', {}, 'Sheet is in review');
  };
  const recount = () => {
    const indexes = selected.size ? [...selected] : count.lines.map((l, i) => (l.outOfTolerance ? i : -1)).filter((i) => i >= 0);
    if (!indexes.length) { error('Pick the lines to recount, or there must be lines outside tolerance'); return; }
    setSelected(new Set());
    return act('recount', { indexes }, `${indexes.length} line${indexes.length === 1 ? '' : 's'} sent back for recount`);
  };
  const post = async () => {
    const blocking = count.lines.filter((l) => l.outOfTolerance && !l.recount).length;
    const body = blocking
      ? `${blocking} line${blocking === 1 ? ' is' : 's are'} outside the ${count.tolerancePct}% tolerance. Posting accepts those variances as counted. Net book movement ${summary.netValue < 0 ? '−' : '+'}${money(Math.abs(summary.netValue), 2)}.`
      : `${summary.withVariance} lot${summary.withVariance === 1 ? '' : 's'} will be adjusted, net ${summary.netValue < 0 ? '−' : '+'}${money(Math.abs(summary.netValue), 2)}. Each adjustment is a count transaction in the ledger.`;
    const reason = await confirm({ title: `Post ${count.countNumber}?`, body, confirmLabel: blocking ? 'Accept variances and post' : 'Post adjustments', tone: blocking ? 'warning' : 'accent', requireReason: blocking ? 'Why are the out-of-tolerance counts being accepted?' : undefined });
    if (!reason) return;
    return act('post', { acceptOutOfTolerance: Boolean(blocking), reason }, 'Count posted — lots now match what was counted');
  };
  const cancel = async () => {
    const ok = await confirm({ title: `Cancel ${count.countNumber}?`, body: 'Nothing will be adjusted. The sheet stays on file as cancelled.', confirmLabel: 'Cancel the count', tone: 'danger' });
    if (!ok) return;
    return act('cancel', {}, 'Count cancelled');
  };

  const scopeLabel = count.scope === 'all' ? 'Whole warehouse' : count.scope === 'items' ? `${count.itemIds?.length ?? 0} selected item${(count.itemIds?.length ?? 0) === 1 ? '' : 's'}` : locations.name(count.locationId);
  const toggle = (i: number) => setSelected((cur) => { const next = new Set(cur); if (next.has(i)) next.delete(i); else next.add(i); return next; });
  let firstOpen = count.lines.findIndex((l) => l.countedQty === null || l.countedQty === undefined);
  if (firstOpen < 0) firstOpen = -1;

  return (
    <div className="page page-wide">
      <PageHeader
        back={{ to: '/inventory?tab=counts', label: 'Inventory' }}
        title={count.countNumber}
        badge={<Badge tone={STATUS_TONE[count.status] ?? 'neutral'} large>{count.status}</Badge>}
        subtitle={<>{scopeLabel} · scheduled {date(count.scheduledFor)}{count.blind ? ' · blind count' : ''} · tolerance ±{count.tolerancePct}%{alsoHere.length ? ` · ${alsoHere.map((p) => p.name).join(', ')} also here` : ''}</>}
        actions={writable && open ? (
          <>
            {count.status === 'scheduled' && <button type="button" className="btn btn-primary" onClick={() => act('start', {}, 'Counting started')}><Icon name="play" size={14} /> Start counting</button>}
            {count.status === 'counting' && <button type="button" className="btn btn-primary" onClick={toReview} disabled={summary.counted === 0}><Icon name="eye" size={14} /> Send to review</button>}
            {['counting', 'review'].includes(count.status) && <button type="button" className="btn" onClick={recount}><Icon name="refresh" size={14} /> Recount{selected.size ? ` (${selected.size})` : summary.outOfTolerance && !blindNow ? ` out-of-tolerance (${summary.outOfTolerance})` : ''}</button>}
            {['counting', 'review'].includes(count.status) && <button type="button" className={`btn ${count.status === 'review' ? 'btn-primary' : ''}`} onClick={post} disabled={summary.counted === 0}><Icon name="check" size={14} /> Post adjustments</button>}
            <button type="button" className="btn btn-ghost" onClick={cancel}><Icon name="x" size={14} /> Cancel count</button>
          </>
        ) : undefined}
      />

      <div className="grid grid-4" style={{ marginBottom: 'var(--s-4)' }}>
        <Card><div className="card-body"><div className="cell-sub">Counted</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{summary.counted}<span className="cell-sub"> / {summary.lines} lots</span></div></div></Card>
        <Card><div className="card-body"><div className="cell-sub">With variance</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }} className="tone-text" data-tone={summary.withVariance ? 'warning' : 'success'}>{blindNow ? <span className="cell-sub">hidden</span> : summary.withVariance}</div></div></Card>
        <Card><div className="card-body"><div className="cell-sub">Outside ±{count.tolerancePct}%</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }} className="tone-text" data-tone={summary.outOfTolerance ? 'danger' : 'success'}>{blindNow ? <span className="cell-sub">hidden</span> : summary.outOfTolerance}</div></div></Card>
        <Card><div className="card-body"><div className="cell-sub">Net book movement</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }} className="tone-text" data-tone={summary.netValue < 0 ? 'danger' : 'success'}>{blindNow ? <span className="cell-sub">hidden</span> : `${summary.netValue < 0 ? '−' : '+'}${money(Math.abs(summary.netValue), 0)}`}</div>{!blindNow && summary.accuracyPct != null && <div className="cell-sub">{summary.accuracyPct}% of counted lots within tolerance</div>}</div></Card>
      </div>

      <div className="detail-grid">
        <div className="col">
          <Card>
            <CardHead
              title="Count sheet"
              subtitle={STATUS_BLURB[count.status]}
              icon="clipboard"
              actions={count.blind && ['scheduled', 'counting'].includes(count.status) && can('cost.view') ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowBook((v) => !v)}><Icon name={showBook ? 'lock' : 'eye'} size={13} /> {showBook ? 'Hide book' : 'Reveal book'}</button>
              ) : undefined}
            />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {editable && ['counting', 'review'].includes(count.status) && <th style={{ width: 32 }} />}
                    <th>Item</th><th>Lot</th><th>Location</th>
                    <th className="num">Book</th><th className="num">Counted</th><th className="num">Variance</th><th className="num">Value</th><th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {count.lines.map((line, index) => {
                    const counted = line.countedQty !== null && line.countedQty !== undefined;
                    const tone = !counted || blindNow ? undefined : line.outOfTolerance ? 'danger' : line.variance ? 'warning' : 'success';
                    return (
                      <tr key={line.lotId} data-tone={line.recount && !counted ? 'warning' : undefined}>
                        {editable && ['counting', 'review'].includes(count.status) && (
                          <td><input type="checkbox" checked={selected.has(index)} onChange={() => toggle(index)} aria-label={`Select ${line.lotNumber}`} /></td>
                        )}
                        <td>
                          <Link to={`/inventory/${line.itemId}`} className="cell-primary">{line.itemName}</Link>
                          <div className="cell-sub mono">{line.itemCode}</div>
                        </td>
                        <td><span className="mono">{line.lotNumber}</span>{line.recount && <Badge tone="warning">recount</Badge>}</td>
                        <td className="cell-sub">{locations.code(line.locationId)}</td>
                        <td className="num">{blindNow ? <span className="faint" title="Blind count — book quantity is hidden until review">••••</span> : `${number(line.expectedQty, 3)} ${line.uom ?? ''}`}</td>
                        <td className="num">
                          {editable && open
                            ? <CountInput line={line} index={index} disabled={!editable} autoFocus={index === firstOpen && count.status === 'counting'} onSave={saveLine} />
                            : counted ? `${number(line.countedQty as number, 3)} ${line.uom ?? ''}` : <span className="faint">—</span>}
                        </td>
                        <td className="num">
                          {!counted || blindNow ? <span className="faint">—</span> : (
                            <span className="tone-text" data-tone={tone}>
                              {(line.variance ?? 0) > 0 ? '+' : ''}{number(line.variance ?? 0, 3)}{line.variancePct != null && line.expectedQty ? ` (${line.variancePct > 0 ? '+' : ''}${line.variancePct}%)` : ''}
                            </span>
                          )}
                        </td>
                        <td className="num">{!counted || blindNow ? <span className="faint">—</span> : <span className="tone-text" data-tone={tone}>{(line.varianceValue ?? 0) < 0 ? '−' : ''}{money(Math.abs(line.varianceValue ?? 0), 2)}</span>}</td>
                        <td className="cell-sub">{counted ? `${users.name(line.countedBy)} · ${relative(line.countedAt)}` : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="col">
          <Section title="Sheet" icon="info">
            <KeyValue items={[
              { label: 'Scope', value: scopeLabel },
              { label: 'Blind', value: count.blind ? 'Yes — book hidden while counting' : 'No' },
              { label: 'Tolerance', value: `±${count.tolerancePct}%` },
              { label: 'Scheduled', value: date(count.scheduledFor) },
              { label: 'Started', value: count.startedAt ? dateTime(count.startedAt) : '—' },
              { label: 'In review', value: count.reviewedAt ? dateTime(count.reviewedAt) : '—' },
              { label: 'Counted by', value: users.name(count.countedBy) },
              { label: count.status === 'cancelled' ? 'Cancelled by' : 'Posted by', value: count.closedBy ? `${users.name(count.closedBy)} · ${dateTime(count.closedAt)}` : '—' },
              ...(count.status === 'closed' ? [
                { label: 'Lots adjusted', value: String(count.postedLines ?? 0) },
                { label: 'Net adjustment', value: <span className="tone-text" data-tone={(count.postedValue ?? 0) < 0 ? 'danger' : 'success'}>{(count.postedValue ?? 0) < 0 ? '−' : '+'}{money(Math.abs(count.postedValue ?? 0), 2)}</span> },
              ] : []),
              ...(count.notes ? [{ label: 'Notes', value: count.notes }] : []),
            ]} />
          </Section>

          <Section title="How this works" icon="sparkles">
            <ol className="cell-sub" style={{ paddingLeft: '1.2em', margin: 0, lineHeight: 1.6 }}>
              <li><strong>Start</strong> refreshes the book quantity of every lot on the sheet.</li>
              <li><strong>Count</strong> each lot. Press Enter to save and move down the sheet.</li>
              <li><strong>Review</strong> shows the variance in units and dollars; anything past ±{count.tolerancePct}% is flagged.</li>
              <li><strong>Recount</strong> clears the flagged lines and sends the sheet back to the floor.</li>
              <li><strong>Post</strong> writes a count transaction per adjusted lot and closes the sheet.</li>
            </ol>
          </Section>
        </div>
      </div>
    </div>
  );
}
