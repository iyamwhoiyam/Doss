import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOrders } from '../lib/queries';
import { ErrorNotice, Loading, Pill, dateStr, money } from '../components/bits';
import type { ProductionOrder } from '../lib/types';

/* The 8 stages of the order ladder, from erp_gate_catalog. */
const STAGES = [
  { no: 1, name: 'Order Intake' },
  { no: 2, name: 'Docs Ready' },
  { no: 3, name: 'Deposit' },
  { no: 4, name: 'Purchasing' },
  { no: 5, name: 'Incoming QC' },
  { no: 6, name: 'Production' },
  { no: 7, name: 'Release QC' },
  { no: 8, name: 'Fulfillment' },
];

export default function Orders() {
  const orders = useOrders();
  const [q, setQ] = useState('');
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [view, setView] = useState<'board' | 'list'>('board');

  const filtered = useMemo(() => {
    if (!orders.data) return [];
    const needle = q.trim().toLowerCase();
    return orders.data.filter((o) => {
      if (onlyBlocked && !o.blocked) return false;
      if (!needle) return true;
      return [o.ref, o.customer, o.product, o.sales_rep, o.so_no, o.customer_po]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(needle));
    });
  }, [orders.data, q, onlyBlocked]);

  if (orders.isLoading) return <Loading what="production orders" />;
  if (orders.error) return <ErrorNotice error={orders.error} />;

  const totalValue = filtered.reduce((s, o) => s + (o.amount ?? 0), 0);
  const blockedCount = filtered.filter((o) => o.blocked).length;

  return (
    <>
      <div className="page__head">
        <h1>Production Orders</h1>
        <span className="dim">
          {filtered.length} orders · {money(totalValue)} · {blockedCount} blocked
        </span>
        <div className="page__spacer" />
        <button className={`chip${view === 'board' ? ' active' : ''}`} onClick={() => setView('board')}>
          Board
        </button>
        <button className={`chip${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>
          List
        </button>
      </div>

      <div className="filters">
        <input
          type="search"
          placeholder="Search ref, customer, product, rep…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className={`chip${onlyBlocked ? ' active' : ''}`} onClick={() => setOnlyBlocked(!onlyBlocked)}>
          ⛔ Blocked only
        </button>
      </div>

      {view === 'board' ? <Board orders={filtered} /> : <List orders={filtered} />}
    </>
  );
}

function Board({ orders }: { orders: ProductionOrder[] }) {
  return (
    <div className="board">
      {STAGES.map((s) => {
        const lane = orders.filter((o) => o.stage === s.no);
        const laneValue = lane.reduce((sum, o) => sum + (o.amount ?? 0), 0);
        return (
          <div className="lane" key={s.no}>
            <div className="lane__head">
              {s.name}
              <span className="lane__count">
                {lane.length} · {money(laneValue)}
              </span>
            </div>
            <div className="lane__body">
              {lane.length === 0 && <div className="empty">—</div>}
              {lane.map((o) => (
                <OrderCard key={o.id} o={o} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrderCard({ o }: { o: ProductionOrder }) {
  return (
    <Link className={`ocard${o.blocked ? ' ocard--blocked' : ''}`} to={`/orders/${encodeURIComponent(o.ref)}`}>
      <div className="ocard__top">
        <span className="ocard__ref">{o.ref}</span>
        <span className="ocard__amount">{money(o.amount)}</span>
      </div>
      <div className="ocard__title">{o.product || '(untitled)'}</div>
      <div className="ocard__cust">
        {o.customer || '—'}
        {o.delivery_date ? ` · due ${dateStr(o.delivery_date)}` : ''}
      </div>
      <div className="progress" aria-hidden="true">
        <i style={{ width: `${o.pct ?? 0}%` }} />
      </div>
      <div className="ocard__foot">
        {o.blocked ? <Pill tone="bad">blocked</Pill> : <Pill tone="ok">{o.pct ?? 0}%</Pill>}
        {o.next_gate && (
          <span className="ocard__next">
            → {o.next_gate.replace(/_/g, ' ')} ({o.next_owner ?? o.next_dept ?? '?'})
          </span>
        )}
      </div>
    </Link>
  );
}

function List({ orders }: { orders: ProductionOrder[] }) {
  return (
    <div className="tablewrap">
      <table className="table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Customer</th>
            <th>Product</th>
            <th>Stage</th>
            <th>Next gate</th>
            <th>Owner</th>
            <th className="right">Amount</th>
            <th>Due</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr
              key={o.id}
              className="rowlink"
              onClick={() => (window.location.href = `/orders/${encodeURIComponent(o.ref)}`)}
            >
              <td className="mono accent">{o.ref}</td>
              <td className="strong">{o.customer || '—'}</td>
              <td>{o.product || '—'}</td>
              <td>{o.stage_name ?? o.stage ?? '—'}</td>
              <td>{o.next_gate?.replace(/_/g, ' ') ?? '—'}</td>
              <td>{o.next_owner ?? o.next_dept ?? '—'}</td>
              <td className="right mono">{money(o.amount)}</td>
              <td className="mono">{dateStr(o.delivery_date)}</td>
              <td>{o.blocked ? <Pill tone="bad">blocked</Pill> : <Pill tone="ok">{o.pct ?? 0}%</Pill>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
