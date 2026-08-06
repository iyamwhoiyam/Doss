import { useShipments } from '../lib/queries';
import { Empty, ErrorNotice, Loading, dateStr, money, num } from '../components/bits';

export default function Shipments() {
  const shipments = useShipments(150);

  if (shipments.isLoading) return <Loading what="shipments" />;
  if (shipments.error) return <ErrorNotice error={shipments.error} />;

  return (
    <>
      <div className="page__head">
        <h1>Shipments</h1>
        <span className="dim">{shipments.data?.length ?? 0} most recent</span>
      </div>

      {(shipments.data?.length ?? 0) === 0 ? (
        <Empty>No shipments recorded.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ship date</th>
                <th>Order</th>
                <th>Customer</th>
                <th>Description</th>
                <th className="right">Units</th>
                <th className="right">Balance</th>
                <th>Tracking</th>
                <th className="right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {shipments.data!.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{dateStr(s.ship_date)}</td>
                  <td className="mono accent">{s.order_ref || '—'}</td>
                  <td className="strong">{s.customer || '—'}</td>
                  <td>{s.description || '—'}</td>
                  <td className="right mono">{num(s.total_units)}</td>
                  <td className="right mono">{s.balance != null ? num(s.balance) : '—'}</td>
                  <td className="mono">{s.tracking || '—'}</td>
                  <td className="right mono">{s.shipping_cost != null ? money(s.shipping_cost, 2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
