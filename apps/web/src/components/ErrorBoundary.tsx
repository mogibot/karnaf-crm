import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@/lib/observability';

interface State { error: Error | null; }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ui-error]', error);
    reportError(error, { componentStack: info.componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center p-6">
          <div className="kf-card max-w-lg p-6">
            <h1 className="text-lg font-semibold text-rose-700">שגיאה בלתי צפויה</h1>
            <p className="mt-2 text-sm text-slate-600">{this.state.error.message}</p>
            <button type="button" className="kf-btn kf-btn-primary mt-4" onClick={() => location.reload()}>
              טעינה מחדש
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
