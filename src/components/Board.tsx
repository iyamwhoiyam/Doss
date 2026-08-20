/**
 * Drag-and-drop board.
 *
 * Cards carry a fractional `boardOrder`; dropping one computes the midpoint
 * between its new neighbours and sends only that (plus the column) to the
 * server, so two people reordering different parts of the same column don't
 * fight over a shared index.
 *
 * The board renders optimistically — the card lands where it was dropped
 * immediately, and the mutation reconciles behind it. A rejected move (a WIP
 * rule, an unstaged batch) snaps the card back and surfaces the reason.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners,
  useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { Icon } from './Icon';

export interface BoardColumn {
  value: string;
  label: string;
  tone?: string;
  blurb?: string;
  wipLimit?: number;
  meta?: ReactNode;
}

export interface BoardItem {
  id: string;
  column: string;
  order: number;
}

export interface MoveRequest {
  id: string;
  column: string;
  beforeOrder: number | null;
  afterOrder: number | null;
}

function SortableCard({ id, disabled, children }: { id: string; disabled?: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      className="board-card"
      data-dragging={isDragging ? 'true' : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

function Column({ column, ids, children, disabled }: {
  column: BoardColumn; ids: string[]; children: ReactNode; disabled?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${column.value}`, disabled });
  const overWip = Boolean(column.wipLimit && ids.length > column.wipLimit);

  return (
    <div className="board-col" data-over={isOver ? 'true' : undefined} data-overwip={overWip ? 'true' : undefined}>
      <header className="board-col-head">
        <span className="badge-dot" data-tone={column.tone ?? 'neutral'} style={{ background: 'var(--tone-fg)' }} />
        <span className="board-col-title grow truncate">{column.label}</span>
        <span className="board-col-count" title={column.wipLimit ? `WIP limit ${column.wipLimit}` : undefined}>
          {ids.length}{column.wipLimit ? `/${column.wipLimit}` : ''}
        </span>
      </header>
      {(column.meta || column.blurb) && (
        <div className="board-col-meta truncate" title={column.blurb}>{column.meta ?? column.blurb}</div>
      )}
      <div ref={setNodeRef} className="board-col-body">
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
        {ids.length === 0 && <div className="board-col-empty">Drop a card here</div>}
      </div>
    </div>
  );
}

export function Board<T extends BoardItem>({
  columns, items, renderCard, renderOverlay, onMove, disabled = false,
}: {
  columns: BoardColumn[];
  items: T[];
  renderCard: (item: T) => ReactNode;
  renderOverlay?: (item: T) => ReactNode;
  onMove: (move: MoveRequest) => void;
  disabled?: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // While a drag is in flight the card is shown in its provisional home, so the
  // board never flickers back to its old position mid-gesture.
  const [preview, setPreview] = useState<Record<string, string>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byColumn = useMemo(() => {
    const map = new Map<string, T[]>(columns.map((column) => [column.value, []]));
    for (const item of items) {
      const column = preview[item.id] ?? item.column;
      if (!map.has(column)) continue;
      map.get(column)!.push(item);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [items, columns, preview]);

  const active = activeId ? items.find((item) => item.id === activeId) ?? null : null;

  const columnOf = (overId: string): string | null => {
    if (overId.startsWith('column:')) return overId.slice(7);
    const item = items.find((candidate) => candidate.id === overId);
    return item ? preview[item.id] ?? item.column : null;
  };

  const handleDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

  const handleDragOver = (event: DragOverEvent) => {
    const { active: dragged, over } = event;
    if (!over) return;
    const target = columnOf(String(over.id));
    if (!target) return;
    const current = preview[String(dragged.id)] ?? items.find((i) => i.id === dragged.id)?.column;
    if (current === target) return;
    setPreview((state) => ({ ...state, [String(dragged.id)]: target }));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    setActiveId(null);
    const draggedId = String(dragged.id);
    setPreview((state) => {
      const { [draggedId]: _removed, ...rest } = state;
      return rest;
    });
    if (!over) return;

    const targetColumn = columnOf(String(over.id));
    if (!targetColumn) return;

    const source = items.find((item) => item.id === draggedId);
    if (!source) return;

    const siblings = (byColumn.get(targetColumn) ?? []).filter((item) => item.id !== draggedId);
    let index = siblings.length;
    if (!String(over.id).startsWith('column:')) {
      const overIndex = siblings.findIndex((item) => item.id === String(over.id));
      if (overIndex >= 0) {
        // dropping onto a card means taking its place
        const draggedIndex = (byColumn.get(source.column) ?? []).findIndex((i) => i.id === draggedId);
        const movingDown = source.column === targetColumn && draggedIndex >= 0 && draggedIndex < overIndex;
        index = movingDown ? overIndex + 1 : overIndex;
      }
    }

    const beforeOrder = index > 0 ? siblings[index - 1].order : null;
    const afterOrder = index < siblings.length ? siblings[index].order : null;

    if (targetColumn === source.column && beforeOrder === null && afterOrder === null) return;
    if (targetColumn === source.column
      && beforeOrder !== null && afterOrder !== null
      && source.order > beforeOrder && source.order < afterOrder) return; // already in place

    onMove({ id: draggedId, column: targetColumn, beforeOrder, afterOrder });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setActiveId(null); setPreview({}); }}
    >
      <div className="board">
        {columns.map((column) => {
          const list = byColumn.get(column.value) ?? [];
          return (
            <Column key={column.value} column={column} ids={list.map((item) => item.id)} disabled={disabled}>
              {list.map((item) => (
                <SortableCard key={item.id} id={item.id} disabled={disabled}>
                  {renderCard(item)}
                </SortableCard>
              ))}
            </Column>
          );
        })}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)' }}>
        {active ? (
          <div className="board-card board-card-overlay">
            {(renderOverlay ?? renderCard)(active)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/* ── sortable rows (formula builder, tier ladder, checklists) ─────────────── */

function SortableRow({ id, className, children }: { id: string; className: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      className="drag-handle"
      aria-label="Reorder"
      {...attributes}
      {...listeners}
    >
      <Icon name="grip" size={14} />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      className={className}
      data-dragging={isDragging ? 'true' : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {children(handle)}
    </div>
  );
}

/**
 * A vertical drag-to-reorder list. `renderRow` receives the drag handle so each
 * row decides where the grip sits.
 */
export function SortableList<T>({ items, getId, onReorder, rowClassName = 'ing-row', renderRow, renderOverlay }: {
  items: T[];
  getId: (item: T, index: number) => string;
  onReorder: (from: number, to: number) => void;
  rowClassName?: string;
  renderRow: (item: T, index: number, handle: ReactNode) => ReactNode;
  renderOverlay?: (item: T, index: number) => ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map((item, index) => getId(item, index));
  const activeIndex = activeId ? ids.indexOf(activeId) : -1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(event) => setActiveId(String(event.active.id))}
      onDragEnd={(event) => {
        setActiveId(null);
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from >= 0 && to >= 0) onReorder(from, to);
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {items.map((item, index) => (
          <SortableRow key={ids[index]} id={ids[index]} className={rowClassName}>
            {(handle) => renderRow(item, index, handle)}
          </SortableRow>
        ))}
      </SortableContext>
      <DragOverlay>
        {activeIndex >= 0 ? (
          <div className={`${rowClassName} ing-row-overlay`} style={{ background: 'var(--surface-2)' }}>
            {(renderOverlay ?? ((item: T, index: number) => renderRow(item, index, <span className="drag-handle"><Icon name="grip" size={14} /></span>)))(items[activeIndex], activeIndex)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
