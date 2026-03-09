import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Input } from '../../components/ui/input'
import { Card, CardDescription, CardTitle } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { postApi } from '../../lib/api'

interface DoctorListItem {
  uid: string
  fullName: string
  verified: boolean
  avgRating: number
  totalReviews: number
}

export function HomePage() {
  const [chatPrompt, setChatPrompt] = useState('')
  const [doctors, setDoctors] = useState<DoctorListItem[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    postApi<{ doctors: DoctorListItem[] }>('/public/doctors/search', { limit: 20 })
      .then((res) => setDoctors(res.doctors || []))
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar doctores'))
  }, [])

  const filtered = useMemo(() => doctors, [doctors])

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-gradient-to-r from-cyan-700 via-sky-700 to-indigo-700 p-8 text-white">
        <h1 className="text-3xl font-bold md:text-4xl">Asistente Medyko (próximamente)</h1>
        <p className="mt-2 max-w-2xl text-sm text-cyan-100">Este chat será la nueva forma de encontrar doctor y disponibilidad. Por ahora está desactivado.</p>
        <div className="mt-5 max-w-2xl">
          <Input
            value={chatPrompt}
            onChange={(e) => setChatPrompt(e.target.value)}
            placeholder="Escribe tu consulta (próximamente)"
            className="bg-white text-slate-900"
          />
          <p className="mt-2 text-xs text-cyan-100">Próxima iteración: activamos respuestas del chat.</p>
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <section className="grid gap-3 md:grid-cols-2">
        {filtered.map((doctor) => (
          <Card key={doctor.uid}>
            <div className="flex items-center justify-between">
              <CardTitle>{doctor.fullName}</CardTitle>
              {doctor.verified ? <Badge>Verificado</Badge> : <span className="text-xs text-amber-600">Pendiente</span>}
            </div>
            <CardDescription>
              Rating {doctor.avgRating.toFixed(2)} · {doctor.totalReviews} reseñas
            </CardDescription>
            <Link to={`/doctors/${doctor.uid}`} className="mt-2 inline-block text-sm font-semibold text-sky-700">
              Ver perfil y horario
            </Link>
          </Card>
        ))}
        {filtered.length === 0 && <p className="text-sm text-slate-600">No encontramos doctores con ese nombre.</p>}
      </section>

      <div className="flex gap-4">
        <Link to="/directory" className="text-sm font-semibold text-sky-700">
          Ver directorio de doctores
        </Link>
        <Link to="/spaces" className="text-sm font-semibold text-sky-700">
          Ver clínicas y quirófanos
        </Link>
      </div>
    </div>
  )
}
