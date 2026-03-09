import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  RecaptchaVerifier,
  PhoneAuthProvider,
  linkWithCredential,
  updatePhoneNumber,
  getAdditionalUserInfo,
} from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import type { AuthClaims, UserRole } from '../../types/domain'

interface AuthContextValue {
  user: User | null
  loading: boolean
  claims: AuthClaims
  role: UserRole | null
  loginWithEmail: (email: string, password: string) => Promise<void>
  registerWithEmail: (email: string, password: string) => Promise<{ isNewUser: boolean }>
  loginWithGoogle: () => Promise<{ isNewUser: boolean }>
  sendPhoneVerificationCode: (phoneE164: string, recaptchaContainerId: string) => Promise<void>
  confirmPhoneVerificationCode: (code: string) => Promise<void>
  logout: () => Promise<void>
  refreshClaims: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const recaptchaVerifiers = new Map<string, RecaptchaVerifier>()
let pendingPhoneVerificationId: string | null = null

function getRecaptchaVerifier(containerId: string) {
  const current = recaptchaVerifiers.get(containerId)
  if (current) return current
  const verifier = new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
  })
  recaptchaVerifiers.set(containerId, verifier)
  return verifier
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [claims, setClaims] = useState<AuthClaims>({})

  async function refreshClaims() {
    if (!auth.currentUser) {
      setClaims({})
      return
    }
    const token = await auth.currentUser.getIdTokenResult(true)
    setClaims({
      role: token.claims.role as UserRole | undefined,
      clinicId: token.claims.clinicId as string | undefined,
      doctorVerified: Boolean(token.claims.doctorVerified),
    })
  }

  useEffect(() => {
    return onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser)
      if (nextUser) {
        await refreshClaims()
      } else {
        setClaims({})
      }
      setLoading(false)
    })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      claims,
      role: claims.role ?? null,
      loginWithEmail: async (email, password) => {
        await signInWithEmailAndPassword(auth, email, password)
        await refreshClaims()
      },
      registerWithEmail: async (email, password) => {
        const result = await createUserWithEmailAndPassword(auth, email, password)
        await refreshClaims()
        return { isNewUser: Boolean(getAdditionalUserInfo(result)?.isNewUser) }
      },
      loginWithGoogle: async () => {
        const provider = new GoogleAuthProvider()
        const result = await signInWithPopup(auth, provider)
        await refreshClaims()
        return { isNewUser: Boolean(getAdditionalUserInfo(result)?.isNewUser) }
      },
      sendPhoneVerificationCode: async (phoneE164, recaptchaContainerId) => {
        const user = auth.currentUser
        if (!user) throw new Error('Sesión no iniciada')
        const verifier = getRecaptchaVerifier(recaptchaContainerId)
        const provider = new PhoneAuthProvider(auth)
        pendingPhoneVerificationId = await provider.verifyPhoneNumber(phoneE164, verifier)
      },
      confirmPhoneVerificationCode: async (code) => {
        const user = auth.currentUser
        if (!user) throw new Error('Sesión no iniciada')
        if (!pendingPhoneVerificationId) {
          throw new Error('Primero solicita el codigo por telefono')
        }
        const credential = PhoneAuthProvider.credential(pendingPhoneVerificationId, code)
        if (user.phoneNumber) {
          await updatePhoneNumber(user, credential)
        } else {
          await linkWithCredential(user, credential)
        }
        pendingPhoneVerificationId = null
        await refreshClaims()
      },
      logout: async () => {
        await signOut(auth)
      },
      refreshClaims,
    }),
    [user, loading, claims],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de AuthProvider')
  }
  return ctx
}
