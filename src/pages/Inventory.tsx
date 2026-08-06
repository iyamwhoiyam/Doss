import { useState } from 'react';
import { useInventory, useInventoryCategories } from '../lib/queries';
import { Empty, ErrorNotice, Loading, money } from '../components/bits';

export default function Inventory() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const items = useInventory(q, cat);
  const cats = useInventoryCategories();

  return (
    <>
      <div className="page__head">
        <h1>Inventory</h1>
        <span className="dim">raw materials, packaging, and components — read-only reference</span>
      </div>

      <div className="filters">
        <input
          type="search"
          placeholder="Search SKU or description…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={cat ?? ''} onChange={(e) => setCat(e.target.value || null)}>
          <option value="">All categories</option>
          {(cats.data ?? []).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {items.isLoading ? (
        <Loading what="inventory" />
      ) : items.error ? (
        <ErrorNotice error={items.error} />
      ) : (items.data?.length ?? 0) === 0 ? (
        <Empty>No items match.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Description</th>
                <th>Category</th>
                <th>Supplier</th>
                <th className="right">Unit cost</th>
                <th className="right">On hand</th>
                <th className="right">Potency</th>
              </tr>
            </thead>
            <tbody>
              {items.data!.map((i) => (
                <tr key={i.sku}>
                  <td className="mono accent">{i.sku}</td>
                  <td className="strong">{i.description || '—'}</td>
                  <td>{i.category || '—'}</td>
                  <td>{i.supplier || '—'}</td>
                  <td className="right mono">{i.unit_cost != null ? money(i.unit_cost, 2) : '—'}</td>
                  <td className="right mono">{i.on_hand != null ? i.on_hand.toLocaleString() : '—'}</td>
                  <td className="right mono">{i.potency_pct != null ? `${i.potency_pct}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(items.data?.length ?? 0) >= 300 && (
        <p className="dim" style={{ marginTop: 10 }}>Showing first 300 — narrow the search to see more.</p>
      )}
    </>
  );
}
