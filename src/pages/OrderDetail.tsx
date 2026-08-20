import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Badge, Card, CardHead, KeyValue, Loading, Meter, Section, Select, StatusBadge } from '../components/ui';
import { api, useList, useRecord } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useCustomers, useUsers } from '../lib/lookups';
import { date, money, number, percent, relative, unitMoney } from '../lib/format';
import { PRIORITIES, SO_STATUS, WORK_ORDER_STAGES } from '@shared/domain';
import type { SalesOrder, Shipment, WorkOrder } from '../lib/types';

export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { error } = useUi();
  const { can } = useSession();
  const customers = useCustomers();
  const users = useUsers();

  const { data: order, isLoading } = useRecord<SalesOrder>('salesOrders', id);
  useViewing(order ? order.orderNumber : null);

  const { data: workOrders } = useList<WorkOrder>('workOrders', { where: { salesOrderId: id ?? '' } }, { enabled: Boolean(id) });
  const { data: shipments } = useList<Shipment>('shipments', { where: { salesOrderId: id ?? '' } }, { enabled: Boolean(id) });

  if (isLoading || !order) return <div className="page"><Loading rows={7} /></div>;

  const ordered = order.lines.reduce((sum, line) => sum + line.qty, 0);
  const shipped = order.lines.reduce((sum, line) => sum + (line.shipped ?? 0), 0);
  const produced = (workOrders?.rows ?? []).filter((wo) => wo.stage === 'complete').reduce((sum, wo) => sum + (wo.actualQty || 0), 0);

  const setStatus = async (status: string) => {
    try {
      await api.patch(`/data/salesOrders/${order.id}`, { status });
      queryClient.invalidateQueries({ queryKey: ['record', 'salesOrders', id] });
      queryClient.invalidateQueries({ queryKey: ['collection', 'salesOrders'] });
    } catch (err) { error(err); }
  };

  return (
    <div className="page">
      <PageHeader
        back={{ to: '/orders', label: 'Orders' }}
        title={order.orderNumber}
        badge={
          <>
            <StatusBadge list={SO_STATUS} value={order.status} large />
            {order.priority !== 'normal' && <StatusBadge list={PRIORITIES} value={order.priority} dot={false} />}
          </>
        }
        subtitle={
          <>
            <Link to={`/customers/${order.customerId}`}>{customers.name(order.customerId)}</Link>
            {order.customerPo && <> · their PO <span className="mono">{order.customerPo}</span></>}
            {' '}· {money(order.total)} · promised {date(order.promisedShipDate)}
          </>
        }
        actions={
          can('orders.write') && (
            <Select
              value={order.status}
              onChange={setStatus}
              options={SO_STATUS.map((s) => ({ value: s.value, label: s.label }))}
              style={{ width: 190 }}
            />
          )
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 'var(--s-4)' }}>
        {[
          { label: 'Ordered', value: number(ordered), detail: 'units', tone: 'neutral' },
          { label: 'Produced', value: number(produced), detail: `${percent(ordered ? (produced / ordered) * 100 : 0, 0)} of the order`, tone: 'progress' },
          { label: 'Shipped', value: number(shipped), detail: `${percent(ordered ? (shipped / ordered) * 100 : 0, 0)} of the order`, tone: 'success' },
          { label: 'Order value', value: money(order.total, 0), detail: `${unitMoney(order.lines[0]?.unitPrice ?? 0)} per unit`, tone: 'accent' },
        ].map((tile) => (
          <div key={tile.label} className="kpi" data-tone={tile.tone}>
            <div className="kpi-label">{tile.label}</div>
            <div className="kpi-value" style={{ fontSize: 'var(--t-xl)' }}>{tile.value}</div>
            <div className="kpi-detail">{tile.detail}</div>
          </div>
        ))}
      </div>

      <div className="split">
        <div className="col">
          <Card>
            <CardHead title="Order lines" icon="cart" />
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num-cell">Quantity</th>
                    <th className="num-cell">Unit price</th>
                    <th className="num-cell">Shipped</th>
                    <th className="num-cell">Extended</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line, index) => (
                    <tr key={index}>
                      <td>
                        <div className="cell-primary truncate">{line.description}</div>
                        {line.formulaId && <Link to={`/formulations/${line.formulaId}`} className="cell-sub">view the formula</Link>}
                      </td>
                      <td className="num-cell">{number(line.qty)}</td>
                      <td className="num-cell">{unitMoney(line.unitPrice)}</td>
                      <td className="num-cell">{number(line.shipped ?? 0)}</td>
                      <td className="num-cell">{money(line.qty * line.unitPrice, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-foot row">
              <span className="spacer" />
              <table style={{ width: 240 }}>
                <tbody>
                  <tr><td className="cell-sub">Subtotal</td><td className="num-cell">{money(order.subtotal)}</td></tr>
                  <tr><td className="cell-sub">Freight</td><td className="num-cell">{money(order.freight)}</td></tr>
                  <tr><td className="strong">Total</td><td className="num-cell strong">{money(order.total)}</td></tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHead
              title="Production"
              subtitle={`${(workOrders?.rows ?? []).length} work order${(workOrders?.rows ?? []).length === 1 ? '' : 's'} against this order`}
              icon="factory"
            />
            <div className="card-body-flush">
              {(workOrders?.rows ?? []).map((wo) => (
                <Link key={wo.id} to={`/production/${wo.id}`} className="list-row">
                  <span className="mono cell-primary" style={{ width: 130 }}>{wo.woNumber}</span>
                  <StatusBadge list={WORK_ORDER_STAGES} value={wo.stage} />
                  <span className="grow truncate cell-sub">{wo.productName}</span>
                  <span className="mono">{number(wo.actualQty || wo.plannedQty)}</span>
                  {wo.yieldPct > 0 && <Badge tone={wo.yieldPct >= 95 ? 'success' : 'warning'}>{percent(wo.yieldPct, 1)}</Badge>}
                </Link>
              ))}
              {(workOrders?.rows ?? []).length === 0 && (
                <div className="cell-sub" style={{ padding: 'var(--s-5)' }}>
                  No work order has been raised yet. Create one from the production board and link it to this order.
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHead title="Shipments" icon="truck" />
            <div className="card-body-flush">
              {(shipments?.rows ?? []).map((shipment) => (
                <div key={shipment.id} className="list-row">
                  <span className="mono cell-primary" style={{ width: 140 }}>{shipment.shipmentNumber}</span>
                  <Badge tone={shipment.status === 'delivered' ? 'success' : 'progress'}>{shipment.status.replace('_', ' ')}</Badge>
                  <span className="grow cell-sub">{shipment.carrier} · {number(shipment.cartons)} cartons · {number(shipment.weightLb)} lb</span>
                  <span className="mono cell-sub">{shipment.trackingNumber}</span>
                  <span className="cell-sub nowrap">{date(shipment.shippedAt)}</span>
                </div>
              ))}
              {(shipments?.rows ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-5)' }}>Nothing has shipped yet.</div>}
            </div>
          </Card>
        </div>

        <div className="col">
          <Section title="Fulfilment" icon="target">
            <div className="col">
              <div>
                <div className="row-tight" style={{ marginBottom: 4 }}>
                  <span className="cell-sub grow">Produced</span>
                  <span className="mono cell-sub">{number(produced)} / {number(ordered)}</span>
                </div>
                <Meter value={produced} max={Math.max(1, ordered)} tone="progress" />
              </div>
              <div>
                <div className="row-tight" style={{ marginBottom: 4 }}>
                  <span className="cell-sub grow">Shipped</span>
                  <span className="mono cell-sub">{number(shipped)} / {number(ordered)}</span>
                </div>
                <Meter value={shipped} max={Math.max(1, ordered)} tone="success" />
              </div>
            </div>
          </Section>

          <Section title="Order" icon="cart">
            <KeyValue
              items={[
                { label: 'Customer', value: <Link to={`/customers/${order.customerId}`}>{customers.name(order.customerId)}</Link> },
                { label: 'Owner', value: users.name(order.ownerId) },
                { label: 'Customer PO', value: order.customerPo || '—' },
                { label: 'From quote', value: order.quoteId ? <Link to={`/quotes/${order.quoteId}`}>view the quote</Link> : '—' },
                { label: 'Requested ship', value: date(order.requestedShipDate) },
                { label: 'Promised ship', value: date(order.promisedShipDate) },
                { label: 'Shipped', value: date(order.shippedAt) },
                { label: 'Created', value: `${date(order.createdAt)} by ${users.name(order.createdBy)}` },
                { label: 'Last change', value: relative(order.updatedAt) },
              ]}
            />
            {order.notes && <div className="cell-sub" style={{ marginTop: 'var(--s-3)', whiteSpace: 'pre-wrap' }}>{order.notes}</div>}
          </Section>
        </div>
      </div>
    </div>
  );
}
