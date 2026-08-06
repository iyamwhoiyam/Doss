import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { useAllGates, useFlags, useOrders, useProjects } from '../lib/queries';
import { Loading, Pill, dateStr, money } from '../components/bits';
import type { EmployeeRole } from '../lib/types';

/* Map employee roles to the departments whose gates they own.
   Gate owner names in erp_gate_catalog are first names (Carlos, Marina, Jose,
   Ariel, Christine, Vivian, Patrick) — we match by name where possible and
   fall back to department. */
const ROLE_DEPTS: Record<EmployeeRole, string[]> = {
  executive: ['Sales', 'Finance', 'R&D', 'Purchasing', 'QA', 'Production', 'Warehouse'],
  product_development: ['Sales', 'R&D'],
  rd_scientist: ['R&D'],
  lab_technician: ['R&D', 'Production'],
  lab_manager: ['R&D', 'QA'],
  qc_specialist: ['QA'],
  production_manager: ['Production', 'Warehouse'],
  product_specialist: ['Sales'],
  admin: ['Sales', 'Finance', 'R&D', 'Purchasing', 'QA', 'Production', 'Warehouse'],
};

export default function MyDay() {
  const { employee, session } = useSession();
  const orders = useOrders();
  const gates = useAllGates();
  const projects = useProjects();
  const flags = useFlags('open');

  const firstName = employee?.name ?? session?.user?.email?.split('@')[0] ?? 'there';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const myDepts = employee ? ROLE_DEPTS[employee.role] ?? [] : [];

  const work = useMemo(() => {
    if (!orders.data || !gates.data) return null;
    const orderByRef = new Map(orders.data.map((o) => [o.ref, o]));

    // A gate is "mine" when its owner is my first name, or (no name match)
    // its department is one my role covers.
    const nameMatch = (owner: string | null) =>
      !!employee && !!owner && owner.toLowerCase() === employee.name.toLowerCase();
    const deptMatch = (dept: string | null) => !!dept && myDepts.includes(dept);

    const actionable = gates.data.filter(
      (g) => g.status !== 'done' && (nameMatch(g.owner) || deptMatch(g.department)),
    );

    // Only surface gates that are actually next: the lowest not-done gate per order.
    const nextByOrder = new Map<string, number>();
    for (const g of gates.data) {
      if (g.status === 'done') continue;
      const cur = nextByOrder.get(g.order_ref);
      if (cur === undefined || (g.gate_order ?? 99) < cur) nextByOrder.set(g.order_ref, g.gate_order ?? 99);
    }
    const mine = actionable
      .filter((g) => nextByOrder.get(g.order_ref) === (g.gate_order ?? 99))
      .map((g) => ({ gate: g, order: orderByRef.get(g.order_ref) }))
      .sort((a, b) => {
        // blocked first, then by delivery date
        const ab = a.gate.status === 'blocked' ? 0 : 1;
        const bb = b.gate.status === 'blocked' ? 0 : 1;
        if (ab !== bb) return ab - bb;
        return (a.order?.delivery_date ?? '9999').localeCompare(b.order?.delivery_date ?? '9999');
      });

    return { mine };
  }, [orders.data, gates.data, employee, myDepts]);

  const myProjects = useMemo(() => {
    if (!projects.data || !employee) return [];
    const me = employee.name.toLowerCase();
    return projects.data
      .filter(
        (p) =>
          (p.pm ?? '').toLowerCase().includes(me) || (p.rep ?? '').toLowerCase().includes(me),
      )
      .slice(0, 8);
  }, [projects.data, employee]);

  const blocked = orders.data?.filter((o) => o.blocked) ?? [];
  const openFlagCount = flags.data?.length ?? 0;

  return (
    <>
      <h1 className="greeting">
        {greet}, {firstName}
      </h1>
      <p className="page__sub">
        {dateStr(new Date().toISOString())} · {employee ? employee.role.replace(/_/g, ' ') : 'no employee record found for your account'}
      </p>

      <div className="kpis">
        <div className={`kpi ${blocked.length ? 'kpi--bad' : 'kpi--good'}`}>
          <span>Blocked orders (plant-wide)</span>
          <b>{orders.data ? blocked.length : '…'}</b>
        </div>
        <div className="kpi">
          <span>Active production orders</span>
          <b>{orders.data ? orders.data.filter((o) => (o.status ?? '') !== 'closed').length : '…'}</b>
        </div>
        <div className="kpi">
          <span>Open projects</span>
          <b>{projects.data ? projects.data.length : '…'}</b>
        </div>
        <div className={`kpi ${openFlagCount ? 'kpi--warn' : ''}`}>
          <span>Open data flags</span>
          <b>{flags.data ? openFlagCount : '…'}</b>
        </div>
      </div>

      <div className="cardgrid">
        <div className="card">
          <div className="card__head">
            My gates
            <span className="dim">next actionable gate on orders in your lane</span>
          </div>
          {!work ? (
            <Loading what="your gates" />
          ) : work.mine.length === 0 ? (
            <div className="empty">Nothing waiting on you. Check the order board for the wider picture.</div>
          ) : (
            <div className="tasklist">
              {work.mine.slice(0, 12).map(({ gate, order }) => (
                <Link key={gate.id} className="task" to={`/orders/${encodeURIComponent(gate.order_ref)}`}>
                  <span>
                    {gate.status === 'blocked' ? <Pill tone="bad">blocked</Pill> : <Pill tone="warn">open</Pill>}
                  </span>
                  <span className="task__what">
                    <b>
                      {gate.stage_name} — {gate.gate_key.replace(/_/g, ' ')}
                    </b>
                    <span>
                      {gate.order_ref}
                      {order?.customer ? ` · ${order.customer}` : ''}
                      {order?.product ? ` · ${order.product}` : ''}
                    </span>
                  </span>
                  <span className="dim mono">{order?.delivery_date ? dateStr(order.delivery_date) : ''}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card__head">
              My projects
              <span className="dim">where you are PM or rep</span>
            </div>
            {!projects.data ? (
              <Loading what="projects" />
            ) : myProjects.length === 0 ? (
              <div className="empty">No projects list you as PM or rep.</div>
            ) : (
              <div className="tasklist">
                {myProjects.map((p) => (
                  <Link key={p.pn} className="task" to={`/projects/${encodeURIComponent(p.pn)}`}>
                    <span className="mono accent">{p.pn}</span>
                    <span className="task__what">
                      <b>{p.product || '(unnamed product)'}</b>
                      <span>{p.customer_name || '—'} · {p.stage}</span>
                    </span>
                    <span />
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card__head">
              Worst blockers
              <span className="dim">highest-value blocked orders</span>
            </div>
            {!orders.data ? (
              <Loading what="orders" />
            ) : blocked.length === 0 ? (
              <div className="empty">Nothing blocked. Rare — enjoy it.</div>
            ) : (
              <div className="tasklist">
                {[...blocked]
                  .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
                  .slice(0, 6)
                  .map((o) => (
                    <Link key={o.id} className="task" to={`/orders/${encodeURIComponent(o.ref)}`}>
                      <span className="mono accent">{o.ref}</span>
                      <span className="task__what">
                        <b>{o.product || o.customer || '(untitled)'}</b>
                        <span>
                          waiting on {o.next_gate?.replace(/_/g, ' ') ?? '?'} · {o.next_owner ?? o.next_dept ?? '?'}
                        </span>
                      </span>
                      <span className="mono dim">{money(o.amount)}</span>
                    </Link>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
