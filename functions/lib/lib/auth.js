"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClaims = getClaims;
exports.requireRole = requireRole;
const firebase_1 = require("./firebase");
async function getClaims(req) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        throw new Error('UNAUTHENTICATED');
    }
    const token = header.replace('Bearer ', '');
    const decoded = await firebase_1.adminAuth.verifyIdToken(token);
    return {
        uid: decoded.uid,
        role: decoded.role,
        clinicId: decoded.clinicId,
        doctorVerified: Boolean(decoded.doctorVerified),
    };
}
function requireRole(claims, allowed) {
    if (!claims.role || !allowed.includes(claims.role)) {
        throw new Error('FORBIDDEN');
    }
}
