import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../core/auth-context';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading, activeMembership } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Verificando sesión...
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!activeMembership) {
    return <Navigate to="/" replace />;
  }

  return children;
}
