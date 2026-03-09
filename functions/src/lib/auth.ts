import { Request } from 'express'
import { adminAuth } from './firebase'

export interface Claims {
  uid: string
  role?: 'doctor' | 'clinic_admin' | 'platform_admin'
  clinicId?: string
  doctorVerified?: boolean
}

export async function getClaims(req: Request): Promise<Claims> {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    throw new Error('UNAUTHENTICATED')
  }
  const token = header.replace('Bearer ', '')
  const decoded = await adminAuth.verifyIdToken(token)
  return {
    uid: decoded.uid,
    role: decoded.role as Claims['role'],
    clinicId: decoded.clinicId as string | undefined,
    doctorVerified: Boolean(decoded.doctorVerified),
  }
}

export function requireRole(claims: Claims, allowed: Claims['role'][]) {
  if (!claims.role || !allowed.includes(claims.role)) {
    throw new Error('FORBIDDEN')
  }
}
