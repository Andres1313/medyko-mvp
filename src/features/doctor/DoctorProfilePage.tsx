import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { useAuth } from '../../hooks/useAuth'
import { postApi } from '../../lib/api'

const countryCodes = ['+502', '+503', '+504', '+505', '+506', '+507', '+52', '+1', '+34']

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type SlotMinutes = 45 | 60

const dayLabels: Array<{ key: DayKey; label: string }> = [
  { key: 'mon', label: 'Lunes' },
  { key: 'tue', label: 'Martes' },
  { key: 'wed', label: 'Miercoles' },
  { key: 'thu', label: 'Jueves' },
  { key: 'fri', label: 'Viernes' },
  { key: 'sat', label: 'Sabado' },
  { key: 'sun', label: 'Domingo' },
]

const doctorProfileSchema = z.object({
  fullName: z.string().min(2, 'Ingresa nombre completo'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida').optional().or(z.literal('')),
  phoneCountryCode: z.string().min(2),
  phoneLocal: z.string().min(6, 'Numero invalido'),
  contactEmail: z.string().email('Correo invalido').optional().or(z.literal('')),
  publicContactEmail: z.string().email('Correo inválido').optional().or(z.literal('')),
  publicContactPhone: z.string().max(30).optional().or(z.literal('')),
  licenseNumber: z.string().min(3, 'Ingresa numero de colegiado'),
  activeLicense: z.boolean(),
  insuranceNetworks: z.string().max(2000),
  degreeTitleUrl: z.string().optional(),
  certificationUrls: z.array(z.string()).optional(),
  academicHistory: z.string().max(3000),
  masters: z.string().max(3000),
  internships: z.string().max(3000),
})

type DoctorProfileForm = z.infer<typeof doctorProfileSchema>
type DoctorProfileApiResponse = Partial<DoctorProfileForm> & {
  phone?: string
  age?: number | null
  dateOfBirth?: string
  photos?: string[]
  certificationUrls?: string[]
  degreeTitleUrl?: string
  publicContactEmail?: string
  publicContactPhone?: string
}

interface PhoneVerificationStatus {
  phone?: string
  verified: boolean
  status?: string
}

interface DoctorApplicationStatus {
  status: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
  reason?: string
}

interface AvailabilityRange {
  start: string
  end: string
}

interface AvailabilityResponse {
  weeklySchedule: Partial<Record<DayKey, AvailabilityRange[]>>
  timezone: string
  slotMinutes: number
}

interface DayAvailabilityState {
  closed: boolean
  selectedSlots: string[]
  rangeStart: string
  rangeEnd: string
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function hhmmFromMinutes(total: number) {
  const h = Math.floor(total / 60)
  const m = total % 60
  return `${pad(h)}:${pad(m)}`
}

function minutesFromHHMM(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function buildSlotOptions(slotMinutes: SlotMinutes) {
  const times: string[] = []
  for (let current = 0; current < 24 * 60; current += slotMinutes) {
    times.push(hhmmFromMinutes(current))
  }
  const dayTimes = times.filter((t) => minutesFromHHMM(t) >= 6 * 60)
  const earlyTimes = times.filter((t) => minutesFromHHMM(t) < 6 * 60)
  return [...dayTimes, ...earlyTimes]
}

function expandRangesToSlots(ranges: AvailabilityRange[] | undefined, slotMinutes: SlotMinutes) {
  if (!ranges || ranges.length === 0) return []
  const out: string[] = []
  for (const range of ranges) {
    const start = minutesFromHHMM(range.start)
    const end = minutesFromHHMM(range.end)
    for (let m = start; m + slotMinutes <= end; m += slotMinutes) {
      out.push(hhmmFromMinutes(m))
    }
  }
  return Array.from(new Set(out)).sort()
}

function compressSlotsToRanges(slots: string[], slotMinutes: SlotMinutes): AvailabilityRange[] {
  if (slots.length === 0) return []
  const minutes = Array.from(new Set(slots.map(minutesFromHHMM))).sort((a, b) => a - b)
  const ranges: AvailabilityRange[] = []
  let blockStart = minutes[0]
  let prev = minutes[0]

  for (let i = 1; i < minutes.length; i += 1) {
    const curr = minutes[i]
    if (curr !== prev + slotMinutes) {
      ranges.push({ start: hhmmFromMinutes(blockStart), end: hhmmFromMinutes(prev + slotMinutes) })
      blockStart = curr
    }
    prev = curr
  }
  ranges.push({ start: hhmmFromMinutes(blockStart), end: hhmmFromMinutes(prev + slotMinutes) })
  return ranges
}

function slotsInRange(slotOptions: string[], slotMinutes: SlotMinutes, rangeStart: string, rangeEnd: string) {
  const startMin = minutesFromHHMM(rangeStart)
  const endMin = minutesFromHHMM(rangeEnd)
  if (endMin <= startMin) return []
  return slotOptions.filter((slot) => {
    const s = minutesFromHHMM(slot)
    const e = s + slotMinutes
    return s >= startMin && e <= endMin
  })
}

function emptyAvailabilityState(): Record<DayKey, DayAvailabilityState> {
  return {
    mon: { closed: false, selectedSlots: [], rangeStart: '07:00', rangeEnd: '17:00' },
    tue: { closed: false, selectedSlots: [], rangeStart: '07:00', rangeEnd: '17:00' },
    wed: { closed: false, selectedSlots: [], rangeStart: '07:00', rangeEnd: '17:00' },
    thu: { closed: false, selectedSlots: [], rangeStart: '07:00', rangeEnd: '17:00' },
    fri: { closed: false, selectedSlots: [], rangeStart: '07:00', rangeEnd: '17:00' },
    sat: { closed: true, selectedSlots: [], rangeStart: '07:00', rangeEnd: '17:00' },
    sun: { closed: true, selectedSlots: [], rangeStart: '07:00', rangeEnd: '17:00' },
  }
}

export function DoctorProfilePage() {
  const { sendPhoneVerificationCode, confirmPhoneVerificationCode } = useAuth()
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const [slotMinutes, setSlotMinutes] = useState<SlotMinutes>(60)
  const [availability, setAvailability] = useState<Record<DayKey, DayAvailabilityState>>(emptyAvailabilityState())
  const [doctorPhotos, setDoctorPhotos] = useState<string[]>([])
  const [degreeTitleUrl, setDegreeTitleUrl] = useState('')
  const [certificationUrls, setCertificationUrls] = useState<string[]>([])
  const [phoneVerification, setPhoneVerification] = useState<PhoneVerificationStatus>({ verified: false, status: 'pending' })
  const [phoneVerificationCode, setPhoneVerificationCode] = useState('')
  const [application, setApplication] = useState<DoctorApplicationStatus>({ status: 'DRAFT' })
  const [currentAge, setCurrentAge] = useState<number | null>(null)

  const profileForm = useForm<DoctorProfileForm>({
    resolver: zodResolver(doctorProfileSchema),
    defaultValues: {
      fullName: '',
      dateOfBirth: '',
      phoneCountryCode: '+502',
      phoneLocal: '',
      contactEmail: '',
      licenseNumber: '',
      activeLicense: false,
      insuranceNetworks: '',
      publicContactEmail: '',
      publicContactPhone: '',
      degreeTitleUrl: '',
      certificationUrls: [],
      academicHistory: '',
      masters: '',
      internships: '',
    },
  })
  const fullNameValue = profileForm.watch('fullName')
  const dateOfBirthValue = profileForm.watch('dateOfBirth')

  useEffect(() => {
    Promise.all([
      postApi<DoctorProfileApiResponse>('/doctors/profile/get', {}),
      postApi<PhoneVerificationStatus>('/doctors/phoneVerification/status', {}),
    ])
      .then(([data, phoneStatus]) => {
        if (!data) return
        const normalizedPhone = String(data.phone || '').replace(/\s+/g, '')
        const code = data.phoneCountryCode || '+502'
        let local = normalizedPhone
        if (normalizedPhone.startsWith(code)) {
          local = normalizedPhone.slice(code.length)
        }
        profileForm.reset({
          fullName: data.fullName || '',
          dateOfBirth: data.dateOfBirth || '',
          phoneCountryCode: code,
          phoneLocal: local,
          contactEmail: data.contactEmail || '',
          licenseNumber: data.licenseNumber || '',
          activeLicense: Boolean(data.activeLicense),
          insuranceNetworks: data.insuranceNetworks || '',
          publicContactEmail: data.publicContactEmail || '',
          publicContactPhone: data.publicContactPhone || '',
          degreeTitleUrl: data.degreeTitleUrl || '',
          certificationUrls: Array.isArray(data.certificationUrls) ? data.certificationUrls : [],
          academicHistory: data.academicHistory || '',
          masters: data.masters || '',
          internships: data.internships || '',
        })
        setDoctorPhotos(Array.isArray(data.photos) ? data.photos : [])
        setDegreeTitleUrl(data.degreeTitleUrl || '')
        setCertificationUrls(Array.isArray(data.certificationUrls) ? data.certificationUrls : [])
        setPhoneVerification(phoneStatus)
        setCurrentAge(typeof data.age === 'number' ? data.age : null)
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'No se pudo cargar tu perfil. Actualiza la pagina e intenta de nuevo.'))
  }, [profileForm])

  useEffect(() => {
    postApi<DoctorApplicationStatus>('/doctors/application/status', {})
      .then((res) => setApplication(res))
      .catch(() => setApplication({ status: 'DRAFT' }))
  }, [])

  useEffect(() => {
    postApi<AvailabilityResponse>('/availability/mine', {})
      .then((data) => {
        const nextSlotMinutes: SlotMinutes = data.slotMinutes === 45 ? 45 : 60
        setSlotMinutes(nextSlotMinutes)

        const next = emptyAvailabilityState()
        const hasAnySaved = dayLabels.some((day) => (data.weeklySchedule?.[day.key] || []).length > 0)
        for (const day of dayLabels) {
          const ranges = data.weeklySchedule?.[day.key] || []
          const selectedSlots = expandRangesToSlots(ranges, nextSlotMinutes)
          if (selectedSlots.length > 0) {
            const rangeStart = ranges[0]?.start || '07:00'
            const rangeEnd = ranges[ranges.length - 1]?.end || '17:00'
            next[day.key] = {
              closed: false,
              selectedSlots,
              rangeStart,
              rangeEnd,
            }
          } else if (!hasAnySaved) {
            const isWeekend = day.key === 'sat' || day.key === 'sun'
            const defaultSelected = isWeekend ? [] : slotsInRange(buildSlotOptions(nextSlotMinutes), nextSlotMinutes, '07:00', '17:00')
            next[day.key] = {
              closed: isWeekend,
              selectedSlots: defaultSelected,
              rangeStart: '07:00',
              rangeEnd: '17:00',
            }
          } else {
            next[day.key] = {
              ...next[day.key],
              closed: true,
              selectedSlots: [],
            }
          }
        }
        setAvailability(next)
      })
      .catch(() => null)
  }, [])

  const slotOptions = useMemo(() => buildSlotOptions(slotMinutes), [slotMinutes])

  useEffect(() => {
    setAvailability((prev) => {
      const next = { ...prev }
      for (const day of dayLabels) {
        const row = next[day.key]
        next[day.key] = {
          ...row,
          selectedSlots: row.closed ? [] : slotsInRange(slotOptions, slotMinutes, row.rangeStart, row.rangeEnd),
        }
      }
      return next
    })
  }, [slotMinutes, slotOptions])

  const persistProfile = async () => {
    const values = profileForm.getValues()
    await postApi('/doctors/profile/upsert', {
      ...values,
      degreeTitleUrl,
      certificationUrls,
    })
  }

  const submitProfile = profileForm.handleSubmit(async () => {
    setMessage('')
    await persistProfile()
    setMessage('Perfil profesional guardado.')
  })

  const toBase64 = async (file: File) => {
    const buffer = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }

  const uploadDoctorPhoto = async (file: File) => {
    setMessage('')
    const base64Data = await toBase64(file)
    const upload = await postApi<{ url: string }>('/media/uploadImage', {
      fileName: file.name,
      contentType: file.type || 'image/jpeg',
      base64Data,
      scope: 'doctor_profile',
    })
    await postApi('/doctors/profile/photos/add', { url: upload.url })
    setDoctorPhotos((prev) => Array.from(new Set([upload.url, ...prev])))
    setMessage('Foto del doctor cargada.')
  }

  const uploadDegree = async (file: File) => {
    setMessage('')
    const base64Data = await toBase64(file)
    const upload = await postApi<{ url: string }>('/media/uploadDocument', {
      fileName: file.name,
      contentType: file.type || 'application/pdf',
      base64Data,
      scope: 'doctor_verification',
    })
    setDegreeTitleUrl(upload.url)
    profileForm.setValue('degreeTitleUrl', upload.url)
    setMessage('Título cargado.')
  }

  const uploadCertification = async (file: File) => {
    setMessage('')
    const base64Data = await toBase64(file)
    const upload = await postApi<{ url: string }>('/media/uploadDocument', {
      fileName: file.name,
      contentType: file.type || 'application/pdf',
      base64Data,
      scope: 'doctor_verification',
    })
    setCertificationUrls((prev) => {
      const next = Array.from(new Set([upload.url, ...prev]))
      profileForm.setValue('certificationUrls', next)
      return next
    })
    setMessage('Certificado cargado.')
  }

  const requestPhoneCode = async () => {
    const countryCode = String(profileForm.getValues('phoneCountryCode') || '').trim()
    const local = String(profileForm.getValues('phoneLocal') || '').replace(/[^\d]/g, '')
    if (!countryCode || !local || local.length < 6) {
      setMessage('Ingresa primero un número de teléfono válido.')
      return
    }
    const phoneE164 = `${countryCode}${local}`
    await sendPhoneVerificationCode(phoneE164, 'recaptcha-phone-profile')
    setPhoneVerification((prev) => ({ ...prev, phone: phoneE164, verified: false, status: 'code_sent' }))
    setMessage('Código enviado por teléfono.')
  }

  const confirmPhoneCode = async () => {
    if (!phoneVerificationCode.trim()) {
      setMessage('Ingresa el código de 6 dígitos.')
      return
    }
    const countryCode = String(profileForm.getValues('phoneCountryCode') || '').trim()
    const local = String(profileForm.getValues('phoneLocal') || '').replace(/[^\d]/g, '')
    const phoneE164 = `${countryCode}${local}`
    await confirmPhoneVerificationCode(phoneVerificationCode.trim())
    await postApi('/doctors/phoneVerification/confirm', { phone: phoneE164 })
    const latest = await postApi<PhoneVerificationStatus>('/doctors/phoneVerification/status', {})
    setPhoneVerification(latest)
    setPhoneVerificationCode('')
    setMessage('Teléfono verificado.')
  }

  const submitApplication = async () => {
    setMessage('')
    const isValid = await profileForm.trigger()
    if (!isValid) {
      setMessage('Completa los campos obligatorios del perfil antes de enviar solicitud.')
      return
    }
    await persistProfile()
    const res = await postApi<DoctorApplicationStatus>('/doctors/application/submit', {})
    setApplication(res)
    setMessage('Solicitud enviada a plataforma para revision.')
  }

  const toggleSlot = (day: DayKey, slot: string) => {
    setAvailability((prev) => {
      const row = prev[day]
      if (row.closed) return prev
      const exists = row.selectedSlots.includes(slot)
      const selectedSlots = exists ? row.selectedSlots.filter((v) => v !== slot) : [...row.selectedSlots, slot]
      return { ...prev, [day]: { ...row, selectedSlots } }
    })
  }

  const applyRange = (day: DayKey) => {
    setAvailability((prev) => {
      const row = prev[day]
      if (row.closed) return prev
      return {
        ...prev,
        [day]: {
          ...row,
          selectedSlots: slotsInRange(slotOptions, slotMinutes, row.rangeStart, row.rangeEnd),
        },
      }
    })
  }

  const saveAvailability = async () => {
    setMessage('')
    const weeklySchedule: Partial<Record<DayKey, AvailabilityRange[]>> = {}

    for (const day of dayLabels) {
      const row = availability[day.key]
      if (row.closed || row.selectedSlots.length === 0) continue
      weeklySchedule[day.key] = compressSlotsToRanges(row.selectedSlots, slotMinutes)
    }

    await postApi('/availability/saveMine', {
      weeklySchedule,
      timezone: 'America/Guatemala',
      slotMinutes,
    })
    setMessage(`Horario guardado. Slots de ${slotMinutes} minutos activos para reservas.`)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Mi perfil profesional</h1>

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-semibold text-red-700">Error al cargar perfil:</p>
          <p className="text-sm text-red-600">{loadError}</p>
        </div>
      )}

      <Card>
        <h2 className="font-semibold">Perfil profesional doctor</h2>
        <p className="mt-1 text-sm text-slate-600">Estos datos se usan para tu perfil, validaciones y operaciones de renta.</p>
        <form className="mt-3 space-y-3" onSubmit={submitProfile}>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Nombre completo</label>
            <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900">{fullNameValue || '-'}</div>
            <input type="hidden" {...profileForm.register('fullName')} />
          </div>
          {profileForm.formState.errors.fullName && <p className="text-xs text-red-600">{profileForm.formState.errors.fullName.message}</p>}
          {dateOfBirthValue ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Fecha de nacimiento</label>
              <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-900">{dateOfBirthValue}</div>
              <input type="hidden" {...profileForm.register('dateOfBirth')} />
              {profileForm.formState.errors.dateOfBirth && <p className="text-xs text-red-600">{profileForm.formState.errors.dateOfBirth.message}</p>}
              {currentAge !== null && <p className="mt-1 text-xs text-slate-500">Edad actual: {currentAge} años</p>}
            </div>
          ) : (
            <div>
              <input type="hidden" {...profileForm.register('dateOfBirth')} />
              {currentAge !== null && <p className="text-xs text-slate-500">Edad actual: {currentAge} años</p>}
            </div>
          )}

          <div className="grid gap-2 md:grid-cols-[140px_1fr]">
            <select className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm" {...profileForm.register('phoneCountryCode')}>
              {countryCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <Input placeholder="Numero de telefono" {...profileForm.register('phoneLocal')} />
          </div>
          {profileForm.formState.errors.phoneLocal && <p className="text-xs text-red-600">{profileForm.formState.errors.phoneLocal.message}</p>}

          <Input placeholder="Correo personal (privado, cifrado)" {...profileForm.register('contactEmail')} />
          {profileForm.formState.errors.contactEmail && <p className="text-xs text-red-600">{profileForm.formState.errors.contactEmail.message}</p>}

          <Input placeholder="Correo de contacto público (opcional)" {...profileForm.register('publicContactEmail')} />
          {profileForm.formState.errors.publicContactEmail && (
            <p className="text-xs text-red-600">{profileForm.formState.errors.publicContactEmail.message}</p>
          )}

          <Input placeholder="Teléfono de contacto público o de clínica (opcional)" {...profileForm.register('publicContactPhone')} />
          {profileForm.formState.errors.publicContactPhone && (
            <p className="text-xs text-red-600">{profileForm.formState.errors.publicContactPhone.message}</p>
          )}

          <Input placeholder="Numero de colegiado" {...profileForm.register('licenseNumber')} />
          {profileForm.formState.errors.licenseNumber && <p className="text-xs text-red-600">{profileForm.formState.errors.licenseNumber.message}</p>}

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" {...profileForm.register('activeLicense')} />
            Colegiado activo
          </label>

          <textarea
            className="min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-sky-200 focus:ring"
            placeholder="Seguros con los que trabajas (separados por coma)"
            {...profileForm.register('insuranceNetworks')}
          />

          <textarea
            className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-sky-200 focus:ring"
            placeholder="Historial academico"
            {...profileForm.register('academicHistory')}
          />
          <textarea
            className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-sky-200 focus:ring"
            placeholder="Maestrias y especializaciones"
            {...profileForm.register('masters')}
          />
          <textarea
            className="min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-sky-200 focus:ring"
            placeholder="Pasantias y rotaciones"
            {...profileForm.register('internships')}
          />

          <Button type="submit" disabled={profileForm.formState.isSubmitting}>
            Guardar perfil
          </Button>
        </form>
        <div className="mt-4 rounded-lg border border-slate-200 p-3">
          <p className="text-sm font-semibold text-slate-900">Verificación de teléfono (paso 2)</p>
          <p className="mt-1 text-xs text-slate-600">
            Estado: {phoneVerification.verified ? 'Verificado' : phoneVerification.status === 'code_sent' ? 'Código enviado' : 'Pendiente'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" onClick={requestPhoneCode}>
              Enviar código
            </Button>
            <Input
              placeholder="Código de 6 dígitos"
              value={phoneVerificationCode}
              onChange={(e) => setPhoneVerificationCode(e.target.value)}
              className="max-w-xs"
            />
            <Button className="bg-slate-700 hover:bg-slate-800" type="button" onClick={confirmPhoneCode}>
              Confirmar código
            </Button>
          </div>
          <div id="recaptcha-phone-profile" />
        </div>
        <div className="mt-4 border-t border-slate-200 pt-3">
          <p className="mb-2 text-sm font-medium text-slate-800">Fotos para tus pacientes</p>
          <Input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              uploadDoctorPhoto(file).catch((err) => setMessage(err instanceof Error ? err.message : 'No se pudo subir la foto'))
            }}
          />
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {doctorPhotos.map((url) => (
              <img key={url} src={url} alt="Doctor" className="h-24 w-full rounded-md border border-slate-200 object-cover" />
            ))}
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-sm font-medium text-slate-800">Documentos para verificación</p>
          <p className="text-xs text-slate-600">Sube foto/PDF de tu título y tus certificaciones.</p>
          <div className="mt-3 space-y-3">
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-700">Título de médico</p>
              <Input
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  uploadDegree(file).catch((err) => setMessage(err instanceof Error ? err.message : 'No se pudo subir el título'))
                }}
              />
              {degreeTitleUrl && (
                <a className="mt-1 inline-block text-xs font-semibold text-sky-700" href={degreeTitleUrl} target="_blank" rel="noreferrer">
                  Ver título cargado
                </a>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-700">Certificaciones</p>
              <Input
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  uploadCertification(file).catch((err) => setMessage(err instanceof Error ? err.message : 'No se pudo subir certificado'))
                }}
              />
              <div className="mt-2 space-y-1">
                {certificationUrls.map((url) => (
                  <a key={url} className="block text-xs font-semibold text-sky-700" href={url} target="_blank" rel="noreferrer">
                    Certificación
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Horario y slots de citas</h2>
        <p className="mt-1 text-sm text-slate-600">Selecciona los slots por dia. Puedes usar bloques de 60 o 45 minutos.</p>

        <div className="mt-3 max-w-xs">
          <label className="mb-1 block text-sm font-medium text-slate-700">Duracion por cita</label>
          <select
            className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={slotMinutes}
            onChange={(e) => setSlotMinutes(Number(e.target.value) as SlotMinutes)}
          >
            <option value={60}>60 minutos</option>
            <option value={45}>45 minutos</option>
          </select>
        </div>

        <div className="mt-4 space-y-4">
          {dayLabels.map((day) => {
            const row = availability[day.key]
            return (
              <div key={day.key} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-semibold text-slate-900">{day.label}</p>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={row.closed}
                      onChange={(e) =>
                        setAvailability((prev) => ({
                          ...prev,
                          [day.key]: {
                            ...prev[day.key],
                            closed: e.target.checked,
                            selectedSlots: e.target.checked
                              ? []
                              : slotsInRange(slotOptions, slotMinutes, prev[day.key].rangeStart, prev[day.key].rangeEnd),
                          },
                        }))
                      }
                    />
                    Cerrado
                  </label>
                </div>

                <div className="mb-3 grid items-end gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Inicio</label>
                    <Input
                      type="time"
                      value={row.rangeStart}
                      disabled={row.closed}
                      onChange={(e) =>
                        setAvailability((prev) => ({
                          ...prev,
                          [day.key]: { ...prev[day.key], rangeStart: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Fin</label>
                    <Input
                      type="time"
                      value={row.rangeEnd}
                      disabled={row.closed}
                      onChange={(e) =>
                        setAvailability((prev) => ({
                          ...prev,
                          [day.key]: { ...prev[day.key], rangeEnd: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <Button type="button" disabled={row.closed} onClick={() => applyRange(day.key)}>
                    Aplicar rango
                  </Button>
                </div>

                <div className="grid grid-cols-5 gap-2 md:grid-cols-6">
                  {slotOptions.map((slot) => {
                    const selected = row.selectedSlots.includes(slot)
                    return (
                      <button
                        key={`${day.key}-${slot}`}
                        type="button"
                        disabled={row.closed}
                        onClick={() => toggleSlot(day.key, slot)}
                        className={`rounded-md px-2 py-2 text-sm font-medium ${
                          row.closed
                            ? 'cursor-not-allowed bg-slate-100 text-slate-300'
                            : selected
                              ? 'bg-emerald-400 text-white'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {slot}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-3">
          <Button type="button" onClick={saveAvailability}>
            Guardar horario
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Solicitud de aprobacion</h2>
        <p className="mt-1 text-sm text-slate-600">
          Estado actual: <strong>{application.status}</strong>
        </p>
        {application.reason && <p className="mt-1 text-sm text-red-600">Motivo: {application.reason}</p>}
        <div className="mt-3">
          <Button
            type="button"
            onClick={submitApplication}
            disabled={application.status === 'PENDING_REVIEW'}
          >
            Enviar solicitud a admin
          </Button>
        </div>
      </Card>

      {message && <p className="text-sm text-sky-700">{message}</p>}
    </div>
  )
}
