import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { postApi } from '../../lib/api'

export function ClinicVerifyPage() {
  const [status, setStatus] = useState('')

  const checkStatus = async () => {
    const result = await postApi<{ verified: boolean; status?: string; failedAttempts?: number }>('/stripe/verification/status', { target: 'OWNER' })
    if (result.verified) {
      setStatus('Identidad de clínica verificada correctamente.')
    } else if ((result.failedAttempts || 0) >= 3) {
      setStatus('Verificación bloqueada por múltiples intentos fallidos. Contacta soporte.')
    } else {
      setStatus('Verificación aún pendiente.')
    }
  }

  const startVerification = async () => {
    const returnUrl = `${window.location.origin}/clinic/verify`
    const resp = await postApi<{ url?: string; sessionId?: string | null }>('/stripe/verification/start', { returnUrl, target: 'OWNER' })
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
  }, [])

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Verificación de clínica</h1>
      <p className="text-sm text-slate-600">Debes verificar identidad para que plataforma pueda aprobar tu clínica.</p>
      <div className="flex gap-2">
        <Button onClick={startVerification}>Verificar identidad</Button>
        <Button className="bg-slate-900 hover:bg-slate-700" onClick={checkStatus}>
          Consultar estado
        </Button>
      </div>
      {status && <p className="text-sm text-slate-700">{status}</p>}
    </div>
  )
}
