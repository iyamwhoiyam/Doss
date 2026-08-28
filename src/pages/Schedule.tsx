/**
 * Production schedule.
 *
 * The board answers "what stage is everything at". This answers "when, and on
 * which line, does it run" — the same work orders, laid out as blocks across
 * production lines and a date window. Drag a block onto a line and a day to
 * reschedule it; drag one out of the tray to place a batch that has no slot yet.
 *
 * A block keeps its duration when it moves: the drop sets the new start, the end
 * follows. All positioning is by date arithmetic against the window start, so a
 * batch that begins before the window still shows, clamped to the left edge.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, pointerWithin,
  useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';

import { PageHeader } from '../components/Shell';
import { Icon } from '../components/Icon';
import { Badge, CardHead, EmptyState, SearchInput, Segmented, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { useUi } from '../lib/ui';
import { useSession } from '../lib/session';
import { useViewing } from '../lib/realtime';
import { useCustomers, useUsers } from '../lib/lookups';
import { compact } from '../lib/format';
import { WORK_ORDER_STAGES, findOption } from '@shared/domain';

interface ScheduleWo {
  id: string; woNumber: string; batchNumber: string; productName: string;
  customerId: string; formulaId: string; line: string; stage: string; priority: string;
  plannedQty: number; uom: string; supervisorId: string;
  plannedStart: string | null; plannedEnd: string | null;
}

interface ScheduleResponse {
  start: string;
  span: number;
  days: { date: string; weekend: boolean }[];
  lines: string[];
  scheduled: ScheduleWo[];
  unscheduled: ScheduleWo[];
}

const MS_DAY = 86_400_000;

function dayIndex(iso: string | null, startISO: string): number | null {
  if (!iso) return null;
  const s = Date.parse(`${startISO}T00:00:00Z`);
  const d = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(d)) return null;
  return Math.round((d - s) / MS_DAY);
}

/** Duration of a work order in whole days, floor of one. */
function durationDays(wo: ScheduleWo): number {
  if (!wo.plannedStart || !wo.plannedEnd) return 1;
  const s = Date.parse(wo.plannedStart);
  const e = Date.parse(wo.plannedEnd);
  if (Number.isNaN(s) || Number.isNaN(e)) return 1;
  return Math.max(1, Math.round((e - s) / MS_DAY) + 1);
}

function isoAt(startISO: string, offsetDays: number, hour = 8): string {
  const base = Date.parse(`${startISO}T00:00:00Z`) + offsetDays * MS_DAY;
  const d = new Date(base);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function shiftWeeks(startISO: string, weeks: number): string {
  return new Date(Date.parse(`${startISO}T00:00:00Z`) + weeks * 7 * MS_DAY).toISOString().slice(0, 10);
}

export function Schedule() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { error } = useUi();
  const { can } = useSession();
  const customers = useCustomers();
  const users = useUsers();
  useViewing('the production schedule');

  const [start, setStart] = useState<string | null>(null);
  const [span, setSpan] = useState<'7' | '14' | '21'>('14');
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState<ScheduleWo | null>(null);
  const editable = can('production.write');

  const { data, isLoading } = useQuery<ScheduleResponse>({
    queryKey: ['production', 'schedule', start, span],
    queryFn: () => api.get<ScheduleResponse>(`/production/schedule?days=${span}${start ? `&start=${start}` : ''}`),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const startISO = data?.start ?? '';
  const days = data?.days ?? [];

  const matches = (wo: ScheduleWo) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return `${wo.woNumber} ${wo.batchNumber} ${wo.productName} ${customers.name(wo.customerId)}`.toLowerCase().includes(needle);
  };

  const byLine = useMemo(() => {
    const map = new Map<string, ScheduleWo[]>();
    for (const line of data?.lines ?? []) map.set(line, []);
    for (const wo of data?.scheduled ?? []) {
      if (!matches(wo)) continue;
      if (!map.has(wo.line)) map.set(wo.line, []);
      map.get(wo.line)!.push(wo);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, search, customers]);

  const unscheduled = (data?.unscheduled ?? []).filter(matches);

  const dailyLoad = useMemo(() => {
    const load = days.map(() => 0);
    for (const wo of data?.scheduled ?? []) {
      const from = dayIndex(wo.plannedStart, startISO);
      if (from == null) continue;
      const dur = durationDays(wo);
      for (let i = Math.max(0, from); i < Math.min(days.length, from + dur); i++) load[i] += wo.plannedQty || 0;
    }
    return load;
  }, [data, days, startISO]);

  const reschedule = async (wo: ScheduleWo, line: string, startOffset: number | null) => {
    const body: Record<string, unknown> = { line };
    if (startOffset != null) {
      const dur = durationDays(wo);
      body.plannedStart = isoAt(startISO, startOffset);
      body.plannedEnd = isoAt(startISO, startOffset + dur - 1, 17);
    } else if (!wo.plannedStart) {
      // Placing an unscheduled batch onto a line with no explicit day lands it today.
      body.plannedStart = isoAt(startISO, Math.max(0, dayIndex(new Date().toISOString(), startISO) ?? 0));
    }
    try {
      await api.post(`/production/${wo.id}/schedule`, body);
      queryClient.invalidateQueries({ queryKey: ['production'] });
    } catch (err) {
      queryClient.invalidateQueries({ queryKey: ['production'] });
      error(err, 'That reschedule was refused');
    }
  };

  const onDragStart = (event: DragStartEvent) => {
    const all = [...(data?.scheduled ?? []), ...(data?.unscheduled ?? [])];
    setDragging(all.find((wo) => wo.id === String(event.active.id)) ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const wo = dragging;
    setDragging(null);
    if (!wo || !event.over) return;
    const target = String(event.over.id);
    if (target.startsWith('cell:')) {
      const [, line, offset] = target.split('|');
      reschedule(wo, line, Number(offset));
    }
  };

  const weekLabel = () => {
    if (!startISO || !days.length) return '';
    const from = new Date(`${days[0].date}T00:00:00Z`);
    const to = new Date(`${days[days.length - 1].date}T00:00:00Z`);
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${fmt(from)} – ${fmt(to)}`;
  };

  return (
    <div className="page page-wide">
      <PageHeader
        title="Schedule"
        subtitle={data ? `${data.scheduled.length} batches placed · ${unscheduled.length} awaiting a slot · drag to reschedule` : 'Loading…'}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Work order, product, customer…" />
            <div className="row-tight">
              <button type="button" className="btn btn-icon" title="Previous week" onClick={() => setStart(shiftWeeks(startISO, -1))} disabled={!startISO}>
                <Icon name="chevron-left" size={16} />
              </button>
              <button type="button" className="btn" onClick={() => setStart(null)}>Today</button>
              <button type="button" className="btn btn-icon" title="Next week" onClick={() => setStart(shiftWeeks(startISO, 1))} disabled={!startISO}>
                <Icon name="chevron-right" size={16} />
              </button>
            </div>
            <Segmented
              value={span}
              onChange={setSpan}
              options={[{ value: '7', label: '1 wk' }, { value: '14', label: '2 wk' }, { value: '21', label: '3 wk' }]}
            />
          </>
        }
      />

      {isLoading && <div className="card"><div className="card-body">Loading the schedule…</div></div>}

      {!isLoading && data && (
        <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="sched-head" style={{ marginBottom: 0, padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--border)' }}>
              <span className="cell-primary">{weekLabel()}</span>
            </div>
            <div className="sched-scroll">
              <div className="sched-grid" style={{ ['--sched-days' as string]: days.length }}>
                {/* header row */}
                <div className="sched-corner">Line</div>
                {days.map((day, i) => {
                  const d = new Date(`${day.date}T00:00:00Z`);
                  return (
                    <div key={day.date} className="sched-dayhead" data-weekend={day.weekend ? 'true' : undefined}>
                      <div className="sched-dow">{d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</div>
                      <div className="sched-date">{d.getUTCDate()}</div>
                      {dailyLoad[i] > 0 && <div className="sched-load" title={`${dailyLoad[i].toLocaleString()} units planned`}>{compact(dailyLoad[i])}</div>}
                    </div>
                  );
                })}

                {/* lanes */}
                {[...byLine.keys()].map((line) => {
                  const cards = byLine.get(line) ?? [];
                  const laneUnits = cards.reduce((sum, c) => sum + (c.plannedQty || 0), 0);
                  return (
                    <div className="sched-lane-row" key={line} style={{ display: 'contents' }}>
                      <div className="sched-lane-name">
                        <span className="truncate">{line}</span>
                        {laneUnits > 0 && <span className="cell-sub">{compact(laneUnits)} u</span>}
                      </div>
                      <div className="sched-lane" style={{ gridColumn: `2 / span ${days.length}` }}>
                        {days.map((day, i) => (
                          <DayCell key={day.date} line={line} offset={i} weekend={day.weekend} disabled={!editable} />
                        ))}
                        {cards.map((wo) => (
                          <ScheduleBlock
                            key={wo.id}
                            wo={wo}
                            startISO={startISO}
                            span={days.length}
                            disabled={!editable}
                            customerName={customers.name(wo.customerId)}
                            supervisor={users.name(wo.supervisorId)}
                            onOpen={() => navigate(`/production/${wo.id}`)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <TrayZone
            items={unscheduled}
            customers={customers}
            disabled={!editable}
            onOpen={(id) => navigate(`/production/${id}`)}
          />

          <DragOverlay dropAnimation={{ duration: 160, easing: 'cubic-bezier(0.22,0.9,0.3,1)' }}>
            {dragging ? (
              <div className="sched-block sched-block-overlay" data-tone={findOption(WORK_ORDER_STAGES, dragging.stage).tone}>
                <div className="sched-block-title truncate">{dragging.productName}</div>
                <div className="sched-block-sub truncate">{dragging.woNumber} · {compact(dragging.plannedQty)} u</div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function DayCell({ line, offset, weekend, disabled }: { line: string; offset: number; weekend: boolean; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell:|${line}|${offset}`, disabled });
  return (
    <div
      ref={setNodeRef}
      className="sched-cell"
      data-weekend={weekend ? 'true' : undefined}
      data-over={isOver ? 'true' : undefined}
      style={{ gridColumn: offset + 1 }}
    />
  );
}

function ScheduleBlock({ wo, startISO, span, disabled, customerName, supervisor, onOpen }: {
  wo: ScheduleWo; startISO: string; span: number; disabled: boolean;
  customerName: string; supervisor: string; onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: wo.id, disabled });
  const from = dayIndex(wo.plannedStart, startISO) ?? 0;
  const dur = durationDays(wo);
  const visibleFrom = Math.max(0, from);
  const visibleTo = Math.min(span, from + dur);
  if (visibleTo <= 0 || visibleFrom >= span) return null;
  const left = (visibleFrom / span) * 100;
  const width = ((visibleTo - visibleFrom) / span) * 100;
  const stage = findOption(WORK_ORDER_STAGES, wo.stage);

  return (
    <div
      ref={setNodeRef}
      className="sched-block"
      data-tone={stage.tone}
      data-dragging={isDragging ? 'true' : undefined}
      data-clip-left={from < 0 ? 'true' : undefined}
      data-clip-right={from + dur > span ? 'true' : undefined}
      style={{ left: `${left}%`, width: `calc(${width}% - 6px)` }}
      title={`${wo.woNumber} · ${wo.productName} · ${stage.label} · ${wo.plannedQty.toLocaleString()} ${wo.uom}\nSupervisor: ${supervisor}`}
      onDoubleClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <div className="sched-block-title truncate">{wo.productName}</div>
      <div className="sched-block-sub truncate">
        {wo.priority !== 'normal' && <span className="sched-flare" data-pri={wo.priority} />}
        {customerName} · {compact(wo.plannedQty)} u
      </div>
    </div>
  );
}

function TrayZone({ items, customers, disabled, onOpen }: {
  items: ScheduleWo[]; customers: ReturnType<typeof useCustomers>; disabled: boolean; onOpen: (id: string) => void;
}) {
  return (
    <div className="card" style={{ marginTop: 'var(--s-4)' }}>
      <CardHead
        title="Awaiting a slot"
        subtitle="Work orders with no line or start date — drag one onto the grid to schedule it"
        actions={<Badge tone={items.length ? 'warning' : 'neutral'}>{items.length}</Badge>}
      />
      <div className="card-body">
        {items.length === 0 ? (
          <EmptyState icon="check" title="Everything is placed" body="Every open batch has a line and a start date." />
        ) : (
          <div className="sched-tray">
            {items.map((wo) => (
              <TrayCard key={wo.id} wo={wo} customerName={customers.name(wo.customerId)} disabled={disabled} onOpen={() => onOpen(wo.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TrayCard({ wo, customerName, disabled, onOpen }: { wo: ScheduleWo; customerName: string; disabled: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: wo.id, disabled });
  const stage = findOption(WORK_ORDER_STAGES, wo.stage);
  return (
    <div
      ref={setNodeRef}
      className="sched-tray-card"
      data-tone={stage.tone}
      data-dragging={isDragging ? 'true' : undefined}
      onDoubleClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <div className="row-tight" style={{ marginBottom: 3 }}>
        <span className="mono cell-sub">{wo.woNumber}</span>
        <span className="spacer" />
        <StatusBadge list={WORK_ORDER_STAGES} value={wo.stage} dot={false} />
      </div>
      <div className="sched-block-title truncate">{wo.productName}</div>
      <div className="cell-sub truncate">{customerName || 'Internal'} · {compact(wo.plannedQty)} u {wo.line ? '' : '· no line'}</div>
    </div>
  );
}
