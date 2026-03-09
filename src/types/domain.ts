export type UserRole = 'doctor' | 'clinic_admin' | 'platform_admin'

export interface AuthClaims {
  role?: UserRole
  clinicId?: string
  doctorVerified?: boolean
}

export interface BaseListing {
  id: string
  clinicId: string
  ownerId: string
  title: string
  description: string
  type: 'CLINIC' | 'OR'
  status: 'DRAFT' | 'PUBLISHED' | 'SUSPENDED'
  location: {
    address: string
    city: 'Guatemala'
    zone: number
    lat?: number
    lng?: number
  }
  pricing: {
    hourly: number | null
    daily: number | null
    currency: 'GTQ'
  }
  tags: {
    equipmentTags: string[]
    amenitiesTags: string[]
  }
  nursingAvailable?: boolean
}

export interface PriceBreakdown {
  baseRent: number
  platformFee: number
  processingFee: number
  total: number
}
