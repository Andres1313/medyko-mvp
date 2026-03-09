import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { auth } from '../../lib/firebase'
import { postApi } from '../../lib/api'

const authSchema = z.object({
  email: z.string().email('Correo inválido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
})

type AuthForm = z.infer<typeof authSchema>

export function AuthPage() {
  const { loginWithEmail, registerWithEmail, loginWithGoogle, refreshClaims } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [serverError, setServerError] = useState('')

  const {
    register: field,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AuthForm>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: '', password: '' },
  })

  const redirectByRole = (role: string | undefined) => {
    if (role === 'platform_admin') {
      navigate('/platform')
      return
    }
    navigate('/doctor/onboarding')
  }

  const roleFromToken = async () => {
    const token = await auth.currentUser?.getIdTokenResult(true)
    return token?.claims.role as string | undefined
  }

  const ensureDoctorRoleForNewAccount = async (isNewUser: boolean, currentRole: string | undefined) => {
    if (!isNewUser && currentRole) return currentRole
    await postApi('/auth/selectRole', { role: 'doctor' })
    await refreshClaims()
    return roleFromToken()
  }

  const onSubmit = handleSubmit(async (data) => {
    setServerError('')
    try {
      const email = data.email.trim().toLowerCase()
      const password = data.password

      let isNewUser = false
      if (mode === 'register') {
        const result = await registerWithEmail(email, password)
        isNewUser = result.isNewUser
      } else {
        await loginWithEmail(email, password)
      }

      await refreshClaims()
      const currentRole = await roleFromToken()
      const finalRole = await ensureDoctorRoleForNewAccount(isNewUser, currentRole)
      redirectByRole(finalRole || 'doctor')
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'No se pudo iniciar sesión')
    }
  })

  const onGoogleLogin = async () => {
    setServerError('')
    try {
      const result = await loginWithGoogle()
      await refreshClaims()
      const currentRole = await roleFromToken()
      const finalRole = await ensureDoctorRoleForNewAccount(result.isNewUser, currentRole)
      redirectByRole(finalRole || 'doctor')
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'No se pudo iniciar sesión con Google')
    }
  }

  return (
    <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6">
      <h1 className="text-2xl font-bold">Acceso Doctor Medyko</h1>
      <p className="text-sm text-slate-500">Ingresa con correo y contraseña o con Google.</p>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
        <Button
          className={mode === 'login' ? 'bg-white !text-slate-900 hover:bg-white' : 'bg-transparent !text-slate-700 hover:bg-white hover:!text-slate-900'}
          type="button"
          onClick={() => setMode('login')}
        >
          Iniciar sesión
        </Button>
        <Button
          className={mode === 'register' ? 'bg-white !text-slate-900 hover:bg-white' : 'bg-transparent !text-slate-700 hover:bg-white hover:!text-slate-900'}
          type="button"
          onClick={() => setMode('register')}
        >
          Crear cuenta
        </Button>
      </div>

      <form className="mt-4 space-y-3" onSubmit={onSubmit}>
        <Input {...field('email')} placeholder="Correo" type="email" />
        {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}

        <Input {...field('password')} placeholder="Contraseña" type="password" />
        {errors.password && <p className="text-xs text-red-600">{errors.password.message}</p>}

        <Button disabled={isSubmitting} type="submit">
          {mode === 'register' ? 'Crear cuenta' : 'Entrar'}
        </Button>
      </form>

      <div className="mt-4 border-t border-slate-200 pt-4">
        <Button className="w-full bg-slate-700 hover:bg-slate-800" type="button" onClick={onGoogleLogin}>
          Continuar con Google
        </Button>
      </div>

      {serverError && <p className="mt-3 text-xs text-red-600">{serverError}</p>}
    </div>
  )
}
