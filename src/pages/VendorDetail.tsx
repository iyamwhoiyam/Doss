import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Badge, Card, CardHead, Donut, KeyValue, Loading, Meter, Section, StatusBadge } from '../components/ui';
import { api, useList } from '../lib/api';
import { useViewing } from '../lib/realtime';
import { useUsers } from '../lib/lookups';
import { date, daysUntil, money, number, percent, relative, unitMoney } from '../lib/format';
import { DOCUMENT_CATEGORIES, PO_STATUS, VENDOR_CATEGORIES, VENDOR_STATUS } from '@shared/domain';
import type { Doc, PurchaseOrder, Vendor } from '../lib/types';

interface Scorecard {
  vendor: Vendor;
  orders: { total: number; open: number; spend: number };
  delivery: { received: number; onTime: number; onTimePct: number | null };
  quality: { lots: number; rejected: number; rejectRatePct: number; missingCoa: number };
  qualification: {
    auditedAt?: string | null; expiresAt?: string | null; certifications?: string[];
    questionnaireOnFile?: boolean; daysUntilExpiry: number | null; state: string;
  };
  items: { id: string; itemCode: string; name: string; uom: string; costPerUom: number }[];
  recentOrders: PurchaseOrder[];
}

export function VendorDetail() {
  const { id } = useParams<{ id: string }>();
  const users = useUsers();

  const { data, isLoading } = useQuery<Scorecard>({
    queryKey: ['purchasing', 'vendor', id],
    queryFn: () => api.get<Scorecard>(`/purchasing/vendors/${id}/scorecard`),
    enabled: Boolean(id),
  });

  const { data: docs } = useList<Doc>('documents', { where: { vendorId: id ?? '' }, sort: '-updatedAt' }, { enabled: Boolean(id) });

  useViewing(data ? data.vendor.name : null);

  if (isLoading || !data) return <div className="page"><Loading rows={8} /></div>;

  const vendor = data.vendor;
  const qualDays = data.qualification.daysUntilExpiry;

  return (
    <div className="page">
      <PageHeader
        back={{ to: '/purchasing', label: 'Vendors' }}
        title={vendor.name}
        badge={
          <>
            <StatusBadge list={VENDOR_STATUS} value={vendor.status} large />
            <StatusBadge list={VENDOR_CATEGORIES} value={vendor.category} dot={false} />
          </>
        }
        subtitle={
          <>
            <span className="mono">{vendor.code}</span> · {vendor.address?.city}{vendor.address?.state ? `, ${vendor.address.state}` : ''} ·
            {' '}{vendor.leadTimeDays} day lead time · {vendor.paymentTerms}
          </>
        }
      />

      {data.qualification.state !== 'current' && (
        <div className="flag" data-tone={data.qualification.state === 'expired' ? 'danger' : 'warning'} style={{ marginBottom: 'var(--s-4)' }}>
          <span className="flag-mark"><Icon name="shield" size={15} /></span>
          <div>
            <div className="flag-title">
              {data.qualification.state === 'expired' ? 'Qualification has lapsed'
                : data.qualification.state === 'expiring' ? `Qualification expires in ${qualDays} days`
                  : 'No qualification on file'}
            </div>
            <div className="flag-detail">
              A purchase order raised against an unqualified vendor needs a written override reason, and the override is recorded on the order.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 'var(--s-4)' }}>
        {[
          { label: 'Spend to date', value: money(data.orders.spend, 0), detail: `${data.orders.total} orders`, tone: 'neutral' },
          { label: 'Open orders', value: number(data.orders.open), detail: 'awaiting delivery', tone: 'info' },
          { label: 'On-time delivery', value: data.delivery.onTimePct === null ? '—' : percent(data.delivery.onTimePct), detail: `${data.delivery.onTime} of ${data.delivery.received} receipts`, tone: (data.delivery.onTimePct ?? 100) >= 90 ? 'success' : 'warning' },
          { label: 'Lot reject rate', value: percent(data.quality.rejectRatePct, 1), detail: `${data.quality.rejected} of ${data.quality.lots} lots`, tone: data.quality.rejectRatePct > 2 ? 'danger' : 'success' },
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
            <CardHead title="Recent purchase orders" icon="clipboard" />
            <div className="card-body-flush">
              {data.recentOrders.map((po) => (
                <Link key={po.id} to={`/purchasing/${po.id}`} className="list-row">
                  <span className="mono cell-primary" style={{ width: 130 }}>{po.poNumber}</span>
                  <StatusBadge list={PO_STATUS} value={po.status} />
                  <span className="grow cell-sub">{po.lines.length} line{po.lines.length === 1 ? '' : 's'}</span>
                  <span className="mono">{money(po.total)}</span>
                  <span className="cell-sub nowrap">{relative(po.createdAt)}</span>
                </Link>
              ))}
              {data.recentOrders.length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-5)' }}>No purchase orders yet.</div>}
            </div>
          </Card>

          <Card>
            <CardHead title="Items sourced here" subtitle={`${data.items.length} catalogue items name this vendor as preferred`} icon="boxes" />
            <div className="card-body-flush">
              {data.items.map((item) => (
                <Link key={item.id} to={`/inventory/${item.id}`} className="list-row">
                  <span className="mono cell-sub" style={{ width: 120 }}>{item.itemCode}</span>
                  <span className="grow truncate">{item.name}</span>
                  <span className="mono cell-sub">{unitMoney(item.costPerUom)} / {item.uom}</span>
                </Link>
              ))}
              {data.items.length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-5)' }}>No items point at this vendor.</div>}
            </div>
          </Card>

          <Card>
            <CardHead title="Documents" subtitle={`${docs?.total ?? 0} on file`} icon="folder" />
            <div className="card-body-flush">
              {(docs?.rows ?? []).map((doc) => {
                const days = daysUntil(doc.expiresAt);
                return (
                  <div key={doc.id} className="list-row">
                    <Icon name="file" size={14} className="faint" />
                    <span className="grow truncate">{doc.name}</span>
                    <Badge tone="neutral">{DOCUMENT_CATEGORIES.find((c) => c.value === doc.category)?.label ?? doc.category}</Badge>
                    {days !== null && (
                      <Badge tone={days < 0 ? 'danger' : days < 45 ? 'warning' : 'neutral'}>
                        {days < 0 ? 'expired' : `${days} d`}
                      </Badge>
                    )}
                  </div>
                );
              })}
              {(docs?.rows ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-5)' }}>No documents filed against this vendor.</div>}
            </div>
          </Card>
        </div>

        <div className="col">
          <Section title="Scorecard" icon="target">
            <div className="row" style={{ marginBottom: 'var(--s-4)' }}>
              <Donut
                value={data.delivery.onTimePct ?? 0}
                total={100}
                size={80}
                tone={(data.delivery.onTimePct ?? 100) >= 90 ? 'success' : 'warning'}
                label={data.delivery.onTimePct === null ? '—' : `${data.delivery.onTimePct}%`}
                sublabel="on time"
              />
              <div className="grow col-tight">
                {[
                  { label: 'Quality', value: vendor.rating?.quality ?? 0 },
                  { label: 'Delivery', value: vendor.rating?.delivery ?? 0 },
                  { label: 'Responsiveness', value: vendor.rating?.responsiveness ?? 0 },
                ].map((rating) => (
                  <div key={rating.label} className="row-tight">
                    <span style={{ width: 108, fontSize: 'var(--t-sm)' }}>{rating.label}</span>
                    <div className="grow"><Meter value={rating.value} max={5} tone={rating.value >= 4 ? 'success' : rating.value >= 3 ? 'warning' : 'danger'} /></div>
                    <span className="mono cell-sub">{rating.value.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
            <KeyValue
              items={[
                { label: 'Lots received', value: number(data.quality.lots) },
                { label: 'Lots rejected', value: number(data.quality.rejected) },
                { label: 'Missing COAs', value: data.quality.missingCoa ? <Badge tone="warning">{data.quality.missingCoa}</Badge> : '0' },
              ]}
            />
          </Section>

          <Section title="Qualification" icon="shield">
            <KeyValue
              items={[
                { label: 'Last audit', value: date(data.qualification.auditedAt) },
                { label: 'Expires', value: date(data.qualification.expiresAt) },
                { label: 'Questionnaire', value: data.qualification.questionnaireOnFile ? 'On file' : 'Not on file' },
                {
                  label: 'Certifications',
                  value: (data.qualification.certifications ?? []).length
                    ? <span className="row-wrap" style={{ gap: 4 }}>{(data.qualification.certifications ?? []).map((cert) => <Badge key={cert} tone="success">{cert}</Badge>)}</span>
                    : '—',
                },
              ]}
            />
          </Section>

          <Section title="Contact" icon="user">
            <KeyValue
              items={[
                { label: 'Buyer', value: users.name(vendor.buyerId) },
                { label: 'Minimum order', value: vendor.minimumOrder ? money(vendor.minimumOrder, 0) : 'None' },
                { label: 'Website', value: vendor.website ? <a href={vendor.website} target="_blank" rel="noreferrer">{vendor.website.replace(/^https?:\/\//, '')}</a> : '—' },
              ]}
            />
            {vendor.contacts.map((contact) => (
              <div key={contact.email} className="list-row" style={{ padding: 'var(--s-3) 0' }}>
                <span className="grow">
                  <span className="cell-primary" style={{ display: 'block' }}>{contact.name}</span>
                  <span className="cell-sub">{contact.title}</span>
                </span>
                <span className="cell-sub">{contact.phone}</span>
              </div>
            ))}
            {vendor.notes && <div className="cell-sub" style={{ marginTop: 'var(--s-3)' }}>{vendor.notes}</div>}
          </Section>
        </div>
      </div>
    </div>
  );
}
