import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Badge, Card, CardHead, Combo, DataTable, Drawer, EmptyState, Field, Flag, KeyValue,
  Modal, SearchInput, Select, StatusBadge, Tabs, TextArea, TextInput, type Column,
} from '../components/ui';
import { api, qs } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useCustomers, useUsers, useVendors } from '../lib/lookups';
import { date, dateTime, daysUntil, fileSize, relative } from '../lib/format';
import { DOCUMENT_CATEGORIES, DOCUMENT_STATUS, findOption } from '@shared/domain';
import type { Doc } from '../lib/types';

interface DocListResponse { rows: Doc[]; total: number }

export function Documents() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const { error, success } = useUi();
  const customers = useCustomers();
  const vendors = useVendors();
  const users = useUsers();
  useViewing('the document vault');

  const [tab, setTab] = useState(params.get('expiring') !== null ? 'expiring' : 'all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [openDoc, setOpenDoc] = useState<string | null>(params.get('doc'));

  const customerFilter = params.get('customerId') ?? '';

  const { data, isLoading } = useQuery<DocListResponse>({
    queryKey: ['documents', 'list', customerFilter],
    queryFn: () => api.get<DocListResponse>(`/documents${qs({ limit: 1000, where: customerFilter ? { customerId: customerFilter } : undefined })}`),
  });

  const { data: expiring } = useQuery<{ rows: (Doc & { daysUntilExpiry: number })[]; total: number; expired: number }>({
    queryKey: ['documents', 'expiring'],
    queryFn: () => api.get('/documents/expiring?days=60'),
  });

  const docs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((doc) => {
      if (category && doc.category !== category) return false;
      if (status && doc.status !== status) return false;
      if (!needle) return true;
      return `${doc.name} ${doc.description} ${doc.ownerName ?? ''}`.toLowerCase().includes(needle);
    });
  }, [data, search, category, status]);

  const selected = (data?.rows ?? []).find((doc) => doc.id === openDoc) ?? null;

  const columns: Column<Doc>[] = [
    { key: 'name', header: 'Document', sortValue: (row) => row.name, render: (row) => (
      <div className="row-tight">
        <Icon name={row.category === 'artwork' ? 'image' : row.category === 'coa' ? 'shield' : 'file'} size={15} className="faint" />
        <div style={{ minWidth: 0 }}>
          <div className="cell-primary truncate">{row.name}</div>
          <div className="cell-sub">v{row.currentVersion}{row.versions?.at(-1) ? ` · ${fileSize(row.versions.at(-1)!.size)}` : ''}</div>
        </div>
      </div>
    ) },
    { key: 'category', header: 'Category', sortValue: (row) => row.category, render: (row) => (
      <StatusBadge list={DOCUMENT_CATEGORIES} value={row.category} dot={false} />
    ) },
    { key: 'owner', header: 'Attached to', sortValue: (row) => row.ownerName ?? '', render: (row) => (
      <div>
        <div className="truncate">{row.ownerName ?? '—'}</div>
        <div className="cell-sub">{row.ownerType}</div>
      </div>
    ) },
    { key: 'status', header: 'Status', sortValue: (row) => row.status, render: (row) => (
      <div>
        <StatusBadge list={DOCUMENT_STATUS} value={row.status} />
        <div className="cell-sub truncate">{row.approvedBy ? users.name(row.approvedBy) : 'not approved'}</div>
      </div>
    ) },
    { key: 'expires', header: 'Expires', sortValue: (row) => row.expiresAt ?? '', render: (row) => {
      const days = daysUntil(row.expiresAt);
      if (days === null) return <span className="faint">—</span>;
      return <Badge tone={days < 0 ? 'danger' : days < 45 ? 'warning' : 'neutral'}>{days < 0 ? `expired ${Math.abs(days)}d ago` : `${days} d`}</Badge>;
    } },
    { key: 'updated', header: 'Updated', align: 'right', sortValue: (row) => row.updatedAt, render: (row) => <span className="nowrap cell-sub">{relative(row.updatedAt)}</span> },
  ];

  const sweep = async () => {
    try {
      const result = await api.post<{ expired: number }>('/documents/sweep-expiry', {});
      success(`${result.expired} document${result.expired === 1 ? '' : 's'} marked expired`);
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['collection', 'documents'] });
    } catch (err) { error(err); }
  };

  return (
    <div className="page page-wide">
      <PageHeader
        title="Documents"
        subtitle={
          customerFilter
            ? <>Filtered to {customers.name(customerFilter)} · <button type="button" className="link-btn" onClick={() => setParams({})}>show everything</button></>
            : `${data?.total ?? 0} documents · ${expiring?.expired ?? 0} expired, ${(expiring?.total ?? 0) - (expiring?.expired ?? 0)} expiring within 60 days`
        }
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Document, owner…" />
            <Select value={category} onChange={setCategory} allowEmpty placeholder="All categories" options={DOCUMENT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} style={{ width: 190 }} />
            <Select value={status} onChange={setStatus} allowEmpty placeholder="All statuses" options={DOCUMENT_STATUS.map((s) => ({ value: s.value, label: s.label }))} style={{ width: 150 }} />
            {can('documents.approve') && <button type="button" className="btn" onClick={sweep}><Icon name="refresh" size={13} /> Sweep expiry</button>}
            {can('documents.write') && (
              <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>
                <Icon name="upload" size={14} /> Upload
              </button>
            )}
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'All documents', count: docs.length, icon: 'folder' },
          { value: 'expiring', label: 'Expiring & expired', count: expiring?.total ?? null, icon: 'clock' },
        ]}
      />

      <div style={{ marginTop: 'var(--s-4)' }}>
        {tab === 'all' && (
          <Card>
            <DataTable
              columns={columns}
              rows={docs}
              loading={isLoading}
              selectedId={openDoc}
              onRowClick={(row) => setOpenDoc(row.id)}
              empty={<EmptyState icon="folder" title="No documents match" body="Adjust the filters, or upload the first document for this record." />}
            />
          </Card>
        )}

        {tab === 'expiring' && (
          <Card>
            <CardHead
              title="Compliance watchlist"
              subtitle="Certificates, insurance and COAs that lapse soon or already have"
              icon="clock"
            />
            <div className="card-body-flush">
              {(expiring?.rows ?? []).length === 0 && (
                <EmptyState icon="check-circle" title="Nothing is expiring" body="Every dated document on file is current for at least the next 60 days." />
              )}
              {(expiring?.rows ?? []).map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  className="list-row"
                  style={{ width: '100%', border: 0, background: 'none', textAlign: 'left' }}
                  onClick={() => { setTab('all'); setOpenDoc(doc.id); }}
                >
                  <span className="tone-text" data-tone={doc.daysUntilExpiry < 0 ? 'danger' : 'warning'}>
                    <Icon name="alert" size={15} />
                  </span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="cell-primary truncate" style={{ display: 'block' }}>{doc.name}</span>
                    <span className="cell-sub">
                      {findOption(DOCUMENT_CATEGORIES, doc.category).label} ·
                      {' '}{doc.vendorId ? vendors.name(doc.vendorId) : doc.customerId ? customers.name(doc.customerId) : doc.ownerType}
                    </span>
                  </span>
                  <Badge tone={doc.daysUntilExpiry < 0 ? 'danger' : 'warning'}>
                    {doc.daysUntilExpiry < 0 ? `expired ${Math.abs(doc.daysUntilExpiry)} days ago` : `${doc.daysUntilExpiry} days`}
                  </Badge>
                  <span className="cell-sub nowrap">{date(doc.expiresAt)}</span>
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>

      <DocumentDrawer
        doc={selected}
        onClose={() => { setOpenDoc(null); setParams(customerFilter ? { customerId: customerFilter } : {}); }}
        onChanged={() => queryClient.invalidateQueries({ queryKey: ['documents'] })}
      />

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        customerOptions={customers.options}
        vendorOptions={vendors.options}
        onUploaded={() => { setUploadOpen(false); queryClient.invalidateQueries({ queryKey: ['documents'] }); }}
      />
    </div>
  );
}

function DocumentDrawer({ doc, onClose, onChanged }: {
  doc: Doc | null; onClose: () => void; onChanged: () => void;
}) {
  const { error, success } = useUi();
  const { can } = useSession();
  const users = useUsers();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (!doc) return null;

  const latest = doc.versions?.at(-1);

  const approve = async () => {
    try {
      await api.post(`/documents/${doc.id}/approve`, {});
      success('Document approved');
      onChanged();
    } catch (err) { error(err); }
  };

  const uploadVersion = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('files', files[0]);
      form.append('documentId', doc.id);
      await api.upload('/documents/upload', form);
      success(`Version ${doc.currentVersion + 1} uploaded`, 'The document is back in review.');
      onChanged();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={doc.name}
      badge={<StatusBadge list={DOCUMENT_STATUS} value={doc.status} />}
      subtitle={`${findOption(DOCUMENT_CATEGORIES, doc.category).label} · ${doc.ownerName ?? doc.ownerType} · v${doc.currentVersion}`}
      footer={
        <>
          {can('documents.write') && (
            <>
              <input ref={inputRef} type="file" className="sr-only" onChange={(event) => { void uploadVersion(event.target.files); event.target.value = ''; }} />
              <button type="button" className="btn" disabled={busy} onClick={() => inputRef.current?.click()}>
                {busy ? <span className="spinner" /> : <Icon name="upload" size={13} />} New version
              </button>
            </>
          )}
          {can('documents.approve') && doc.status !== 'approved' && (
            <button type="button" className="btn btn-primary" onClick={approve}><Icon name="check" size={13} /> Approve</button>
          )}
          {latest && !latest.placeholder && (
            <a className="btn btn-primary" href={`/api/documents/${doc.id}/versions/${latest.version}/file?download=1`}>
              <Icon name="download" size={13} /> Download
            </a>
          )}
        </>
      }
    >
      <div className="col">
        {doc.confidential && (
          <Flag tone="danger" title="Confidential" detail="This document is marked confidential. Share it only with people on the account." />
        )}
        {latest?.placeholder && (
          <Flag
            tone="warning"
            title="No file is attached to this version"
            detail="This record was created as metadata only — the underlying file has not been uploaded yet. Use “New version” to attach it."
          />
        )}

        <KeyValue
          items={[
            { label: 'Category', value: findOption(DOCUMENT_CATEGORIES, doc.category).label },
            { label: 'Attached to', value: `${doc.ownerName ?? '—'} (${doc.ownerType})` },
            { label: 'Effective', value: date(doc.effectiveDate) },
            { label: 'Expires', value: doc.expiresAt ? `${date(doc.expiresAt)} (${daysUntil(doc.expiresAt)} days)` : '—' },
            { label: 'Reviewer', value: users.name(doc.reviewerId) },
            { label: 'Approved', value: doc.approvedBy ? `${users.name(doc.approvedBy)} · ${date(doc.approvedAt)}` : 'Not approved' },
            { label: 'Created', value: `${date(doc.createdAt)} by ${users.name(doc.createdBy)}` },
          ]}
        />

        {doc.description && <div className="muted">{doc.description}</div>}

        <div>
          <div className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>Version history</div>
          <div className="card">
            <div className="card-body-flush">
              {[...(doc.versions ?? [])].reverse().map((version) => (
                <div key={version.version} className="list-row">
                  <Badge tone={version.version === doc.currentVersion ? 'success' : 'neutral'}>v{version.version}</Badge>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="cell-primary truncate" style={{ display: 'block' }}>{version.filename}</span>
                    <span className="cell-sub">
                      {fileSize(version.size)} · {users.name(version.uploadedBy)} · {dateTime(version.uploadedAt)}
                      {version.notes ? ` · ${version.notes}` : ''}
                    </span>
                  </span>
                  {!version.placeholder && (
                    <a className="btn btn-sm btn-ghost" href={`/api/documents/${doc.id}/versions/${version.version}/file`} target="_blank" rel="noreferrer">
                      <Icon name="external" size={13} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {doc.tags.length > 0 && (
          <div className="row-wrap">
            {doc.tags.map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function UploadModal({ open, onClose, onUploaded, customerOptions, vendorOptions }: {
  open: boolean; onClose: () => void; onUploaded: () => void;
  customerOptions: { value: string; label: string; sub?: string }[];
  vendorOptions: { value: string; label: string; sub?: string }[];
}) {
  const { error, success } = useUi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [ownerType, setOwnerType] = useState('customer');
  const [ownerId, setOwnerId] = useState('');
  const [category, setCategory] = useState('other');
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      form.append('ownerType', ownerType);
      form.append('ownerId', ownerId);
      if (ownerType === 'customer') form.append('customerId', ownerId);
      if (ownerType === 'vendor') form.append('vendorId', ownerId);
      form.append('category', category);
      if (name) form.append('name', name);
      if (expiresAt) form.append('expiresAt', new Date(`${expiresAt}T12:00:00Z`).toISOString());
      if (description) form.append('description', description);
      await api.upload('/documents/upload', form);
      success(`${files.length} file${files.length === 1 ? '' : 's'} uploaded`);
      setFiles([]); setName(''); setDescription(''); setExpiresAt('');
      onUploaded();
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  const ownerOptions = ownerType === 'customer' ? customerOptions : ownerType === 'vendor' ? vendorOptions : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      large
      title="Upload documents"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!files.length || busy} onClick={submit}>
            {busy ? <span className="spinner" /> : <Icon name="upload" size={14} />} Upload {files.length || ''}
          </button>
        </>
      }
    >
      <div className="col">
        <div
          className="dropzone"
          data-over={dragOver ? 'true' : undefined}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => { event.preventDefault(); setDragOver(false); setFiles(Array.from(event.dataTransfer.files)); }}
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="upload" size={22} className="faint" />
          <div className="strong" style={{ marginTop: 'var(--s-2)' }}>
            {files.length ? `${files.length} file${files.length === 1 ? '' : 's'} ready` : 'Drop files here, or click to choose'}
          </div>
          <div className="cell-sub">PDF, images, Office documents and archives up to 60 MB each</div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
        </div>

        {files.length > 0 && (
          <div className="col-tight">
            {files.map((file) => (
              <div key={file.name} className="row-tight">
                <Icon name="file" size={13} className="faint" />
                <span className="grow truncate">{file.name}</span>
                <span className="cell-sub">{fileSize(file.size)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="field-row">
          <Field label="Attach to">
            <Select
              value={ownerType}
              onChange={(value) => { setOwnerType(value); setOwnerId(''); }}
              options={[
                { value: 'customer', label: 'A customer' },
                { value: 'vendor', label: 'A vendor' },
                { value: 'general', label: 'Nothing in particular' },
              ]}
            />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={setCategory} options={DOCUMENT_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
          </Field>
        </div>

        {ownerType !== 'general' && (
          <Field label={ownerType === 'customer' ? 'Customer' : 'Vendor'}>
            <Combo value={ownerId} onChange={setOwnerId} options={ownerOptions} placeholder="Choose…" allowEmpty={false} />
          </Field>
        )}

        <div className="field-row">
          <Field label="Document name" hint="Defaults to the file name."><TextInput value={name} onChange={setName} placeholder="Auto" /></Field>
          <Field label="Expires" hint="Certificates, insurance and COAs should carry one."><TextInput type="date" value={expiresAt} onChange={setExpiresAt} /></Field>
        </div>

        <Field label="Description"><TextArea value={description} onChange={setDescription} rows={2} /></Field>
      </div>
    </Modal>
  );
}
