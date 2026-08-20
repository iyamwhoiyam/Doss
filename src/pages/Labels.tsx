import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import {
  Badge, Card, Combo, DataTable, Field, Flag, Meter, Modal, SearchInput,
  Select, StatusBadge, TextArea, TextInput, type Column,
} from '../components/ui';
import { api, useList } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useCustomers, useFormulas, useUsers } from '../lib/lookups';
import { date, relative } from '../lib/format';
import { LABEL_REVIEW_STATUS } from '@shared/domain';
import type { LabelReview } from '../lib/types';

const PANEL_FIELDS = [
  { key: 'pdp', label: 'Principal display panel', hint: 'Brand, product name, "Dietary Supplement", net quantity.' },
  { key: 'information', label: 'Information panel', hint: 'Supplement Facts, other ingredients, allergens, firm statement, UPC.' },
  { key: 'leftSide', label: 'Left side panel', hint: 'Directions, claims, warnings, the DSHEA disclaimer, the revision mark.' },
  { key: 'rightSide', label: 'Right side panel', hint: 'Anything on the fourth panel of a carton dieline.' },
] as const;

export function Labels() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const customers = useCustomers();
  const formulas = useFormulas();
  const users = useUsers();
  useViewing('label reviews');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const { data, isLoading } = useList<LabelReview>('labelReviews', { sort: '-createdAt', limit: 300 });

  const reviews = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((review) => {
      if (status && review.status !== status) return false;
      if (!needle) return true;
      return `${review.reviewNumber} ${review.productName} ${review.brand} ${customers.name(review.customerId)}`.toLowerCase().includes(needle);
    });
  }, [data, search, status, customers]);

  const totals = useMemo(() => ({
    open: reviews.filter((review) => ['in_review', 'corrections_requested'].includes(review.status)).length,
    corrections: reviews.reduce((sum, review) => sum + (review.metrics?.requiredCorrections ?? 0), 0),
    undecided: reviews.reduce((sum, review) => sum + review.findings.filter((finding) => finding.decision === 'pending').length, 0),
  }), [reviews]);

  const columns: Column<LabelReview>[] = [
    { key: 'review', header: 'Review', sortValue: (row) => row.reviewNumber, render: (row) => (
      <div>
        <div className="cell-primary truncate">{row.brand ? `${row.brand} · ` : ''}{row.productName}</div>
        <div className="cell-sub mono">{row.reviewNumber}{row.labelRevision ? ` · ${row.labelRevision}` : ''}</div>
      </div>
    ) },
    { key: 'customer', header: 'Customer', sortValue: (row) => customers.name(row.customerId), render: (row) => customers.name(row.customerId) },
    { key: 'status', header: 'Status', sortValue: (row) => row.status, render: (row) => <StatusBadge list={LABEL_REVIEW_STATUS} value={row.status} /> },
    { key: 'completion', header: 'Checklist', width: '150px', sortValue: (row) => row.metrics?.completionPct ?? 0, render: (row) => (
      <div className="row-tight">
        <div className="grow"><Meter value={row.metrics?.completionPct ?? 0} /></div>
        <span className="cell-sub mono">{row.metrics?.reviewed ?? 0}/{row.metrics?.total ?? 41}</span>
      </div>
    ) },
    { key: 'required', header: 'Required', numeric: true, sortValue: (row) => row.metrics?.requiredCorrections ?? 0, render: (row) => (
      (row.metrics?.requiredCorrections ?? 0) > 0
        ? <Badge tone="danger">{row.metrics.requiredCorrections}</Badge>
        : <Badge tone="success">0</Badge>
    ) },
    { key: 'recommend', header: 'Advisory', numeric: true, sortValue: (row) => row.metrics?.recommendations ?? 0, render: (row) => row.metrics?.recommendations ?? 0 },
    { key: 'pending', header: 'Undecided', numeric: true, render: (row) => {
      const pending = row.findings.filter((finding) => finding.decision === 'pending').length;
      return pending ? <Badge tone="warning">{pending}</Badge> : <span className="faint">—</span>;
    } },
    { key: 'reviewer', header: 'Reviewer', sortValue: (row) => users.name(row.reviewerId), render: (row) => users.name(row.reviewerId) },
    { key: 'approver', header: 'Signed off', render: (row) => (row.approverId ? `${users.name(row.approverId)} · ${date(row.approvedAt)}` : <span className="faint">not signed</span>) },
    { key: 'received', header: 'Received', sortValue: (row) => row.receivedAt ?? '', render: (row) => relative(row.receivedAt) },
  ];

  return (
    <div className="page page-wide">
      <PageHeader
        title="Label review"
        subtitle={`${totals.open} in review · ${totals.corrections} required corrections · ${totals.undecided} findings awaiting a decision`}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Review, product, brand…" />
            <Select value={status} onChange={setStatus} allowEmpty placeholder="All statuses" options={LABEL_REVIEW_STATUS.map((s) => ({ value: s.value, label: s.label }))} style={{ width: 190 }} />
            {can('labels.write') && (
              <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
                <Icon name="plus" size={14} /> New review
              </button>
            )}
          </>
        }
      />

      <Card>
        <DataTable columns={columns} rows={reviews} loading={isLoading} onRowClick={(row) => navigate(`/labels/${row.id}`)} />
      </Card>

      <NewReview
        open={newOpen}
        onClose={() => setNewOpen(false)}
        customerOptions={customers.options}
        formulaOptions={formulas.options}
        onCreated={(id) => {
          setNewOpen(false);
          queryClient.invalidateQueries({ queryKey: ['collection', 'labelReviews'] });
          navigate(`/labels/${id}`);
        }}
      />
    </div>
  );
}

function NewReview({ open, onClose, onCreated, customerOptions, formulaOptions }: {
  open: boolean; onClose: () => void; onCreated: (id: string) => void;
  customerOptions: { value: string; label: string; sub?: string }[];
  formulaOptions: { value: string; label: string; sub?: string }[];
}) {
  const { error } = useUi();
  const [productName, setProductName] = useState('');
  const [brand, setBrand] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [formulaId, setFormulaId] = useState('');
  const [source, setSource] = useState('text');
  const [panels, setPanels] = useState<Record<string, string>>({ pdp: '', information: '', leftSide: '', rightSide: '' });
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const review = await api.post<LabelReview>('/labels', {
        productName, brand, customerId, formulaId, source,
        panels: Object.fromEntries(Object.entries(panels).filter(([, value]) => value.trim())),
      });
      onCreated(review.id);
    } catch (err) { error(err); } finally { setBusy(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      large
      title="Open a label review"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!productName || !panels.pdp || busy} onClick={create}>
            {busy ? <span className="spinner" /> : <Icon name="wand" size={14} />} Run the checklist
          </button>
        </>
      }
    >
      <div className="col">
        <Flag
          tone="info"
          title="Paste the copy panel by panel"
          detail="A carton dieline is four or five separate panels. Reading them as one block produces a review of a label that does not exist. Twenty of the forty-one rows need the artwork itself and will come back as Not reviewed with the specific thing to look at."
        />

        <div className="field-row">
          <Field label="Product name"><TextInput value={productName} onChange={setProductName} autoFocus placeholder="Immune Defense Gummy" /></Field>
          <Field label="Brand"><TextInput value={brand} onChange={setBrand} placeholder="Nordvita" /></Field>
        </div>
        <div className="field-row">
          <Field label="Customer"><Combo value={customerId} onChange={setCustomerId} options={customerOptions} placeholder="Choose…" /></Field>
          <Field label="Master formula" hint="Cross-checks the declared amounts against the formula.">
            <Combo value={formulaId} onChange={setFormulaId} options={formulaOptions} placeholder="None linked" />
          </Field>
        </div>
        <Field label="Where the copy came from" hint="An image is read by OCR, so a missing element becomes 'confirm against the artwork', not 'missing'.">
          <Select
            value={source}
            onChange={setSource}
            options={[
              { value: 'text', label: 'Typed or pasted copy' },
              { value: 'pdf', label: 'Print PDF text layer' },
              { value: 'image', label: 'Image read by OCR' },
              { value: 'artwork', label: 'Artwork proof' },
            ]}
          />
        </Field>

        {PANEL_FIELDS.map((panel) => (
          <Field key={panel.key} label={panel.label} hint={panel.hint}>
            <TextArea
              value={panels[panel.key] ?? ''}
              onChange={(value) => setPanels((current) => ({ ...current, [panel.key]: value }))}
              rows={panel.key === 'information' ? 8 : 4}
            />
          </Field>
        ))}
      </div>
    </Modal>
  );
}
