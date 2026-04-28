// Lightweight observability hook. The browser side reports unhandled
// errors and unhandled promise rejections to whatever Sentry-style POST
// endpoint VITE_SENTRY_DSN points at. With the DSN unset every helper is
// a no-op, so the build doesn't pull `@sentry/browser` and there is no
// runtime cost in dev/local environments.

interface ReportPayload {
  level: 'error' | 'warning' | 'info';
  message: string;
  release?: string;
  environment?: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

const dsn = import.meta.env.VITE_SENTRY_DSN;
const release = import.meta.env.VITE_RELEASE;
const environment = import.meta.env.VITE_ENV ?? 'production';

export const observabilityEnabled = typeof dsn === 'string' && dsn.length > 0;

function send(payload: ReportPayload) {
  if (!observabilityEnabled || !dsn) return;
  // Use sendBeacon when available so the request survives page unload.
  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(dsn, blob);
      return;
    }
    void fetch(dsn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
  } catch {
    // Reporter must never throw into the host app.
  }
}

function pack(level: ReportPayload['level'], message: string, context?: Record<string, unknown>): ReportPayload {
  return {
    level,
    message,
    release,
    environment,
    context,
    timestamp: new Date().toISOString(),
  };
}

export function reportError(error: unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);
  send(pack('error', message, { ...context, stack: error instanceof Error ? error.stack : undefined }));
}

export function reportWarning(message: string, context?: Record<string, unknown>) {
  send(pack('warning', message, context));
}

export function installGlobalReporters() {
  if (!observabilityEnabled) return;
  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { kind: 'unhandledrejection' });
  });
}
