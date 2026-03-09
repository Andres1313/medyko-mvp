import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../../components/ui/button'
import { postApi } from '../../lib/api'

type VerifyStatusResponse = {
  verified: boolean
  status?: string
  failedAttempts?: number
  identitySaved?: {
    hasFullName?: boolean
    hasDateOfBirth?: boolean
    hasIdNumber?: boolean
    idNumberLast4?: string | null
  }
}

export function DoctorVerifyPage() {
  const { refreshClaims } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [verified, setVerified] = useState(false)
  const [loading, setLoading] = useState(false)

  const checkStatus = async () => {
    setLoading(true)
    try {
      const result = await postApi<VerifyStatusResponse>('/stripe/verification/status', { target: 'DOCTOR' })
      setVerified(Boolean(result.verified))
      if (result.verified) {
        const id = result.identitySaved || {}
        setStatus(
          `Doctor verificado correctamente. Datos guardados: nombre=${id.hasFullName ? 'sí' : 'no'}, DOB=${id.hasDateOfBirth ? 'sí' : 'no'}, DPI=${id.hasIdNumber ? 'sí' : 'no'}.`,
        )
      } else if ((result.failedAttempts || 0) >= 3) {
        setStatus('Verificación bloqueada por múltiples intentos fallidos. Contacta soporte.')
      } else {
        setStatus('Verificación pendiente. Esta pantalla se actualiza cada 5 segundos.')
      }
      await refreshClaims()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo consultar estado de verificacion.'
      setStatus(message)
    } finally {
      setLoading(false)
    }
  }

  const startVerification = async () => {
    const returnUrl = `${window.location.origin}/doctor/verify`
    const resp = await postApi<{ url?: string; sessionId?: string | null }>('/stripe/verification/start', { returnUrl, target: 'DOCTOR' })
    if (resp.sessionId) {
      sessionStorage.setItem('stripeSessionId', resp.sessionId)
    }
    if (!resp.url) {
      throw new Error('No se recibió URL de Stripe para verificación')
    }
    window.location.href = resp.url
  }

  useEffect(() => {
    void checkStatus()
    if (verified) return
    const timer = window.setInterval(() => {
      void checkStatus()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [verified])

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Verificación de doctor</h1>
      <p className="text-sm text-slate-600">Debes verificar identidad para pagar y confirmar reservas.</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={startVerification}>Verificar identidad</Button>
        <Button className="bg-slate-900 hover:bg-slate-700" disabled={loading} onClick={checkStatus}>
          Consultar estado
        </Button>
        {verified ? (
          <Button className="bg-emerald-700 hover:bg-emerald-800" onClick={() => navigate('/doctor/onboarding')}>
            Continuar
          </Button>
        ) : (
          <Button className="bg-slate-700 hover:bg-slate-800" onClick={startVerification}>
            Intentar otra vez
          </Button>
        )}
      </div>
      {status && <p className="text-sm text-slate-700">{status}</p>}
    </div>
  )
}
