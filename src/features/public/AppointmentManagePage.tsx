import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { postApi } from '../../lib/api'

interface AppointmentData {
  appointmentId: string
  doctorId?: string
  patientName: string
  patientEmail?: string
  patientPhoneE164?: string
  notes?: string
  status: 'CONFIRMED' | 'CANCELLED'
  startDateTime: string | null
  endDateTime: string | null
}

interface PublicSlotItem {
  label: string
  startDateTime: string
  endDateTime: string
  available: boolean
}

function slotStartLabel(label: string) {
  return String(label || '').split(' - ')[0] || label
}

function oneHourAheadMs() {
  return Date.now() + 60 * 60 * 1000
}

export function AppointmentManagePage() {
  const { appointmentId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''

  const [appointment, setAppointment] = useState<AppointmentData | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [slots, setSlots] = useState<PublicSlotItem[]>([])
  const [selectedSlotStart, setSelectedSlotStart] = useState('')
  const [slotsMessage, setSlotsMessage] = useState('')

  const visibleSlots = useMemo(() => {
    const minStart = oneHourAheadMs()
    return slots.filter((slot) => {
      const startMs = new Date(slot.startDateTime).getTime()
      return Number.isFinite(startMs) && startMs >= minStart
    })
  }, [slots])

  const hasAvailableSlots = useMemo(() => visibleSlots.some((s) => s.available), [visibleSlots])

  const loadSlots = async (doctorUid: string, selectedDate: string, currentAppointmentId: string) => {
    setSlotsMessage('')
    try {
      const res = await postApi<{ blocked?: boolean; reason?: string; slots?: PublicSlotItem[] }>('/public/doctors/slots', {
        doctorUid,
        date: selectedDate,
        excludeAppointmentId: currentAppointmentId,
      })
      if (res.blocked) {
        setSlots([])
        setSelectedSlotStart('')
        setSlotsMessage(res.reason || 'Agenda bloqueada.')
        return
      }
      const nextSlots = res.slots || []
      setSlots(nextSlots)
      const selectedStillAvailable = nextSlots.some((s) => s.startDateTime === selectedSlotStart && s.available)
      if (!selectedStillAvailable) {
        const firstAvailable = nextSlots.find((s) => s.available)
        setSelectedSlotStart(firstAvailable?.startDateTime || '')
      }
      if (nextSlots.length === 0) {
        setSelectedSlotStart('')
        setSlotsMessage('No hay horarios para esta fecha.')
      }
    } catch (error) {
      setSlots([])
      setSelectedSlotStart('')
      setSlotsMessage(error instanceof Error ? error.message : 'No se pudieron cargar los horarios.')
    }
  }

  const load = async () => {
    if (!appointmentId || !token) return
    setLoading(true)
    setMessage('')
    try {
      const res = await postApi<{ appointment: AppointmentData }>('/appointments/public/get', {
        appointmentId,
        token,
      })
      setAppointment(res.appointment)
      const startIso = res.appointment.startDateTime || null
      const initialDate = startIso ? new Date(startIso).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
      setDate(initialDate)
      if (res.appointment.doctorId) {
        await loadSlots(res.appointment.doctorId, initialDate, res.appointment.appointmentId)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cargar la cita')
      setAppointment(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [appointmentId, token])

  const cancelAppointment = async () => {
    if (!appointment) return
    setMessage('')
    try {
      await postApi('/appointments/public/action', {
        appointmentId: appointment.appointmentId,
        token,
        action: 'CANCEL',
      })
      setMessage('Cita cancelada. Te notificamos por WhatsApp.')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cancelar')
    }
  }

  const rescheduleAppointment = async () => {
    if (!appointment) return
    const selected = visibleSlots.find((s) => s.startDateTime === selectedSlotStart && s.available)
    if (!selected) {
      setMessage('Selecciona un slot disponible para reagendar.')
      return
    }
    setMessage('')
    try {
      await postApi('/appointments/public/action', {
        appointmentId: appointment.appointmentId,
        token,
        action: 'RESCHEDULE',
        startDateTime: selected.startDateTime,
        endDateTime: selected.endDateTime,
      })
      setMessage('Cita reagendada. Te notificamos por WhatsApp.')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo reagendar')
    }
  }

  useEffect(() => {
    if (!appointment?.doctorId) return
    loadSlots(appointment.doctorId, date, appointment.appointmentId).catch(() => null)
  }, [date, appointment?.doctorId, appointment?.appointmentId])

  useEffect(() => {
    const selectedStillAvailable = visibleSlots.some((s) => s.startDateTime === selectedSlotStart && s.available)
    if (!selectedStillAvailable) {
      const firstAvailable = visibleSlots.find((s) => s.available)
      setSelectedSlotStart(firstAvailable?.startDateTime || '')
    }
  }, [selectedSlotStart, visibleSlots])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Gestionar cita</h1>
      {!token && <p className="text-sm text-red-600">Token invalido.</p>}
      {loading && <p className="text-sm text-slate-600">Cargando...</p>}

      {appointment && (
        <Card>
          <p className="font-semibold">Paciente: {appointment.patientName}</p>
          <p>Estado: {appointment.status}</p>
          <p>Inicio: {appointment.startDateTime ? new Date(appointment.startDateTime).toLocaleString('es-GT') : '-'}</p>
          <p>Fin: {appointment.endDateTime ? new Date(appointment.endDateTime).toLocaleString('es-GT') : '-'}</p>

          {appointment.status !== 'CANCELLED' && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-xs" />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {visibleSlots.map((slot) => (
                  <button
                    key={slot.startDateTime}
                    type="button"
                    onClick={() => {
                      if (!slot.available) return
                      setSelectedSlotStart(slot.startDateTime)
                    }}
                    disabled={!slot.available}
                    className={`rounded-md border px-3 py-1 text-sm transition ${
                      !slot.available
                        ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                        : selectedSlotStart === slot.startDateTime
                          ? 'border-sky-500 bg-sky-50 text-sky-700'
                          : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-400'
                    }`}
                  >
                    {slotStartLabel(slot.label)}
                  </button>
                ))}
              </div>
              {selectedSlotStart && (
                <p className="text-sm text-slate-700">
                  Slot seleccionado: <strong>{slotStartLabel(visibleSlots.find((s) => s.startDateTime === selectedSlotStart)?.label || '-')}</strong>
                </p>
              )}
              {slotsMessage && <p className="text-sm text-slate-600">{slotsMessage}</p>}
              {!hasAvailableSlots && <p className="text-xs text-slate-600">No hay slots disponibles con al menos 1 hora de anticipacion.</p>}
              <div className="flex gap-2">
                <Button type="button" disabled={!hasAvailableSlots} onClick={rescheduleAppointment}>
                  Reagendar
                </Button>
                <Button className="bg-slate-700 hover:bg-slate-800" type="button" onClick={cancelAppointment}>
                  Cancelar cita
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {message && <p className="text-sm text-sky-700">{message}</p>}
    </div>
  )
}
