import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { postApi } from '../../lib/api'

interface AccessRequestItem {
  doctorId: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
}

interface VerificationStatus {
  status?: 'PENDING_DOCUMENTS' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
  reason?: string
  ownerResponseComment?: string
  utilityBill?: { fileName?: string; url?: string }
}

async function toBase64(file: File) {
  const buffer = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export function ClinicDashboardPage() {
  const [requests, setRequests] = useState<AccessRequestItem[]>([])
  const [verification, setVerification] = useState<VerificationStatus | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [responseComment, setResponseComment] = useState('')

  const loadRequests = async () => {
    setLoading(true)
    try {
      const [result, verificationResult] = await Promise.all([
        postApi<{ requests: AccessRequestItem[] }>('/clinics/doctorAccess/list', {}),
        postApi<VerificationStatus>('/clinicVerification/status', {}),
      ])
      setRequests(result.requests || [])
      setVerification(verificationResult)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRequests().catch(() => {
      setRequests([])
      setVerification(null)
    })
  }, [])

  const updateRequest = async (doctorId: string, status: 'APPROVED' | 'REJECTED') => {
    await postApi('/clinics/doctorAccess/update', { doctorId, status })
    await loadRequests()
  }

  const uploadUtilityBill = async () => {
    setMessage('')
    if (!file) {
      setMessage('Selecciona un archivo primero.')
      return
    }
    if (file.size > 6 * 1024 * 1024) {
      setMessage('Archivo muy grande. Máximo 6MB.')
      return
    }

    const base64Data = await toBase64(file)
    await postApi('/clinicVerification/uploadUtilityBill', {
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      base64Data,
    })

    setMessage('Recibo enviado. Queda pendiente de revisión por plataforma.')
    setFile(null)
    await loadRequests()
  }

  const sendReviewResponse = async () => {
    setMessage('')
    if (!responseComment.trim()) {
      setMessage('Escribe un comentario para plataforma.')
      return
    }
    await postApi('/clinicVerification/respondReview', {
      comment: responseComment.trim(),
    })
    setMessage('Comentario enviado. Plataforma volverá a revisar tu caso.')
    setResponseComment('')
    await loadRequests()
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Panel de Mi Clínica</h1>
      <Card>Desde tu cuenta Doctor puedes gestionar tu clínica, publicar espacios y aprobar doctores.</Card>

      <Card>
        <h2 className="font-semibold">Verificación de clínica para publicar</h2>
        <p className="mt-1 text-sm text-slate-600">Debes subir recibo de luz/agua/teléfono. Plataforma revisa y aprueba/rechaza.</p>
        <div className="mt-2 text-sm">
          <p>Estado actual: <strong>{verification?.status || 'PENDING_DOCUMENTS'}</strong></p>
          {verification?.reason && <p className="text-red-600">Motivo: {verification.reason}</p>}
          {verification?.ownerResponseComment && <p className="text-slate-600">Tu último comentario: {verification.ownerResponseComment}</p>}
          {verification?.utilityBill?.url && (
            <a className="text-sky-700" href={verification.utilityBill.url} target="_blank" rel="noreferrer">
              Ver último recibo cargado ({verification.utilityBill.fileName || 'archivo'})
            </a>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <Button type="button" onClick={uploadUtilityBill}>Subir recibo</Button>
        </div>
        {verification?.status === 'REJECTED' && (
          <div className="mt-3 space-y-2">
            <Input placeholder="Comentario para plataforma (causa, aclaración, etc.)" value={responseComment} onChange={(e) => setResponseComment(e.target.value)} />
            <Button className="bg-slate-700 hover:bg-slate-800" type="button" onClick={sendReviewResponse}>
              Enviar comentario y solicitar revisión
            </Button>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">Aprobación de doctores (lista de espera)</h2>
        {loading && <p className="mt-2 text-sm text-slate-500">Cargando solicitudes...</p>}
        {!loading && requests.length === 0 && <p className="mt-2 text-sm text-slate-500">No hay solicitudes por ahora.</p>}
        <div className="mt-3 space-y-2">
          {requests.map((item) => (
            <div key={item.doctorId} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
              <div>
                <p className="text-sm font-medium">Doctor UID: {item.doctorId}</p>
                <p className="text-xs text-slate-500">Estado: {item.status}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={() => updateRequest(item.doctorId, 'APPROVED')}>
                  Aprobar
                </Button>
                <Button className="bg-slate-700 hover:bg-slate-800" type="button" onClick={() => updateRequest(item.doctorId, 'REJECTED')}>
                  Rechazar
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-wrap gap-4 text-sm font-semibold text-sky-700">
        <Link to="/clinic/verify">Verificar identidad de clínica</Link>
        <Link to="/clinic/listings/new">Crear nuevo listado</Link>
        <Link to="/clinic/bookings">Gestión de reservas</Link>
      </div>

      {message && <p className="text-sm text-sky-700">{message}</p>}
    </div>
  )
}
