import { Link, useNavigate } from 'react-router-dom';

import { Icon } from './Icon';
import { Badge } from './ui';
import type { Journey, JourneyStep } from '../lib/types';

const ICONS: Record<string, string> = {
  request: 'clipboard', project: 'flask', formula: 'beaker', quote: 'calculator', approval: 'shield',
  order: 'cart', batch: 'factory', qa: 'check', shipment: 'truck',
};
const WORD: Record<JourneyStep['status'], string> = { done: 'done', current: 'in progress', todo: 'to do', blocked: 'needs attention', skipped: 'n/a' };

/**
 * Where a product is on the path from request to shipment, and what happens
 * next. Every step opens its record; every open step offers the action that
 * moves it forward. Actions that live on the project page itself (start a
 * batch, request approval) are handed back to the page through `onAction`.
 */
export function ProductJourney({ journey, onAction }: { journey: Journey | undefined; onAction: (kind: string) => void }) {
  const navigate = useNavigate();
  if (!journey) return null;
  const run = (kind: string, to: string | null) => { if (kind === 'link' && to) navigate(to); else onAction(kind); };

  return (
    <div className="journey card" style={{ marginBottom: 'var(--s-4)' }}>
      <div className="journey-steps">
        {journey.steps.map((step, i) => (
          <div key={step.key} className="journey-step" data-status={step.status} title={`${step.label}: ${WORD[step.status]}${step.detail ? ` · ${step.detail}` : ''}`}>
            {i > 0 && <span className="journey-line" />}
            <button
              type="button"
              className="journey-dot"
              data-status={step.status}
              onClick={() => (step.record ? navigate(step.record.link) : step.action ? run(step.action.kind, step.action.to) : undefined)}
              aria-label={`${step.label} — ${WORD[step.status]}`}
              disabled={!step.record && !step.action}
            >
              <Icon name={step.status === 'done' ? 'check' : step.status === 'blocked' ? 'alert' : ICONS[step.key] ?? 'activity'} size={13} />
            </button>
            <div className="journey-label">{step.label}</div>
            <div className="journey-detail">
              {step.record ? <Link to={step.record.link} className="mono" onClick={(e) => e.stopPropagation()}>{step.record.label}</Link> : <span className="faint">{step.detail ?? '—'}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="journey-next">
        <div className="row" style={{ alignItems: 'center', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
          <Badge tone="accent">{journey.progress}% of the way</Badge>
          {journey.next ? (
            <>
              <span className="cell-sub">Next up:</span>
              <strong>{journey.next.label}</strong>
              <span className="spacer" />
              <button type="button" className="btn btn-sm btn-primary" onClick={() => run(journey.next!.kind, journey.next!.to)}>
                {journey.next.label} <Icon name="arrow-right" size={12} />
              </button>
            </>
          ) : (
            <span className="cell-sub">Nothing is waiting on you — the product has shipped or every open step is with someone else.</span>
          )}
        </div>
      </div>
    </div>
  );
}
