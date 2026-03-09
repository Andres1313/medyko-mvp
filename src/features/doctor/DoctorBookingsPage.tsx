import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { postApi } from '../../lib/api'

interface DoctorBooking {
  bookingId: string
  clinicId: string | null
  listingType: string | null
  listingId: string | null
  status: string | null
  paymentStatus: string | null
  startDateTime: string | null
  endDateTime: string | null
}

function fmt(dateIso: string | null) {
  if (!dateIso) return '-'
  return new Date(dateIso).toLocaleString('es-GT')
}

export function DoctorBookingsPage() {
  const [bookings, setBookings] = useState<DoctorBooking[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    setMessage('')
    try {
      const data = await postApi<{ bookings: DoctorBooking[] }>('/bookings/listMine', { limit: 150 })
      setBookings(data.bookings || [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudieron cargar reservas')
      setBookings([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const cancelBooking = async (booking: DoctorBooking) => {
    if (!booking.clinicId) {
      setMessage('No se puede cancelar: falta clinicId.')
      return
    }
    const reason = window.prompt('Motivo de cancelación (opcional):') || ''
    try {
      await postApi('/bookings/cancel', {
        clinicId: booking.clinicId,
        bookingId: booking.bookingId,
        reason,
      })
      setMessage('Reserva cancelada y notificada por correo.')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cancelar la reserva')
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mis reservas</h1>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Historial</h2>
          <Button onClick={load}>Actualizar</Button>
        </div>

        {loading && <p className="mt-2 text-sm text-slate-500">Cargando...</p>}
        {!loading && bookings.length === 0 && <p className="mt-2 text-sm text-slate-500">No tienes reservas aún.</p>}

        <div className="mt-3 space-y-2">
          {bookings.map((b) => (
            <div key={b.bookingId} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold">{b.bookingId}</p>
              <p>Clínica: {b.clinicId || '-'}</p>
              <p>Listing: {b.listingType || '-'} / {b.listingId || '-'}</p>
              <p>Inicio: {fmt(b.startDateTime)} | Fin: {fmt(b.endDateTime)}</p>
              <p>Estado: {b.status || '-'} | Pago: {b.paymentStatus || '-'}</p>
              {b.status !== 'CANCELLED' && (
                <div className="mt-2">
                  <Button className="bg-slate-700 hover:bg-slate-800" onClick={() => cancelBooking(b)}>
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

