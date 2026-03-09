import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Lock, PhoneCall, ShieldCheck, UserRoundCheck, CalendarClock } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { postApi } from '../../lib/api'

type OnboardingStep = {
  id: string
  title: string
  description: string
  done: boolean
  to: string
  icon: 'stripe' | 'phone' | 'profile' | 'schedule' | 'approval'
}

interface ProfileResponse {
  fullName?: string
  phone?: string
  licenseNumber?: string
  contactEmail?: string
  insuranceNetworks?: string
  activeLicense?: boolean
  degreeTitleUrl?: string
  certificationUrls?: string[]
}

interface AvailabilityResponse {
  weeklySchedule?: Record<string, Array<{ start: string; end: string }>>
}

interface VerifyResponse {
  verified: boolean
}

interface PhoneVerificationStatus {
  phone?: string
  verified: boolean
  status?: string
}

interface DoctorApplicationStatus {
  status: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
}

function StepIcon({ icon }: { icon: OnboardingStep['icon'] }) {
  if (icon === 'stripe') return <ShieldCheck className="h-5 w-5 text-sky-700" />
  if (icon === 'phone') return <PhoneCall className="h-5 w-5 text-sky-700" />
  if (icon === 'profile') return <UserRoundCheck className="h-5 w-5 text-sky-700" />
  if (icon === 'approval') return <CheckCircle2 className="h-5 w-5 text-sky-700" />
  return <CalendarClock className="h-5 w-5 text-sky-700" />
}

export function DoctorOnboardingPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [steps, setSteps] = useState<OnboardingStep[]>([])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [profile, availability, verifyDoctor, phoneVerification, application] = await Promise.all([
        postApi<ProfileResponse>('/doctors/profile/get', {}),
        postApi<AvailabilityResponse>('/availability/mine', {}),
        postApi<VerifyResponse>('/stripe/verification/status', { target: 'DOCTOR' }),
        postApi<PhoneVerificationStatus>('/doctors/phoneVerification/status', {}),
        postApi<DoctorApplicationStatus>('/doctors/application/status', {}),
      ])

      const hasSchedule = Object.values(availability.weeklySchedule || {}).some((ranges) => (ranges || []).length > 0)
      const hasProfessionalPack = Boolean(
        (profile.fullName || '').trim() &&
          (profile.phone || '').trim() &&
          (profile.licenseNumber || '').trim() &&
          (profile.insuranceNetworks || '').trim() &&
          profile.activeLicense &&
          (profile.degreeTitleUrl || '').trim() &&
          (profile.certificationUrls || []).length > 0,
      )

      const nextSteps: OnboardingStep[] = [
        {
          id: 'doctor_verify',
          title: 'Verifica identidad con Stripe',
          description: 'Paso obligatorio para validar al doctor.',
          done: verifyDoctor.verified,
          to: '/doctor/verify',
          icon: 'stripe',
        },
        {
          id: 'phone_verify',
          title: 'Verifica tu teléfono',
          description: 'Confirma tu teléfono con código OTP dentro del perfil.',
          done: Boolean(phoneVerification.verified),
          to: '/doctor/profile',
          icon: 'phone',
        },
        {
          id: 'doctor_profile',
          title: 'Completa expediente profesional',
          description: 'CV, colegiado activo, seguros, titulo y certificaciones.',
          done: hasProfessionalPack,
          to: '/doctor/profile',
          icon: 'profile',
        },
        {
          id: 'doctor_schedule',
          title: 'Configura tu horario',
          description: 'Define tus slots disponibles para citas y reservas.',
          done: hasSchedule,
          to: '/doctor/profile',
          icon: 'schedule',
        },
        {
          id: 'doctor_admin_approval',
          title: 'Aprobacion de plataforma',
          description: 'Envia solicitud y espera aprobacion de admin.',
          done: application.status === 'APPROVED',
          to: '/doctor/profile',
          icon: 'approval',
        },
      ]

      setSteps(nextSteps)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar onboarding')
      setSteps([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const enhancedSteps = useMemo(() => {
    return steps.map((step, index) => {
      const unlocked = index === 0 ? true : steps.slice(0, index).every((p) => p.done)
      return { ...step, unlocked }
    })
  }, [steps])

  const doneCount = useMemo(() => enhancedSteps.filter((s) => s.done).length, [enhancedSteps])
  const progress = enhancedSteps.length > 0 ? Math.round((doneCount / enhancedSteps.length) * 100) : 0
  const nextStep = useMemo(() => enhancedSteps.find((s) => s.unlocked && !s.done) || null, [enhancedSteps])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Onboarding doctor</h1>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">
            Completado: <strong>{doneCount}/{enhancedSteps.length}</strong>
          </p>
          {nextStep ? (
            <Link to={nextStep.to}>
              <Button>
                Continuar
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          ) : (
            <span className="text-sm font-semibold text-emerald-700">Onboarding completo</span>
          )}
        </div>
        <div className="mt-3 h-2 w-full rounded-full bg-slate-200">
          <div className="h-2 rounded-full bg-sky-600" style={{ width: `${progress}%` }} />
        </div>
      </Card>

      {loading && <p className="text-sm text-slate-500">Cargando onboarding...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && (
        <div className="space-y-3">
          {enhancedSteps.map((step, idx) => (
            <Card key={step.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="mt-1">
                    {step.done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : step.unlocked ? <StepIcon icon={step.icon} /> : <Lock className="h-5 w-5 text-slate-400" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Paso {idx + 1}: {step.title}
                    </p>
                    <p className="text-sm text-slate-600">{step.description}</p>
                    <p className={`mt-1 text-xs font-semibold ${step.done ? 'text-emerald-700' : step.unlocked ? 'text-amber-700' : 'text-slate-500'}`}>
                      {step.done ? 'Completo' : step.unlocked ? 'Pendiente' : 'Bloqueado'}
                    </p>
                  </div>
                </div>
                {step.unlocked ? (
                  <Link className="text-sm font-semibold text-sky-700" to={step.to}>
                    Ir al paso
                  </Link>
                ) : (
                  <span className="text-xs text-slate-400">Completa pasos previos</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
