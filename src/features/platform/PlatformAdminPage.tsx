import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { postApi } from '../../lib/api'

interface ContactItem {
  uid: string
  name?: string | null
  clinicId?: string | null
  email?: string | null
  phone?: string | null
  verified?: boolean
  hasFullName?: boolean
  hasDateOfBirth?: boolean
  hasIdNumber?: boolean
  idNumberLast4?: string | null
}

interface BookingHistoryItem {
  bookingId: string
  clinicId: string | null
  listingType: string | null
  listingId: string | null
  doctorId: string | null
  status: string | null
  paymentStatus: string | null
  startDateTime: string | null
  endDateTime: string | null
}

interface VerificationItem {
  clinicId: string
  ownerUid: string
  ownerEmail: string | null
  ownerPhone: string | null
  status: 'PENDING_DOCUMENTS' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
  reason: string
  identityVerified: boolean
  utilityBillUrl: string | null
  submittedAt?: unknown
  ownerRespondedAt?: unknown
  reviewedAt?: unknown
}

interface DoctorApplicationItem {
  doctorUid: string
  fullName?: string | null
  phone: string | null
  email: string | null
  status: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
  reason: string
  stripeVerified: boolean
  phoneVerified: boolean
  activeLicense: boolean
  degreeTitleUrl: string
  certificationCount: number
  certificationUrls?: string[]
  submittedAt?: unknown
  reviewedAt?: unknown
}

interface OverviewResponse {
  totals: {
    clinics: number
    doctors: number
    bookings: number
  }
  clinicContacts: ContactItem[]
  doctorContacts: ContactItem[]
  bookingHistory: BookingHistoryItem[]
  patientAppointments?: Array<{
    appointmentId: string
    doctorId: string | null
    patientName: string
    status: string
    startDateTime: string | null
    endDateTime: string | null
    consentAccepted: boolean
    consentAt?: unknown
    consentPolicyVersion?: string
  }>
  emergencies?: Array<{
    emergencyId: string
    doctorUid: string
    status: string
    createdAt?: unknown
    whatsappSent?: boolean
    consentAccepted: boolean
    consentAt?: unknown
    consentPolicyVersion?: string
  }>
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.seconds === 'number') {
      const d = new Date(record.seconds * 1000)
      return Number.isNaN(d.getTime()) ? null : d
    }
    if (typeof record._seconds === 'number') {
      const d = new Date(record._seconds * 1000)
      return Number.isNaN(d.getTime()) ? null : d
    }
    if (typeof record.toDate === 'function') {
      try {
        const d = (record.toDate as () => Date)()
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null
      } catch {
        return null
      }
    }
  }
  return null
}

function fmt(value: unknown) {
  const date = toDate(value)
  if (!date) return '-'
  return date.toLocaleString('es-GT')
}

function toCsv(rows: Record<string, string | number | null>[]) {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const escape = (value: string | number | null) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h] ?? '')).join(','))
  }
  return lines.join('\n')
}

function downloadCsv(fileName: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export function PlatformAdminPage() {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [verifications, setVerifications] = useState<VerificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [decisionReason, setDecisionReason] = useState<Record<string, string>>({})
  const [doctorApplications, setDoctorApplications] = useState<DoctorApplicationItem[]>([])

  const load = async () => {
    setLoading(true)
    setMessage('')
    try {
      const [overview, verificationRes, appRes] = await Promise.all([
        postApi<OverviewResponse>('/platform/admin/overview', { limit: 300 }),
        postApi<{ verifications: VerificationItem[] }>('/platform/clinicVerification/list', {}),
        postApi<{ applications: DoctorApplicationItem[] }>('/platform/doctors/applications/list', {}),
      ])
      setData(overview)
      setVerifications(verificationRes.verifications || [])
      setDoctorApplications(appRes.applications || [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cargar el panel')
      setData(null)
      setVerifications([])
      setDoctorApplications([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch(() => null)
  }, [])

  const filteredClinicContacts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return data?.clinicContacts || []
    return (data?.clinicContacts || []).filter((item) => {
      return (
        item.uid.toLowerCase().includes(q) ||
        String(item.clinicId || '').toLowerCase().includes(q) ||
        String(item.name || '').toLowerCase().includes(q) ||
        String(item.email || '').toLowerCase().includes(q)
      )
    })
  }, [data?.clinicContacts, query])

  const filteredDoctorContacts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return data?.doctorContacts || []
    return (data?.doctorContacts || []).filter((item) => {
      return item.uid.toLowerCase().includes(q) || String(item.name || '').toLowerCase().includes(q) || String(item.email || '').toLowerCase().includes(q)
    })
  }, [data?.doctorContacts, query])

  const filteredBookings = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return data?.bookingHistory || []
    return (data?.bookingHistory || []).filter((item) => {
      return (
        String(item.bookingId || '').toLowerCase().includes(q) ||
        String(item.clinicId || '').toLowerCase().includes(q) ||
        String(item.doctorId || '').toLowerCase().includes(q)
      )
    })
  }, [data?.bookingHistory, query])

  const exportBookingsCsv = () => {
    const rows = filteredBookings.map((item) => ({
      bookingId: item.bookingId,
      clinicId: item.clinicId,
      doctorId: item.doctorId,
      listingType: item.listingType,
      listingId: item.listingId,
      status: item.status,
      paymentStatus: item.paymentStatus,
      startDateTime: item.startDateTime,
      endDateTime: item.endDateTime,
    }))
    const csv = toCsv(rows)
    downloadCsv(`medyko-bookings-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  const filteredPatientAppointments = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = data?.patientAppointments || []
    if (!q) return rows
    return rows.filter((item) => {
      return (
        String(item.appointmentId || '').toLowerCase().includes(q) ||
        String(item.doctorId || '').toLowerCase().includes(q) ||
        String(item.patientName || '').toLowerCase().includes(q)
      )
    })
  }, [data?.patientAppointments, query])

  const filteredEmergencies = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = data?.emergencies || []
    if (!q) return rows
    return rows.filter((item) => {
      return String(item.emergencyId || '').toLowerCase().includes(q) || String(item.doctorUid || '').toLowerCase().includes(q)
    })
  }, [data?.emergencies, query])

  const reviewClinic = async (clinicId: string, decision: 'APPROVED' | 'REJECTED') => {
    const reason = (decisionReason[clinicId] || '').trim()
    if (decision === 'REJECTED' && !reason) {
      setMessage('Debes escribir una razón al rechazar la clínica.')
      return
    }
    await postApi('/platform/clinicVerification/review', {
      clinicId,
      decision,
      reason,
    })
    setMessage(`Clínica ${clinicId} ${decision === 'APPROVED' ? 'aprobada' : 'rechazada'}.`)
    await load()
  }

  const reviewDoctorApplication = async (doctorUid: string, decision: 'APPROVED' | 'REJECTED') => {
    const reason = (decisionReason[doctorUid] || '').trim()
    if (decision === 'REJECTED' && !reason) {
      setMessage('Debes escribir una razón al rechazar al doctor.')
      return
    }
    await postApi('/platform/doctors/applications/review', {
      doctorUid,
      decision,
      reason,
    })
    setMessage(`Solicitud de doctor ${decision === 'APPROVED' ? 'aprobada' : 'rechazada'}.`)
    await load()
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Panel Plataforma (Super Admin Medyko)</h1>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Buscar por nombre/email/uid/clinicId" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="button" onClick={load}>Actualizar</Button>
          <Button className="bg-slate-700 hover:bg-slate-800" type="button" onClick={exportBookingsCsv}>
            Exportar reservas CSV
          </Button>
        </div>
        {loading && <p className="mt-2 text-sm text-slate-500">Cargando...</p>}
        {data && (
          <div className="mt-2 grid gap-2 text-sm md:grid-cols-3">
            <p>Clínicas: <strong>{data.totals.clinics}</strong></p>
            <p>Doctores: <strong>{data.totals.doctors}</strong></p>
            <p>Reservas (muestra): <strong>{data.totals.bookings}</strong></p>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">Solicitudes de doctores</h2>
        <div className="mt-3 space-y-3">
          {doctorApplications.map((item) => {
            const missing: string[] = []
            if (!item.stripeVerified) missing.push('Stripe')
            if (!item.phoneVerified) missing.push('teléfono')
            if (!item.activeLicense) missing.push('colegiado activo')
            if (!item.degreeTitleUrl) missing.push('título')
            if (item.certificationCount <= 0) missing.push('certificaciones')
            const canApprove = item.status === 'PENDING_REVIEW' && missing.length === 0
            return (
              <div key={item.doctorUid} className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="font-semibold">Doctor UID: {item.doctorUid}</p>
                <p>Nombre: {item.fullName || '-'}</p>
                <p>Teléfono: {item.phone || '-'}</p>
                <p>Email: {item.email || '-'}</p>
                <p>Estado solicitud: {item.status}</p>
                <p>Solicitado: {fmt(item.submittedAt)} | Revisado: {fmt(item.reviewedAt)}</p>
                <p>Requisitos: Stripe {item.stripeVerified ? 'Sí' : 'No'} | Teléfono {item.phoneVerified ? 'Sí' : 'No'} | Colegiado activo {item.activeLicense ? 'Sí' : 'No'}</p>
                <p>Docs: Título {item.degreeTitleUrl ? 'Sí' : 'No'} | Certificaciones {item.certificationCount}</p>
                {!canApprove && item.status === 'PENDING_REVIEW' && <p className="text-amber-700">Falta para aprobar: {missing.join(', ') || '-'}</p>}
                {item.degreeTitleUrl && (
                  <a className="text-sky-700" href={item.degreeTitleUrl} target="_blank" rel="noreferrer">
                    Ver título
                  </a>
                )}
                {Array.isArray(item.certificationUrls) && item.certificationUrls.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {item.certificationUrls.map((url, idx) => (
                      <a key={url} className="block text-sky-700" href={url} target="_blank" rel="noreferrer">
                        Ver certificación {idx + 1}
                      </a>
                    ))}
                  </div>
                )}
                <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                  <Input
                    placeholder="Razón (obligatoria para rechazo)"
                    value={decisionReason[item.doctorUid] || ''}
                    onChange={(e) => setDecisionReason((prev) => ({ ...prev, [item.doctorUid]: e.target.value }))}
                  />
                  <Button type="button" disabled={!canApprove} onClick={() => reviewDoctorApplication(item.doctorUid, 'APPROVED')}>
                    Aprobar doctor
                  </Button>
                  <Button className="bg-slate-700 hover:bg-slate-800" type="button" onClick={() => reviewDoctorApplication(item.doctorUid, 'REJECTED')}>
                    Rechazar doctor
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Verificación de clínicas (servicios + identidad)</h2>
        <div className="mt-3 space-y-3">
          {verifications.map((item) => (
            <div key={item.clinicId} className="rounded-lg border border-slate-200 p-3 text-sm">
              {(() => {
                const missing: string[] = []
                if (!item.identityVerified) missing.push('identidad verificada')
                if (!item.utilityBillUrl) missing.push('recibo de servicios')
                const canApprove = missing.length === 0
                return (
                  <>
              <p className="font-semibold">Clínica: {item.clinicId}</p>
              <p>Owner UID: {item.ownerUid}</p>
              <p>Email: {item.ownerEmail || '-'}</p>
              <p>Teléfono: {item.ownerPhone || '-'}</p>
              <p>Estado: {item.status}</p>
              <p>Solicitado: {fmt(item.submittedAt)} | Revisado: {fmt(item.reviewedAt)}</p>
              <p>Identidad verificada: {item.identityVerified ? 'Sí' : 'No'}</p>
              <p>Recibo cargado: {item.utilityBillUrl ? 'Sí' : 'No'}</p>
              {!canApprove && (
                <p className="text-amber-700">Falta para aprobar: {missing.join(' + ')}</p>
              )}
              {item.utilityBillUrl && (
                <a className="text-sky-700" href={item.utilityBillUrl} target="_blank" rel="noreferrer">
                  Ver recibo de servicio
                </a>
              )}
              <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                <Input
                  placeholder="Razón (obligatoria para rechazo)"
                  value={decisionReason[item.clinicId] || ''}
                  onChange={(e) => setDecisionReason((prev) => ({ ...prev, [item.clinicId]: e.target.value }))}
                />
                <Button type="button" disabled={!canApprove} onClick={() => reviewClinic(item.clinicId, 'APPROVED')}>
                  Aprobar
                </Button>
                <Button className="bg-slate-700 hover:bg-slate-800" type="button" onClick={() => reviewClinic(item.clinicId, 'REJECTED')}>
                  Rechazar
                </Button>
              </div>
                  </>
                )
              })()}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Contactos de clínicas</h2>
        <div className="mt-3 space-y-2">
          {filteredClinicContacts.map((item) => (
            <div key={item.uid} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold">UID: {item.uid}</p>
              <p>Clinic ID: {item.clinicId || '-'}</p>
              <p>Nombre: {item.name || '-'}</p>
              <p>Email: {item.email || '-'}</p>
              <p>Teléfono: {item.phone || '-'}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Contactos de doctores</h2>
        <div className="mt-3 space-y-2">
          {filteredDoctorContacts.map((item) => (
            <div key={item.uid} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold">UID: {item.uid}</p>
              <p>Nombre: {item.name || '-'}</p>
              <p>Email: {item.email || '-'}</p>
              <p>Teléfono: {item.phone || '-'}</p>
              <p>Verificado: {item.verified ? 'Sí' : 'No'}</p>
              <p>Datos Stripe: Nombre {item.hasFullName ? 'Sí' : 'No'} | DOB {item.hasDateOfBirth ? 'Sí' : 'No'} | DPI {item.hasIdNumber ? 'Sí' : 'No'}</p>
              <p>DPI último 4: {item.idNumberLast4 || '-'}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Historial de reservas</h2>
        <div className="mt-3 space-y-2">
          {filteredBookings.map((item) => (
            <div key={item.bookingId} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold">{item.bookingId}</p>
              <p>Clínica: {item.clinicId || '-'} | Doctor: {item.doctorId || '-'}</p>
              <p>Listing: {item.listingType || '-'} / {item.listingId || '-'}</p>
              <p>Inicio: {fmt(item.startDateTime)} | Fin: {fmt(item.endDateTime)}</p>
              <p>Estado: {item.status || '-'} | Pago: {item.paymentStatus || '-'}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Citas de pacientes (consentimiento)</h2>
        <div className="mt-3 space-y-2">
          {filteredPatientAppointments.map((item) => (
            <div key={item.appointmentId} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold">{item.appointmentId}</p>
              <p>Doctor: {item.doctorId || '-'}</p>
              <p>Paciente: {item.patientName || '-'}</p>
              <p>Inicio: {fmt(item.startDateTime)} | Fin: {fmt(item.endDateTime)}</p>
              <p>Estado: {item.status || '-'}</p>
              <p>Consentimiento: {item.consentAccepted ? 'Sí' : 'No'} | Fecha: {fmt(item.consentAt)}</p>
              <p>Versión política: {item.consentPolicyVersion || '-'}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Emergencias (consentimiento)</h2>
        <div className="mt-3 space-y-2">
          {filteredEmergencies.map((item) => (
            <div key={item.emergencyId} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold">{item.emergencyId}</p>
              <p>Doctor UID: {item.doctorUid || '-'}</p>
              <p>Creada: {fmt(item.createdAt)}</p>
              <p>Estado: {item.status || '-'} | WhatsApp enviado: {item.whatsappSent ? 'Sí' : 'No'}</p>
              <p>Consentimiento: {item.consentAccepted ? 'Sí' : 'No'} | Fecha: {fmt(item.consentAt)}</p>
              <p>Versión política: {item.consentPolicyVersion || '-'}</p>
            </div>
          ))}
        </div>
      </Card>

      {message && <p className="text-sm text-red-600">{message}</p>}
    </div>
  )
}
