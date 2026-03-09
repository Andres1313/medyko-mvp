import { Timestamp } from 'firebase-admin/firestore'
import { db } from './firebase'

export async function hasBookingConflict(params: {
  clinicId: string
  listingId: string
  startDateTime: string
  endDateTime: string
}) {
  const start = Timestamp.fromDate(new Date(params.startDateTime))
  const end = Timestamp.fromDate(new Date(params.endDateTime))

  const snapshot = await db
    .collection(`clinics/${params.clinicId}/bookings`)
    .where('listingId', '==', params.listingId)
    .where('startDateTime', '<', end)
    .where('endDateTime', '>', start)
    .where('status', 'in', ['PENDING', 'CONFIRMED'])
    .limit(1)
    .get()

  return !snapshot.empty
}
