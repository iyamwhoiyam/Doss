import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Badge, Card, DataTable, EmptyState, SearchInput, Segmented, Select, StatusBadge, type Column } from '../components/ui';
import { useList } from '../lib/api';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useCustomers, useProjects, useUsers } from '../lib/lookups';
import { ProjectLink } from '../components/ProjectLink';
import { date, mg, number, relative } from '../lib/format';
import { FORMULA_FORMATS, FORMULA_STATUS, findOption } from '@shared/domain';
import type { Formula } from '../lib/types';

export function Formulations() {
  const navigate = useNavigate();
  const { can } = useSession();
  const customers = useCustomers();
  const users = useUsers();
  const projects = useProjects();
  const projectFor = (row: Formula) => (row.projectId ? projects.byId.get(row.projectId) : undefined) ?? projects.rows.find((p) => p.formulaId === row.id);
  useViewing('formulations');

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [format, setFormat] = useState('');
  const [view, setView] = useState<'cards' | 'table'>('cards');

  const { data, isLoading } = useList<Formula>('formulas', { sort: 'code', limit: 500 });

  const formulas = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((formula) => {
      if (status && formula.status !== status) return false;
      if (format && formula.format !== format) return false;
      if (!needle) return true;
      return `${formula.code} ${formula.name} ${customers.name(formula.customerId)} ${formula.actives.map((a) => a.name).join(' ')}`
        .toLowerCase().includes(needle);
    });
  }, [data, search, status, format, customers]);

  const columns: Column<Formula>[] = [
    { key: 'code', header: 'Formula', sortValue: (row) => row.code, render: (row) => (
      <div>
        <div className="cell-primary truncate">{row.name}</div>
        <div className="cell-sub mono">{row.code} · rev {row.revision}</div>
      </div>
    ) },
    { key: 'format', header: 'Format', sortValue: (row) => row.format, render: (row) => (
      <Badge tone="neutral">{findOption(FORMULA_FORMATS, row.format).label}</Badge>
    ) },
    { key: 'customer', header: 'Customer', sortValue: (row) => customers.name(row.customerId), render: (row) => customers.name(row.customerId) },
    { key: 'project', header: 'Project', sortValue: (row) => projectFor(row)?.code ?? '', render: (row) => { const p = projectFor(row); return <ProjectLink id={p?.id} code={p?.code} />; } },
    { key: 'status', header: 'Status', sortValue: (row) => row.status, render: (row) => <StatusBadge list={FORMULA_STATUS} value={row.status} /> },
    { key: 'actives', header: 'Actives', numeric: true, sortValue: (row) => row.actives.length, render: (row) => row.actives.length },
    { key: 'serving', header: 'Serving', render: (row) => row.servingSize },
    { key: 'weight', header: 'Fill weight', numeric: true, sortValue: (row) => row.totalFormatWeightMg, render: (row) => mg(row.totalFormatWeightMg) },
    { key: 'owner', header: 'Owner', sortValue: (row) => users.name(row.ownerId), render: (row) => users.name(row.ownerId) },
    { key: 'updated', header: 'Updated', sortValue: (row) => row.updatedAt, render: (row) => relative(row.updatedAt) },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Formulations"
        subtitle={`${formulas.length} formulas · the master record every batch and quote is built from`}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Formula, ingredient, customer…" />
            <Select value={status} onChange={setStatus} allowEmpty placeholder="All statuses" options={FORMULA_STATUS.map((s) => ({ value: s.value, label: s.label }))} style={{ width: 156 }} />
            <Select value={format} onChange={setFormat} allowEmpty placeholder="All formats" options={FORMULA_FORMATS.map((f) => ({ value: f.value, label: f.label }))} style={{ width: 150 }} />
            <Segmented value={view} onChange={setView} options={[{ value: 'cards', label: 'Cards' }, { value: 'table', label: 'Table' }]} />
            {can('formulas.write') && (
              <button type="button" className="btn btn-primary" onClick={() => navigate('/formulations/new')}>
                <Icon name="plus" size={14} /> New formula
              </button>
            )}
          </>
        }
      />

      {view === 'table' ? (
        <Card>
          <DataTable columns={columns} rows={formulas} loading={isLoading} onRowClick={(row) => navigate(`/formulations/${row.id}`)} />
        </Card>
      ) : (
        <div className="grid grid-3">
          {formulas.map((formula) => {
            const formatDef = findOption(FORMULA_FORMATS, formula.format);
            return (
              <div
                key={formula.id}
                role="button"
                tabIndex={0}
                className="card"
                style={{ textAlign: 'left', padding: 'var(--s-5)', cursor: 'pointer' }}
                onClick={() => navigate(`/formulations/${formula.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/formulations/${formula.id}`); }}
              >
                <div className="row-tight" style={{ marginBottom: 'var(--s-2)' }}>
                  <span className="mono cell-sub">{formula.code}</span>
                  <span className="spacer" />
                  <StatusBadge list={FORMULA_STATUS} value={formula.status} />
                </div>
                <h3 style={{ fontSize: 'var(--t-base)', marginBottom: 4 }} className="truncate">{formula.name}</h3>
                <div className="cell-sub row-tight" style={{ marginBottom: 'var(--s-3)' }}>
                  <span className="truncate">{customers.name(formula.customerId)}</span>
                  {(() => { const p = projectFor(formula); return p ? <><span>·</span><ProjectLink id={p.id} code={p.code} /></> : null; })()}
                </div>

                <div className="row-wrap" style={{ gap: 'var(--s-1)', marginBottom: 'var(--s-3)' }}>
                  <Badge tone="accent">{formatDef.label}</Badge>
                  <Badge tone="neutral">{formula.servingSize}</Badge>
                  {formula.isBulk && <Badge tone="warning">bulk</Badge>}
                  {formula.capsuleShellSize && <Badge tone="neutral">size {formula.capsuleShellSize}</Badge>}
                </div>

                <div className="col-tight">
                  {formula.actives.slice(0, 4).map((active) => (
                    <div key={active.code + active.name} className="row-tight" style={{ fontSize: 'var(--t-xs)' }}>
                      <span className="grow truncate">{active.name}</span>
                      <span className="mono faint">{mg(active.targetMg ?? 0)}</span>
                    </div>
                  ))}
                  {formula.actives.length > 4 && (
                    <div className="cell-sub">+{formula.actives.length - 4} more actives</div>
                  )}
                </div>

                <div className="row-tight" style={{ marginTop: 'var(--s-4)', paddingTop: 'var(--s-3)', borderTop: '1px solid var(--line-soft)' }}>
                  <span className="cell-sub">{number(formula.servingsPerUnit)} servings/unit</span>
                  <span className="spacer" />
                  <span className="cell-sub">{formula.approvedAt ? `approved ${date(formula.approvedAt)}` : `rev ${formula.revision}`}</span>
                </div>
              </div>
            );
          })}
          {formulas.length === 0 && !isLoading && (
            <Card><EmptyState icon="beaker" title="No formulas match" body="Adjust the filters, or create a new formula to start a cost build." /></Card>
          )}
        </div>
      )}
    </div>
  );
}
