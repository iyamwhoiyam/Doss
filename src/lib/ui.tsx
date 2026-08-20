/** Toasts and confirmation prompts, provided app-wide. */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

import { Icon } from '../components/Icon';

export type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger' | 'accent';

interface Toast { id: number; title: string; body?: string; tone: Tone }

interface ConfirmRequest {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  /** When set, the operator must type a reason before confirming. */
  requireReason?: string;
}

interface UiValue {
  toast: (title: string, options?: { body?: string; tone?: Tone }) => void;
  success: (title: string, body?: string) => void;
  error: (error: unknown, fallback?: string) => void;
  confirm: (request: ConfirmRequest) => Promise<string | false>;
}

const UiContext = createContext<UiValue | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [prompt, setPrompt] = useState<(ConfirmRequest & { resolve: (value: string | false) => void }) | null>(null);
  const [reason, setReason] = useState('');
  const nextId = useRef(1);

  const push = useCallback((title: string, options: { body?: string; tone?: Tone } = {}) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, title, body: options.body, tone: options.tone ?? 'neutral' }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), options.tone === 'danger' ? 9000 : 5000);
  }, []);

  const value = useMemo<UiValue>(() => ({
    toast: push,
    success: (title, body) => push(title, { body, tone: 'success' }),
    error: (err, fallback = 'Something went wrong') => {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : fallback;
      push(message, { tone: 'danger' });
    },
    confirm: (request) => new Promise<string | false>((resolve) => {
      setReason('');
      setPrompt({ ...request, resolve });
    }),
  }), [push]);

  const close = (result: string | false) => {
    prompt?.resolve(result);
    setPrompt(null);
    setReason('');
  };

  return (
    <UiContext.Provider value={value}>
      {children}

      {prompt && (
        <>
          <div className="overlay" onClick={() => close(false)} />
          <div className="modal-wrap">
            <div className="modal" role="alertdialog" aria-modal="true" aria-label={prompt.title}>
              <div className="modal-head">
                <span data-tone={prompt.tone ?? 'warning'} className="tone-text"><Icon name="alert" /></span>
                <h3>{prompt.title}</h3>
              </div>
              <div className="modal-body col">
                {prompt.body && <div className="muted">{prompt.body}</div>}
                {prompt.requireReason && (
                  <label className="field">
                    <span className="field-label">{prompt.requireReason}</span>
                    <textarea
                      className="textarea"
                      value={reason}
                      autoFocus
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="This is recorded on the record and in the audit trail."
                    />
                  </label>
                )}
              </div>
              <div className="modal-foot">
                <button type="button" className="btn" onClick={() => close(false)}>{prompt.cancelLabel ?? 'Cancel'}</button>
                <button
                  type="button"
                  className={prompt.tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary'}
                  disabled={Boolean(prompt.requireReason) && reason.trim().length < 4}
                  onClick={() => close(prompt.requireReason ? reason.trim() : 'confirmed')}
                >
                  {prompt.confirmLabel ?? 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" data-tone={toast.tone}>
            <span className="tone-text" style={{ marginTop: 1 }}>
              <Icon name={toast.tone === 'success' ? 'check-circle' : toast.tone === 'danger' ? 'alert' : 'info'} />
            </span>
            <div className="grow">
              <div className="toast-title">{toast.title}</div>
              {toast.body && <div className="toast-body">{toast.body}</div>}
            </div>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setToasts((c) => c.filter((t) => t.id !== toast.id))} aria-label="Dismiss">
              <Icon name="x" size={13} />
            </button>
          </div>
        ))}
      </div>
    </UiContext.Provider>
  );
}

export function useUi(): UiValue {
  const context = useContext(UiContext);
  if (!context) throw new Error('useUi must be used inside a UiProvider');
  return context;
}
