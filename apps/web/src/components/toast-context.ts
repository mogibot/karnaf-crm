import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastAction {
  /** Button label (Hebrew). */
  label: string;
  /** Fired when the operator clicks the button. */
  onClick: () => void;
}

export interface ToastInput {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
  /** Optional inline action button — used for Undo on destructive ops. */
  action?: ToastAction;
}

export interface ToastApi {
  push: (input: ToastInput) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => undefined, success: () => undefined,
      error: () => undefined, info: () => undefined,
    };
  }
  return ctx;
}
