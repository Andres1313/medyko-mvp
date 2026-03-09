import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { postApi } from '../../lib/api'

interface RatingSummary {
  avgRating: number
  totalReviews: number
  latest: Array<{ bookingId: string; rating: number; comment: string }>
}

export function DoctorDashboardPage() {
  const { claims, user } = useAuth()
  const [rating, setRating] = useState<RatingSummary>({ avgRating: 0, totalReviews: 0, latest: [] })
  const [copyMessage, setCopyMessage] = useState('')

  useEffect(() => {
    postApi<RatingSummary>('/doctors/myRatingSummary', {}).then(setRating).catch(() => null)
  }, [])

  const publicProfileLink = user ? `${window.location.origin}/doctors/${user.uid}` : ''

  const copyPublicLink = async () => {
    if (!publicProfileLink) return
    try {
      await navigator.clipboard.writeText(publicProfileLink)
      setCopyMessage('Link copiado.')
    } catch {
      setCopyMessage('No se pudo copiar automáticamente.')
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Panel Doctor</h1>
      <Card>
        <p className="text-sm">
          Flujo recomendado: <Link className="font-semibold text-sky-700" to="/doctor/onboarding">Empezar onboarding</Link> → verificar identidad → verificar teléfono → completar perfil y horario.
        </p>
      </Card>
      <Card>
        Estado de verificación: <strong>{claims.doctorVerified ? 'Verificado' : 'Pendiente'}</strong>
      </Card>
      <Card>
        <p className="font-semibold">Link para que tus pacientes agenden cita</p>
        <p className="mt-1 text-sm text-slate-600">Comparte este link para que vean tu perfil y horario disponible.</p>
        <div className="mt-3 flex flex-col gap-2 md:flex-row">
          <input className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm" readOnly value={publicProfileLink} />
          <Button type="button" onClick={copyPublicLink}>
            Copiar link
          </Button>
        </div>
        {copyMessage && <p className="mt-2 text-xs text-slate-600">{copyMessage}</p>}
      </Card>
      <Card>
        <p>
          Rating promedio: <strong>{rating.avgRating.toFixed(2)}</strong> ({rating.totalReviews} reseñas)
        </p>
        <div className="mt-2 space-y-1 text-sm">
          {rating.latest.map((item) => (
            <p key={item.bookingId}>
              {item.bookingId}: {item.rating}/5 {item.comment ? `- ${item.comment}` : ''}
            </p>
          ))}
        </div>
      </Card>
      <div className="flex gap-4">
        <Link className="text-sky-700" to="/doctor/onboarding">
          Empezar onboarding
        </Link>
        <Link className="text-sky-700" to="/doctor/profile">
          Completar perfil y horario
        </Link>
        <Link className="text-sky-700" to="/doctor/patient-appointments">
          Gestionar citas pacientes
        </Link>
        <Link className="text-sky-700" to="/doctor/verify">
          Verificar identidad
        </Link>
      </div>
    </div>
  )
}
