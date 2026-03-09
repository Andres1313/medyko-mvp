import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardDescription, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Badge } from '../../components/ui/badge'
import { postApi } from '../../lib/api'

interface DoctorListItem {
  uid: string
  fullName: string
  verified: boolean
  avgRating: number
  totalReviews: number
}

export function DirectoryPage() {
  const [doctors, setDoctors] = useState<DoctorListItem[]>([])
  const [chatPrompt, setChatPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    postApi<{ doctors: DoctorListItem[] }>('/public/doctors/search', { limit: 80 })
      .then((res) => setDoctors(res.doctors || []))
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar doctores'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => doctors, [doctors])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Directorio de doctores</h1>
      <div className="grid gap-3 md:grid-cols-1">
        <Input
          placeholder="Chat de búsqueda (próximamente)"
          value={chatPrompt}
          onChange={(e) => setChatPrompt(e.target.value)}
        />
      </div>

      {loading && <p className="text-sm text-slate-600">Cargando doctores...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((doctor) => (
          <Card key={doctor.uid}>
            <div className="flex items-center justify-between">
              <CardTitle>{doctor.fullName}</CardTitle>
              {doctor.verified ? <Badge>Verificado</Badge> : <span className="text-xs text-amber-600">Pendiente</span>}
            </div>
            <CardDescription>
              Rating {doctor.avgRating.toFixed(2)} · {doctor.totalReviews} reseñas
            </CardDescription>
            <Link className="mt-2 inline-block text-sm font-semibold text-sky-700" to={`/doctors/${doctor.uid}`}>
              Ver perfil y horario
            </Link>
          </Card>
        ))}
        {!loading && filtered.length === 0 && <p className="text-sm text-slate-600">Aún no hay doctores publicados.</p>}
      </div>
    </div>
  )
}
