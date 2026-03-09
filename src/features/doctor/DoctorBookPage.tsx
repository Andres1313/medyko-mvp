import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AvailabilityCalendar } from '../../components/calendar/AvailabilityCalendar'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { useAuth } from '../../hooks/useAuth'
import { calculatePriceBreakdown } from '../../lib/pricing'
import { postApi } from '../../lib/api'

type AccessStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'

interface SlotItem {
  label: string
  startDateTime: string
  endDateTime: string
  available: boolean
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function extractApiError(message: string) {
  try {
    const parsed = JSON.parse(message) as { error?: string }
    return parsed.error || message
  } catch {
    return message
  }
}

function slotBucket(slot: SlotItem) {
  const startHour = Number(slot.label.slice(0, 2))
  if (startHour < 12) return 'Mañana'
  if (startHour < 18) return 'Tarde'
  return 'Noche'
}

export function DoctorBookPage() {
  const { claims } = useAuth()
  const { type, clinicId, listingId } = useParams()
  const [baseRent, setBaseRent] = useState(500)
  const [selectedDate, setSelectedDate] = useState(todayISO())
  const [slots, setSlots] = useState<SlotItem[]>([])
  const [selectedSlot, setSelectedSlot] = useState<SlotItem | null>(null)
  const [accessStatus, setAccessStatus] = useState<AccessStatus>('NONE')
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [message, setMessage] = useState('')
  const [slotError, setSlotError] = useState('')
  const [slotMinutes, setSlotMinutes] = useState<45 | 60>(60)

  const breakdown = useMemo(() => calculatePriceBreakdown(baseRent), [baseRent])

  const groupedSlots = useMemo(() => {
    const available = slots.filter((slot) => slot.available)
    return {
      'Mañana': available.filter((slot) => slotBucket(slot) === 'Mañana'),
      'Tarde': available.filter((slot) => slotBucket(slot) === 'Tarde'),
      'Noche': available.filter((slot) => slotBucket(slot) === 'Noche'),
    }
  }, [slots])

  const orderedSlots = useMemo(
    () =>
      [...slots].sort((a, b) => {
        const at = new Date(a.startDateTime).getTime()
        const bt = new Date(b.startDateTime).getTime()
        return at - bt
      }),
    [slots],
  )

  const events = slots
    .filter((slot) => !slot.available)
    .map((slot) => ({
      title: 'Ocupado',
      start: new Date(slot.startDateTime),
      end: new Date(slot.endDateTime),
    }))

  const refreshAccess = async () => {
    if (!clinicId) return
    const result = await postApi<{ status: AccessStatus }>('/clinics/accessStatus', { clinicId })
    setAccessStatus(result.status)
  }

  const refreshSlots = async () => {
    if (!clinicId || !listingId || !type) return
    setLoadingSlots(true)
    setSelectedSlot(null)
    setSlotError('')
    try {
      const result = await postApi<{ slots: SlotItem[] }>('/availability/slots', {
        clinicId,
        listingId,
        listingType: type,
        date: selectedDate,
        slotMinutes,
      })
      setSlots(result.slots || [])
    } catch (error) {
      setSlots([])
      setSlotError(error instanceof Error ? extractApiError(error.message) : 'No se pudieron cargar horarios')
    } finally {
      setLoadingSlots(false)
    }
  }

  useEffect(() => {
    postApi<{ slotMinutes: number }>('/availability/mine', {})
      .then((res) => setSlotMinutes(res.slotMinutes === 45 ? 45 : 60))
      .catch(() => setSlotMinutes(60))
  }, [])

  useEffect(() => {
    refreshAccess().catch(() => setAccessStatus('NONE'))
  }, [clinicId])

  useEffect(() => {
    void refreshSlots()
  }, [clinicId, listingId, type, selectedDate, slotMinutes])

  const requestAccess = async () => {
    if (!clinicId) return
    setMessage('')
    const result = await postApi<{ status: AccessStatus }>('/clinics/requestAccess', { clinicId })
    setAccessStatus(result.status)
    setMessage('Solicitud enviada. Quedas en lista de espera hasta aprobación de la clínica.')
  }

  const createCheckout = async () => {
    if (!clinicId || !listingId || !type) {
      alert('Faltan datos de la reserva.')
      return
    }

    if (accessStatus !== 'APPROVED') {
      alert('Tu acceso aún no está aprobado por la clínica para reservar.')
      return
    }

    if (!claims.doctorVerified) {
      alert('Debes verificarte antes de pagar una reserva.')
      return
    }

    if (!selectedSlot) {
      alert('Selecciona un slot disponible.')
      return
    }

    const booking = await postApi<{ bookingId: string }>('/bookings/create', {
      clinicId,
      listingId,
      listingType: type,
      startDateTime: selectedSlot.startDateTime,
      endDateTime: selectedSlot.endDateTime,
      baseRent,
    })

    const checkout = await postApi<{ checkoutUrl: string }>('/payments/createCheckout', { bookingId: booking.bookingId })
    window.location.href = checkout.checkoutUrl
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Reserva y checkout</h1>
      <p className="text-sm text-slate-600">
        Listing: {type} / {clinicId} / {listingId}
      </p>

      <Card>
        <p className="text-sm">
          Estado de acceso a clínica: <strong>{accessStatus}</strong>
        </p>
        {accessStatus !== 'APPROVED' && (
          <div className="mt-3">
            <Button type="button" onClick={requestAccess}>
              Solicitar aprobación de clínica
            </Button>
          </div>
        )}
        {message && <p className="mt-2 text-xs text-sky-700">{message}</p>}
      </Card>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Fecha y horarios disponibles</h2>
        <p className="mt-1 text-xs text-slate-500">Slots de {slotMinutes} minutos dentro de la fecha seleccionada.</p>
        <div className="mt-3 max-w-xs">
          <Input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
        </div>

        {slotError && <p className="mt-2 text-sm text-red-600">Error al cargar horarios: {slotError}</p>}

        <div className="mt-3 space-y-3">
          {loadingSlots && <p className="text-sm text-slate-500">Cargando slots...</p>}
          {!loadingSlots && slots.filter((slot) => slot.available).length === 0 && !slotError && (
            <p className="text-sm text-slate-500">No hay horarios disponibles para esta fecha.</p>
          )}

          {(['Mañana', 'Tarde', 'Noche'] as const).map((bucket) => (
            <div key={bucket}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{bucket}</p>
              <div className="flex flex-wrap gap-2">
                {groupedSlots[bucket].length === 0 ? (
                  <span className="text-xs text-slate-400">Sin horarios</span>
                ) : (
                  groupedSlots[bucket].map((slot) => (
                    <button
                      key={slot.startDateTime}
                      className={`rounded-lg border px-3 py-2 text-sm ${selectedSlot?.startDateTime === slot.startDateTime ? 'border-sky-600 bg-sky-50 text-sky-700' : 'border-slate-300 text-slate-700 hover:border-sky-400 hover:text-sky-700'}`}
                      type="button"
                      onClick={() => setSelectedSlot(slot)}
                    >
                      {slot.label}
                    </button>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Agenda interactiva del día</h2>
        <p className="mt-1 text-xs text-slate-500">Selecciona un bloque disponible. Los ocupados aparecen bloqueados.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {orderedSlots.length === 0 && !loadingSlots && <p className="text-sm text-slate-500">Sin agenda para este día.</p>}
          {orderedSlots.map((slot) => {
            const isSelected = selectedSlot?.startDateTime === slot.startDateTime
            const baseClass = 'rounded-lg border px-3 py-2 text-left text-sm transition'
            const stateClass = !slot.available
              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
              : isSelected
                ? 'border-sky-600 bg-sky-50 text-sky-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-sky-400 hover:text-sky-700'

            return (
              <button
                key={`agenda-${slot.startDateTime}`}
                className={`${baseClass} ${stateClass}`}
                disabled={!slot.available}
                type="button"
                onClick={() => setSelectedSlot(slot)}
              >
                <p className="font-semibold">{slot.label}</p>
                <p className="text-xs">{slot.available ? 'Disponible' : 'Ocupado'}</p>
              </button>
            )
          })}
        </div>
      </div>

      <AvailabilityCalendar events={events} />

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Desglose de pago</h2>
        <div className="mt-2 grid gap-2 text-sm">
          <Input type="number" value={baseRent} onChange={(e) => setBaseRent(Number(e.target.value || 0))} />
          <p>Renta: Q{breakdown.baseRent.toFixed(2)}</p>
          <p>Tarifa Medyko (10%): Q{breakdown.platformFee.toFixed(2)}</p>
          <p>Procesamiento seguro (4.5% + Q2): Q{breakdown.processingFee.toFixed(2)}</p>
          <p className="font-semibold">Total: Q{breakdown.total.toFixed(2)}</p>
          {selectedSlot && <p className="text-xs text-slate-600">Slot seleccionado: {selectedSlot.label}</p>}
        </div>
      </div>

      <Button disabled={accessStatus !== 'APPROVED'} onClick={createCheckout}>
        Continuar a checkout
      </Button>
    </div>
  )
}
