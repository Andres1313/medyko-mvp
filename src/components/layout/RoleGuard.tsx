import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import type { UserRole } from '../../types/domain'

export function RoleGuard({ allowedRoles }: { allowedRoles: UserRole[] }) {
  const { loading, role, user } = useAuth()

  if (loading) {
    return <div className="p-8 text-sm text-slate-600">Cargando sesión...</div>
  }

  if (!user) {
    return <Navigate to="/auth" replace />
  }

  if (!role || !allowedRoles.includes(role)) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

