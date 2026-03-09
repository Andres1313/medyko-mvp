import { Link, NavLink } from 'react-router-dom'
import { Stethoscope, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/button'

const publicLinks = [
  { to: '/', label: 'Inicio' },
  { to: '/directory', label: 'Doctores' },
  { to: '/spaces', label: 'Clínicas y Quirófanos' },
]

const roleLinks: Record<string, Array<{ to: string; label: string }>> = {
  doctor: [
    { to: '/doctor/onboarding', label: 'Empezar' },
    { to: '/doctor', label: 'Panel Doctor' },
    { to: '/doctor/profile', label: 'Mi Perfil' },
    { to: '/doctor/patient-appointments', label: 'Mis Citas' },
  ],
  clinic_admin: [
    { to: '/clinic', label: 'Panel Owner Clínica' },
    { to: '/clinic/verify', label: 'Verificación Owner' },
    { to: '/clinic/listings', label: 'Mis Listados' },
    { to: '/clinic/calendar', label: 'Calendario' },
    { to: '/clinic/bookings', label: 'Reservas' },
    { to: '/clinic/ledger', label: 'Finanzas' },
  ],
  platform_admin: [{ to: '/platform', label: 'Super Admin Plataforma' }],
}

export function Navbar() {
  const { role, user, logout, claims } = useAuth()
  const links = [...publicLinks, ...(role ? roleLinks[role] ?? [] : [])]

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2 text-slate-900">
          <Stethoscope className="h-5 w-5 text-sky-600" />
          <span className="text-lg font-bold">Medyko Guatemala</span>
        </Link>

        <nav className="hidden items-center gap-4 md:flex">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                isActive ? 'text-sm font-semibold text-sky-600' : 'text-sm font-medium text-slate-600 hover:text-slate-900'
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {claims.doctorVerified && <ShieldCheck className="h-4 w-4 text-emerald-600" />}
          {user ? (
            <Button className="bg-slate-900 hover:bg-slate-700" onClick={() => logout()}>
              Salir
            </Button>
          ) : (
            <Link to="/auth" className="text-sm font-semibold text-sky-600">
              Ingresar
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
