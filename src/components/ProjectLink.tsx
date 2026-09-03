import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from './Icon';
import { preloadRoute } from '../lib/routes';

/**
 * The one way a project is referenced anywhere in the app: a link that opens
 * it. Safe inside clickable rows and draggable cards — the click never
 * bubbles up to the row or starts a drag.
 */
export function ProjectLink({ id, code, name, children, className = '', title = 'Open project' }: {
  id: string | null | undefined; code?: string; name?: string; children?: ReactNode; className?: string; title?: string;
}) {
  if (!id) return <span className="faint">—</span>;
  const stop = (e: MouseEvent) => { e.stopPropagation(); };
  return (
    <Link
      to={`/development/${id}`}
      className={`project-link ${className}`}
      title={title}
      onClick={stop}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={stop}
      onPointerEnter={() => { void preloadRoute(`/development/${id}`); }}
    >
      {children ?? (
        <>
          <Icon name="flask" size={11} />
          {code && <span className="mono">{code}</span>}
          {name && <span className="truncate">{name}</span>}
        </>
      )}
    </Link>
  );
}
