import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './auth-context';
import { Spinner } from '@/components/Spinner';
import { t } from '@/lib/i18n';

export function ProtectedRoute() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.loading) {
    return (
      <div className="grid min-h-screen place-items-center gap-2 text-slate-500">
        <Spinner className="h-6 w-6 text-brand-600" />
        <span className="text-sm">{t('loading')}</span>
      </div>
    );
  }

  if (!auth.session || !auth.role) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <Outlet />;
}
