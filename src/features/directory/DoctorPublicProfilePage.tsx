import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { postApi } from '../../lib/api'

type ScheduleRange = { start: string; end: string }
type WeeklySchedule = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', ScheduleRange[]>>

interface DoctorPublicProfile {
  uid: string
  clinicId: string | null
  fullName: string | null
  licenseNumber: string | null
  phone: string | null
  publicContactEmail?: string | null
  publicContactPhone?: string | null
  insuranceNetworks?: string
  activeLicense?: boolean
  academicHistory: string
  masters: string
  internships: string
  weeklySchedule: WeeklySchedule
  verified: boolean
  adminApproved?: boolean
  avgRating: number
  totalReviews: number
  photos?: string[]
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

const days: Array<{ key: keyof WeeklySchedule; label: string }> = [
  { key: 'mon', label: 'Lunes' },
  { key: 'tue', label: 'Martes' },
  { key: 'wed', label: 'Miercoles' },
  { key: 'thu', label: 'Jueves' },
  { key: 'fri', label: 'Viernes' },
  { key: 'sat', label: 'Sabado' },
  { key: 'sun', label: 'Domingo' },
]

function formatRanges(ranges: ScheduleRange[] | undefined) {
  if (!ranges || ranges.length === 0) return 'Sin disponibilidad'
  return ranges.map((r) => `${r.start} - ${r.end}`).join(' | ')
}

export function DoctorPublicProfilePage() {
  const { doctorUid } = useParams()
  const [doctor, setDoctor] = useState<DoctorPublicProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [patientName, setPatientName] = useState('')
  const [age, setAge] = useState('')
  const [patientPhone, setPatientPhone] = useState('')
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [emergencyConsentAccepted, setEmergencyConsentAccepted] = useState(false)
  const [recurringPatient, setRecurringPatient] = useState(false)
  const [hasInsurance, setHasInsurance] = useState(false)
  const [insuranceName, setInsuranceName] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [slots, setSlots] = useState<PublicSlotItem[]>([])
  const [selectedSlotStart, setSelectedSlotStart] = useState('')
  const [slotsMessage, setSlotsMessage] = useState('')
  const [emergencyDescription, setEmergencyDescription] = useState('')

  const loadSlots = async (uid: string, selectedDate: string) => {
    setSlotsMessage('')
    try {
      const res = await postApi<{ blocked?: boolean; reason?: string; slots?: PublicSlotItem[] }>('/public/doctors/slots', {
        doctorUid: uid,
        date: selectedDate,
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

  useEffect(() => {
    if (!doctorUid) return
    setLoading(true)
    setError('')
    postApi<{ doctor: DoctorPublicProfile }>('/public/doctors/profile', { doctorUid })
      .then((res) => {
        setDoctor(res.doctor)
        return loadSlots(res.doctor.uid, date)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar doctor'))
      .finally(() => setLoading(false))
  }, [doctorUid])

  const scheduleRows = useMemo(
    () =>
      days.map((d) => ({
        day: d.label,
        text: formatRanges(doctor?.weeklySchedule?.[d.key]),
      })),
    [doctor],
  )
  const visibleSlots = useMemo(() => {
    const minStart = oneHourAheadMs()
    return slots.filter((slot) => {
      const startMs = new Date(slot.startDateTime).getTime()
      return Number.isFinite(startMs) && startMs >= minStart
    })
  }, [slots])
  const hasAvailableSlots = useMemo(() => visibleSlots.some((s) => s.available), [visibleSlots])

  const submitInquiry = async () => {
    if (!doctor) return
    setMessage('')
    const selected = visibleSlots.find((s) => s.startDateTime === selectedSlotStart && s.available)
    if (!selected) {
      setMessage('Selecciona un slot disponible antes de enviar la solicitud.')
      return
    }
    if (!consentAccepted) {
      setMessage('Debes aceptar el tratamiento de datos para continuar.')
      return
    }
    try {
      const result = await postApi<{ ok: boolean; warning?: string | null }>('/public/appointments/create', {
        doctorUid: doctor.uid,
        patientName: patientName.trim(),
        patientAge: Number(age || 0),
        patientPhone: patientPhone.trim() || undefined,
        consentAccepted: true,
        startDateTime: selected.startDateTime,
        endDateTime: selected.endDateTime,
        notes: `Paciente recurrente: ${recurringPatient ? 'Sí' : 'No'}. Seguro: ${hasInsurance ? insuranceName.trim() || 'Sí' : 'No'}.`,
      })
      setMessage(result.warning || 'Cita agendada correctamente.')
      setPatientName('')
      setAge('')
      setPatientPhone('')
      setConsentAccepted(false)
      setRecurringPatient(false)
      setHasInsurance(false)
      setInsuranceName('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar la cita.')
    }
  }

  const submitEmergency = async () => {
    if (!doctor) return
    setMessage('')
    const patientAge = Number(age || 0)
    if (!patientName.trim() || !Number.isFinite(patientAge) || patientAge < 0) {
      setMessage('Ingresa nombre y edad del paciente.')
      return
    }
    if (!patientPhone.trim()) {
      setMessage('Ingresa un teléfono para poder recibir la confirmación de la cita de emergencia.')
      return
    }
    if (!emergencyDescription.trim() || emergencyDescription.trim().length < 3) {
      setMessage('Describe la emergencia.')
      return
    }
    if (!emergencyConsentAccepted) {
      setMessage('Debes aceptar el tratamiento de datos para enviar una emergencia.')
      return
    }
    try {
      const result = await postApi<{ ok: boolean; whatsappSent?: boolean; warning?: string | null }>('/appointments/emergency', {
        doctorUid: doctor.uid,
        patientName: patientName.trim(),
        patientAge,
        patientPhone: patientPhone.trim(),
        description: emergencyDescription.trim(),
        consentAccepted: true,
      })
      setEmergencyDescription('')
      setEmergencyConsentAccepted(false)
      if (result.whatsappSent === false) {
        setMessage(result.warning || 'Emergencia guardada, pero no se pudo enviar WhatsApp al doctor.')
      } else {
        setMessage('Emergencia enviada al doctor. Se notificó por plataforma y WhatsApp.')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo enviar la emergencia.')
    }
  }

  useEffect(() => {
    if (!doctor) return
    loadSlots(doctor.uid, date).catch(() => null)
  }, [date, doctor?.uid])

  useEffect(() => {
    const selectedStillAvailable = visibleSlots.some((s) => s.startDateTime === selectedSlotStart && s.available)
    if (!selectedStillAvailable) {
      const firstAvailable = visibleSlots.find((s) => s.available)
      setSelectedSlotStart(firstAvailable?.startDateTime || '')
    }
  }, [selectedSlotStart, visibleSlots])

  if (loading) return <p className="text-sm text-slate-600">Cargando perfil del doctor...</p>
  if (error || !doctor) return <p className="text-sm text-red-600">{error || 'Doctor no encontrado'}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Perfil publico del doctor</h1>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">{doctor.fullName || doctor.uid}</h2>
          {doctor.verified ? <Badge>Verificado</Badge> : <span className="text-xs text-amber-700">Sin verificar</span>}
        </div>
        <p className="mt-2 text-sm text-slate-700">Colegiado: {doctor.licenseNumber || '-'}</p>
        <p className="text-sm text-slate-700">Colegiado activo: {doctor.activeLicense ? 'Si' : 'No'}</p>
        <p className="text-sm text-slate-700">Teléfono de contacto: {doctor.publicContactPhone || doctor.phone || '-'}</p>
        <p className="text-sm text-slate-700">Correo de contacto: {doctor.publicContactEmail || '-'}</p>
        <p className="text-sm text-slate-700">Seguros que maneja: {doctor.insuranceNetworks || '-'}</p>
        <p className="text-sm text-slate-700">
          Rating: <strong>{doctor.avgRating.toFixed(2)}</strong> ({doctor.totalReviews} resenas)
        </p>
        {Array.isArray(doctor.photos) && doctor.photos.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {doctor.photos.map((url) => (
              <img key={url} src={url} alt="Foto doctor" className="h-24 w-full rounded-md border border-slate-200 object-cover" />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="font-semibold">Historial academico</h3>
        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{doctor.academicHistory || 'No agregado aun.'}</p>
      </Card>

      <Card>
        <h3 className="font-semibold">Maestrias y especializaciones</h3>
        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{doctor.masters || 'No agregado aun.'}</p>
      </Card>

      <Card>
        <h3 className="font-semibold">Pasantias y rotaciones</h3>
        <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{doctor.internships || 'No agregado aun.'}</p>
      </Card>

      <Card>
        <h3 className="font-semibold">Horario de citas disponible</h3>
        {!doctor.adminApproved && <p className="mt-2 text-sm text-amber-700">Este doctor aún está pendiente de aprobación por plataforma.</p>}
        <div className="mt-3 flex items-center gap-2">
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
          <p className="mt-2 text-sm text-slate-700">
            Slot seleccionado: <strong>{slotStartLabel(visibleSlots.find((s) => s.startDateTime === selectedSlotStart)?.label || '-')}</strong>
          </p>
        )}
        {slotsMessage && <p className="mt-2 text-sm text-slate-600">{slotsMessage}</p>}
        <div className="mt-2 space-y-2 text-sm">
          {scheduleRows.map((row) => (
            <div key={row.day} className="grid grid-cols-[120px_1fr] gap-2">
              <span className="font-medium text-slate-800">{row.day}</span>
              <span className="text-slate-700">{row.text}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold">Formulario de paciente</h3>
        <div className="mt-3 space-y-2">
          <Input placeholder="Tu nombre" value={patientName} onChange={(e) => setPatientName(e.target.value)} />
          <Input placeholder="Tu edad" type="number" min={0} value={age} onChange={(e) => setAge(e.target.value)} />
          <Input
            placeholder="Tu teléfono (ej. +502XXXXXXXX)"
            value={patientPhone}
            onChange={(e) => setPatientPhone(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={recurringPatient} onChange={(e) => setRecurringPatient(e.target.checked)} />
            Soy paciente recurrente
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hasInsurance} onChange={(e) => setHasInsurance(e.target.checked)} />
            Tengo seguro
          </label>
          {hasInsurance && <Input placeholder="Nombre del seguro" value={insuranceName} onChange={(e) => setInsuranceName(e.target.value)} />}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consentAccepted} onChange={(e) => setConsentAccepted(e.target.checked)} />
            <span>
              Acepto el tratamiento de mis datos para gestionar esta cita y recibir notificaciones relacionadas.
              {' '}
              <Link className="text-sky-700 underline" to="/privacy" target="_blank" rel="noopener noreferrer">
                Ver politica de privacidad
              </Link>
              .
            </span>
          </label>
          <Button type="button" disabled={!hasAvailableSlots} onClick={submitInquiry}>
            Enviar solicitud
          </Button>
          {!hasAvailableSlots && <p className="text-xs text-slate-600">No hay slots disponibles con al menos 1 hora de anticipación.</p>}
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
            <p className="text-sm font-semibold text-rose-700">Emergencia</p>
            <textarea
              className="mt-2 min-h-24 w-full rounded-md border border-rose-300 px-3 py-2 text-sm outline-none ring-rose-200 focus:ring"
              placeholder="Describe la emergencia"
              value={emergencyDescription}
              onChange={(e) => setEmergencyDescription(e.target.value)}
            />
            <label className="mt-2 flex items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={emergencyConsentAccepted} onChange={(e) => setEmergencyConsentAccepted(e.target.checked)} />
              <span>
                Acepto el tratamiento de mis datos para gestionar esta emergencia.
                {' '}
                <Link className="text-sky-700 underline" to="/privacy" target="_blank" rel="noopener noreferrer">
                  Ver politica de privacidad
                </Link>
                .
              </span>
            </label>
            <Button className="mt-2 bg-rose-600 hover:bg-rose-700" type="button" onClick={submitEmergency}>
              Enviar emergencia
            </Button>
          </div>
          {message && <p className="text-xs text-sky-700">{message}</p>}
        </div>
      </Card>
    </div>
  )
}
