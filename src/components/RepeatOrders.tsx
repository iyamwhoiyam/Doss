import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { Icon } from './Icon';
import { Badge, Card, CardHead, Field, Modal, NumberInput, TextInput } from './ui';
import { api, useList } from '../lib/api';
import { useUi } from '../lib/ui';
import { money, number, relative, unitMoney } from '../lib/format';
import type { OrderTemplate } from '../lib/types';

/**
 * A customer's canned jobs: the products they buy again and again, at the
 * quantity and price already agreed. "Reorder" raises the next sales order
 * with their PO number in one step; the journey then offers the batch.
 */
export function RepeatOrders({ customerId, writable }: { customerId: string; writable: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { error, success } = useUi();
  const { data } = useList<OrderTemplate>('orderTemplates', { where: { customerId }, sort: '-lastUsedAt', limit: 50 });
  const [reorder, setReorder] = useState<OrderTemplate | null>(null);
  const [customerPo, setCustomerPo] = useState('');
  const [qty, setQty] = useState(0);
  const [busy, setBusy] = useState(false);
  const templates = (data?.rows ?? []).filter((t) => t.active !== false);

  const open = (t: OrderTemplate) => { setReorder(t); setCustomerPo(''); setQty(t.qty); };
  const submit = async () => {
    if (!reorder) return;
    setBusy(true);
    try {
      const order = await api.post<{ id: string; orderNumber: string }>(`/commerce/templates/${reorder.id}/reorder`, { customerPo, qty });
      queryClient.invalidateQueries({ queryKey: ['collection', 'salesOrders'] });
      queryClient.invalidateQueries({ queryKey: ['collection', 'orderTemplates'] });
      success(`${order.orderNumber} raised`, `${reorder.name}${customerPo ? ` · PO ${customerPo}` : ''}`);
      setReorder(null);
      navigate(`/orders/${order.id}`);
    } catch (err) { error(err); } finally { setBusy(false); }
  };
  const retire = async (t: OrderTemplate) => {
    try {
      await api.patch(`/data/orderTemplates/${t.id}`, { active: false });
      queryClient.invalidateQueries({ queryKey: ['collection', 'orderTemplates'] });
      success('Repeat order retired');
    } catch (err) { error(err); }
  };

  return (
    <Card>
      <CardHead title="Repeat orders" subtitle="Canned jobs — the same product, quantity and price as last time, one click to the next PO" icon="refresh" />
      <div className="card-body-flush">
        {templates.map((t) => (
          <div key={t.id} className="list-row">
            <Icon name="refresh" size={14} className="faint" />
            <span className="grow">
              <span className="cell-primary truncate" style={{ display: 'block' }}>{t.name}</span>
              <span className="cell-sub">{number(t.qty)} units at {unitMoney(t.unitPrice)} · {money(t.qty * t.unitPrice, 0)}{t.bulk ? ' · bulk' : ''} · used {t.timesUsed || 0}×{t.lastUsedAt ? `, last ${relative(t.lastUsedAt)}` : ''}</span>
            </span>
            {t.bulk && <Badge tone="warning">bulk</Badge>}
            {writable && (
              <>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => open(t)}><Icon name="cart" size={12} /> Reorder</button>
                <button type="button" className="btn btn-sm btn-ghost" title="Retire this repeat order" aria-label={`Retire ${t.name}`} onClick={() => retire(t)}><Icon name="archive" size={12} /></button>
              </>
            )}
          </div>
        ))}
        {templates.length === 0 && (
          <div className="cell-sub" style={{ padding: 'var(--s-5)' }}>
            No repeat orders yet. Open any shipped order for this customer and choose "Save as repeat order".
          </div>
        )}
      </div>

      <Modal
        open={Boolean(reorder)}
        onClose={() => setReorder(null)}
        title={reorder ? `Reorder · ${reorder.name}` : 'Reorder'}
        footer={(
          <>
            <button type="button" className="btn" onClick={() => setReorder(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || qty <= 0}><Icon name="cart" size={14} /> Raise the order</button>
          </>
        )}
      >
        {reorder && (
          <div className="col">
            <div className="field-row">
              <Field label="Customer PO"><TextInput value={customerPo} onChange={setCustomerPo} placeholder="Their purchase order number" autoFocus /></Field>
              <Field label="Quantity" hint={`Agreed price ${unitMoney(reorder.unitPrice)} per unit · ${money(qty * reorder.unitPrice, 0)}`}>
                <NumberInput value={qty} onChange={setQty} min={1} />
              </Field>
            </div>
            <div className="cell-sub">The order is confirmed at the agreed price and linked to the product's project, so its SO# shows on the project and the journey offers the batch next.</div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
