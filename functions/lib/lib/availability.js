"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasBookingConflict = hasBookingConflict;
const firestore_1 = require("firebase-admin/firestore");
const firebase_1 = require("./firebase");
async function hasBookingConflict(params) {
    const start = firestore_1.Timestamp.fromDate(new Date(params.startDateTime));
    const end = firestore_1.Timestamp.fromDate(new Date(params.endDateTime));
    const snapshot = await firebase_1.db
        .collection(`clinics/${params.clinicId}/bookings`)
        .where('listingId', '==', params.listingId)
        .where('startDateTime', '<', end)
        .where('endDateTime', '>', start)
        .where('status', 'in', ['PENDING', 'CONFIRMED'])
        .limit(1)
        .get();
    return !snapshot.empty;
}
