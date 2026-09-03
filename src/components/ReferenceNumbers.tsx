import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { Icon } from './Icon';
import { Badge, Combo, CopyButton, Section } from './ui';
import { api, useList } from '../lib/api';
import { useUi } from '../lib/ui';
import type { ProjectNumbers, SalesOrder, WorkOrder } from '../lib/types';

/**
 * Every number anyone will ever quote about this product, in one block:
 * project, formula, quote, SO# (sales orders) and MO# (manufacturing orders,
 * i.e. batches). Each opens its record. Orders and batches raised through the
 * app attach themselves; anything made elsewhere can be linked here by hand.
 */
export function ReferenceNumbers({ projectId, numbers, writable, onChanged }: {
  projectId: string; numbers: ProjectNumbers | undefined; writable: boolean; onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const { error, success } = useUi();
  const [linking, setLinking] = useState<'so' | 'mo' | null>(null);
  const { data: orders } = useList<SalesOrder>('salesOrders', { sort: '-createdAt', limit: 300, select: ['id', 'orderNumber', 'customerPo', 'status', 'projectId'] }, { enabled: linking === 'so' });
  const { data: batches } = useList<WorkOrder>('workOrders', { sort: '-createdAt', limit: 300, select: ['id', 'woNumber', 'batchNumber', 'productName', 'stage', 'projectId'] }, { enabled: linking === 'mo' });

  const link = async (body: { salesOrderId?: string; workOrderId?: string; detach?: boolean }) => {
    try {
      const result = await api.post<{ changed: string[] }>(`/projects/${projectId}/link`, body);
      queryClient.invalidateQueries({ queryKey: ['collection', 'salesOrders'] });
      queryClient.invalidateQueries({ queryKey: ['collection', 'workOrders'] });
      onChanged();
      success(`${result.changed.join(', ')} ${body.detach ? 'detached' : 'linked'}`);
      setLinking(null);
    } catch (err) { error(err); }
  };

  if (!numbers) return null;
  const all = [
    numbers.project,
    numbers.formula?.code ?? '',
    ...numbers.quotes.map((q) => q.number),
    ...numbers.salesOrders.map((s) => s.number),
    ...numbers.workOrders.map((w) => w.number),
  ].filter(Boolean).join(' · ');

  return (
    <Section title="Reference numbers" icon="tag" actions={<CopyButton text={all} label="Copy all" />}>
      <div className="col-tight">
        <Row label="Project">
          <span className="ref-chip" data-kind="p" style={{ cursor: 'default' }}>{numbers.project}</span>
        </Row>
        <Row label="Formula">
          {numbers.formula ? <Link to={`/formulations/${numbers.formula.id}`} className="ref-chip" data-kind="f" title={`Formula · rev ${numbers.formula.revision}`}>{numbers.formula.code}</Link> : <span className="faint">none yet</span>}
        </Row>
        <Row label="Quote">
          {numbers.quotes.length ? numbers.quotes.map((q) => <Link key={q.id} to={`/quotes/${q.id}`} className="ref-chip" data-kind="q" title={`Quote · ${q.status}`}>{q.number}</Link>) : <span className="faint">none yet</span>}
        </Row>
        <Row label="SO#" hint="Sales order">
          {numbers.salesOrders.map((so) => (
            <span key={so.id} className="row-tight" style={{ gap: 2 }}>
              <Link to={`/orders/${so.id}`} className="ref-chip" data-kind="so" title={`Sales order · ${so.status}${so.customerPo ? ` · PO ${so.customerPo}` : ''}`}>{so.number}</Link>
              {so.customerPo && <span className="cell-sub">PO {so.customerPo}</span>}
              {writable && <button type="button" className="btn btn-sm btn-ghost" title="Detach from this project" aria-label={`Detach ${so.number}`} onClick={() => link({ salesOrderId: so.id, detach: true })}>×</button>}
            </span>
          ))}
          {!numbers.salesOrders.length && <span className="faint">none yet</span>}
          {writable && linking !== 'so' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLinking('so')}><Icon name="link" size={12} /> Link an order</button>}
        </Row>
        {linking === 'so' && (
          <Combo
            value=""
            onChange={(v) => { if (v) void link({ salesOrderId: v }); }}
            options={(orders?.rows ?? []).filter((o) => o.projectId !== projectId).map((o) => ({ value: o.id, label: `${o.orderNumber}${o.customerPo ? ` · PO ${o.customerPo}` : ''}`, sub: o.status }))}
            placeholder="Pick the sales order to attach"
          />
        )}
        <Row label="MO#" hint="Manufacturing order (batch)">
          {numbers.workOrders.map((wo) => (
            <span key={wo.id} className="row-tight" style={{ gap: 2 }}>
              <Link to={`/production/${wo.id}`} className="ref-chip" data-kind="mo" title={`Batch ${wo.batchNumber} · ${wo.stage.replace(/_/g, ' ')}`}>{wo.number}</Link>
              <Badge tone={wo.stage === 'complete' ? 'success' : wo.stage === 'qc_hold' ? 'danger' : 'neutral'}>{wo.stage.replace(/_/g, ' ')}</Badge>
              {writable && <button type="button" className="btn btn-sm btn-ghost" title="Detach from this project" aria-label={`Detach ${wo.number}`} onClick={() => link({ workOrderId: wo.id, detach: true })}>×</button>}
            </span>
          ))}
          {!numbers.workOrders.length && <span className="faint">none yet</span>}
          {writable && linking !== 'mo' && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLinking('mo')}><Icon name="link" size={12} /> Link a batch</button>}
        </Row>
        {linking === 'mo' && (
          <Combo
            value=""
            onChange={(v) => { if (v) void link({ workOrderId: v }); }}
            options={(batches?.rows ?? []).filter((b) => b.projectId !== projectId).map((b) => ({ value: b.id, label: `${b.woNumber} · ${b.productName}`, sub: b.stage }))}
            placeholder="Pick the batch to attach"
          />
        )}
      </div>
    </Section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--s-3)' }}>
      <span className="cell-sub" style={{ width: 64, flexShrink: 0, paddingTop: 3 }} title={hint}>{label}</span>
      <span className="row-wrap grow" style={{ gap: 6, alignItems: 'center' }}>{children}</span>
    </div>
  );
}
