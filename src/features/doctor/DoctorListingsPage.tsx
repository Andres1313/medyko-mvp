import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { Card } from '../../components/ui/card'
import { db } from '../../lib/firebase'

interface PublicListing {
  id: string
  clinicId: string
  type: 'CLINIC' | 'OR'
  title: string
  zone?: number
  hourly?: number | null
  daily?: number | null
  photos?: string[]
}

export function DoctorListingsPage() {
  const [listings, setListings] = useState<PublicListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError('')
      try {
        const q = query(collection(db, 'public_listings'), where('status', '==', 'PUBLISHED'), limit(80))
        const snap = await getDocs(q)
        const rows = snap.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<PublicListing, 'id'>) }))
          .filter((item) => item.clinicId && item.type && item.title)
        setListings(rows)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudieron cargar listados')
        setListings([])
      } finally {
        setLoading(false)
      }
    }

    void run()
  }, [])

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Búsqueda avanzada</h1>
      {loading && <p className="text-sm text-slate-500">Cargando espacios publicados...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && listings.length === 0 && <p className="text-sm text-slate-500">No hay espacios publicados por ahora.</p>}

      <div className="grid gap-3">
        {listings.map((listing) => (
          <Card key={listing.id}>
            {Array.isArray(listing.photos) && listing.photos[0] && (
              <img src={listing.photos[0]} alt={listing.title} className="mb-2 h-36 w-full rounded-md border border-slate-200 object-cover" />
            )}
            <p className="font-semibold">{listing.title}</p>
            <p className="text-xs text-slate-500">
              {listing.type === 'OR' ? 'Quirófano' : 'Clínica'} | Zona {listing.zone ?? '-'} | Hora: Q{listing.hourly ?? '-'} | Día: Q{listing.daily ?? '-'}
            </p>
            <Link className="text-sm text-sky-700" to={`/doctor/book/${listing.type}/${listing.clinicId}/${listing.id}`}>
              Ver horarios y reservar
            </Link>
          </Card>
        ))}
      </div>
    </div>
  )
}
