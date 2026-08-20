import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Avatar, Badge, Card, CardHead, DataTable, EmptyState, Field, KeyValue, Loading,
  Section, Select, StatusBadge, Tabs, TextArea, type Column,
} from '../components/ui';
import { api, useList, useRecord } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useUsers } from '../lib/lookups';
import { colorFor, date, daysUntil, fileSize, money, number, relative, unitMoney } from '../lib/format';
import {
  CUSTOMER_STATUS, CUSTOMER_TIERS, DOCUMENT_CATEGORIES, DOCUMENT_STATUS,
  FORMULA_STATUS, LABEL_REVIEW_STATUS, QUOTE_STATUS, SO_STATUS, findOption,
} from '@shared/domain';
import type { Customer, Doc, Formula, LabelReview, Project, Quote, SalesOrder } from '../lib/types';

export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { error, success } = useUi();
  const { can } = useSession();
  const users = useUsers();
  const [tab, setTab] = useState('overview');

  const { data: customer, isLoading } = useRecord<Customer>('customers', id);
  useViewing(customer ? customer.name : null);

  const scoped = { where: { customerId: id ?? '' }, limit: 200 };
  const { data: orders } = useList<SalesOrder>('salesOrders', { ...scoped, sort: '-createdAt' }, { enabled: Boolean(id) });
  const { data: quotes } = useList<Quote>('quotes', { ...scoped, sort: '-createdAt' }, { enabled: Boolean(id) });
  const { data: formulas } = useList<Formula>('formulas', { ...scoped, sort: 'code' }, { enabled: Boolean(id) });
  const { data: projects } = useList<Project>('projects', { ...scoped, sort: '-createdAt' }, { enabled: Boolean(id) });
  const { data: labels } = useList<LabelReview>('labelReviews', { ...scoped, sort: '-createdAt' }, { enabled: Boolean(id) });
  const { data: docs } = useList<Doc>('documents', { where: { customerId: id ?? '' }, sort: '-updatedAt', limit: 300 }, { enabled: Boolean(id) });

  const revenue = useMemo(
    () => (orders?.rows ?? []).filter((order) => !['cancelled', 'draft'].includes(order.status)).reduce((sum, order) => sum + (order.total ?? 0), 0),
    [orders],
  );
  const openOrders = (orders?.rows ?? []).filter((order) => !['closed', 'cancelled', 'invoiced'].includes(order.status));
  const expiringDocs = (docs?.rows ?? []).filter((doc) => {
    const days = daysUntil(doc.expiresAt);
    return days !== null && days < 45;
  });

  if (isLoading || !customer) return <div className="page"><Loading rows={8} /></div>;

  const patch = async (body: Partial<Customer>) => {
    try {
      await api.patch(`/data/customers/${id}`, body);
      queryClient.invalidateQueries({ queryKey: ['record', 'customers', id] });
      queryClient.invalidateQueries({ queryKey: ['collection', 'customers'] });
    } catch (err) { error(err); }
  };

  const orderColumns: Column<SalesOrder>[] = [
    { key: 'order', header: 'Order', sortValue: (row) => row.orderNumber, render: (row) => <span className="mono cell-primary">{row.orderNumber}</span> },
    { key: 'desc', header: 'Product', render: (row) => <span className="truncate">{row.lines[0]?.description ?? '—'}</span> },
    { key: 'status', header: 'Status', sortValue: (row) => row.status, render: (row) => <StatusBadge list={SO_STATUS} value={row.status} /> },
    { key: 'qty', header: 'Units', numeric: true, sortValue: (row) => row.lines[0]?.qty ?? 0, render: (row) => number(row.lines[0]?.qty ?? 0) },
    { key: 'price', header: 'Unit price', numeric: true, render: (row) => unitMoney(row.lines[0]?.unitPrice ?? 0) },
    { key: 'total', header: 'Total', numeric: true, sortValue: (row) => row.total, render: (row) => money(row.total, 0) },
    { key: 'ship', header: 'Promised', sortValue: (row) => row.promisedShipDate ?? '', render: (row) => date(row.promisedShipDate) },
  ];

  return (
    <div className="page">
      <PageHeader
        back={{ to: '/customers', label: 'Customers' }}
        title={
          <span className="row-tight">
            <Avatar name={customer.name} color={customer.logoTint || colorFor(customer.name)} size="lg" />
            {customer.name}
          </span>
        }
        badge={
          <>
            <StatusBadge list={CUSTOMER_STATUS} value={customer.status} large />
            <StatusBadge list={CUSTOMER_TIERS} value={customer.tier} dot={false} />
          </>
        }
        subtitle={
          <>
            <span className="mono">{customer.code}</span> · {customer.industry || 'Industry not set'} ·
            {' '}{customer.paymentTerms} · managed by {users.name(customer.ownerId)}
          </>
        }
        actions={
          can('customers.write') && (
            <>
              <Select
                value={customer.status}
                onChange={(value) => patch({ status: value })}
                options={CUSTOMER_STATUS.map((s) => ({ value: s.value, label: s.label }))}
                style={{ width: 150 }}
              />
              <Link to={`/documents?customerId=${customer.id}`} className="btn"><Icon name="folder" size={13} /> Documents</Link>
            </>
          )
        }
      />

      {customer.status === 'on_hold' && (
        <div className="flag" data-tone="warning" style={{ marginBottom: 'var(--s-4)' }}>
          <span className="flag-mark"><Icon name="alert" size={15} /></span>
          <div>
            <div className="flag-title">This account is on hold</div>
            <div className="flag-detail">{customer.notes || 'New orders should not be released until the hold is lifted.'}</div>
          </div>
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 'var(--s-4)' }}>
        {[
          { label: 'Booked revenue', value: money(revenue, 0), detail: `${orders?.total ?? 0} orders`, tone: 'success' },
          { label: 'Open orders', value: number(openOrders.length), detail: money(openOrders.reduce((sum, order) => sum + order.total, 0), 0), tone: 'accent' },
          { label: 'Quotes in play', value: number((quotes?.rows ?? []).filter((quote) => ['draft', 'sent', 'revised'].includes(quote.status)).length), detail: `${quotes?.total ?? 0} all time`, tone: 'info' },
          { label: 'Documents expiring', value: number(expiringDocs.length), detail: `${docs?.total ?? 0} on file`, tone: expiringDocs.length ? 'warning' : 'neutral' },
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
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'overview', label: 'Overview', icon: 'building' },
              { value: 'orders', label: 'Orders', count: orders?.total ?? null, icon: 'cart' },
              { value: 'quotes', label: 'Quotes', count: quotes?.total ?? null, icon: 'calculator' },
              { value: 'products', label: 'Products', count: (formulas?.total ?? 0) + (labels?.total ?? 0), icon: 'beaker' },
              { value: 'documents', label: 'Documents', count: docs?.total ?? null, icon: 'folder' },
            ]}
          />

          <div style={{ marginTop: 'var(--s-4)' }} className="col">
            {tab === 'overview' && (
              <>
                <Card>
                  <CardHead title="Active projects" icon="flask" />
                  <div className="card-body-flush">
                    {(projects?.rows ?? []).map((project) => (
                      <Link key={project.id} to={`/development/${project.id}`} className="list-row">
                        <Icon name="flask" size={14} className="faint" />
                        <span className="grow truncate">{project.name}</span>
                        <Badge tone="neutral">{project.stage.replace('_', ' ')}</Badge>
                        <span className="cell-sub nowrap">{date(project.targetLaunch)}</span>
                      </Link>
                    ))}
                    {(projects?.rows ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-5)' }}>No projects on this account.</div>}
                  </div>
                </Card>

                <Card>
                  <CardHead title="Recent orders" icon="cart" />
                  <div className="card-body-flush">
                    {(orders?.rows ?? []).slice(0, 6).map((order) => (
                      <Link key={order.id} to={`/orders/${order.id}`} className="list-row">
                        <span className="mono cell-primary" style={{ width: 130 }}>{order.orderNumber}</span>
                        <StatusBadge list={SO_STATUS} value={order.status} />
                        <span className="grow truncate cell-sub">{order.lines[0]?.description}</span>
                        <span className="mono">{money(order.total, 0)}</span>
                      </Link>
                    ))}
                    {(orders?.rows ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-5)' }}>No orders yet.</div>}
                  </div>
                </Card>

                {can('customers.write') && (
                  <Section title="Notes" icon="file">
                    <NotesEditor value={customer.notes} onSave={async (value) => { await patch({ notes: value }); success('Notes saved'); }} />
                  </Section>
                )}
              </>
            )}

            {tab === 'orders' && (
              <Card><DataTable columns={orderColumns} rows={orders?.rows ?? []} onRowClick={(row) => window.location.assign(`/orders/${row.id}`)} /></Card>
            )}

            {tab === 'quotes' && (
              <Card>
                <div className="card-body-flush">
                  {(quotes?.rows ?? []).map((quote) => {
                    const tier = (quote.result?.tiers ?? []).filter((t) => t.extendedTotal !== null).at(-1);
                    return (
                      <Link key={quote.id} to={`/quotes/${quote.id}`} className="list-row">
                        <span className="mono cell-primary" style={{ width: 130 }}>{quote.quoteNumber}</span>
                        <StatusBadge list={QUOTE_STATUS} value={quote.status} />
                        <span className="grow truncate">{quote.title}</span>
                        {tier && <span className="mono cell-sub">{unitMoney(tier.salePricePerUnit)} × {number(tier.qty)}</span>}
                        <span className="mono">{tier?.extendedTotal ? money(tier.extendedTotal, 0) : '—'}</span>
                      </Link>
                    );
                  })}
                  {(quotes?.rows ?? []).length === 0 && <EmptyState icon="calculator" title="No quotes yet" body="Build one from a formula under Quotes & costing." />}
                </div>
              </Card>
            )}

            {tab === 'products' && (
              <>
                <Card>
                  <CardHead title="Formulas" icon="beaker" />
                  <div className="card-body-flush">
                    {(formulas?.rows ?? []).map((formula) => (
                      <Link key={formula.id} to={`/formulations/${formula.id}`} className="list-row">
                        <span className="mono cell-sub" style={{ width: 96 }}>{formula.code}</span>
                        <span className="grow truncate">{formula.name}</span>
                        <StatusBadge list={FORMULA_STATUS} value={formula.status} />
                        <span className="cell-sub nowrap">rev {formula.revision}</span>
                      </Link>
                    ))}
                    {(formulas?.rows ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-5)' }}>No formulas on this account.</div>}
                  </div>
                </Card>
                <Card>
                  <CardHead title="Label reviews" icon="label" />
                  <div className="card-body-flush">
                    {(labels?.rows ?? []).map((label) => (
                      <Link key={label.id} to={`/labels/${label.id}`} className="list-row">
                        <span className="mono cell-sub" style={{ width: 110 }}>{label.reviewNumber}</span>
                        <span className="grow truncate">{label.productName}</span>
                        <StatusBadge list={LABEL_REVIEW_STATUS} value={label.status} />
                        {label.metrics?.requiredCorrections > 0 && <Badge tone="danger">{label.metrics.requiredCorrections}</Badge>}
                      </Link>
                    ))}
                    {(labels?.rows ?? []).length === 0 && <div className="cell-sub" style={{ padding: 'var(--s-5)' }}>No label reviews.</div>}
                  </div>
                </Card>
              </>
            )}

            {tab === 'documents' && (
              <CustomerDocuments customerId={customer.id} docs={docs?.rows ?? []} onUploaded={() => queryClient.invalidateQueries({ queryKey: ['collection', 'documents'] })} />
            )}
          </div>
        </div>

        <div className="col">
          <Section title="Account" icon="building">
            <KeyValue
              items={[
                { label: 'Account manager', value: <span className="row-tight"><Avatar name={users.name(customer.ownerId)} size="sm" /> {users.name(customer.ownerId)}</span> },
                { label: 'Payment terms', value: customer.paymentTerms },
                { label: 'Credit limit', value: customer.creditLimit ? money(customer.creditLimit, 0) : '—' },
                { label: 'Website', value: customer.website ? <a href={customer.website} target="_blank" rel="noreferrer">{customer.website.replace(/^https?:\/\//, '')}</a> : '—' },
                { label: 'Customer since', value: date(customer.createdAt) },
                { label: 'Last change', value: relative(customer.updatedAt) },
              ]}
            />
          </Section>

          <Section title="Contacts" icon="users">
            {customer.contacts.length === 0 && <div className="cell-sub">No contacts recorded.</div>}
            {customer.contacts.map((contact) => (
              <div key={contact.email ?? contact.name} className="list-row" style={{ padding: 'var(--s-3) 0', alignItems: 'flex-start' }}>
                <Avatar name={contact.name} size="sm" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row-tight">
                    <span className="cell-primary truncate">{contact.name}</span>
                    {contact.primary && <Badge tone="accent">primary</Badge>}
                  </div>
                  <div className="cell-sub">{contact.title}</div>
                  {contact.email && <div className="cell-sub truncate"><a href={`mailto:${contact.email}`}>{contact.email}</a></div>}
                  {contact.phone && <div className="cell-sub">{contact.phone}</div>}
                </div>
              </div>
            ))}
          </Section>

          {customer.billingAddress?.line1 && (
            <Section title="Billing address" icon="tag">
              <div className="cell-sub" style={{ lineHeight: 1.7 }}>
                {customer.billingAddress.line1}<br />
                {customer.billingAddress.city}, {customer.billingAddress.state} {customer.billingAddress.postalCode}<br />
                {customer.billingAddress.country}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function NotesEditor({ value, onSave }: { value: string; onSave: (value: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  return (
    <div className="col">
      <TextArea value={draft} onChange={setDraft} rows={5} placeholder="Anything the team should know before they call." />
      <div className="row">
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={draft === value || busy}
          onClick={async () => { setBusy(true); await onSave(draft); setBusy(false); }}
        >
          Save notes
        </button>
      </div>
    </div>
  );
}

function CustomerDocuments({ customerId, docs, onUploaded }: {
  customerId: string; docs: Doc[]; onUploaded: () => void;
}) {
  const { error, success } = useUi();
  const { can } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [category, setCategory] = useState('other');
  const [busy, setBusy] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      for (const file of Array.from(files)) form.append('files', file);
      form.append('ownerType', 'customer');
      form.append('ownerId', customerId);
      form.append('customerId', customerId);
      form.append('category', category);
      await api.upload('/documents/upload', form);
      success(`${files.length} file${files.length === 1 ? '' : 's'} uploaded`);
      onUploaded();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <div className="col">
      {can('documents.write') && (
        <Card>
          <div className="card-body col">
            <Field label="Category for the next upload">
              <Select value={category} onChange={setCategory} options={DOCUMENT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
            </Field>
            <div
              className="dropzone"
              data-over={dragOver ? 'true' : undefined}
              onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => { event.preventDefault(); setDragOver(false); void upload(event.dataTransfer.files); }}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? <span className="spinner" /> : <Icon name="upload" size={22} className="faint" />}
              <div className="strong" style={{ marginTop: 'var(--s-2)' }}>Drop files here, or click to choose</div>
              <div className="cell-sub">PDF, images, Office documents and archives up to 60 MB each</div>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="sr-only"
                onChange={(event) => { void upload(event.target.files); event.target.value = ''; }}
              />
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHead title="Document vault" subtitle={`${docs.length} on file`} icon="folder" />
        <div className="card-body-flush">
          {docs.map((doc) => {
            const days = daysUntil(doc.expiresAt);
            const latest = doc.versions?.at(-1);
            return (
              <div key={doc.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                <Icon name={doc.category === 'artwork' ? 'image' : 'file'} size={15} className="faint" style={{ marginTop: 2 }} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row-tight">
                    <span className="cell-primary truncate">{doc.name}</span>
                    {doc.confidential && <Badge tone="danger"><Icon name="lock" size={9} /> confidential</Badge>}
                  </div>
                  <div className="cell-sub">
                    {findOption(DOCUMENT_CATEGORIES, doc.category).label} · v{doc.currentVersion}
                    {latest && ` · ${fileSize(latest.size)}`} · updated {relative(doc.updatedAt)}
                  </div>
                </div>
                <StatusBadge list={DOCUMENT_STATUS} value={doc.status} />
                {days !== null && <Badge tone={days < 0 ? 'danger' : days < 45 ? 'warning' : 'neutral'}>{days < 0 ? 'expired' : `${days} d`}</Badge>}
                {latest && !latest.placeholder && (
                  <a className="btn btn-sm btn-ghost" href={`/api/documents/${doc.id}/versions/${latest.version}/file?download=1`}>
                    <Icon name="download" size={13} />
                  </a>
                )}
              </div>
            );
          })}
          {docs.length === 0 && <EmptyState icon="folder" title="No documents on this account" body="Drop the master services agreement, the quality agreement and approved artwork here." />}
        </div>
      </Card>
    </div>
  );
}
