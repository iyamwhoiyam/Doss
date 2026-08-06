import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useOrder, useOrderGates, useSetGateStatus, useUpdateOrder } from '../lib/queries';
import { useActor } from '../lib/session';
import { ErrorNotice, Loading, Pill, StatusPill, dateStr, money, num } from '../components/bits';
import type { GateStatus, OrderGate } from '../lib/types';

export default function OrderDetail() {
  const { ref } = useParams<{ ref: string }>();
  const order = useOrder(ref);
  const gates = useOrderGates(ref);
  const actor = useActor();
  const setGate = useSetGateStatus(actor);
  const updateOrder = useUpdateOrder(actor);

  const [modal, setModal] = useState<{ gate: OrderGate; status: GateStatus } | null>(null);
  const [note, setNote] = useState('');

  if (order.isLoading) return <Loading what={`order ${ref}`} />;
  if (order.error) return <ErrorNotice error={order.error} />;
  if (!order.data)
    return (
      <div className="notice notice--info">
        No order with ref <b className="mono">{ref}</b>. <Link to="/orders" className="accent">Back to the board</Link>.
      </div>
    );

  const o = order.data;
  const gateRows = gates.data ?? [];
  const firstOpen = gateRows.find((g) => g.status !== 'done');

  function openModal(gate: OrderGate, status: GateStatus) {
    setNote(gate.note ?? '');
    setModal({ gate, status });
  }

  async function confirmModal() {
    if (!modal) return;
    await setGate.mutateAsync({ gate: modal.gate, status: modal.status, note: note || undefined });
    setModal(null);
  }

  return (
    <>
      <div className="page__head">
        <h1>
          <span className="mono accent">{o.ref}</span> {o.product || ''}
        </h1>
        {o.blocked ? <Pill tone="bad">blocked</Pill> : <Pill tone="ok">{o.pct ?? 0}%</Pill>}
        <div className="page__spacer" />
        <button
          className={`btn btn--sm ${o.blocked ? 'btn--primary' : 'btn--danger'}`}
          disabled={updateOrder.isPending}
          onClick={() =>
            updateOrder.mutate({
              order: o,
              patch: { blocked: !o.blocked, status: o.blocked ? 'active' : 'blocked' },
            })
          }
        >
          {o.blocked ? 'Clear block' : 'Mark blocked'}
        </button>
      </div>
      <p className="page__sub">
        {o.customer || 'no customer'} · {o.sales_rep ? `rep ${o.sales_rep}` : 'no rep'} ·{' '}
        {o.qty ? `${num(o.qty)} ${o.unit ?? 'units'}` : 'no qty'} · {money(o.amount)}
      </p>

      <div className="detail">
        <div className="card">
          <div className="card__head">
            Gate ladder
            <span className="dim">
              {gateRows.filter((g) => g.status === 'done').length}/{gateRows.length} complete
            </span>
          </div>
          <div className="card__body">
            {gates.isLoading ? (
              <Loading what="gates" />
            ) : gateRows.length === 0 ? (
              <div className="empty">This order has no gate rows yet.</div>
            ) : (
              <div className="ladder">
                {gateRows.map((g) => {
                  const cls =
                    g.status === 'done'
                      ? 'gate--done'
                      : g.status === 'blocked'
                        ? 'gate--blocked'
                        : g.id === firstOpen?.id
                          ? 'gate--current'
                          : '';
                  return (
                    <div className={`gate ${cls}`} key={g.id}>
                      <span className="gate__dot" aria-hidden="true" />
                      <div>
                        <div className="gate__name">{g.gate_key.replace(/_/g, ' ')}</div>
                        <div className="gate__meta">
                          {g.stage_name} · {g.department ?? '—'} · {g.owner ?? 'unassigned'}
                          {g.status_date ? ` · ${dateStr(g.status_date)}` : ''}
                        </div>
                      </div>
                      <div className="gate__actions">
                        {g.status !== 'done' && (
                          <button
                            className="btn btn--primary btn--sm"
                            disabled={setGate.isPending}
                            onClick={() => openModal(g, 'done')}
                          >
                            Done
                          </button>
                        )}
                        {g.status !== 'blocked' && g.status !== 'done' && (
                          <button
                            className="btn btn--danger btn--sm"
                            disabled={setGate.isPending}
                            onClick={() => openModal(g, 'blocked')}
                          >
                            Block
                          </button>
                        )}
                        {(g.status === 'blocked' || g.status === 'done') && (
                          <button
                            className="btn btn--ghost btn--sm"
                            disabled={setGate.isPending}
                            onClick={() => openModal(g, 'in_progress')}
                          >
                            Reopen
                          </button>
                        )}
                      </div>
                      {g.note && <div className="gate__note">{g.note}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card__head">Order facts</div>
            <div className="card__body">
              <dl className="kv">
                <dt>Status</dt>
                <dd><StatusPill status={o.status} /></dd>
                <dt>Stage</dt>
                <dd>{o.stage_name ?? o.stage ?? '—'}</dd>
                <dt>Next gate</dt>
                <dd>{o.next_gate?.replace(/_/g, ' ') ?? '—'} ({o.next_owner ?? o.next_dept ?? '?'})</dd>
                <dt>SO / PO</dt>
                <dd className="mono">{o.so_no ?? '—'} / {o.customer_po ?? '—'}</dd>
                <dt>MO refs</dt>
                <dd className="mono">{o.mo_refs ?? '—'}</dd>
                <dt>Project</dt>
                <dd>
                  {o.project_pn ? (
                    <Link className="accent mono" to={`/projects/${encodeURIComponent(o.project_pn)}`}>
                      {o.project_pn}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt>Contract date</dt>
                <dd className="mono">{dateStr(o.contract_date)}</dd>
                <dt>Delivery date</dt>
                <dd className="mono">{dateStr(o.delivery_date)}</dd>
                <dt>Deposit</dt>
                <dd>{o.deposit_received ? <Pill tone="ok">received</Pill> : <Pill tone="warn">outstanding</Pill>}</dd>
                <dt>Final payment</dt>
                <dd>{o.final_received ? <Pill tone="ok">received</Pill> : <Pill tone="warn">outstanding</Pill>}</dd>
                <dt>Unit price</dt>
                <dd className="mono">{o.unit_price != null ? money(o.unit_price, 4) : '—'}</dd>
              </dl>
            </div>
          </div>

          {(o.docs_outstanding?.length ?? 0) > 0 && (
            <div className="card">
              <div className="card__head">Documents outstanding</div>
              <div className="card__body">
                {o.docs_outstanding!.map((d) => (
                  <Pill key={d} tone="warn">{d.replace(/_/g, ' ')}</Pill>
                ))}{' '}
              </div>
            </div>
          )}

          {o.order_issues && (
            <div className="card">
              <div className="card__head">Issues / notes</div>
              <div className="card__body mid" style={{ whiteSpace: 'pre-wrap' }}>
                {o.order_issues}
              </div>
            </div>
          )}
        </div>
      </div>

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {modal.status === 'done'
                ? 'Complete gate'
                : modal.status === 'blocked'
                  ? 'Block gate'
                  : 'Reopen gate'}
              : {modal.gate.gate_key.replace(/_/g, ' ')}
            </h3>
            <textarea
              placeholder={modal.status === 'blocked' ? 'Why is it blocked? (required)' : 'Note (optional)'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoFocus
            />
            <div className="modal__actions">
              <button className="btn btn--ghost btn--sm" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                className={`btn btn--sm ${modal.status === 'blocked' ? 'btn--danger' : 'btn--primary'}`}
                disabled={setGate.isPending || (modal.status === 'blocked' && !note.trim())}
                onClick={confirmModal}
              >
                {setGate.isPending ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
