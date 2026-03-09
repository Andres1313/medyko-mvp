import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { postApi } from '../../lib/api'

interface EmergencyData {
  emergencyId: string
  doctorUid: string
  patientName: string
  patientAge: number
  patientPhoneE164: string
  description: string
  status: string
  whatsappSent: boolean
  createdAt: string | null
}

interface SlotItem {
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

function toIsoFromDateAndTime(date: string, time: string) {
  const value = `${date}T${time}:00`
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toISOString()
}

export function EmergencyAppointmentPage() {
  const { emergencyId = '' } = useParams()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [emergency, setEmergency] = useState<EmergencyData | null>(null)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [slots, setSlots] = useState<SlotItem[]>([])
  const [selectedSlotStart, setSelectedSlotStart] = useState('')
  const [slotsMessage, setSlotsMessage] = useState('')
  const [useManualTime, setUseManualTime] = useState(false)
  const [manualTime, setManualTime] = useState('')
  const [manualDuration, setManualDuration] = useState(60)
  const [manualConflict, setManualConflict] = useState<string | null>(null)

  const visibleSlots = useMemo(() => {
    const minStart = oneHourAheadMs()
    return slots.filter((slot) => {
      const startMs = new Date(slot.startDateTime).getTime()
      return Number.isFinite(startMs) && startMs >= minStart
    })
  }, [slots])

  const hasAvailableSlots = useMemo(() => visibleSlots.some((s) => s.available), [visibleSlots])

  const loadEmergency = async () => {
    if (!emergencyId) return
    setLoading(true)
    setError('')
    try {
      const res = await postApi<{ emergency: EmergencyData }>('/appointments/emergency/get', { emergencyId })
      setEmergency(res.emergency)
    } catch (err) {
      setEmergency(null)
      setError(err instanceof Error ? err.message : 'No se pudo cargar la emergencia')
    } finally {
      setLoading(false)
    }
  }

  const loadSlots = async (selectedDate: string) => {
    setSlotsMessage('')
    try {
      const [slotsRes, availabilityRes] = await Promise.all([
        postApi<{ slots: SlotItem[] }>('/appointments/mine/slots', { date: selectedDate }),
        postApi<{ slotMinutes?: number }>('/availability/mine', {}),
      ])
      const nextSlots = slotsRes.slots || []
      setSlots(nextSlots)
      const configuredDuration = Number(availabilityRes.slotMinutes || 60)
      if (configuredDuration === 45 || configuredDuration === 60) {
        setManualDuration(configuredDuration)
      }
      const selectedStillAvailable = nextSlots.some((s) => s.startDateTime === selectedSlotStart && s.available)
      if (!selectedStillAvailable) {
        const firstAvailable = nextSlots.find((s) => s.available)
        setSelectedSlotStart(firstAvailable?.startDateTime || '')
      }
      if (nextSlots.length === 0) {
        setSelectedSlotStart('')
        setSlotsMessage('No hay horarios configurados para esta fecha.')
      }
    } catch (err) {
      setSlots([])
      setSelectedSlotStart('')
      setSlotsMessage(err instanceof Error ? err.message : 'No se pudieron cargar los horarios.')
    }
  }

  const checkManualConflict = async (startIso: string, endIso: string) => {
    try {
      const res = await postApi<{ conflict: boolean; message?: string | null }>('/appointments/mine/checkConflict', {
        startDateTime: startIso,
        endDateTime: endIso,
      })
      setManualConflict(res.conflict ? res.message || 'El horario interfiere con otra cita o reserva.' : null)
      return Boolean(res.conflict)
    } catch (err) {
      const text = err instanceof Error ? err.message : 'No se pudo validar el conflicto.'
      setManualConflict(text)
      return true
    }
  }

  const createAppointmentFromEmergency = async () => {
    if (!emergency) return
    let startIso = ''
    let endIso = ''

    if (useManualTime) {
      if (!manualTime) {
        const msg = 'Selecciona una hora manual.'
        setMessage(msg)
        alert(msg)
        return
      }
      startIso = toIsoFromDateAndTime(date, manualTime)
      if (!startIso) {
        const msg = 'Hora manual inválida.'
        setMessage(msg)
        alert(msg)
        return
      }
      const startMs = new Date(startIso).getTime()
      const minStart = oneHourAheadMs()
      if (!Number.isFinite(startMs) || startMs < minStart) {
        const msg = 'La hora manual debe ser al menos 1 hora después de la hora actual.'
        setMessage(msg)
        alert(msg)
        return
      }
      endIso = new Date(startMs + manualDuration * 60 * 1000).toISOString()
    } else {
      const selected = visibleSlots.find((s) => s.startDateTime === selectedSlotStart && s.available)
      if (!selected) {
        const msg = 'Selecciona un horario disponible.'
        setMessage(msg)
        alert(msg)
        return
      }
      startIso = selected.startDateTime
      endIso = selected.endDateTime
    }

    const hasConflict = await checkManualConflict(startIso, endIso)
    if (hasConflict) {
      const msg = manualConflict || 'Ese horario interfiere con una cita existente.'
      setMessage(msg)
      alert(`Conflicto de horario: ${msg}`)
      return
    }

    setSaving(true)
    setMessage('')
    try {
      await postApi('/appointments/mine/create', {
        patientName: emergency.patientName || 'Paciente',
        patientPhone: emergency.patientPhoneE164 || '',
        source: 'EMERGENCY',
        emergencyId: emergency.emergencyId,
        startDateTime: startIso,
        endDateTime: endIso,
        notes: `Cita creada desde emergencia ${emergency.emergencyId}. Edad: ${emergency.patientAge || '-'} | Detalle: ${emergency.description || ''}`,
      })
      setMessage('Cita creada desde emergencia. El horario ya quedó bloqueado en tu calendario.')
      await loadSlots(date)
    } catch (err) {
      const text = err instanceof Error ? err.message : 'No se pudo crear la cita desde emergencia'
      setMessage(text)
      if (String(text).toLowerCase().includes('conflicto') || String(text).toLowerCase().includes('horario')) {
        alert(`Conflicto de horario: ${text}`)
      }
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    loadEmergency().catch(() => null)
  }, [emergencyId])

  useEffect(() => {
    loadSlots(date).catch(() => null)
  }, [date])

  useEffect(() => {
    const selectedStillAvailable = visibleSlots.some((s) => s.startDateTime === selectedSlotStart && s.available)
    if (!selectedStillAvailable) {
      const firstAvailable = visibleSlots.find((s) => s.available)
      setSelectedSlotStart(firstAvailable?.startDateTime || '')
    }
  }, [selectedSlotStart, visibleSlots])

  useEffect(() => {
    if (!useManualTime || !manualTime) {
      setManualConflict(null)
      return
    }
    const startIso = toIsoFromDateAndTime(date, manualTime)
    if (!startIso) {
      setManualConflict('Hora manual inválida.')
      return
    }
    const startMs = new Date(startIso).getTime()
    const endIso = new Date(startMs + manualDuration * 60 * 1000).toISOString()
    const t = setTimeout(() => {
      checkManualConflict(startIso, endIso).catch(() => null)
    }, 250)
    return () => clearTimeout(t)
  }, [useManualTime, manualTime, manualDuration, date])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Detalle de emergencia</h1>
      {loading && <p className="text-sm text-slate-600">Cargando...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {emergency && (
        <Card>
          <p className="font-semibold">Emergencia: {emergency.emergencyId}</p>
          <p>Estado: {emergency.status}</p>
          <p>Paciente: {emergency.patientName || '-'}</p>
          <p>Edad: {Number.isFinite(emergency.patientAge) ? emergency.patientAge : '-'}</p>
          <p>Descripcion: {emergency.description || '-'}</p>
          <p>Creada: {emergency.createdAt ? new Date(emergency.createdAt).toLocaleString('es-GT') : '-'}</p>

          <div className="mt-4 space-y-2">
            <p className="font-semibold">Crear cita desde emergencia</p>
            <div className="flex items-center gap-2">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-xs" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useManualTime} onChange={(e) => setUseManualTime(e.target.checked)} />
              Usar hora manual (emergencia)
            </label>

            {useManualTime ? (
              <div className="grid gap-2 md:grid-cols-2">
                <Input type="time" value={manualTime} onChange={(e) => setManualTime(e.target.value)} />
                <select
                  className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                  value={manualDuration}
                  onChange={(e) => setManualDuration(Number(e.target.value))}
                >
                  <option value={45}>Duración 45 min</option>
                  <option value={60}>Duración 60 min</option>
                </select>
              </div>
            ) : (
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
            )}

            {!useManualTime && selectedSlotStart && (
              <p className="text-sm text-slate-700">
                Hora seleccionada: <strong>{slotStartLabel(visibleSlots.find((s) => s.startDateTime === selectedSlotStart)?.label || '-')}</strong>
              </p>
            )}
            {slotsMessage && <p className="text-sm text-slate-600">{slotsMessage}</p>}
            {useManualTime && manualConflict && <p className="text-sm text-amber-700">{manualConflict}</p>}
            {!useManualTime && !hasAvailableSlots && <p className="text-xs text-slate-600">No hay slots disponibles con al menos 1 hora de anticipación.</p>}
            <Button type="button" disabled={saving || (!useManualTime && !hasAvailableSlots)} onClick={createAppointmentFromEmergency}>
              {saving ? 'Guardando...' : 'Crear cita'}
            </Button>
          </div>
        </Card>
      )}

      {message && <p className="text-sm text-sky-700">{message}</p>}
    </div>
  )
}
