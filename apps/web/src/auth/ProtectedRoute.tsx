import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './auth-context';
import { Spinner } from '@/components/Spinner';

export function ProtectedRoute() {
  const auth = useAuth();
  if (auth.loading) {
    return (
      <div className="grid min-h-screen place-items-center gap-3 text-slate-500">
        <Spinner className="h-7 w-7 text-brand-600" />
        <span className="text-sm">טוען...</span>
      </div>
    );
  }
  if (!auth.session || !auth.role) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
