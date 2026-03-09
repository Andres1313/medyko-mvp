import type { PriceBreakdown } from '../types/domain'

export function calculatePriceBreakdown(baseRent: number): PriceBreakdown {
  const platformFee = Number((baseRent * 0.1).toFixed(2))
  const processingFee = Number((baseRent * 0.045 + 2).toFixed(2))
  const total = Number((baseRent + platformFee + processingFee).toFixed(2))

  return {
    baseRent,
    platformFee,
    processingFee,
    total,
  }
}

