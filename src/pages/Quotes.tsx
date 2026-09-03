import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Badge, Card, Combo, DataTable, Field, Modal, SearchInput, Select, StatusBadge, type Column } from '../components/ui';
import { useList } from '../lib/api';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useCustomers, useFormulas, useProjects, useUsers } from '../lib/lookups';
import { ProjectLink } from '../components/ProjectLink';
import { compact, date, daysUntil, money, relative, unitMoney } from '../lib/format';
import { QUOTE_STATUS } from '@shared/domain';
import type { Quote } from '../lib/types';

/** The headline number on a quote is the largest tier that carries a price. */
function topTier(quote: Quote) {
  return (quote.result?.tiers ?? []).filter((tier) => tier.extendedTotal !== null).at(-1) ?? null;
}

export function Quotes() {
  const navigate = useNavigate();
  const { can } = useSession();
  const customers = useCustomers();
  const formulas = useFormulas();
  const users = useUsers();
  const projects = useProjects();
  // A quote belongs to a project directly, or through the formula it prices.
  const projectFor = (row: Quote) => (row.projectId ? projects.byId.get(row.projectId) : undefined) ?? projects.rows.find((p) => p.quoteId === row.id || (row.formulaId && p.formulaId === row.formulaId));
  useViewing('quotes');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const { data, isLoading } = useList<Quote>('quotes', { sort: '-createdAt', limit: 400 });

  const quotes = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((quote) => {
      if (status && quote.status !== status) return false;
      if (!needle) return true;
      return `${quote.quoteNumber} ${quote.title} ${customers.name(quote.customerId)}`.toLowerCase().includes(needle);
    });
  }, [data, search, status, customers]);

  const pipeline = useMemo(() => {
    const open = quotes.filter((quote) => ['draft', 'sent', 'revised'].includes(quote.status));
    const won = quotes.filter((quote) => quote.status === 'accepted');
    return {
      openValue: open.reduce((sum, quote) => sum + Number(topTier(quote)?.extendedTotal ?? 0), 0),
      wonValue: won.reduce((sum, quote) => sum + Number(topTier(quote)?.extendedTotal ?? 0), 0),
      open: open.length,
      won: won.length,
    };
  }, [quotes]);

  const columns: Column<Quote>[] = [
    { key: 'number', header: 'Quote', sortValue: (row) => row.quoteNumber, render: (row) => (
      <div>
        <div className="cell-primary truncate">{row.title}</div>
        <div className="cell-sub mono">{row.quoteNumber}{row.revision > 1 ? ` · rev ${row.revision}` : ''}</div>
      </div>
    ) },
    { key: 'customer', header: 'Customer', sortValue: (row) => customers.name(row.customerId), render: (row) => customers.name(row.customerId) },
    { key: 'project', header: 'Project', sortValue: (row) => projectFor(row)?.code ?? '', render: (row) => { const p = projectFor(row); return <ProjectLink id={p?.id} code={p?.code} />; } },
    { key: 'status', header: 'Status', sortValue: (row) => row.status, render: (row) => <StatusBadge list={QUOTE_STATUS} value={row.status} /> },
    { key: 'tiers', header: 'Tiers', numeric: true, sortValue: (row) => row.tiers.length, render: (row) => row.tiers.map((tier) => compact(tier.qty)).join(' / ') },
    { key: 'cogs', header: 'COGS/unit', numeric: true, sortValue: (row) => Number(topTier(row)?.cogsPerUnit ?? 0), render: (row) => {
      const tier = topTier(row);
      return tier ? unitMoney(tier.cogsPerUnit) : '—';
    } },
    { key: 'price', header: 'Price/unit', numeric: true, sortValue: (row) => Number(topTier(row)?.salePricePerUnit ?? 0), render: (row) => {
      const tier = topTier(row);
      return tier?.salePricePerUnit ? unitMoney(tier.salePricePerUnit) : <span className="faint">no margin set</span>;
    } },
    { key: 'value', header: 'Extended', numeric: true, sortValue: (row) => Number(topTier(row)?.extendedTotal ?? 0), render: (row) => {
      const tier = topTier(row);
      return tier?.extendedTotal ? money(tier.extendedTotal, 0) : '—';
    } },
    { key: 'compliance', header: '', render: (row) => {
      const worst = row.result?.complianceWorst;
      if (!worst || worst === 'PASS') return null;
      return <Badge tone={worst === 'BLOCK' ? 'danger' : 'warning'}>{worst}</Badge>;
    } },
    { key: 'owner', header: 'Owner', sortValue: (row) => users.name(row.ownerId), render: (row) => users.name(row.ownerId) },
    { key: 'valid', header: 'Valid until', sortValue: (row) => row.validUntil ?? '', render: (row) => {
      const days = daysUntil(row.validUntil);
      if (days === null) return '—';
      return <span className={days < 0 ? 'tone-text' : ''} data-tone={days < 0 ? 'danger' : undefined}>{date(row.validUntil)}</span>;
    } },
    { key: 'updated', header: 'Updated', sortValue: (row) => row.updatedAt, render: (row) => relative(row.updatedAt) },
  ];

  return (
    <div className="page page-wide">
      <PageHeader
        title="Quotes & costing"
        subtitle={`${pipeline.open} open worth ${money(pipeline.openValue, 0)} · ${pipeline.won} accepted worth ${money(pipeline.wonValue, 0)}`}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Quote number, product, customer…" />
            <Select value={status} onChange={setStatus} allowEmpty placeholder="All statuses" options={QUOTE_STATUS.map((s) => ({ value: s.value, label: s.label }))} style={{ width: 154 }} />
            {can('quotes.write') && (
              <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
                <Icon name="plus" size={14} /> New quote
              </button>
            )}
          </>
        }
      />

      <Card>
        <DataTable columns={columns} rows={quotes} loading={isLoading} onRowClick={(row) => navigate(`/quotes/${row.id}`)} />
      </Card>

      <NewQuote
        open={newOpen}
        onClose={() => setNewOpen(false)}
        formulaOptions={formulas.options}
        onPick={(formulaId) => { setNewOpen(false); navigate(`/quotes/new?formulaId=${formulaId}`); }}
      />
    </div>
  );
}

function NewQuote({ open, onClose, onPick, formulaOptions }: {
  open: boolean; onClose: () => void; onPick: (formulaId: string) => void;
  formulaOptions: { value: string; label: string; sub?: string }[];
}) {
  const [formulaId, setFormulaId] = useState('');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start a quote"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!formulaId} onClick={() => onPick(formulaId)}>
            Build the cost <Icon name="arrow-right" size={13} />
          </button>
        </>
      }
    >
      <Field label="Formula" hint="Every quote is built from a master formula, so the cost and the batch record agree.">
        <Combo value={formulaId} onChange={setFormulaId} options={formulaOptions} placeholder="Choose a formula…" allowEmpty={false} />
      </Field>
    </Modal>
  );
}
