import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import { BarChart, Card, CardHead, DataTable, Donut, Loading, type Column } from '../components/ui';
import { api } from '../lib/api';
import { useViewing } from '../lib/realtime';
import { compact, money, number } from '../lib/format';

interface Overview {
  throughput: { week: string; units: number }[];
  inventory: { rows: { item: string; itemCode: string; qty: number; uom: string; value: number }[]; total: number };
  pipeline: { counts: Record<string, number>; won: number; lost: number; winRate: number; openValue: number; open: number };
  delivery: { total: number; onTime: number; late: number; rate: number; rows: { orderNumber: string; promised: string; shipped: string; onTime: boolean }[] };
}

function ExportLink({ report }: { report: string }) {
  return (
    <a className="btn btn-sm" href={`/api/reports/export/${report}`} download>
      <Icon name="download" size={13} /> Export CSV
    </a>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <div className="card-body">
        <div className="cell-sub" style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 'var(--t-xs)' }}>{label}</div>
        <div style={{ fontSize: '1.7rem', fontWeight: 700, marginTop: 4 }}>{value}</div>
        {sub && <div className="cell-sub">{sub}</div>}
      </div>
    </Card>
  );
}

export function Reports() {
  useViewing('reports');
  const { data, isLoading } = useQuery<Overview>({ queryKey: ['reports', 'overview'], queryFn: () => api.get('/reports/overview') });

  if (isLoading || !data) return <div className="page"><Loading rows={8} /></div>;

  const weeksLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const totalProduced = data.throughput.reduce((s, w) => s + w.units, 0);

  const invCols: Column<{ item: string; itemCode: string; qty: number; uom: string; value: number }>[] = [
    { key: 'code', header: 'Code', sortValue: (r) => r.itemCode, render: (r) => <span className="mono cell-sub">{r.itemCode || '—'}</span> },
    { key: 'item', header: 'Item', sortValue: (r) => r.item, render: (r) => <span className="truncate">{r.item}</span> },
    { key: 'qty', header: 'On hand', numeric: true, sortValue: (r) => r.qty, render: (r) => `${number(r.qty, 2)} ${r.uom}` },
    { key: 'value', header: 'Value', numeric: true, sortValue: (r) => r.value, render: (r) => money(r.value, 2) },
  ];
  const delCols: Column<{ orderNumber: string; promised: string; shipped: string; onTime: boolean }>[] = [
    { key: 'order', header: 'Order', sortValue: (r) => r.orderNumber, render: (r) => <span className="mono">{r.orderNumber}</span> },
    { key: 'promised', header: 'Promised', sortValue: (r) => r.promised, render: (r) => r.promised },
    { key: 'shipped', header: 'Shipped', sortValue: (r) => r.shipped, render: (r) => r.shipped },
    { key: 'ontime', header: 'On time', sortValue: (r) => String(r.onTime), render: (r) => r.onTime ? <span className="tone-text" data-tone="success">On time</span> : <span className="tone-text" data-tone="danger">Late</span> },
  ];

  return (
    <div className="page page-wide">
      <PageHeader title="Reports" subtitle="Live rollups off the operating data — export any of them to a spreadsheet." />

      <div className="grid-4" style={{ marginBottom: 'var(--s-4)' }}>
        <Stat label="Produced (12 wk)" value={compact(totalProduced)} sub="finished units" />
        <Stat label="Inventory value" value={money(data.inventory.total, 0)} sub={`${data.inventory.rows.length} items on hand`} />
        <Stat label="Quote win rate" value={`${data.pipeline.winRate}%`} sub={`${data.pipeline.won} won · ${data.pipeline.lost} lost`} />
        <Stat label="On-time delivery" value={`${data.delivery.rate}%`} sub={`${data.delivery.onTime}/${data.delivery.total} orders`} />
      </div>

      <Card style={{ marginBottom: 'var(--s-4)' }}>
        <CardHead title="Production throughput" subtitle="Finished units per week, last 12 weeks" icon="factory" actions={<ExportLink report="production-throughput" />} />
        <div className="card-body">
          <BarChart data={data.throughput.map((w) => ({ label: weeksLabel(w.week), value: w.units }))} height={180} format={(v) => `${compact(v)} units`} />
        </div>
      </Card>

      <div className="split">
        <Card>
          <CardHead title="Inventory valuation" subtitle={`${money(data.inventory.total, 2)} on hand`} icon="boxes" actions={<ExportLink report="inventory-valuation" />} />
          <DataTable columns={invCols} rows={data.inventory.rows.slice(0, 25).map((r, i) => ({ ...r, id: String(i) }))} />
        </Card>

        <div className="col">
          <Card>
            <CardHead title="Quote pipeline" subtitle={`${data.pipeline.open} open · ${money(data.pipeline.openValue, 0)} potential`} icon="clipboard" actions={<ExportLink report="quote-pipeline" />} />
            <div className="card-body row" style={{ alignItems: 'center', gap: 'var(--s-5)' }}>
              <Donut value={data.pipeline.won} total={Math.max(1, data.pipeline.won + data.pipeline.lost)} tone="success" label={`${data.pipeline.winRate}%`} sublabel="win rate" />
              <div className="col-tight">
                {Object.entries(data.pipeline.counts).map(([status, count]) => (
                  <div key={status} className="row-tight"><span className="cell-sub" style={{ width: 90, textTransform: 'capitalize' }}>{status}</span><strong>{count}</strong></div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="On-time delivery" subtitle={`${data.delivery.rate}% on time`} icon="truck" actions={<ExportLink report="on-time-delivery" />} />
            <DataTable columns={delCols} rows={data.delivery.rows.slice(0, 12).map((r, i) => ({ ...r, id: String(i) }))} />
          </Card>
        </div>
      </div>
    </div>
  );
}
