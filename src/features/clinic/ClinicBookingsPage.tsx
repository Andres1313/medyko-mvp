import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { postApi } from '../../lib/api'

interface ClinicBooking {
  bookingId: string
  clinicId: string
  listingType: 'CLINIC' | 'OR'
  listingId: string
  doctorId: string
  status: string
  paymentStatus: string
  bookingKind: string
  startDateTime: string | null
  endDateTime: string | null
  review?: { rating: number; comment?: string } | null
}

interface MyListingItem {
  id: string
  type: 'CLINIC' | 'OR'
  title: string
  status: string
}

function fmt(dateIso: string | null) {
  if (!dateIso) return '-'
  return new Date(dateIso).toLocaleString('es-GT')
}

export function ClinicBookingsPage() {
  const [bookings, setBookings] = useState<ClinicBooking[]>([])
  const [myListings, setMyListings] = useState<MyListingItem[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const [selectedListingId, setSelectedListingId] = useState('')
  const [date, setDate] = useState('')

  const [reviewBookingId, setReviewBookingId] = useState('')
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')

  const loadBookings = async () => {
    setLoading(true)
    setMessage('')
    try {
      const [bookingsData, listingsData] = await Promise.all([
        postApi<{ bookings: ClinicBooking[] }>('/bookings/listForClinic', { limit: 120 }),
        postApi<{ listings: MyListingItem[] }>('/listings/mine', {}),
      ])
      setBookings(bookingsData.bookings || [])
      const ownerListings = listingsData.listings || []
      setMyListings(ownerListings)
      if (!selectedListingId && ownerListings.length > 0) {
        setSelectedListingId(ownerListings[0].id)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBookings().catch(() => setBookings([]))
  }, [])

  const reserveOwnerDay = async () => {
    setMessage('')
    if (!selectedListingId || !date) {
      setMessage('Selecciona el espacio y la fecha.')
      return
    }
    const selected = myListings.find((l) => l.id === selectedListingId)
    if (!selected) {
      setMessage('Espacio no encontrado.')
      return
    }

    try {
      await postApi('/bookings/ownerReserveDay', {
        listingType: selected.type,
        listingId: selected.id,
        date,
      })
      setMessage('Reserva diaria del owner creada correctamente.')
      await loadBookings()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo reservar por día')
    }
  }

  const submitReview = async () => {
    setMessage('')
    if (!reviewBookingId) {
      setMessage('Selecciona un bookingId para calificar.')
      return
    }

    try {
      await postApi('/bookings/reviewDoctor', {
        bookingId: reviewBookingId,
        rating,
        comment,
      })
      setMessage('Calificación guardada.')
      setComment('')
      await loadBookings()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la calificación')
    }
  }

  const finishedBookings = bookings.filter((b) => !!b.endDateTime && new Date(b.endDateTime).getTime() < Date.now())

  const cancelBooking = async (bookingId: string) => {
    const reason = window.prompt('Motivo de cancelación (opcional):') || ''
    setMessage('')
    try {
      await postApi('/bookings/cancel', { clinicId: bookings.find((b) => b.bookingId === bookingId)?.clinicId, bookingId, reason })
      setMessage('Reserva cancelada y notificaciones enviadas por correo.')
      await loadBookings()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cancelar la reserva')
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Reservas</h1>

      <Card>
        <h2 className="font-semibold">Reservar por día para owner de clínica</h2>
        <p className="mt-1 text-xs text-slate-500">Solo crea bloqueo si no hay reservaciones hechas en ese día y con anticipación.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={selectedListingId} onChange={(e) => setSelectedListingId(e.target.value)}>
            {myListings.length === 0 && <option value="">No hay espacios publicados</option>}
            {myListings.map((l) => (
              <option key={l.id} value={l.id}>
                [{l.type}] {l.title} ({l.status})
              </option>
            ))}
          </select>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="mt-3">
          <Button type="button" onClick={reserveOwnerDay}>
            Crear reserva diaria owner
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Calificar doctor luego de reserva finalizada</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <select
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={reviewBookingId}
            onChange={(e) => setReviewBookingId(e.target.value)}
          >
            <option value="">Selecciona booking</option>
            {finishedBookings.map((b) => (
              <option key={b.bookingId} value={b.bookingId}>
                {b.bookingId} - Dr {b.doctorId}
              </option>
            ))}
          </select>
          <Input type="number" min={1} max={5} value={rating} onChange={(e) => setRating(Number(e.target.value || 5))} />
          <Input placeholder="Comentario" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <div className="mt-3">
          <Button type="button" onClick={submitReview}>
            Guardar calificación
          </Button>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Historial de reservas</h2>
          <Button type="button" onClick={loadBookings}>
            Actualizar
          </Button>
        </div>
        {loading && <p className="mt-2 text-sm text-slate-500">Cargando reservas...</p>}
        {!loading && bookings.length === 0 && <p className="mt-2 text-sm text-slate-500">No hay reservas.</p>}
        <div className="mt-3 space-y-2">
          {bookings.map((b) => (
            <div key={b.bookingId} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold">{b.bookingId}</p>
              <p>Doctor: {b.doctorId}</p>
              <p>Listing: {b.listingType} / {b.listingId}</p>
              <p>Inicio: {fmt(b.startDateTime)} | Fin: {fmt(b.endDateTime)}</p>
              <p>Estado: {b.status} | Pago: {b.paymentStatus} | Tipo: {b.bookingKind}</p>
              {b.review && <p>Review: {b.review.rating}/5 {b.review.comment ? `- ${b.review.comment}` : ''}</p>}
              {b.status !== 'CANCELLED' && (
                <div className="mt-2">
                  <Button className="bg-slate-700 hover:bg-slate-800" type="button" onClick={() => cancelBooking(b.bookingId)}>
                    Cancelar reserva
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {message && <p className="text-sm text-sky-700">{message}</p>}
    </div>
  )
}
