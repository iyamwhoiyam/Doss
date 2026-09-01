import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Badge, Card, CardHead, Flag, Loading, SearchInput, Segmented } from '../components/ui';
import { api } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { number, dateShort } from '../lib/format';

interface Cell { week: string; demand: number; supply: number; planned: number; projected: number }
interface PlanItem {
  itemId: string; itemCode: string; name: string; uom: string; onHand: number; safetyStock: number;
  leadTimeDays: number; reorderQty: number; vendorId: string; vendorName: string;
  cells: Cell[]; shortWeek: string | null;
  plannedOrders: { week: string; qty: number; orderBy: string; late: boolean }[];
  sources: { type: string; ref: string; id: string; week: string; qty: number }[];
}
interface Buy { itemId: string; itemCode: string; name: string; uom: string; qty: number; week: string; orderBy: string; late: boolean; vendorId: string; vendorName: string }
interface Plan { start: string; weeks: string[]; generatedAt: string; items: PlanItem[]; buys: Buy[]; summary: { items: number; short: number; late: number; buys: number } }

const wk = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function Planning() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { error, success } = useUi();
  const { can } = useSession();
  useViewing('material planning');
  const [weeks, setWeeks] = useState<'8' | '12' | '16'>('12');
  const [search, setSearch] = useState('');
  const [onlyShort, setOnlyShort] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery<Plan>({ queryKey: ['planning', 'mrp', weeks], queryFn: () => api.get(`/planning/mrp?weeks=${weeks}`) });

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.items ?? []).filter((i) => (!onlyShort || i.shortWeek) && (!needle || `${i.itemCode} ${i.name} ${i.vendorName}`.toLowerCase().includes(needle)));
  }, [data, search, onlyShort]);

  const draftable = useMemo(() => (data?.buys ?? []).filter((b) => b.vendorId), [data]);

  const draftPos = async () => {
    // one line per item at the total planned quantity across the horizon
    const byItem = new Map<string, number>();
    for (const b of draftable) byItem.set(b.itemId, Number(((byItem.get(b.itemId) ?? 0) + b.qty).toFixed(3)));
    setBusy(true);
    try {
      const res = await api.post<{ count: number }>('/purchasing/draft-from-suggestions', {
        itemIds: [...byItem.keys()], qtyById: Object.fromEntries(byItem), note: `Planned by MRP on ${dateShort(new Date().toISOString())}`,
      });
      success(`${res.count} purchase order${res.count === 1 ? '' : 's'} drafted`, 'Grouped by vendor at the planned quantities. Review and approve them in Purchasing.');
      queryClient.invalidateQueries({ queryKey: ['planning'] });
      queryClient.invalidateQueries({ queryKey: ['collection', 'purchaseOrders'] });
      navigate('/purchasing');
    } catch (err) { error(err, 'Could not draft purchase orders'); } finally { setBusy(false); }
  };

  if (isLoading || !data) return <div className="page"><Loading rows={8} /></div>;
  const noVendor = (data.buys ?? []).filter((b) => !b.vendorId);

  return (
    <div className="page page-wide">
      <PageHeader
        title="Planning"
        subtitle={`Material requirements, ${data.weeks.length} weeks out · ${data.summary.short} short · ${data.summary.buys} planned buys${data.summary.late ? ` · ${data.summary.late} already late` : ''}`}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Item, code, vendor…" />
            <Segmented value={weeks} onChange={setWeeks} options={[{ value: '8', label: '8 wk' }, { value: '12', label: '12 wk' }, { value: '16', label: '16 wk' }]} />
            <button type="button" className={`btn${onlyShort ? ' btn-primary' : ''}`} onClick={() => setOnlyShort((v) => !v)}>
              <Icon name="alert" size={13} /> Shortages only
            </button>
            {can('po.write') && draftable.length > 0 && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={draftPos}>
                {busy ? <span className="spinner" /> : <Icon name="truck" size={14} />} Draft {new Set(draftable.map((b) => b.itemId)).size} purchase orders
              </button>
            )}
          </>
        }
      />

      {data.summary.late > 0 && (
        <Flag tone="danger" title={`${data.summary.late} planned buy${data.summary.late === 1 ? ' is' : 's are'} already past the order-by date`} detail="Lead time means these cannot arrive before they are needed. Expedite, substitute, or re-plan the batch." />
      )}
      {noVendor.length > 0 && (
        <Flag tone="warning" title={`${new Set(noVendor.map((b) => b.itemId)).size} short item${new Set(noVendor.map((b) => b.itemId)).size === 1 ? ' has' : 's have'} no preferred vendor`} detail="Set a preferred vendor on the item to include it in drafted purchase orders." />
      )}

      <Card style={{ marginTop: 'var(--s-4)' }}>
        <CardHead
          title="Projected on-hand by week"
          subtitle="Demand from open batches and the order book · supply from open purchase orders · a planned buy raises the balance back to safety stock"
          icon="target"
          actions={<span className="cell-sub">{items.length} of {data.items.length} items</span>}
        />
        <div className="mrp-scroll">
          <table className="mrp">
            <thead>
              <tr>
                <th className="mrp-item">Item</th>
                <th className="right">On hand</th>
                {data.weeks.map((w) => <th key={w} className="right mrp-week">{wk(w)}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <Fragment key={item.itemId}>
                  <tr className="mrp-row" data-short={item.shortWeek ? 'true' : undefined} onClick={() => setOpen(open === item.itemId ? null : item.itemId)}>
                    <td className="mrp-item">
                      <div className="cell-primary truncate">{item.name}</div>
                      <div className="cell-sub"><span className="mono">{item.itemCode}</span> · {item.uom} · lead {item.leadTimeDays}d{item.vendorName ? ` · ${item.vendorName}` : ''}</div>
                    </td>
                    <td className="right">{number(item.onHand, 1)}</td>
                    {item.cells.map((c) => {
                      // A planned buy means the balance would have fallen below safety here:
                      // red if that buy is already too late to arrive in time, amber if it is on time.
                      const late = item.plannedOrders.find((p) => p.week === c.week)?.late;
                      const tone = c.projected < 0 || (c.planned > 0 && late) ? 'danger' : c.planned > 0 ? 'warning' : undefined;
                      return (
                        <td key={c.week} className="right mrp-cell" data-tone={tone} title={`Week of ${wk(c.week)}\nDemand ${number(c.demand, 2)} · Supply ${number(c.supply, 2)}${c.planned ? ` · Planned buy ${number(c.planned, 2)}` : ''}\nProjected ${number(c.projected, 2)} ${item.uom}`}>
                          <div className="mrp-proj">{number(c.projected, 0)}</div>
                          {(c.demand > 0 || c.supply > 0 || c.planned > 0) && (
                            <div className="mrp-flow">
                              {c.demand > 0 && <span className="mrp-d">−{number(c.demand, 0)}</span>}
                              {c.supply > 0 && <span className="mrp-s">+{number(c.supply, 0)}</span>}
                              {c.planned > 0 && <span className="mrp-p">▲{number(c.planned, 0)}</span>}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {open === item.itemId && (
                    <tr key={`${item.itemId}-detail`} className="mrp-detail">
                      <td colSpan={2 + data.weeks.length}>
                        <div className="row" style={{ gap: 'var(--s-6)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          <div>
                            <div className="cell-sub" style={{ marginBottom: 4 }}>Planned buys</div>
                            {item.plannedOrders.length === 0 && <div className="cell-sub">None — covered through the horizon.</div>}
                            {item.plannedOrders.map((p) => (
                              <div key={p.week} className="row-tight">
                                <Badge tone={p.late ? 'danger' : 'info'}>{number(p.qty, 1)} {item.uom}</Badge>
                                <span className="cell-sub">for week of {wk(p.week)} · order by <strong>{wk(p.orderBy)}</strong>{p.late ? ' — late' : ''}</span>
                              </div>
                            ))}
                          </div>
                          <div>
                            <div className="cell-sub" style={{ marginBottom: 4 }}>Driven by</div>
                            {item.sources.slice(0, 8).map((s, i) => (
                              <div key={i} className="row-tight">
                                <Badge tone={s.type === 'purchaseOrder' ? 'success' : 'neutral'}>{s.type === 'purchaseOrder' ? 'supply' : 'demand'}</Badge>
                                <button type="button" className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); navigate(s.type === 'workOrder' ? `/production/${s.id}` : s.type === 'salesOrder' ? `/orders/${s.id}` : `/purchasing/${s.id}`); }}>
                                  <span className="mono">{s.ref}</span>
                                </button>
                                <span className="cell-sub">{number(s.qty, 1)} {item.uom} · {wk(s.week)}</span>
                              </div>
                            ))}
                            {item.sources.length > 8 && <div className="cell-sub">+{item.sources.length - 8} more</div>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={2 + data.weeks.length} className="cell-sub" style={{ padding: 'var(--s-5)' }}>Nothing to plan — no open batches or uncovered orders create requirements in this window.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="cell-sub" style={{ marginTop: 'var(--s-3)' }}>
        Click a row for its planned buys and what drives them. Each cell is projected on-hand after that week; <span className="mrp-d">−demand</span> <span className="mrp-s">+supply</span> <span className="mrp-p">▲planned buy</span>. Amber: a buy is needed that week. Red: it is already past its order-by date.
      </p>
    </div>
  );
}
