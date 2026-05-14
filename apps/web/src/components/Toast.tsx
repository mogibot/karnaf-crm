import {
  useCallback, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import clsx from 'clsx';
import { ToastContext, type ToastApi, type ToastInput, type ToastTone } from './toast-context';

// eslint-disable-next-line react-refresh/only-export-components
export { useToast } from './toast-context';
export type { ToastApi, ToastInput, ToastTone } from './toast-context';

interface ToastItem {
  id: number;
  message: ToastInput['message'];
  tone: NonNullable<ToastInput['tone']>;
  durationMs: NonNullable<ToastInput['durationMs']>;
  action: ToastInput['action'];
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((input: ToastInput) => {
    const id = ++idRef.current;
    // When a toast carries an action button, default the lifetime to 10s
    // (Undo window). Caller can still override via durationMs.
    const defaultMs = input.action ? 10_000 : 4500;
    const item: ToastItem = {
      id,
      message: input.message,
      tone: input.tone ?? 'info',
      durationMs: input.durationMs ?? defaultMs,
      action: input.action,
    };
    setItems((prev) => [...prev, item]);
    if (item.durationMs > 0) {
      window.setTimeout(() => dismiss(id), item.durationMs);
    }
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({
    push,
    success: (message) => push({ message, tone: 'success' }),
    error: (message) => push({ message, tone: 'error' }),
    info: (message) => push({ message, tone: 'info' }),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite" aria-atomic="false"
        className="pointer-events-none fixed top-4 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={clsx(
              'kf-toast',
              t.tone === 'success' && 'kf-toast-success',
              t.tone === 'error' && 'kf-toast-error',
              t.tone === 'info' && 'kf-toast-info',
            )}
          >
            <ToneIcon tone={t.tone} />
            <div className="flex-1 leading-snug">{t.message}</div>
            {t.action ? (
              <button
                type="button"
                className="kf-btn kf-btn-ghost text-xs pointer-events-auto"
                onClick={() => { t.action!.onClick(); dismiss(t.id); }}
              >
                {t.action.label}
              </button>
            ) : null}
            <button
              type="button" aria-label="סגירת התראה"
              className="text-slate-500 hover:text-slate-900"
              onClick={() => dismiss(t.id)}
            >×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToneIcon({ tone }: { tone: ToastTone }) {
  if (tone === 'success') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 text-emerald-600">
        <path fill="currentColor" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L9 11.6l6.3-6.3a1 1 0 0 1 1.4 0z" />
      </svg>
    );
  }
  if (tone === 'error') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 text-rose-600">
        <path fill="currentColor" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-1 11h2v2H9v-2Zm0-8h2v6H9V5Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5 text-sky-600">
      <path fill="currentColor" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-1 5h2v2H9V7Zm0 4h2v5H9v-5Z" />
    </svg>
  );
}
