"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.purgeOldAppointmentSensitiveData = exports.syncORListings = exports.syncClinicListings = exports.stripeVerificationWebhook = exports.recurrenteWebhook = exports.api = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const algoliasearch_1 = __importDefault(require("algoliasearch"));
const stripe_1 = __importDefault(require("stripe"));
const firestore_1 = require("firebase-admin/firestore");
const firebase_1 = require("./lib/firebase");
const auth_1 = require("./lib/auth");
const crypto_2 = require("./lib/crypto");
const availability_1 = require("./lib/availability");
const payments_1 = require("./lib/payments");
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: true }));
app.use(express_1.default.json());
const recurrenteWebhookApp = (0, express_1.default)();
recurrenteWebhookApp.use(express_1.default.json());
const stripeWebhookApp = (0, express_1.default)();
stripeWebhookApp.use(express_1.default.raw({ type: 'application/json' }));
function cleanError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return 'unknown error';
}
function maskEmail(email) {
    const value = String(email || '').trim();
    if (!value.includes('@'))
        return value ? '***' : '';
    const [local, domain] = value.split('@');
    const safeLocal = local.length <= 2 ? `${local[0] || '*'}*` : `${local.slice(0, 2)}***`;
    return `${safeLocal}@${domain}`;
}
function extractClientIp(req) {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '');
    const firstForwarded = forwardedFor.split(',')[0]?.trim() || '';
    const raw = firstForwarded || req.ip || '';
    return String(raw || '').trim();
}
function hashConsentIp(ip) {
    const source = String(ip || '').trim();
    if (!source)
        return '';
    const salt = process.env.CONSENT_IP_SALT || 'medyko-consent-ip';
    return crypto_1.default.createHash('sha256').update(`${source}:${salt}`).digest('hex');
}
function isStripeRestrictedIdentityError(error) {
    const msg = cleanError(error).toLowerCase();
    return (msg.includes('to access sensitive verification results') ||
        msg.includes('verificationflow') ||
        msg.includes('rate-limit exceeded') ||
        (msg.includes('sensitive pii') && msg.includes('rate-limit')));
}
function getStripeClient() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
        throw new Error('STRIPE_SECRET_KEY missing');
    }
    return new stripe_1.default(secretKey);
}
function getStripeIdentityClient() {
    const identityKey = process.env.STRIPE_IDENTITY_KEY;
    if (identityKey) {
        return new stripe_1.default(identityKey);
    }
    return getStripeClient();
}
async function sendEmail(params) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        console.warn('sendEmail skipped: RESEND_API_KEY missing');
        return;
    }
    if (!params.to) {
        console.warn('sendEmail skipped: destination email missing', { subject: params.subject });
        return;
    }
    const from = process.env.RESEND_FROM_EMAIL || 'no-reply@medyko.gt';
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: [params.to],
            subject: params.subject,
            text: params.text,
            html: params.html || `<p>${params.text}</p>`,
        }),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Resend error ${response.status}: ${detail}`);
    }
    console.log('sendEmail ok', { to: maskEmail(String(params.to || '')), subject: params.subject });
}
async function getUserEmail(uid) {
    const user = await firebase_1.adminAuth.getUser(uid).catch(() => null);
    return user?.email || null;
}
function normalizeE164Phone(value) {
    const raw = String(value || '').trim();
    if (!raw)
        return '';
    if (raw.startsWith('+'))
        return raw.replace(/[^\d+]/g, '');
    const digits = raw.replace(/\D/g, '');
    if (!digits)
        return '';
    if (digits.length === 8)
        return `+502${digits}`;
    return `+${digits}`;
}
function hashManageToken(appointmentId, token) {
    return crypto_1.default.createHash('sha256').update(`${appointmentId}:${token}`).digest('hex');
}
function hashEmergencyAccessToken(emergencyId, token) {
    return crypto_1.default.createHash('sha256').update(`emergency:${emergencyId}:${token}`).digest('hex');
}
function buildAppointmentManageLink(appointmentId, token) {
    const base = (process.env.FRONTEND_APP_URL || 'http://localhost:5173').replace(/\/$/, '').replace(/\/citas$/i, '');
    return `${base}/appointment/manage/${appointmentId}?token=${encodeURIComponent(token)}`;
}
async function upsertPublicAppointmentLookup(doctorUid, appointmentId) {
    await firebase_1.db.doc(`appointment_public_lookup/${appointmentId}`).set({
        appointmentId,
        doctorId: doctorUid,
        appointmentPath: `users/${doctorUid}/patient_appointments/${appointmentId}`,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
}
async function upsertPublicEmergencyLookup(doctorUid, emergencyId) {
    await firebase_1.db.doc(`emergency_public_lookup/${emergencyId}`).set({
        emergencyId,
        doctorUid,
        emergencyPath: `doctors/${doctorUid}/emergencies/${emergencyId}`,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
}
async function findPatientAppointmentById(appointmentId) {
    const lookupRef = firebase_1.db.doc(`appointment_public_lookup/${appointmentId}`);
    const lookupSnap = await lookupRef.get().catch(() => null);
    const lookupData = lookupSnap?.exists ? (lookupSnap.data() || {}) : null;
    const lookupDoctorId = String(lookupData?.doctorId || '').trim();
    if (lookupDoctorId) {
        const ref = firebase_1.db.doc(`users/${lookupDoctorId}/patient_appointments/${appointmentId}`);
        const snap = await ref.get().catch(() => null);
        if (snap?.exists) {
            return { ref, snap, doctorId: lookupDoctorId };
        }
    }
    const usersSnap = await firebase_1.db.collection('users').select().get();
    const userIds = usersSnap.docs.map((d) => d.id);
    const batchSize = 25;
    for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize);
        const snaps = await Promise.all(batch.map((uid) => firebase_1.db.doc(`users/${uid}/patient_appointments/${appointmentId}`).get().catch(() => null)));
        for (let j = 0; j < snaps.length; j += 1) {
            const snap = snaps[j];
            if (snap?.exists) {
                const doctorId = batch[j];
                await upsertPublicAppointmentLookup(doctorId, appointmentId).catch(() => null);
                return { ref: snap.ref, snap, doctorId };
            }
        }
    }
    return null;
}
async function findEmergencyById(emergencyId) {
    const lookupRef = firebase_1.db.doc(`emergency_public_lookup/${emergencyId}`);
    const lookupSnap = await lookupRef.get().catch(() => null);
    const lookupData = lookupSnap?.exists ? (lookupSnap.data() || {}) : null;
    const lookupDoctorUid = String(lookupData?.doctorUid || '').trim();
    if (lookupDoctorUid) {
        const ref = firebase_1.db.doc(`doctors/${lookupDoctorUid}/emergencies/${emergencyId}`);
        const snap = await ref.get().catch(() => null);
        if (snap?.exists) {
            return { ref, snap, doctorUid: lookupDoctorUid };
        }
    }
    const usersSnap = await firebase_1.db.collection('users').select().get();
    const doctorIds = usersSnap.docs
        .filter((d) => String((d.data() || {}).role || '') === 'doctor')
        .map((d) => d.id);
    const batchSize = 25;
    for (let i = 0; i < doctorIds.length; i += batchSize) {
        const batch = doctorIds.slice(i, i + batchSize);
        const snaps = await Promise.all(batch.map((uid) => firebase_1.db.doc(`doctors/${uid}/emergencies/${emergencyId}`).get().catch(() => null)));
        for (let j = 0; j < snaps.length; j += 1) {
            const snap = snaps[j];
            if (snap?.exists) {
                const doctorUid = batch[j];
                await upsertPublicEmergencyLookup(doctorUid, emergencyId).catch(() => null);
                return { ref: snap.ref, snap, doctorUid };
            }
        }
    }
    return null;
}
function hashPhoneVerify(doctorUid, phoneE164, code) {
    const salt = process.env.PHONE_VERIFY_SALT || 'medyko-phone-verify';
    return crypto_1.default.createHash('sha256').update(`${doctorUid}:${phoneE164}:${code}:${salt}`).digest('hex');
}
function createPhoneVerificationToken(verificationId) {
    const raw = crypto_1.default.randomUUID().replace(/-/g, '');
    return `${verificationId}.${raw}`;
}
function hashGenericToken(token) {
    return crypto_1.default.createHash('sha256').update(token).digest('hex');
}
function hashDoctorPhoneLookup(phoneE164) {
    const salt = process.env.DOCTOR_PHONE_LOOKUP_SALT || 'medyko-doctor-phone-lookup';
    return crypto_1.default.createHash('sha256').update(`${phoneE164}:${salt}`).digest('hex');
}
async function resolveDoctorUidByPhone(phoneE164) {
    const normalized = normalizeE164Phone(phoneE164);
    if (!normalized)
        return null;
    const phoneHash = hashDoctorPhoneLookup(normalized);
    const snap = await firebase_1.db
        .collectionGroup('public')
        .where('phoneLookupHash', '==', phoneHash)
        .limit(1)
        .get();
    if (snap.empty)
        return null;
    const doc = snap.docs[0];
    const doctorUid = String(doc.data().uid || '').trim();
    if (!doctorUid)
        return null;
    return doctorUid;
}
function senderQueueKey(sender) {
    return crypto_1.default.createHash('sha256').update(sender).digest('hex').slice(0, 32);
}
function parseWhatsAppTimestampMs(rawTs) {
    const num = Number(String(rawTs || '').trim());
    if (!Number.isFinite(num) || num <= 0)
        return Date.now();
    // WhatsApp usually sends unix seconds in string form.
    if (num < 1000000000000)
        return Math.floor(num * 1000);
    return Math.floor(num);
}
async function enqueueInboundMessage(payload) {
    const key = senderQueueKey(payload.sender);
    const queueRef = firebase_1.db.doc(`wa_inbound_queue/${key}/messages/${payload.messageId}`);
    await queueRef.set({
        sender: payload.sender,
        sequenceTs: parseWhatsAppTimestampMs(payload.timestamp),
        createdAt: firestore_1.FieldValue.serverTimestamp(),
        attempts: 0,
        payload,
    }, { merge: true });
}
async function processInboundQueueForSender(sender) {
    const key = senderQueueKey(sender);
    const lockRef = firebase_1.db.doc(`wa_inbound_queue_locks/${key}`);
    const workerId = crypto_1.default.randomUUID();
    const now = Date.now();
    const lockTtlMs = 45_000;
    const acquired = await firebase_1.db.runTransaction(async (trx) => {
        const lockSnap = await trx.get(lockRef);
        const lockData = lockSnap.exists ? lockSnap.data() : null;
        const lockedUntil = Number(lockData?.lockedUntilMs || 0);
        if (lockedUntil > now) {
            return false;
        }
        trx.set(lockRef, {
            lockedBy: workerId,
            lockedUntilMs: now + lockTtlMs,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        return true;
    });
    if (!acquired)
        return;
    try {
        const queueCol = firebase_1.db.collection(`wa_inbound_queue/${key}/messages`);
        let processedCount = 0;
        const maxBatch = 20;
        while (processedCount < maxBatch) {
            const nextSnap = await queueCol.orderBy('sequenceTs', 'asc').limit(1).get();
            if (nextSnap.empty)
                break;
            const nextDoc = nextSnap.docs[0];
            const data = nextDoc.data();
            const payload = data.payload;
            if (!payload) {
                await nextDoc.ref.delete();
                processedCount += 1;
                continue;
            }
            try {
                await forwardInboundToCloudRun(payload);
                await firebase_1.db.doc(`wa_inbound_processed/${payload.messageId}`).set({
                    status: 'FORWARDED',
                    forwardedAt: firestore_1.FieldValue.serverTimestamp(),
                }, { merge: true });
                await nextDoc.ref.delete();
            }
            catch (error) {
                await firebase_1.db.doc(`wa_inbound_processed/${payload.messageId}`).set({
                    status: 'FORWARD_FAILED',
                    error: cleanError(error),
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                }, { merge: true });
                await nextDoc.ref.delete();
            }
            processedCount += 1;
        }
    }
    finally {
        await lockRef.set({
            lockedBy: null,
            lockedUntilMs: 0,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
}
async function forwardInboundToCloudRun(payload) {
    const url = process.env.CLOUD_RUN_WHATSAPP_REQUEST_URL || '';
    if (!url) {
        throw new Error('CLOUD_RUN_WHATSAPP_REQUEST_URL missing');
    }
    const sharedSecret = process.env.CLOUD_RUN_SHARED_SECRET || '';
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(sharedSecret ? { 'X-Webhook-Secret': sharedSecret } : {}),
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Cloud Run forward failed (${response.status}): ${body}`);
    }
}
function formatDateTimeGT(date) {
    const dateText = date.toLocaleDateString('es-GT', { timeZone: 'America/Guatemala' });
    const timeText = date.toLocaleTimeString('es-GT', {
        timeZone: 'America/Guatemala',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    return { dateText, timeText };
}
function getGtDayBounds(base) {
    const gtOffsetMs = -6 * 60 * 60 * 1000;
    const shifted = new Date(base.getTime() + gtOffsetMs);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const day = shifted.getUTCDate();
    const startShiftedUtcMs = Date.UTC(year, month, day, 0, 0, 0, 0);
    const endShiftedUtcMs = Date.UTC(year, month, day, 23, 59, 59, 999);
    return {
        startUtc: new Date(startShiftedUtcMs - gtOffsetMs),
        endUtc: new Date(endShiftedUtcMs - gtOffsetMs),
    };
}
function buttonArgFromLink(link) {
    const base = (process.env.FRONTEND_APP_URL || '').replace(/\/$/, '');
    const normalized = String(link || '').trim();
    if (!normalized)
        return '';
    if (base && normalized.startsWith(`${base}/`))
        return normalized.slice(base.length + 1);
    return normalized;
}
async function sendWhatsAppTemplate(params) {
    const token = process.env.WA_TOKEN;
    const phoneId = process.env.WA_PHONE_NUMBER_ID;
    const apiBase = process.env.WA_API_BASE || 'https://graph.facebook.com/v22.0';
    if (!token || !phoneId || !params.to)
        return false;
    if (params.templateName) {
        const components = [
            {
                type: 'body',
                parameters: params.bodyParams.map((text) => ({ type: 'text', text })),
            },
        ];
        if (params.buttonUrlArg) {
            components.push({
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [{ type: 'text', text: params.buttonUrlArg }],
            });
        }
        const response = await fetch(`${apiBase}/${phoneId}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: params.to,
                type: 'template',
                template: {
                    name: params.templateName,
                    language: { code: process.env.WA_LANG_CODE || 'es_MX' },
                    components,
                },
            }),
        });
        if (response.ok)
            return true;
    }
    if (!params.fallbackText)
        return false;
    const fallbackResponse = await fetch(`${apiBase}/${phoneId}/messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: params.to,
            type: 'text',
            text: { body: params.fallbackText },
        }),
    });
    return fallbackResponse.ok;
}
async function sendPatientTemplateByAction(params) {
    const buttonArg = buttonArgFromLink(params.manageLink);
    const { dateText, timeText } = formatDateTimeGT(params.start);
    if (params.action === 'created') {
        return await sendWhatsAppTemplate({
            to: params.patientPhoneE164,
            templateName: process.env.WA_TPL_PATIENT_BOOKED || 'patient_message',
            bodyParams: [params.patientName, params.doctorName, dateText, timeText],
            buttonUrlArg: buttonArg,
            fallbackText: `Hola ${params.patientName}. Tu cita con Dr. ${params.doctorName} esta programada para ${dateText} a las ${timeText}. Gestiona tu cita: ${params.manageLink}`,
        });
    }
    if (params.action === 'cancelled') {
        return await sendWhatsAppTemplate({
            to: params.patientPhoneE164,
            templateName: process.env.WA_TPL_PATIENT_CANCELLED || 'cancelled_appointment',
            bodyParams: [params.patientName, params.doctorName, dateText, timeText],
            buttonUrlArg: buttonArg,
            fallbackText: `Hola ${params.patientName}. Tu cita con Dr. ${params.doctorName} fue cancelada (${dateText} ${timeText}). Gestiona tu cita: ${params.manageLink}`,
        });
    }
    const previous = params.previousStart || params.start;
    const prev = formatDateTimeGT(previous);
    return await sendWhatsAppTemplate({
        to: params.patientPhoneE164,
        templateName: process.env.WA_TPL_PATIENT_RESCHEDULED || 'rescheduled_appointment',
        bodyParams: [params.patientName, params.doctorName, prev.dateText, prev.timeText, dateText, timeText],
        buttonUrlArg: buttonArg,
        fallbackText: `Hola ${params.patientName}. Tu cita con Dr. ${params.doctorName} fue reagendada de ${prev.dateText} ${prev.timeText} a ${dateText} ${timeText}. Gestiona tu cita: ${params.manageLink}`,
    });
}
async function sendPatientEmergencyScheduledTemplate(params) {
    const { dateText, timeText } = formatDateTimeGT(params.start);
    const buttonArg = buttonArgFromLink(params.manageLink);
    return await sendWhatsAppTemplate({
        to: params.patientPhoneE164,
        templateName: process.env.WA_TPL_PATIENT_EMERGENCY || 'appointment_emergency_patient',
        bodyParams: [params.patientName, params.doctorName, dateText, timeText],
        buttonUrlArg: buttonArg,
        fallbackText: `Hola ${params.patientName}. El doctor ${params.doctorName} programó tu cita de emergencia para el ${dateText} a las ${timeText}. Gestiona tu cita: ${params.manageLink}`,
    });
}
async function sendDoctorTemplateByAction(params) {
    const dt = formatDateTimeGT(params.start);
    if (params.action === 'cancelled_by_patient') {
        return await sendWhatsAppTemplate({
            to: params.doctorPhoneE164,
            templateName: process.env.WA_TPL_DOCTOR_CANCELLED_BY_PATIENT || 'appointment_cancelled_notify_doc',
            bodyParams: [params.doctorName, params.patientName, dt.dateText, dt.timeText],
            buttonUrlArg: params.linkArg,
            fallbackText: `Hola Dr. ${params.doctorName}, el paciente ${params.patientName} cancelo su cita (${dt.dateText} ${dt.timeText}).`,
        });
    }
    if (params.action === 'rescheduled_by_patient') {
        const prev = formatDateTimeGT(params.previousStart || params.start);
        return await sendWhatsAppTemplate({
            to: params.doctorPhoneE164,
            templateName: process.env.WA_TPL_DOCTOR_RESCHEDULED_BY_PATIENT || 'rescheduled_notify_doc',
            bodyParams: [params.doctorName, params.patientName, prev.dateText, prev.timeText, dt.dateText, dt.timeText],
            buttonUrlArg: params.linkArg,
            fallbackText: `Hola Dr. ${params.doctorName}, ${params.patientName} reagendo de ${prev.dateText} ${prev.timeText} a ${dt.dateText} ${dt.timeText}.`,
        });
    }
    if (params.action === 'booked_lt24') {
        return await sendWhatsAppTemplate({
            to: params.doctorPhoneE164,
            templateName: process.env.WA_TPL_DOCTOR_BOOKED_LT24 || 'appointment_booked_notify_doc',
            bodyParams: [params.doctorName, params.patientName, dt.dateText, dt.timeText],
            buttonUrlArg: params.linkArg,
            fallbackText: `Hola Dr. ${params.doctorName}, ${params.patientName} agendo cita para ${dt.dateText} ${dt.timeText}.`,
        });
    }
    return await sendWhatsAppTemplate({
        to: params.doctorPhoneE164,
        templateName: process.env.WA_TPL_DOCTOR_EMERGENCY || 'appointment_emergency',
        bodyParams: [params.doctorName, params.patientName, String(params.patientAge || ''), String(params.description || '')],
        buttonUrlArg: params.linkArg,
        fallbackText: `Hola Dr. ${params.doctorName}. Emergencia de ${params.patientName} (${params.patientAge || '-'}) ${params.description || ''}.`,
    });
}
async function getOrCreatePatientDek(clinicId) {
    const keyRef = firebase_1.db.doc(`clinics/${clinicId}/crypto_keys/patient_dek`);
    const keySnap = await keyRef.get();
    if (keySnap.exists) {
        return keySnap.data();
    }
    const created = await (0, crypto_2.createWrappedDek)(1);
    await keyRef.set({
        wrappedKey: created.wrappedKey,
        keyVersion: created.keyVersion,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return { wrappedKey: created.wrappedKey, keyVersion: created.keyVersion };
}
async function getOrCreateDoctorDek(uid) {
    const keyRef = firebase_1.db.doc(`doctors/${uid}/crypto_keys/doctor_dek`);
    const keySnap = await keyRef.get();
    if (keySnap.exists) {
        return keySnap.data();
    }
    const created = await (0, crypto_2.createWrappedDek)(1);
    await keyRef.set({
        wrappedKey: created.wrappedKey,
        keyVersion: created.keyVersion,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return { wrappedKey: created.wrappedKey, keyVersion: created.keyVersion };
}
function buildDoctorAadCandidates(uid, fieldName) {
    return [
        { clinicId: 'N/A', docId: uid, fieldName, schemaVersion: '1' },
        { docId: uid, clinicId: 'N/A', fieldName, schemaVersion: '1' },
        { docId: uid, fieldName, clinicId: 'N/A', schemaVersion: '1' },
        { clinicId: '', docId: uid, fieldName, schemaVersion: '1' },
        { clinicId: 'N/A', docId: uid, fieldName, schemaVersion: '0' },
        { clinicId: 'N/A', docId: uid, fieldName },
        { docId: uid, fieldName, clinicId: 'N/A' },
    ];
}
function asNormalizedText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (typeof value === 'object') {
        const candidate = value;
        if (typeof candidate.value === 'string')
            return candidate.value.trim();
        if (typeof candidate.text === 'string')
            return candidate.text.trim();
        if (typeof candidate.fullName === 'string')
            return candidate.fullName.trim();
        if (typeof candidate.dateOfBirth === 'string')
            return candidate.dateOfBirth.trim();
    }
    return '';
}
function normalizeDobIso(value) {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime()))
            return '';
        return value.toISOString().slice(0, 10);
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const dt = new Date(value);
        if (Number.isNaN(dt.getTime()))
            return '';
        return dt.toISOString().slice(0, 10);
    }
    if (value && typeof value === 'object') {
        const candidate = value;
        if (typeof candidate.year === 'number' &&
            typeof candidate.month === 'number' &&
            typeof candidate.day === 'number' &&
            Number.isFinite(candidate.year) &&
            Number.isFinite(candidate.month) &&
            Number.isFinite(candidate.day)) {
            const y = String(candidate.year).padStart(4, '0');
            const m = String(candidate.month).padStart(2, '0');
            const d = String(candidate.day).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
        const toDateFn = candidate.toDate;
        if (typeof toDateFn === 'function') {
            try {
                const dt = toDateFn.call(candidate);
                if (dt instanceof Date && !Number.isNaN(dt.getTime()))
                    return dt.toISOString().slice(0, 10);
            }
            catch {
                // Ignore and keep trying other representations.
            }
        }
        if (typeof candidate.seconds === 'number') {
            const dt = new Date(candidate.seconds * 1000);
            if (!Number.isNaN(dt.getTime()))
                return dt.toISOString().slice(0, 10);
        }
    }
    const raw = asNormalizedText(value);
    if (!raw)
        return '';
    const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch)
        return isoMatch[1];
    const dmyMatch = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (dmyMatch)
        return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime()))
        return '';
    return dt.toISOString().slice(0, 10);
}
function decryptDoctorField(encrypted, dek, uid, fieldName) {
    const value = encrypted[fieldName];
    if (!value)
        return '';
    if (!dek)
        return asNormalizedText(value);
    for (const aadMeta of buildDoctorAadCandidates(uid, fieldName)) {
        try {
            const plain = (0, crypto_2.decryptField)(value, dek, aadMeta);
            const normalizedText = asNormalizedText(plain);
            if (normalizedText)
                return normalizedText;
            if (fieldName === 'dateOfBirth') {
                return normalizeDobIso(plain);
            }
            return '';
        }
        catch {
            continue;
        }
    }
    return asNormalizedText(value);
}
function buildAppointmentAadCandidates(doctorUid, appointmentId, fieldName) {
    const names = [`appointment.${fieldName}`, fieldName];
    const out = [];
    for (const name of names) {
        out.push({ clinicId: 'N/A', docId: appointmentId, fieldName: name, schemaVersion: '1' });
        out.push({ docId: appointmentId, clinicId: 'N/A', fieldName: name, schemaVersion: '1' });
        out.push({ clinicId: 'N/A', docId: doctorUid, fieldName: name, schemaVersion: '1' });
        out.push({ clinicId: 'N/A', docId: appointmentId, fieldName: name });
        out.push({ docId: appointmentId, fieldName: name, clinicId: 'N/A' });
    }
    return out;
}
function decryptAppointmentField(encryptedValue, fallbackValue, dek, doctorUid, appointmentId, fieldName) {
    if (!encryptedValue)
        return asNormalizedText(fallbackValue);
    if (!dek)
        return asNormalizedText(fallbackValue);
    for (const aadMeta of buildAppointmentAadCandidates(doctorUid, appointmentId, fieldName)) {
        try {
            const plain = (0, crypto_2.decryptField)(encryptedValue, dek, aadMeta);
            const normalized = asNormalizedText(plain);
            if (normalized || plain === 0 || plain === false)
                return normalized;
        }
        catch {
            continue;
        }
    }
    return asNormalizedText(fallbackValue);
}
async function getDoctorDekOrNull(doctorUid) {
    try {
        const key = await getOrCreateDoctorDek(doctorUid);
        return await (0, crypto_2.unwrapDek)(key);
    }
    catch {
        return null;
    }
}
function decodeAppointmentSensitive(data, dek, doctorUid, appointmentId) {
    const encrypted = (data.sensitiveCipher || {}) || {};
    const patientName = decryptAppointmentField(encrypted.patientName, data.patientName, dek, doctorUid, appointmentId, 'patientName');
    const patientPhoneE164 = normalizeE164Phone(decryptAppointmentField(encrypted.patientPhoneE164, data.patientPhoneE164, dek, doctorUid, appointmentId, 'patientPhoneE164'));
    const patientEmail = decryptAppointmentField(encrypted.patientEmail, data.patientEmail, dek, doctorUid, appointmentId, 'patientEmail');
    const notes = decryptAppointmentField(encrypted.notes, data.notes, dek, doctorUid, appointmentId, 'notes');
    return { patientName, patientPhoneE164, patientEmail, notes };
}
async function encryptAppointmentSensitive(doctorUid, appointmentId, params) {
    const key = await getOrCreateDoctorDek(doctorUid);
    const dek = await (0, crypto_2.unwrapDek)(key);
    return {
        keyVersion: key.keyVersion,
        encryptedSchemaVersion: 1,
        sensitiveCipher: {
            patientName: (0, crypto_2.encryptField)(params.patientName, dek, { clinicId: 'N/A', docId: appointmentId, fieldName: 'appointment.patientName', schemaVersion: '1' }, key.keyVersion),
            patientPhoneE164: (0, crypto_2.encryptField)(params.patientPhoneE164, dek, { clinicId: 'N/A', docId: appointmentId, fieldName: 'appointment.patientPhoneE164', schemaVersion: '1' }, key.keyVersion),
            patientEmail: (0, crypto_2.encryptField)(params.patientEmail, dek, { clinicId: 'N/A', docId: appointmentId, fieldName: 'appointment.patientEmail', schemaVersion: '1' }, key.keyVersion),
            notes: (0, crypto_2.encryptField)(params.notes, dek, { clinicId: 'N/A', docId: appointmentId, fieldName: 'appointment.notes', schemaVersion: '1' }, key.keyVersion),
        },
    };
}
async function saveDoctorIdentityFromStripe(uid, session) {
    const verifiedOutputs = (session.verified_outputs || {});
    const docReport = (session.last_verification_report?.document || {});
    const fullNameRaw = String(verifiedOutputs.full_name || '').trim() ||
        `${String(verifiedOutputs.first_name || '').trim()} ${String(verifiedOutputs.last_name || '').trim()}`.trim() ||
        `${String(docReport.first_name || '').trim()} ${String(docReport.last_name || '').trim()}`.trim();
    const dob = (verifiedOutputs.dob || docReport.dob);
    const dateOfBirth = dob?.year && dob?.month && dob?.day
        ? `${String(dob.year).padStart(4, '0')}-${String(dob.month).padStart(2, '0')}-${String(dob.day).padStart(2, '0')}`
        : '';
    const documentNumber = String(docReport.number ||
        session.last_verification_report?.document?.number ||
        session?.last_verification_report?.document?.number ||
        '').trim();
    const ageCurrent = dateOfBirth ? computeAgeFromDob(dateOfBirth) : null;
    const key = await getOrCreateDoctorDek(uid);
    const dek = await (0, crypto_2.unwrapDek)(key);
    const nextCipher = {};
    if (fullNameRaw) {
        nextCipher.fullName = (0, crypto_2.encryptField)(fullNameRaw, dek, { clinicId: 'N/A', docId: uid, fieldName: 'fullName', schemaVersion: '1' }, key.keyVersion);
    }
    if (dateOfBirth) {
        nextCipher.dateOfBirth = (0, crypto_2.encryptField)(dateOfBirth, dek, { clinicId: 'N/A', docId: uid, fieldName: 'dateOfBirth', schemaVersion: '1' }, key.keyVersion);
    }
    if (documentNumber) {
        nextCipher.idNumber = (0, crypto_2.encryptField)(documentNumber, dek, { clinicId: 'N/A', docId: uid, fieldName: 'idNumber', schemaVersion: '1' }, key.keyVersion);
    }
    if (Object.keys(nextCipher).length > 0) {
        const profileUpdate = {
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        for (const [keyName, value] of Object.entries(nextCipher)) {
            profileUpdate[`ciphertext.${keyName}`] = value;
        }
        await firebase_1.db.doc(`doctors/${uid}/private/profile`).set(profileUpdate, { merge: true });
    }
    if (fullNameRaw || ageCurrent !== null) {
        const publicProfilePatch = {
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        const userPatch = {
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        if (fullNameRaw) {
            publicProfilePatch.fullName = fullNameRaw;
            userPatch.fullName = fullNameRaw;
        }
        if (ageCurrent !== null) {
            publicProfilePatch.ageCurrent = ageCurrent;
            userPatch.ageCurrent = ageCurrent;
        }
        await Promise.all([
            firebase_1.db.doc(`doctors/${uid}/profile/public`).set(publicProfilePatch, { merge: true }),
            firebase_1.db.doc(`users/${uid}`).set(userPatch, { merge: true }),
        ]);
    }
    await firebase_1.db.doc(`doctors/${uid}/verification/identity`).set({
        stripeSessionId: session.id,
        source: 'stripe_webhook',
        hasFullName: Boolean(fullNameRaw),
        hasDateOfBirth: Boolean(dateOfBirth),
        hasIdNumber: Boolean(documentNumber),
        idNumberLast4: documentNumber ? documentNumber.slice(-4) : null,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    }, { merge: true });
}
async function resolveStripeVerificationUid(session) {
    const byPayload = String(session.client_reference_id || session.metadata?.firebase_uid || '').trim();
    if (byPayload)
        return byPayload;
    const sessionId = String(session.id || '').trim();
    if (!sessionId)
        return '';
    const mapSnap = await firebase_1.db.doc(`stripe_verification_sessions/${sessionId}`).get();
    if (!mapSnap.exists)
        return '';
    return String(mapSnap.data().uid || '').trim();
}
async function getDoctorPublicSnapshot(uid) {
    const userSnap = await firebase_1.db.doc(`users/${uid}`).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    if ((userData.role || '') !== 'doctor')
        return null;
    const privateSnap = await firebase_1.db.doc(`doctors/${uid}/private/profile`).get();
    const publicSnap = await firebase_1.db.doc(`doctors/${uid}/profile/public`).get().catch(() => null);
    const publicData = publicSnap?.exists ? (publicSnap.data() || {}) : {};
    const verificationSnap = await firebase_1.db.doc(`doctors/${uid}/verification/status`).get().catch(() => null);
    const applicationSnap = await firebase_1.db.doc(`doctors/${uid}/verification/application`).get().catch(() => null);
    const scheduleSnap = await firebase_1.db.doc(`users/${uid}/availability/default`).get().catch(() => null);
    const reviewsSnap = await firebase_1.db.collection(`doctors/${uid}/reviews`).limit(200).get().catch(() => null);
    const encrypted = privateSnap.exists ? (privateSnap.data().ciphertext || {}) : {};
    let dek = null;
    if (privateSnap.exists) {
        const key = await getOrCreateDoctorDek(uid);
        dek = await (0, crypto_2.unwrapDek)(key);
    }
    const decryptOptional = (fieldName) => decryptDoctorField(encrypted, dek, uid, fieldName);
    const reviews = reviewsSnap?.docs.map((d) => d.data()) || [];
    const totalReviews = reviews.length;
    const avgRating = totalReviews > 0 ? reviews.reduce((acc, item) => acc + Number(item.rating || 0), 0) / totalReviews : 0;
    const weeklySchedule = scheduleSnap?.exists ? (scheduleSnap.data().weeklySchedule || {}) : {};
    const verification = verificationSnap?.exists ? (verificationSnap.data() || {}) : {};
    const application = applicationSnap?.exists ? (applicationSnap.data() || {}) : {};
    const fullNamePublic = String(publicData.fullName || '').trim();
    const licensePublic = String(publicData.licenseNumber || '').trim();
    const legacyFullName = decryptOptional('fullName');
    const legacyLicense = decryptOptional('licenseNumber');
    const personalPhone = decryptOptional('personalPhone') || decryptOptional('phone');
    return {
        uid,
        clinicId: userData.primaryClinicId || null,
        fullName: fullNamePublic || legacyFullName || null,
        licenseNumber: licensePublic || legacyLicense || null,
        phone: personalPhone || null,
        publicContactPhone: (String(publicData.publicContactPhone || '').trim() || null),
        publicContactEmail: (String(publicData.publicContactEmail || '').trim() || null),
        insuranceNetworks: decryptOptional('insuranceNetworks') || '',
        academicHistory: decryptOptional('academicHistory') || '',
        masters: decryptOptional('masters') || '',
        internships: decryptOptional('internships') || '',
        activeLicense: Boolean(publicData.activeLicense),
        weeklySchedule,
        verified: Boolean(verification.stripeVerified) && String(application.status || '') === 'APPROVED',
        adminApproved: String(application.status || '') === 'APPROVED',
        avgRating: Number(avgRating.toFixed(2)),
        totalReviews,
        photos: Array.isArray(publicData.photos) ? publicData.photos : [],
        updatedAt: userData.updatedAt || null,
    };
}
async function getDoctorRatingStats(doctorId) {
    const snap = await firebase_1.db.collection(`doctors/${doctorId}/reviews`).get();
    const ratings = snap.docs
        .map((d) => Number(d.data().rating || 0))
        .filter((r) => r > 0);
    const totalReviews = ratings.length;
    const avgRating = totalReviews ? Number((ratings.reduce((a, b) => a + b, 0) / totalReviews).toFixed(2)) : 0;
    return { avgRating, totalReviews };
}
async function upsertActiveDoctor(uid, overrides = {}) {
    const [userSnap, publicSnap, applicationSnap, verificationSnap] = await Promise.all([
        firebase_1.db.doc(`users/${uid}`).get(),
        firebase_1.db.doc(`doctors/${uid}/profile/public`).get().catch(() => null),
        firebase_1.db.doc(`doctors/${uid}/verification/application`).get().catch(() => null),
        firebase_1.db.doc(`doctors/${uid}/verification/status`).get().catch(() => null),
    ]);
    const userData = userSnap.exists ? (userSnap.data() || {}) : {};
    const publicData = publicSnap?.exists ? (publicSnap.data() || {}) : {};
    const application = applicationSnap?.exists ? (applicationSnap.data() || {}) : {};
    const verification = verificationSnap?.exists ? (verificationSnap.data() || {}) : {};
    const approved = typeof overrides.approved === 'boolean' ? overrides.approved : String(application.status || '') === 'APPROVED';
    const verified = typeof overrides.verified === 'boolean' ? overrides.verified : Boolean(verification.stripeVerified) && approved;
    const subscription = typeof overrides.subscription === 'boolean'
        ? overrides.subscription
        : typeof application.subscription === 'boolean'
            ? Boolean(application.subscription)
            : approved;
    const activePayload = {
        uid,
        clinicId: userData.primaryClinicId || null,
        fullName: String(publicData.fullName || '').trim(),
        fullNameLower: String(publicData.fullName || '')
            .trim()
            .toLowerCase(),
        approved,
        verified,
        subscription,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    };
    if (typeof overrides.avgRating === 'number')
        activePayload.avgRating = overrides.avgRating;
    if (typeof overrides.totalReviews === 'number')
        activePayload.totalReviews = overrides.totalReviews;
    await firebase_1.db.doc(`active_doctors/${uid}`).set(activePayload, { merge: true });
}
function parseIsoDate(value, field) {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime()))
        throw new Error(`${field} inválido`);
    return dt;
}
function computeAgeFromDob(dobIso) {
    const dob = new Date(dobIso);
    if (Number.isNaN(dob.getTime()))
        return null;
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate()))
        age -= 1;
    return age >= 0 ? age : null;
}
async function hasDoctorTimeConflict(doctorId, start, end, excludeAppointmentId) {
    const bookingSnap = await firebase_1.db
        .collectionGroup('bookings')
        .where('doctorId', '==', doctorId)
        .where('status', 'in', ['PENDING', 'CONFIRMED'])
        .get();
    for (const doc of bookingSnap.docs) {
        const b = doc.data();
        const bs = b.startDateTime?.toDate?.();
        const be = b.endDateTime?.toDate?.();
        if (!bs || !be)
            continue;
        if (start < be && end > bs)
            return true;
    }
    const apptSnap = await firebase_1.db.collection(`users/${doctorId}/patient_appointments`).get();
    for (const doc of apptSnap.docs) {
        if (excludeAppointmentId && doc.id === excludeAppointmentId)
            continue;
        const a = doc.data();
        const status = String(a.status || 'CONFIRMED').toUpperCase();
        if (status === 'CANCELLED')
            continue;
        const as = a.startDateTime?.toDate?.();
        const ae = a.endDateTime?.toDate?.();
        if (!as || !ae)
            continue;
        if (start < ae && end > as)
            return true;
    }
    const blocksSnap = await firebase_1.db.collection(`users/${doctorId}/time_blocks`).where('status', '==', 'ACTIVE').get().catch(() => null);
    if (blocksSnap) {
        for (const doc of blocksSnap.docs) {
            const data = doc.data();
            const bs = data.startDateTime?.toDate?.();
            const be = data.endDateTime?.toDate?.();
            if (!bs || !be)
                continue;
            if (start < be && end > bs)
                return true;
        }
    }
    return false;
}
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map((v) => Number(v));
    if (!Number.isFinite(h) || !Number.isFinite(m))
        return -1;
    return h * 60 + m;
}
function toHHMM(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function normalizeRanges(ranges) {
    return (ranges || [])
        .map((r) => ({ start: toMinutes(r.start), end: toMinutes(r.end) }))
        .filter((r) => r.start >= 0 && r.end > r.start);
}
function intersectTwoRanges(a, b) {
    const out = [];
    for (const ra of a) {
        for (const rb of b) {
            const start = Math.max(ra.start, rb.start);
            const end = Math.min(ra.end, rb.end);
            if (end > start)
                out.push({ start, end });
        }
    }
    return out;
}
function dayKeyFromDate(dateISO) {
    const date = new Date(`${dateISO}T00:00:00-06:00`);
    return DAY_KEYS[date.getUTCDay()];
}
function toDateAtGuatemala(dateISO, hhmm) {
    return new Date(`${dateISO}T${hhmm}:00-06:00`);
}
function toGuatemalaDayAndMinutes(date) {
    const gtMillis = date.getTime() - 6 * 60 * 60 * 1000;
    const gt = new Date(gtMillis);
    const dayKey = DAY_KEYS[gt.getUTCDay()];
    const minutes = gt.getUTCHours() * 60 + gt.getUTCMinutes();
    return { dayKey, minutes };
}
function isIntervalCoveredByRanges(startMinutes, endMinutes, ranges) {
    return ranges.some((r) => startMinutes >= r.start && endMinutes <= r.end);
}
async function getDoctorClinicAccess(clinicId, doctorUid) {
    const snap = await firebase_1.db.doc(`clinics/${clinicId}/doctor_access/${doctorUid}`).get();
    if (!snap.exists)
        return null;
    return snap.data();
}
function resolveClinicIdFromClaims(claims, bodyClinicId) {
    if (claims.role === 'platform_admin')
        return bodyClinicId;
    return claims.clinicId || bodyClinicId;
}
app.post('/auth/selectRole', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        const body = zod_1.z
            .object({
            role: zod_1.z.literal('doctor').default('doctor'),
            clinicId: zod_1.z.string().trim().min(1).optional(),
        })
            .parse(req.body);
        const resolvedClinicId = body.clinicId || `clinic_${claims.uid.slice(0, 8)}`;
        const nextClaims = {
            role: 'doctor',
            doctorVerified: false,
            clinicId: resolvedClinicId,
        };
        await firebase_1.adminAuth.setCustomUserClaims(claims.uid, nextClaims);
        await firebase_1.db.doc(`users/${claims.uid}`).set({
            role: body.role,
            primaryClinicId: resolvedClinicId,
            linkedClinicIds: firestore_1.FieldValue.arrayUnion(resolvedClinicId),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        await firebase_1.db.doc(`clinics/${resolvedClinicId}/verification/status`).set({
            clinicId: resolvedClinicId,
            ownerUid: claims.uid,
            status: 'PENDING_DOCUMENTS',
            identityVerified: false,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        const email = await getUserEmail(claims.uid);
        await sendEmail({
            to: email,
            subject: 'Bienvenido a Medyko',
            text: `Tu cuenta en Medyko fue creada correctamente con rol ${body.role}.`,
            html: `<h3>Bienvenido a Medyko</h3><p>Tu cuenta fue creada correctamente con rol <strong>${body.role}</strong>.</p>`,
        });
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/public/doctors/search', async (req, res) => {
    try {
        const body = zod_1.z.object({ query: zod_1.z.string().optional(), limit: zod_1.z.number().int().positive().max(100).optional() }).parse(req.body || {});
        const queryText = (body.query || '').trim().toLowerCase();
        const maxItems = body.limit || 40;
        const usersSnap = await firebase_1.db.collection('active_doctors').where('approved', '==', true).limit(500).get();
        const rows = usersSnap.docs.map((doc) => {
            const data = doc.data() || {};
            const fullName = String(data.fullName || '').trim();
            return {
                uid: String(data.uid || doc.id),
                fullName,
                fullNameLower: String(data.fullNameLower || fullName.toLowerCase()),
                verified: Boolean(data.verified),
                avgRating: Number(data.avgRating || 0),
                totalReviews: Number(data.totalReviews || 0),
                clinicId: data.clinicId || null,
            };
        });
        const filtered = rows
            .filter((item) => Boolean(item.fullName))
            .filter((item) => (!queryText ? true : item.fullNameLower.includes(queryText)))
            .sort((a, b) => {
            if (Number(b.verified) !== Number(a.verified))
                return Number(b.verified) - Number(a.verified);
            return b.avgRating - a.avgRating;
        })
            .slice(0, maxItems)
            .map((item) => ({
            uid: item.uid,
            fullName: item.fullName,
            verified: item.verified,
            avgRating: item.avgRating,
            totalReviews: item.totalReviews,
            clinicId: item.clinicId,
        }));
        res.json({ doctors: filtered });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/public/doctors/profile', async (req, res) => {
    try {
        const body = zod_1.z.object({ doctorUid: zod_1.z.string().min(1) }).parse(req.body);
        const profile = await getDoctorPublicSnapshot(body.doctorUid);
        if (!profile)
            throw new Error('Doctor no encontrado');
        res.json({
            doctor: {
                ...profile,
                // Never expose personal phone in public endpoint
                phone: profile.publicContactPhone || null,
            },
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/public/doctors/slots', async (req, res) => {
    try {
        const body = zod_1.z
            .object({
            doctorUid: zod_1.z.string().min(1),
            date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            excludeAppointmentId: zod_1.z.string().optional(),
        })
            .parse(req.body);
        const profile = await getDoctorPublicSnapshot(body.doctorUid);
        if (!profile)
            throw new Error('Doctor no encontrado');
        if (!profile.adminApproved) {
            res.json({ blocked: true, reason: 'Doctor pendiente de aprobación de plataforma.', slots: [] });
            return;
        }
        const dayKey = dayKeyFromDate(body.date);
        const scheduleSnap = await firebase_1.db.doc(`users/${body.doctorUid}/availability/default`).get();
        const data = scheduleSnap.exists ? scheduleSnap.data() : {};
        const slotMinutes = Number(data.slotMinutes || 60);
        const ranges = normalizeRanges((data.weeklySchedule?.[dayKey] || []));
        if (ranges.length === 0) {
            res.json({ blocked: false, slots: [] });
            return;
        }
        const dayStart = toDateAtGuatemala(body.date, '00:00');
        const dayEnd = toDateAtGuatemala(body.date, '23:59');
        const busy = [];
        const apptSnap = await firebase_1.db.collection(`users/${body.doctorUid}/patient_appointments`).get().catch(() => null);
        if (apptSnap) {
            for (const doc of apptSnap.docs) {
                const a = doc.data();
                const apptId = String(a.appointmentId || doc.id);
                if (body.excludeAppointmentId && apptId === body.excludeAppointmentId)
                    continue;
                const status = String(a.status || 'CONFIRMED').toUpperCase();
                if (status === 'CANCELLED')
                    continue;
                const start = a.startDateTime?.toDate?.();
                const end = a.endDateTime?.toDate?.();
                if (!start || !end)
                    continue;
                if (start < dayEnd && end > dayStart)
                    busy.push({ start, end });
            }
        }
        const bookingSnap = await firebase_1.db.collectionGroup('bookings').where('doctorId', '==', body.doctorUid).where('status', 'in', ['PENDING', 'CONFIRMED']).get();
        for (const doc of bookingSnap.docs) {
            const b = doc.data();
            const start = b.startDateTime?.toDate?.();
            const end = b.endDateTime?.toDate?.();
            if (!start || !end)
                continue;
            if (start < dayEnd && end > dayStart)
                busy.push({ start, end });
        }
        const blocksSnap = await firebase_1.db.collection(`users/${body.doctorUid}/time_blocks`).where('status', '==', 'ACTIVE').get().catch(() => null);
        if (blocksSnap) {
            for (const doc of blocksSnap.docs) {
                const b = doc.data();
                const start = b.startDateTime?.toDate?.();
                const end = b.endDateTime?.toDate?.();
                if (!start || !end)
                    continue;
                if (start < dayEnd && end > dayStart)
                    busy.push({ start, end });
            }
        }
        const slots = [];
        for (const range of ranges) {
            for (let start = range.start; start + slotMinutes <= range.end; start += slotMinutes) {
                const end = start + slotMinutes;
                const startDate = toDateAtGuatemala(body.date, toHHMM(start));
                const endDate = toDateAtGuatemala(body.date, toHHMM(end));
                const overlaps = busy.some((b) => startDate < b.end && endDate > b.start);
                slots.push({
                    label: `${toHHMM(start)} - ${toHHMM(end)}`,
                    startDateTime: startDate.toISOString(),
                    endDateTime: endDate.toISOString(),
                    available: !overlaps,
                });
            }
        }
        res.json({ blocked: false, slots });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/public/appointments/patientPhone/startVerification', async (req, res) => {
    try {
        const body = zod_1.z
            .object({
            doctorUid: zod_1.z.string().min(1),
            patientPhone: zod_1.z.string().min(8),
            wantsWhatsapp: zod_1.z.boolean().default(true),
        })
            .parse(req.body || {});
        if (!body.wantsWhatsapp) {
            res.json({ ok: true, verificationRequired: false });
            return;
        }
        const profile = await getDoctorPublicSnapshot(body.doctorUid);
        if (!profile || !profile.adminApproved)
            throw new Error('Doctor no disponible para citas');
        const phoneE164 = normalizeE164Phone(body.patientPhone);
        if (!phoneE164)
            throw new Error('Número de teléfono inválido');
        const code = `${Math.floor(100000 + Math.random() * 900000)}`;
        const verificationRef = firebase_1.db.collection(`doctors/${body.doctorUid}/public_patient_phone_verifications`).doc();
        const expiresAt = firestore_1.Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000));
        await verificationRef.set({
            verificationId: verificationRef.id,
            doctorUid: body.doctorUid,
            phoneE164,
            verified: false,
            codeHash: hashPhoneVerify(body.doctorUid, phoneE164, code),
            attempts: 0,
            expiresAt,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        const sent = await sendWhatsAppTemplate({
            to: phoneE164,
            templateName: process.env.WA_TPL_PHONE_VERIFY || '',
            bodyParams: [code],
            fallbackText: `Tu código de verificación Medyko es ${code}. Expira en 10 minutos.`,
        });
        if (!sent)
            throw new Error('No se pudo enviar el código por WhatsApp');
        res.json({
            ok: true,
            verificationRequired: true,
            verificationId: verificationRef.id,
            expiresInSeconds: 600,
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/public/appointments/patientPhone/confirmVerification', async (req, res) => {
    try {
        const body = zod_1.z
            .object({
            doctorUid: zod_1.z.string().min(1),
            verificationId: zod_1.z.string().min(1),
            code: zod_1.z.string().regex(/^\d{6}$/),
        })
            .parse(req.body || {});
        const ref = firebase_1.db.doc(`doctors/${body.doctorUid}/public_patient_phone_verifications/${body.verificationId}`);
        const snap = await ref.get();
        if (!snap.exists)
            throw new Error('Verificación no encontrada');
        const data = snap.data();
        const phoneE164 = String(data.phoneE164 || '');
        if (!phoneE164)
            throw new Error('Verificación inválida');
        const expiresAt = data.expiresAt?.toDate?.();
        if (!expiresAt || expiresAt.getTime() < Date.now())
            throw new Error('Código expirado');
        const expectedHash = String(data.codeHash || '');
        const providedHash = hashPhoneVerify(body.doctorUid, phoneE164, body.code);
        if (!expectedHash || expectedHash !== providedHash) {
            const nextAttempts = Number(data.attempts || 0) + 1;
            await ref.set({ attempts: nextAttempts, updatedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
            throw new Error('Código inválido');
        }
        const verificationToken = createPhoneVerificationToken(body.verificationId);
        const tokenHash = hashGenericToken(verificationToken);
        await ref.set({
            verified: true,
            verifiedAt: firestore_1.FieldValue.serverTimestamp(),
            phoneVerificationTokenHash: tokenHash,
            phoneVerificationTokenExpiresAt: firestore_1.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
            codeHash: firestore_1.FieldValue.delete(),
            attempts: firestore_1.FieldValue.delete(),
            expiresAt: firestore_1.FieldValue.delete(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({
            ok: true,
            verified: true,
            verificationToken,
            phoneE164,
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/public/appointments/create', async (req, res) => {
    try {
        const body = zod_1.z
            .object({
            doctorUid: zod_1.z.string().min(1),
            patientName: zod_1.z.string().min(2).max(120),
            patientAge: zod_1.z.number().int().min(0).max(120),
            patientPhone: zod_1.z.string().optional(),
            consentAccepted: zod_1.z.literal(true),
            startDateTime: zod_1.z.string(),
            endDateTime: zod_1.z.string(),
            notes: zod_1.z.string().max(1200).optional(),
        })
            .parse(req.body || {});
        const profile = await getDoctorPublicSnapshot(body.doctorUid);
        if (!profile || !profile.adminApproved)
            throw new Error('Doctor no disponible para citas');
        const start = parseIsoDate(body.startDateTime, 'startDateTime');
        const end = parseIsoDate(body.endDateTime, 'endDateTime');
        if (end <= start)
            throw new Error('endDateTime debe ser mayor que startDateTime');
        if (start.getTime() < Date.now() + 60 * 60 * 1000)
            throw new Error('La cita debe agendarse con al menos 1 hora de anticipación');
        const conflict = await hasDoctorTimeConflict(body.doctorUid, start, end);
        if (conflict)
            throw new Error('El horario seleccionado ya no está disponible');
        const clientIpHash = hashConsentIp(extractClientIp(req));
        const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
        const patientPhoneE164 = normalizeE164Phone(body.patientPhone || '');
        const patientPhoneVerified = Boolean(patientPhoneE164);
        const wantsWhatsapp = Boolean(patientPhoneE164);
        const patientName = body.patientName.trim();
        const notes = body.notes || '';
        const ref = firebase_1.db.collection(`users/${body.doctorUid}/patient_appointments`).doc();
        const manageToken = crypto_1.default.randomUUID().replace(/-/g, '');
        const manageTokenHash = hashManageToken(ref.id, manageToken);
        const manageLink = buildAppointmentManageLink(ref.id, manageToken);
        const doctorName = String(profile.fullName || 'Doctor');
        const sensitive = await encryptAppointmentSensitive(body.doctorUid, ref.id, {
            patientName,
            patientPhoneE164,
            patientEmail: '',
            notes,
        });
        await ref.set({
            appointmentId: ref.id,
            doctorId: body.doctorUid,
            patientName: '',
            patientAge: body.patientAge,
            patientEmail: '',
            patientPhoneE164: '',
            patientWhatsappOptIn: wantsWhatsapp,
            patientPhoneVerified,
            notes: '',
            consent: {
                accepted: true,
                acceptedAt: firestore_1.FieldValue.serverTimestamp(),
                ipHash: clientIpHash || null,
                userAgent: userAgent || null,
                policyVersion: '2026-03-02',
            },
            sensitiveCipher: sensitive.sensitiveCipher,
            encryptedSchemaVersion: sensitive.encryptedSchemaVersion,
            keyVersion: sensitive.keyVersion,
            status: 'CONFIRMED',
            startDateTime: firestore_1.Timestamp.fromDate(start),
            endDateTime: firestore_1.Timestamp.fromDate(end),
            manageTokenHash,
            manageLink,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        await upsertPublicAppointmentLookup(body.doctorUid, ref.id).catch(() => null);
        let whatsappSent = false;
        if (patientPhoneE164 && wantsWhatsapp && patientPhoneVerified) {
            whatsappSent = await sendPatientTemplateByAction({
                patientName,
                doctorName,
                action: 'created',
                start,
                end,
                manageLink,
                patientPhoneE164,
            });
        }
        const doctorPhoneE164 = normalizeE164Phone(String(profile.phone || ''));
        const hoursUntilStart = (start.getTime() - Date.now()) / (1000 * 60 * 60);
        if (doctorPhoneE164 && hoursUntilStart >= 0 && hoursUntilStart < 24) {
            await sendDoctorTemplateByAction({
                action: 'booked_lt24',
                doctorPhoneE164,
                doctorName,
                patientName,
                start,
                linkArg: buttonArgFromLink(manageLink),
            });
        }
        res.json({
            ok: true,
            appointmentId: ref.id,
            manageLink,
            whatsappSent,
            warning: wantsWhatsapp && patientPhoneVerified && !whatsappSent ? 'Cita guardada, pero no se pudo enviar WhatsApp al paciente.' : null,
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/public/doctors/inquiries/create', async (req, res) => {
    try {
        const body = zod_1.z
            .object({
            doctorUid: zod_1.z.string().min(1),
            patientName: zod_1.z.string().min(2).max(120),
            age: zod_1.z.number().int().min(0).max(120),
            recurringPatient: zod_1.z.boolean(),
            hasInsurance: zod_1.z.boolean(),
            insuranceName: zod_1.z.string().max(120).optional(),
            preferredStartDateTime: zod_1.z.string().optional().nullable(),
            preferredEndDateTime: zod_1.z.string().optional().nullable(),
            preferredSlotLabel: zod_1.z.string().max(80).optional().nullable(),
        })
            .parse(req.body);
        const profile = await getDoctorPublicSnapshot(body.doctorUid);
        if (!profile)
            throw new Error('Doctor no encontrado');
        const key = await getOrCreateDoctorDek(body.doctorUid);
        const dek = await (0, crypto_2.unwrapDek)(key);
        const encrypted = {
            patientName: (0, crypto_2.encryptField)(body.patientName.trim(), dek, { clinicId: 'N/A', docId: body.doctorUid, fieldName: 'patientName', schemaVersion: '1' }, key.keyVersion),
            age: (0, crypto_2.encryptField)(body.age, dek, { clinicId: 'N/A', docId: body.doctorUid, fieldName: 'age', schemaVersion: '1' }, key.keyVersion),
            recurringPatient: (0, crypto_2.encryptField)(body.recurringPatient, dek, { clinicId: 'N/A', docId: body.doctorUid, fieldName: 'recurringPatient', schemaVersion: '1' }, key.keyVersion),
            hasInsurance: (0, crypto_2.encryptField)(body.hasInsurance, dek, { clinicId: 'N/A', docId: body.doctorUid, fieldName: 'hasInsurance', schemaVersion: '1' }, key.keyVersion),
            insuranceName: (0, crypto_2.encryptField)((body.insuranceName || '').trim(), dek, { clinicId: 'N/A', docId: body.doctorUid, fieldName: 'insuranceName', schemaVersion: '1' }, key.keyVersion),
            preferredStartDateTime: (0, crypto_2.encryptField)(body.preferredStartDateTime || '', dek, { clinicId: 'N/A', docId: body.doctorUid, fieldName: 'preferredStartDateTime', schemaVersion: '1' }, key.keyVersion),
            preferredEndDateTime: (0, crypto_2.encryptField)(body.preferredEndDateTime || '', dek, { clinicId: 'N/A', docId: body.doctorUid, fieldName: 'preferredEndDateTime', schemaVersion: '1' }, key.keyVersion),
            preferredSlotLabel: (0, crypto_2.encryptField)(body.preferredSlotLabel || '', dek, { clinicId: 'N/A', docId: body.doctorUid, fieldName: 'preferredSlotLabel', schemaVersion: '1' }, key.keyVersion),
        };
        const ref = firebase_1.db.collection(`doctors/${body.doctorUid}/patient_inquiries`).doc();
        await ref.set({
            inquiryId: ref.id,
            doctorUid: body.doctorUid,
            ciphertext: encrypted,
            encryptedSchemaVersion: 1,
            keyVersion: key.keyVersion,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || null;
        if (adminEmail) {
            await sendEmail({
                to: adminEmail,
                subject: 'Nueva solicitud de paciente en perfil público',
                text: `Doctor: ${profile.fullName || body.doctorUid}. Paciente: ${body.patientName}, edad ${body.age}. Slot: ${body.preferredSlotLabel || '-'}.`,
            });
        }
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/doctors/settings/get', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'platform_admin']);
        const body = zod_1.z.object({ uid: zod_1.z.string().optional() }).parse(req.body || {});
        const targetUid = claims.role === 'platform_admin' ? body.uid || claims.uid : claims.uid;
        const snap = await firebase_1.db.doc(`doctors/${targetUid}/settings/preferences`).get();
        const data = snap.exists ? snap.data() : {};
        res.json({
            useDoctorScheduleForClinicReservations: data.useDoctorScheduleForClinicReservations === false ? false : true,
            wantsDoctorPath: data.wantsDoctorPath === false ? false : true,
            wantsClinicPath: data.wantsClinicPath === false ? false : true,
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/doctors/settings/update', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'platform_admin']);
        const body = zod_1.z
            .object({
            uid: zod_1.z.string().optional(),
            useDoctorScheduleForClinicReservations: zod_1.z.boolean().optional(),
            wantsDoctorPath: zod_1.z.boolean().optional(),
            wantsClinicPath: zod_1.z.boolean().optional(),
        })
            .parse(req.body);
        const targetUid = claims.role === 'platform_admin' ? body.uid || claims.uid : claims.uid;
        await firebase_1.db.doc(`doctors/${targetUid}/settings/preferences`).set({
            ...(typeof body.useDoctorScheduleForClinicReservations === 'boolean'
                ? { useDoctorScheduleForClinicReservations: body.useDoctorScheduleForClinicReservations }
                : {}),
            ...(typeof body.wantsDoctorPath === 'boolean' ? { wantsDoctorPath: body.wantsDoctorPath } : {}),
            ...(typeof body.wantsClinicPath === 'boolean' ? { wantsClinicPath: body.wantsClinicPath } : {}),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/doctors/profile/get', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'platform_admin']);
        const body = zod_1.z.object({ uid: zod_1.z.string().optional() }).parse(req.body || {});
        const targetUid = claims.role === 'platform_admin' ? body.uid || claims.uid : claims.uid;
        const [privateSnap, publicSnap, userSnap] = await Promise.all([
            firebase_1.db.doc(`doctors/${targetUid}/private/profile`).get(),
            firebase_1.db.doc(`doctors/${targetUid}/profile/public`).get(),
            firebase_1.db.doc(`users/${targetUid}`).get(),
        ]);
        const encrypted = privateSnap.exists ? (privateSnap.data().ciphertext || {}) : {};
        const publicData = publicSnap.exists ? publicSnap.data() : {};
        const userData = userSnap.exists ? userSnap.data() : {};
        console.log('profile/get uid:', targetUid, 'privateExists:', privateSnap.exists, 'publicExists:', publicSnap.exists, 'encryptedKeys:', Object.keys(encrypted), 'publicFullName:', publicData.fullName || '(empty)', 'userFullName:', userData.fullName || '(empty)');
        const key = await getOrCreateDoctorDek(targetUid);
        const dek = await (0, crypto_2.unwrapDek)(key);
        const decryptOptional = (fieldName) => decryptDoctorField(encrypted, dek, targetUid, fieldName);
        const dateOfBirth = normalizeDobIso(decryptOptional('dateOfBirth')) ||
            normalizeDobIso(userData.dateOfBirth || userData.dob) ||
            normalizeDobIso(publicData.dateOfBirth);
        const age = (dateOfBirth ? computeAgeFromDob(dateOfBirth) : null) ??
            (typeof publicData.ageCurrent === 'number' ? Number(publicData.ageCurrent) : null) ??
            (typeof userData.ageCurrent === 'number' ? Number(userData.ageCurrent) : null);
        res.json({
            fullName: decryptOptional('fullName') || asNormalizedText(publicData.fullName) || asNormalizedText(userData.fullName) || '',
            age,
            dateOfBirth,
            phone: decryptOptional('personalPhone') || decryptOptional('phone'),
            licenseNumber: publicData.licenseNumber || decryptOptional('licenseNumber'),
            contactEmail: decryptOptional('personalEmail') || decryptOptional('contactEmail'),
            publicContactEmail: publicData.publicContactEmail || '',
            publicContactPhone: publicData.publicContactPhone || '',
            insuranceNetworks: decryptOptional('insuranceNetworks'),
            academicHistory: decryptOptional('academicHistory'),
            masters: decryptOptional('masters'),
            internships: decryptOptional('internships'),
            activeLicense: Boolean(publicData.activeLicense),
            degreeTitleUrl: publicData.degreeTitleUrl || '',
            certificationUrls: Array.isArray(publicData.certificationUrls) ? publicData.certificationUrls : [],
            phoneCountryCode: publicData.phoneCountryCode || '+502',
            photos: Array.isArray(publicData.photos) ? publicData.photos : [],
        });
    }
    catch (error) {
        console.error('profile/get error:', cleanError(error));
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/doctors/profile/upsert', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z
            .object({
            fullName: zod_1.z.string().min(2).max(120),
            dateOfBirth: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(zod_1.z.literal('')),
            phoneCountryCode: zod_1.z.string().min(2).max(6),
            phoneLocal: zod_1.z.string().min(6).max(20),
            licenseNumber: zod_1.z.string().min(3).max(80),
            contactEmail: zod_1.z.string().email().max(190).optional().or(zod_1.z.literal('')),
            publicContactEmail: zod_1.z.string().email().max(190).optional().or(zod_1.z.literal('')),
            publicContactPhone: zod_1.z.string().max(30).optional().or(zod_1.z.literal('')),
            insuranceNetworks: zod_1.z.string().max(2000).default(''),
            activeLicense: zod_1.z.boolean().default(false),
            degreeTitleUrl: zod_1.z.string().url().optional().or(zod_1.z.literal('')),
            certificationUrls: zod_1.z.array(zod_1.z.string().url()).max(20).default([]),
            academicHistory: zod_1.z.string().max(3000).default(''),
            masters: zod_1.z.string().max(3000).default(''),
            internships: zod_1.z.string().max(3000).default(''),
        })
            .parse(req.body);
        const key = await getOrCreateDoctorDek(claims.uid);
        const dek = await (0, crypto_2.unwrapDek)(key);
        const personalPhone = `${body.phoneCountryCode}${body.phoneLocal}`.replace(/\s+/g, '');
        const authEmail = (await getUserEmail(claims.uid)) || '';
        const personalEmail = String(body.contactEmail || authEmail || '').trim().toLowerCase();
        const encrypted = {
            fullName: (0, crypto_2.encryptField)(body.fullName, dek, { clinicId: 'N/A', docId: claims.uid, fieldName: 'fullName', schemaVersion: '1' }, key.keyVersion),
            ...(body.dateOfBirth
                ? {
                    dateOfBirth: (0, crypto_2.encryptField)(body.dateOfBirth, dek, { clinicId: 'N/A', docId: claims.uid, fieldName: 'dateOfBirth', schemaVersion: '1' }, key.keyVersion),
                }
                : {}),
            personalPhone: (0, crypto_2.encryptField)(personalPhone, dek, { clinicId: 'N/A', docId: claims.uid, fieldName: 'personalPhone', schemaVersion: '1' }, key.keyVersion),
            ...(personalEmail
                ? {
                    personalEmail: (0, crypto_2.encryptField)(personalEmail, dek, { clinicId: 'N/A', docId: claims.uid, fieldName: 'personalEmail', schemaVersion: '1' }, key.keyVersion),
                }
                : {}),
            insuranceNetworks: (0, crypto_2.encryptField)(body.insuranceNetworks, dek, { clinicId: 'N/A', docId: claims.uid, fieldName: 'insuranceNetworks', schemaVersion: '1' }, key.keyVersion),
            academicHistory: (0, crypto_2.encryptField)(body.academicHistory, dek, { clinicId: 'N/A', docId: claims.uid, fieldName: 'academicHistory', schemaVersion: '1' }, key.keyVersion),
            masters: (0, crypto_2.encryptField)(body.masters, dek, { clinicId: 'N/A', docId: claims.uid, fieldName: 'masters', schemaVersion: '1' }, key.keyVersion),
            internships: (0, crypto_2.encryptField)(body.internships, dek, { clinicId: 'N/A', docId: claims.uid, fieldName: 'internships', schemaVersion: '1' }, key.keyVersion),
        };
        await firebase_1.db.doc(`doctors/${claims.uid}/private/profile`).set({
            ciphertext: encrypted,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        await firebase_1.db.doc(`doctors/${claims.uid}/profile/public`).set({
            uid: claims.uid,
            fullName: body.fullName,
            ...(body.dateOfBirth ? { ageCurrent: computeAgeFromDob(body.dateOfBirth) } : {}),
            licenseNumber: body.licenseNumber,
            phoneCountryCode: body.phoneCountryCode,
            phoneLookupHash: hashDoctorPhoneLookup(personalPhone),
            publicContactEmail: (body.publicContactEmail || '').trim(),
            publicContactPhone: (body.publicContactPhone || '').trim(),
            activeLicense: body.activeLicense,
            degreeTitleUrl: body.degreeTitleUrl || '',
            certificationUrls: body.certificationUrls,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        if (body.dateOfBirth) {
            await firebase_1.db.doc(`users/${claims.uid}`).set({
                ageCurrent: computeAgeFromDob(body.dateOfBirth),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        const phoneVerificationRef = firebase_1.db.doc(`doctors/${claims.uid}/verification/phone`);
        const phoneVerificationSnap = await phoneVerificationRef.get().catch(() => null);
        const phoneVerificationData = phoneVerificationSnap?.exists ? (phoneVerificationSnap.data() || {}) : {};
        const verifiedPhone = normalizeE164Phone(String(phoneVerificationData.phone || ''));
        if (!phoneVerificationData.verified || verifiedPhone !== personalPhone) {
            await phoneVerificationRef.set({
                phone: personalPhone,
                verified: false,
                status: 'pending',
                verifiedAt: firestore_1.FieldValue.delete(),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        const appSnap = await firebase_1.db.doc(`doctors/${claims.uid}/verification/application`).get().catch(() => null);
        const appData = appSnap?.exists ? (appSnap.data() || {}) : {};
        await upsertActiveDoctor(claims.uid, {
            approved: String(appData.status || '') === 'APPROVED',
            subscription: typeof appData.subscription === 'boolean' ? Boolean(appData.subscription) : true,
        });
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/doctors/application/status', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'platform_admin']);
        const body = zod_1.z.object({ uid: zod_1.z.string().optional() }).parse(req.body || {});
        const targetUid = claims.role === 'platform_admin' ? body.uid || claims.uid : claims.uid;
        const snap = await firebase_1.db.doc(`doctors/${targetUid}/verification/application`).get();
        const data = snap.exists ? snap.data() : {};
        res.json({
            status: data.status || 'DRAFT',
            reason: data.reason || '',
            submittedAt: data.submittedAt || null,
            reviewedAt: data.reviewedAt || null,
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/doctors/application/submit', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const [profileSnap, publicSnap, stripeSnap, phoneSnap] = await Promise.all([
            firebase_1.db.doc(`doctors/${claims.uid}/private/profile`).get(),
            firebase_1.db.doc(`doctors/${claims.uid}/profile/public`).get(),
            firebase_1.db.doc(`doctors/${claims.uid}/verification/status`).get(),
            firebase_1.db.doc(`doctors/${claims.uid}/verification/phone`).get(),
        ]);
        if (!profileSnap.exists)
            throw new Error('Completa tu perfil primero');
        const profileData = profileSnap.data();
        const publicData = publicSnap.exists ? publicSnap.data() : {};
        const stripe = stripeSnap.exists ? stripeSnap.data() : {};
        const phone = phoneSnap.exists ? phoneSnap.data() : {};
        const cipher = (profileData.ciphertext || {});
        const missing = [];
        if (!stripe.stripeVerified)
            missing.push('verificación de identidad Stripe');
        if (!phone.verified)
            missing.push('verificación de teléfono');
        if (!publicData.fullName)
            missing.push('nombre');
        if (!publicData.licenseNumber)
            missing.push('colegiado');
        if (!cipher.personalPhone && !cipher.phone)
            missing.push('teléfono personal');
        if (!cipher.insuranceNetworks)
            missing.push('seguros');
        if (!publicData.activeLicense)
            missing.push('colegiado activo');
        if (!publicData.degreeTitleUrl)
            missing.push('título médico');
        if (!Array.isArray(publicData.certificationUrls) || publicData.certificationUrls.length === 0)
            missing.push('certificaciones');
        if (missing.length > 0) {
            throw new Error(`Faltan requisitos: ${missing.join(', ')}`);
        }
        await firebase_1.db.doc(`doctors/${claims.uid}/verification/application`).set({
            doctorUid: claims.uid,
            status: 'PENDING_REVIEW',
            reason: '',
            submittedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ ok: true, status: 'PENDING_REVIEW' });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/clinics/upsertMine', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin']);
        const body = zod_1.z
            .object({
            clinicName: zod_1.z.string().min(2).max(140),
            address: zod_1.z.string().min(4).max(300),
            zone: zod_1.z.number().int().min(1).max(25),
            contactPhone: zod_1.z.string().min(7).max(24),
        })
            .parse(req.body);
        const currentClaims = await firebase_1.adminAuth.getUser(claims.uid);
        const currentCustomClaims = currentClaims.customClaims || {};
        const clinicId = (claims.clinicId || currentCustomClaims.clinicId || `clinic_${claims.uid.slice(0, 8)}`);
        await firebase_1.db.doc(`clinics/${clinicId}`).set({
            clinicId,
            ownerUid: claims.uid,
            clinicName: body.clinicName,
            location: {
                city: 'Guatemala',
                zone: body.zone,
                address: body.address,
            },
            contactPhone: body.contactPhone,
            status: 'ACTIVE',
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        const existingClinicListings = await firebase_1.db.collection(`clinics/${clinicId}/clinics_listings`).where('ownerId', '==', claims.uid).limit(1).get();
        if (existingClinicListings.empty) {
            const listingRef = firebase_1.db.collection(`clinics/${clinicId}/clinics_listings`).doc();
            await listingRef.set({
                id: listingRef.id,
                clinicId,
                ownerId: claims.uid,
                title: `${body.clinicName} - Espacio clínico`,
                description: 'Listado inicial creado automáticamente.',
                location: { address: body.address, city: 'Guatemala', zone: body.zone, lat: null, lng: null },
                photos: [],
                status: 'DRAFT',
                verificationBadge: false,
                tags: { equipmentTags: [], amenitiesTags: [] },
                policies: { cancellationPolicy: 'Flexible', depositPolicy: 'Sin depósito', requirements: 'Doctor verificado' },
                pricing: { hourly: 0, daily: 0, currency: 'GTQ', priceRules: [] },
                availability: {
                    timezone: 'America/Guatemala',
                    slotMinutes: 60,
                    weeklySchedule: {
                        mon: [{ start: '08:00', end: '17:00' }],
                        tue: [{ start: '08:00', end: '17:00' }],
                        wed: [{ start: '08:00', end: '17:00' }],
                        thu: [{ start: '08:00', end: '17:00' }],
                        fri: [{ start: '08:00', end: '17:00' }],
                        sat: [],
                        sun: [],
                    },
                    blackoutDates: [],
                    minLeadTimeHours: 4,
                    maxBookingHours: 8,
                    bufferMinutesBetweenBookings: 15,
                },
                consultationRoomsCount: 1,
                specialtiesAllowed: ['Medicina general'],
                waitingRoomAvailable: true,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        await firebase_1.db.doc(`users/${claims.uid}`).set({
            role: 'doctor',
            primaryClinicId: clinicId,
            linkedClinicIds: firestore_1.FieldValue.arrayUnion(clinicId),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        await firebase_1.db.doc(`clinics/${clinicId}/verification/status`).set({
            clinicId,
            ownerUid: claims.uid,
            status: 'PENDING_DOCUMENTS',
            identityVerified: false,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        await firebase_1.adminAuth.setCustomUserClaims(claims.uid, {
            ...currentCustomClaims,
            role: 'doctor',
            clinicId,
        });
        res.json({ ok: true, clinicId });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/doctors/emailVerification/status', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'platform_admin']);
        const body = zod_1.z.object({ uid: zod_1.z.string().optional() }).parse(req.body || {});
        const targetUid = claims.role === 'platform_admin' ? body.uid || claims.uid : claims.uid;
        const snap = await firebase_1.db.doc(`doctors/${targetUid}/verification/email`).get();
        const data = snap.exists ? snap.data() : {};
        res.json({
            email: data.email || '',
            verified: Boolean(data.verified),
            status: data.status || 'pending',
            verifiedAt: data.verifiedAt || null,
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/doctors/phoneVerification/status', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'platform_admin']);
        const body = zod_1.z.object({ uid: zod_1.z.string().optional() }).parse(req.body || {});
        const targetUid = claims.role === 'platform_admin' ? body.uid || claims.uid : claims.uid;
        const snap = await firebase_1.db.doc(`doctors/${targetUid}/verification/phone`).get();
        const data = snap.exists ? snap.data() : {};
        res.json({
            phone: data.phone || '',
            verified: Boolean(data.verified),
            status: data.status || 'pending',
            verifiedAt: data.verifiedAt || null,
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/doctors/phoneVerification/confirm', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z.object({ phone: zod_1.z.string().min(8).max(30) }).parse(req.body || {});
        const expectedPhone = normalizeE164Phone(body.phone);
        if (!expectedPhone)
            throw new Error('Número de teléfono inválido');
        const authUser = await firebase_1.adminAuth.getUser(claims.uid);
        const authPhone = normalizeE164Phone(authUser.phoneNumber || '');
        if (!authPhone)
            throw new Error('Primero confirma el código de teléfono');
        if (authPhone !== expectedPhone) {
            throw new Error('El teléfono verificado no coincide con el teléfono del perfil');
        }
        await firebase_1.db.doc(`doctors/${claims.uid}/verification/phone`).set({
            phone: expectedPhone,
            verified: true,
            status: 'verified',
            verifiedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ ok: true, verified: true, phone: expectedPhone });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/doctors/emailVerification/request', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z.object({ email: zod_1.z.string().email().max(190) }).parse(req.body);
        const code = `${Math.floor(100000 + Math.random() * 900000)}`;
        const salt = process.env.EMAIL_VERIFY_SALT || 'medyko-email-verify';
        const codeHash = crypto_1.default.createHash('sha256').update(`${claims.uid}:${code}:${salt}`).digest('hex');
        const expiresAt = firestore_1.Timestamp.fromDate(new Date(Date.now() + 15 * 60 * 1000));
        await firebase_1.db.doc(`doctors/${claims.uid}/verification/email`).set({
            email: body.email.trim().toLowerCase(),
            verified: false,
            status: 'code_sent',
            codeHash,
            expiresAt,
            attempts: 0,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        await sendEmail({
            to: body.email,
            subject: 'Código de verificación de correo - Medyko',
            text: `Tu código de verificación es ${code}. Expira en 15 minutos.`,
            html: `<h3>Verificación de correo</h3><p>Tu código es <strong>${code}</strong>.</p><p>Expira en 15 minutos.</p>`,
        });
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/doctors/emailVerification/confirm', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z.object({ code: zod_1.z.string().regex(/^\d{6}$/) }).parse(req.body);
        const ref = firebase_1.db.doc(`doctors/${claims.uid}/verification/email`);
        const snap = await ref.get();
        if (!snap.exists)
            throw new Error('No hay solicitud de verificación');
        const data = snap.data();
        const expiresAt = data.expiresAt?.toDate?.();
        if (!expiresAt || expiresAt.getTime() < Date.now()) {
            throw new Error('Código expirado');
        }
        const salt = process.env.EMAIL_VERIFY_SALT || 'medyko-email-verify';
        const expectedHash = crypto_1.default.createHash('sha256').update(`${claims.uid}:${body.code}:${salt}`).digest('hex');
        if (expectedHash !== String(data.codeHash || '')) {
            const nextAttempts = Number(data.attempts || 0) + 1;
            await ref.set({ attempts: nextAttempts, updatedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
            throw new Error('Código inválido');
        }
        await ref.set({
            verified: true,
            status: 'verified',
            verifiedAt: firestore_1.FieldValue.serverTimestamp(),
            codeHash: firestore_1.FieldValue.delete(),
            expiresAt: firestore_1.FieldValue.delete(),
            attempts: firestore_1.FieldValue.delete(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ ok: true, verified: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/clinics/requestAccess', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z.object({ clinicId: zod_1.z.string().min(1) }).parse(req.body);
        const ref = firebase_1.db.doc(`clinics/${body.clinicId}/doctor_access/${claims.uid}`);
        const snap = await ref.get();
        const current = snap.exists ? snap.data() : null;
        const status = current?.status || 'PENDING';
        await ref.set({
            clinicId: body.clinicId,
            doctorId: claims.uid,
            status: status === 'APPROVED' ? 'APPROVED' : 'PENDING',
            requestedAt: current ? snap.data().requestedAt || firestore_1.FieldValue.serverTimestamp() : firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ status: status === 'APPROVED' ? 'APPROVED' : 'PENDING' });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/clinics/accessStatus', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin', 'platform_admin']);
        const body = zod_1.z.object({ clinicId: zod_1.z.string().min(1), doctorId: zod_1.z.string().optional() }).parse(req.body);
        const doctorId = claims.role === 'doctor' ? claims.uid : body.doctorId;
        if (!doctorId)
            throw new Error('doctorId requerido');
        const access = await getDoctorClinicAccess(body.clinicId, doctorId);
        res.json({ status: access?.status || 'NONE' });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/clinics/doctorAccess/list', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin', 'platform_admin']);
        const body = zod_1.z.object({ clinicId: zod_1.z.string().optional() }).parse(req.body || {});
        const clinicId = resolveClinicIdFromClaims(claims, body.clinicId);
        if (!clinicId)
            throw new Error('clinicId requerido');
        const snap = await firebase_1.db.collection(`clinics/${clinicId}/doctor_access`).orderBy('updatedAt', 'desc').limit(100).get();
        const items = snap.docs.map((d) => {
            const data = d.data();
            return {
                doctorId: d.id,
                status: data.status || 'PENDING',
                requestedAt: data.requestedAt || null,
                approvedAt: data.approvedAt || null,
            };
        });
        res.json({ requests: items });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/clinics/doctorAccess/update', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin', 'platform_admin']);
        const body = zod_1.z
            .object({
            clinicId: zod_1.z.string().optional(),
            doctorId: zod_1.z.string(),
            status: zod_1.z.enum(['APPROVED', 'REJECTED']),
        })
            .parse(req.body);
        const clinicId = resolveClinicIdFromClaims(claims, body.clinicId);
        if (!clinicId)
            throw new Error('clinicId requerido');
        const ref = firebase_1.db.doc(`clinics/${clinicId}/doctor_access/${body.doctorId}`);
        await ref.set({
            clinicId,
            doctorId: body.doctorId,
            status: body.status,
            approvedBy: claims.uid,
            approvedAt: body.status === 'APPROVED' ? firestore_1.FieldValue.serverTimestamp() : null,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/clinicVerification/uploadUtilityBill', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin']);
        const body = zod_1.z
            .object({
            clinicId: zod_1.z.string().optional(),
            fileName: zod_1.z.string().min(3),
            contentType: zod_1.z.string().min(3),
            base64Data: zod_1.z.string().min(10),
        })
            .parse(req.body);
        const clinicId = resolveClinicIdFromClaims(claims, body.clinicId);
        if (!clinicId)
            throw new Error('clinicId requerido');
        if (claims.role !== 'platform_admin' && claims.clinicId && claims.clinicId !== clinicId)
            throw new Error('FORBIDDEN clinic mismatch');
        const cleanName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `verification/clinics/${clinicId}/${Date.now()}_${cleanName}`;
        const buffer = Buffer.from(body.base64Data, 'base64');
        if (buffer.byteLength > 6 * 1024 * 1024)
            throw new Error('Archivo demasiado grande (max 6MB)');
        const firebaseConfigBucket = (() => {
            try {
                const raw = process.env.FIREBASE_CONFIG;
                if (!raw)
                    return undefined;
                const parsed = JSON.parse(raw);
                return parsed.storageBucket;
            }
            catch {
                return undefined;
            }
        })();
        const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID || 'medyko-project';
        const bucketCandidates = Array.from(new Set([
            process.env.APP_STORAGE_BUCKET,
            firebaseConfigBucket,
            `${projectId}.appspot.com`,
            `${projectId}.firebasestorage.app`,
        ].filter((v) => Boolean(v && v.trim()))));
        let uploadedFile = null;
        let lastError = null;
        for (const bucketName of bucketCandidates) {
            try {
                const downloadToken = crypto_1.default.randomUUID();
                const candidate = firebase_1.storage.bucket(bucketName).file(path);
                await candidate.save(buffer, {
                    contentType: body.contentType,
                    metadata: {
                        metadata: {
                            clinicId,
                            ownerUid: claims.uid,
                            uploadedAt: new Date().toISOString(),
                            bucketName,
                            firebaseStorageDownloadTokens: downloadToken,
                        },
                    },
                });
                uploadedFile = { bucketName, path, downloadToken };
                break;
            }
            catch (error) {
                lastError = error;
            }
        }
        if (!uploadedFile) {
            throw new Error(`No se pudo guardar archivo en Storage. Configura APP_STORAGE_BUCKET. Último error: ${cleanError(lastError)}`);
        }
        const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(uploadedFile.bucketName)}/o/${encodeURIComponent(uploadedFile.path)}?alt=media&token=${encodeURIComponent(uploadedFile.downloadToken)}`;
        await firebase_1.db.doc(`clinics/${clinicId}/verification/status`).set({
            clinicId,
            ownerUid: claims.uid,
            utilityBill: {
                fileName: body.fileName,
                contentType: body.contentType,
                storagePath: path,
                url,
                uploadedAt: firestore_1.FieldValue.serverTimestamp(),
            },
            status: 'PENDING_REVIEW',
            submittedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ ok: true, url });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/media/uploadImage', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin', 'platform_admin']);
        const body = zod_1.z
            .object({
            fileName: zod_1.z.string().min(3),
            contentType: zod_1.z.string().min(3),
            base64Data: zod_1.z.string().min(10),
            scope: zod_1.z.enum(['doctor_profile', 'clinic_listing', 'or_listing']).default('doctor_profile'),
        })
            .parse(req.body);
        if (!body.contentType.startsWith('image/'))
            throw new Error('Solo se permiten imágenes');
        const cleanName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const scopeFolder = body.scope === 'doctor_profile'
            ? `doctors/${claims.uid}`
            : body.scope === 'clinic_listing'
                ? `clinics/${claims.clinicId || 'unassigned'}/clinic_listings`
                : `clinics/${claims.clinicId || 'unassigned'}/or_listings`;
        const path = `media/${scopeFolder}/${Date.now()}_${cleanName}`;
        const buffer = Buffer.from(body.base64Data, 'base64');
        if (buffer.byteLength > 8 * 1024 * 1024)
            throw new Error('Imagen demasiado grande (max 8MB)');
        const firebaseConfigBucket = (() => {
            try {
                const raw = process.env.FIREBASE_CONFIG;
                if (!raw)
                    return undefined;
                const parsed = JSON.parse(raw);
                return parsed.storageBucket;
            }
            catch {
                return undefined;
            }
        })();
        const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID || 'medyko-project';
        const bucketCandidates = Array.from(new Set([process.env.APP_STORAGE_BUCKET, firebaseConfigBucket, `${projectId}.appspot.com`, `${projectId}.firebasestorage.app`].filter((v) => Boolean(v && v.trim()))));
        let uploaded = null;
        let lastError = null;
        for (const bucketName of bucketCandidates) {
            try {
                const token = crypto_1.default.randomUUID();
                const file = firebase_1.storage.bucket(bucketName).file(path);
                await file.save(buffer, {
                    contentType: body.contentType,
                    metadata: {
                        metadata: {
                            ownerUid: claims.uid,
                            scope: body.scope,
                            firebaseStorageDownloadTokens: token,
                        },
                    },
                });
                uploaded = { bucketName, path, token };
                break;
            }
            catch (error) {
                lastError = error;
            }
        }
        if (!uploaded) {
            throw new Error(`No se pudo subir imagen. Configura APP_STORAGE_BUCKET. Último error: ${cleanError(lastError)}`);
        }
        const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(uploaded.bucketName)}/o/${encodeURIComponent(uploaded.path)}?alt=media&token=${encodeURIComponent(uploaded.token)}`;
        res.json({ ok: true, url, path: uploaded.path });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/media/uploadDocument', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin', 'platform_admin']);
        const body = zod_1.z
            .object({
            fileName: zod_1.z.string().min(3),
            contentType: zod_1.z.string().min(3),
            base64Data: zod_1.z.string().min(10),
            scope: zod_1.z.enum(['doctor_verification', 'clinic_verification']).default('doctor_verification'),
        })
            .parse(req.body);
        const isPdf = body.contentType === 'application/pdf';
        const isImage = body.contentType.startsWith('image/');
        if (!isPdf && !isImage)
            throw new Error('Solo se permiten PDF o imágenes');
        const cleanName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const scopeFolder = body.scope === 'doctor_verification'
            ? `doctors/${claims.uid}/verification_docs`
            : `clinics/${claims.clinicId || 'unassigned'}/verification_docs`;
        const path = `media/${scopeFolder}/${Date.now()}_${cleanName}`;
        const buffer = Buffer.from(body.base64Data, 'base64');
        if (buffer.byteLength > 12 * 1024 * 1024)
            throw new Error('Archivo demasiado grande (max 12MB)');
        const firebaseConfigBucket = (() => {
            try {
                const raw = process.env.FIREBASE_CONFIG;
                if (!raw)
                    return undefined;
                const parsed = JSON.parse(raw);
                return parsed.storageBucket;
            }
            catch {
                return undefined;
            }
        })();
        const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID || 'medyko-project';
        const bucketCandidates = Array.from(new Set([process.env.APP_STORAGE_BUCKET, firebaseConfigBucket, `${projectId}.appspot.com`, `${projectId}.firebasestorage.app`].filter((v) => Boolean(v && v.trim()))));
        let uploaded = null;
        let lastError = null;
        for (const bucketName of bucketCandidates) {
            try {
                const token = crypto_1.default.randomUUID();
                const file = firebase_1.storage.bucket(bucketName).file(path);
                await file.save(buffer, {
                    contentType: body.contentType,
                    metadata: {
                        metadata: {
                            ownerUid: claims.uid,
                            scope: body.scope,
                            firebaseStorageDownloadTokens: token,
                        },
                    },
                });
                uploaded = { bucketName, path, token };
                break;
            }
            catch (error) {
                lastError = error;
            }
        }
        if (!uploaded) {
            throw new Error(`No se pudo subir documento. Configura APP_STORAGE_BUCKET. Último error: ${cleanError(lastError)}`);
        }
        const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(uploaded.bucketName)}/o/${encodeURIComponent(uploaded.path)}?alt=media&token=${encodeURIComponent(uploaded.token)}`;
        res.json({ ok: true, url, path: uploaded.path });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/doctors/profile/photos/add', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z.object({ url: zod_1.z.string().url() }).parse(req.body);
        await firebase_1.db.doc(`doctors/${claims.uid}/profile/public`).set({
            photos: firestore_1.FieldValue.arrayUnion(body.url),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/clinicVerification/status', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin', 'platform_admin']);
        const body = zod_1.z.object({ clinicId: zod_1.z.string().optional() }).parse(req.body || {});
        const clinicId = resolveClinicIdFromClaims(claims, body.clinicId);
        if (!clinicId)
            throw new Error('clinicId requerido');
        const snap = await firebase_1.db.doc(`clinics/${clinicId}/verification/status`).get();
        const data = snap.exists ? snap.data() : {};
        res.json({ clinicId, ...(data || {}) });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/platform/clinicVerification/list', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['platform_admin']);
        const snap = await firebase_1.db.collectionGroup('verification').get();
        const rows = await Promise.all(snap.docs
            .filter((d) => {
            if (!d.ref.path.endsWith('/verification/status'))
                return false;
            const status = String(d.data().status || '');
            return ['PENDING_DOCUMENTS', 'PENDING_REVIEW', 'REJECTED', 'APPROVED'].includes(status);
        })
            .map(async (d) => {
            const data = d.data();
            const clinicId = String(data.clinicId || d.ref.parent.parent?.id || '');
            const ownerUid = String(data.ownerUid || '');
            const owner = ownerUid ? await firebase_1.adminAuth.getUser(ownerUid).catch(() => null) : null;
            return {
                clinicId,
                ownerUid,
                ownerEmail: owner?.email || null,
                ownerPhone: owner?.phoneNumber || null,
                status: data.status || 'PENDING_DOCUMENTS',
                reason: data.reason || '',
                identityVerified: Boolean(data.identityVerified),
                utilityBillUrl: data.utilityBill?.url || null,
                submittedAt: data.submittedAt || data.utilityBill?.uploadedAt || null,
                ownerRespondedAt: data.ownerRespondedAt || null,
                reviewedAt: data.reviewedAt || null,
                updatedAt: data.updatedAt || null,
            };
        }));
        res.json({ verifications: rows });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/platform/doctors/applications/list', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['platform_admin']);
        const usersSnap = await firebase_1.db.collection('users').where('role', '==', 'doctor').limit(500).get();
        const rows = await Promise.all(usersSnap.docs.map(async (u) => {
            const doctorUid = u.id;
            const appSnap = await firebase_1.db.doc(`doctors/${doctorUid}/verification/application`).get().catch(() => null);
            const data = appSnap?.exists ? (appSnap.data() || {}) : {};
            const authUser = doctorUid ? await firebase_1.adminAuth.getUser(doctorUid).catch(() => null) : null;
            const stripeSnap = doctorUid ? await firebase_1.db.doc(`doctors/${doctorUid}/verification/status`).get().catch(() => null) : null;
            const phoneSnap = doctorUid ? await firebase_1.db.doc(`doctors/${doctorUid}/verification/phone`).get().catch(() => null) : null;
            const publicSnap = doctorUid ? await firebase_1.db.doc(`doctors/${doctorUid}/profile/public`).get().catch(() => null) : null;
            const stripe = stripeSnap?.exists ? stripeSnap.data() : {};
            const phone = phoneSnap?.exists ? phoneSnap.data() : {};
            const publicData = publicSnap?.exists ? publicSnap.data() : {};
            return {
                doctorUid,
                fullName: publicData.fullName || null,
                phone: authUser?.phoneNumber || null,
                email: authUser?.email || null,
                status: data.status || 'DRAFT',
                reason: data.reason || '',
                stripeVerified: Boolean(stripe.stripeVerified),
                phoneVerified: Boolean(phone.verified),
                activeLicense: Boolean(publicData.activeLicense),
                degreeTitleUrl: publicData.degreeTitleUrl || '',
                certificationCount: Array.isArray(publicData.certificationUrls) ? publicData.certificationUrls.length : 0,
                certificationUrls: Array.isArray(publicData.certificationUrls) ? publicData.certificationUrls : [],
                submittedAt: data.submittedAt || null,
                reviewedAt: data.reviewedAt || null,
            };
        }));
        const sorted = rows.sort((a, b) => {
            const rank = (status) => (status === 'PENDING_REVIEW' ? 0 : status === 'REJECTED' ? 1 : status === 'DRAFT' ? 2 : 3);
            const r = rank(String(a.status)) - rank(String(b.status));
            if (r !== 0)
                return r;
            const ta = a.submittedAt?.toDate?.()?.getTime?.() || 0;
            const tb = b.submittedAt?.toDate?.()?.getTime?.() || 0;
            return tb - ta;
        });
        res.json({ applications: sorted });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/platform/doctors/applications/review', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['platform_admin']);
        const body = zod_1.z
            .object({
            doctorUid: zod_1.z.string().min(1),
            decision: zod_1.z.enum(['APPROVED', 'REJECTED']),
            reason: zod_1.z.string().max(1500).optional(),
        })
            .parse(req.body);
        const ref = firebase_1.db.doc(`doctors/${body.doctorUid}/verification/application`);
        const snap = await ref.get();
        if (!snap.exists)
            throw new Error('Solicitud no encontrada');
        const reason = (body.reason || '').trim();
        if (body.decision === 'REJECTED' && !reason)
            throw new Error('Debes escribir causa de rechazo');
        if (body.decision === 'APPROVED') {
            const [stripeSnap, phoneSnap, publicSnap, profileSnap] = await Promise.all([
                firebase_1.db.doc(`doctors/${body.doctorUid}/verification/status`).get(),
                firebase_1.db.doc(`doctors/${body.doctorUid}/verification/phone`).get(),
                firebase_1.db.doc(`doctors/${body.doctorUid}/profile/public`).get(),
                firebase_1.db.doc(`doctors/${body.doctorUid}/private/profile`).get(),
            ]);
            const stripe = stripeSnap.exists ? stripeSnap.data() : {};
            const phone = phoneSnap.exists ? phoneSnap.data() : {};
            const publicData = publicSnap.exists ? publicSnap.data() : {};
            const profile = profileSnap.exists ? profileSnap.data() : {};
            const cipher = (profile.ciphertext || {});
            const isValid = Boolean(stripe.stripeVerified) &&
                Boolean(phone.verified) &&
                Boolean(publicData.activeLicense) &&
                Boolean(publicData.degreeTitleUrl) &&
                Array.isArray(publicData.certificationUrls) &&
                publicData.certificationUrls.length > 0 &&
                Boolean(publicData.fullName) &&
                Boolean(publicData.licenseNumber) &&
                (Boolean(cipher.personalPhone) || Boolean(cipher.phone));
            if (!isValid)
                throw new Error('Doctor no cumple requisitos mínimos para aprobar');
        }
        await ref.set({
            status: body.decision,
            reason,
            subscription: body.decision === 'APPROVED' ? true : false,
            reviewedBy: claims.uid,
            reviewedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        const publicSnap = await firebase_1.db.doc(`doctors/${body.doctorUid}/profile/public`).get().catch(() => null);
        const publicData = publicSnap?.exists ? (publicSnap.data() || {}) : {};
        await upsertActiveDoctor(body.doctorUid, {
            approved: body.decision === 'APPROVED',
            subscription: body.decision === 'APPROVED',
            verified: body.decision === 'APPROVED',
        });
        const user = await firebase_1.adminAuth.getUser(body.doctorUid);
        await firebase_1.adminAuth.setCustomUserClaims(body.doctorUid, {
            ...(user.customClaims || {}),
            doctorVerified: body.decision === 'APPROVED',
        });
        let doctorEmail = await getUserEmail(body.doctorUid).catch(() => null);
        if (!doctorEmail) {
            const privateSnap = await firebase_1.db.doc(`doctors/${body.doctorUid}/private/profile`).get().catch(() => null);
            if (privateSnap?.exists) {
                const privateData = privateSnap.data() || {};
                const encrypted = (privateData.ciphertext || {});
                try {
                    const key = await getOrCreateDoctorDek(body.doctorUid);
                    const dek = await (0, crypto_2.unwrapDek)(key);
                    const fallbackEmail = decryptDoctorField(encrypted, dek, body.doctorUid, 'personalEmail') ||
                        decryptDoctorField(encrypted, dek, body.doctorUid, 'contactEmail');
                    if (String(fallbackEmail || '').includes('@')) {
                        doctorEmail = String(fallbackEmail).trim().toLowerCase();
                    }
                }
                catch {
                    // Ignore fallback decryption errors.
                }
            }
        }
        console.log('doctor application review notification target', {
            doctorUid: body.doctorUid,
            decision: body.decision,
            email: doctorEmail || null,
        });
        const appBase = (process.env.FRONTEND_APP_URL || 'http://localhost:5173').replace(/\/$/, '');
        const doctorPanelLink = `${appBase}/doctor/profile`;
        const doctorOnboardingLink = `${appBase}/doctor/onboarding`;
        if (doctorEmail) {
            if (body.decision === 'APPROVED') {
                await sendEmail({
                    to: doctorEmail,
                    subject: 'Tu solicitud de doctor fue aprobada - Medyko',
                    text: `Tu solicitud fue aprobada. Ya puedes continuar desde tu panel: ${doctorOnboardingLink}`,
                    html: `<h3>Solicitud aprobada</h3><p>Tu solicitud fue aprobada.</p><p>Puedes continuar desde tu panel: <a href="${doctorOnboardingLink}">${doctorOnboardingLink}</a></p>`,
                });
            }
            else {
                const reasonText = reason || 'Revisa tu perfil y vuelve a enviar tu solicitud.';
                await sendEmail({
                    to: doctorEmail,
                    subject: 'Tu solicitud de doctor fue rechazada - Medyko',
                    text: `Tu solicitud fue rechazada.\nMotivo: ${reasonText}\nCorrige lo pendiente desde tu panel: ${doctorPanelLink}`,
                    html: `<h3>Solicitud rechazada</h3><p>Tu solicitud fue rechazada.</p><p><strong>Motivo:</strong> ${reasonText}</p><p>Corrige lo pendiente desde tu panel: <a href="${doctorPanelLink}">${doctorPanelLink}</a></p>`,
                });
            }
        }
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/platform/clinicVerification/review', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['platform_admin']);
        const body = zod_1.z
            .object({
            clinicId: zod_1.z.string(),
            decision: zod_1.z.enum(['APPROVED', 'REJECTED']),
            reason: zod_1.z.string().max(1500).optional(),
        })
            .parse(req.body);
        const ref = firebase_1.db.doc(`clinics/${body.clinicId}/verification/status`);
        const snap = await ref.get();
        if (!snap.exists)
            throw new Error('Verificación no encontrada');
        const data = snap.data();
        const ownerUid = String(data.ownerUid || '');
        const identityVerified = Boolean(data.identityVerified);
        const hasUtilityBill = Boolean(data.utilityBill?.url || data.utilityBill?.storagePath);
        if (body.decision === 'APPROVED') {
            if (!identityVerified || !hasUtilityBill) {
                throw new Error('Para aprobar clínica se requiere identidad verificada y recibo de servicios cargado');
            }
        }
        await ref.set({
            status: body.decision,
            reason: body.reason?.trim() || '',
            ownerResponseComment: '',
            ownerRespondedAt: null,
            identityVerified,
            reviewedBy: claims.uid,
            reviewedAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        await firebase_1.db.doc(`clinics/${body.clinicId}`).set({
            approvedForPublishing: body.decision === 'APPROVED',
            approvalUpdatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        if (ownerUid) {
            const to = await getUserEmail(ownerUid);
            const subject = body.decision === 'APPROVED' ? 'Tu clínica fue aprobada en Medyko' : 'Tu clínica fue rechazada en Medyko';
            const reasonText = body.reason?.trim() ? `Motivo: ${body.reason.trim()}` : 'Sin motivo adicional.';
            const appUrl = process.env.FRONTEND_APP_URL || 'http://localhost:5173';
            const reviewUrl = `${appUrl}/clinic`;
            await sendEmail({
                to,
                subject,
                text: body.decision === 'APPROVED'
                    ? `${subject}. Ya puedes continuar con tus listados.`
                    : `${subject}. ${reasonText}. Revisa y responde aquí: ${reviewUrl}`,
                html: body.decision === 'APPROVED'
                    ? `<h3>${subject}</h3><p>Ya puedes continuar con tus listados.</p>`
                    : `<h3>${subject}</h3><p>${reasonText}</p><p><a href="${reviewUrl}">Revisar rechazo y responder</a></p>`,
            });
        }
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/clinicVerification/respondReview', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin']);
        const body = zod_1.z
            .object({
            clinicId: zod_1.z.string().optional(),
            comment: zod_1.z.string().min(3).max(1500),
        })
            .parse(req.body);
        const clinicId = resolveClinicIdFromClaims(claims, body.clinicId);
        if (!clinicId)
            throw new Error('clinicId requerido');
        const ref = firebase_1.db.doc(`clinics/${clinicId}/verification/status`);
        const snap = await ref.get();
        if (!snap.exists)
            throw new Error('Verificación no encontrada');
        const data = snap.data();
        const ownerUid = String(data.ownerUid || '');
        if (ownerUid && ownerUid !== claims.uid && claims.role !== 'platform_admin') {
            throw new Error('FORBIDDEN');
        }
        await ref.set({
            ownerResponseComment: body.comment.trim(),
            ownerRespondedAt: firestore_1.FieldValue.serverTimestamp(),
            status: 'PENDING_REVIEW',
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/availability/slots', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin', 'platform_admin']);
        const body = zod_1.z
            .object({
            clinicId: zod_1.z.string(),
            listingId: zod_1.z.string(),
            listingType: zod_1.z.enum(['CLINIC', 'OR']),
            date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            doctorId: zod_1.z.string().optional(),
            slotMinutes: zod_1.z.union([zod_1.z.literal(45), zod_1.z.literal(60)]).optional(),
        })
            .parse(req.body);
        const collection = body.listingType === 'OR' ? 'or_listings' : 'clinics_listings';
        const listingSnap = await firebase_1.db.doc(`clinics/${body.clinicId}/${collection}/${body.listingId}`).get();
        if (!listingSnap.exists)
            throw new Error('Listing no encontrado');
        const listing = listingSnap.data();
        const dayKey = dayKeyFromDate(body.date);
        const listingRanges = normalizeRanges((listing.availability?.weeklySchedule?.[dayKey] || []));
        let doctorSlotMinutes = null;
        const doctorId = claims.role === 'doctor' ? claims.uid : body.doctorId;
        if (doctorId) {
            const doctorScheduleSnap = await firebase_1.db.doc(`users/${doctorId}/availability/default`).get();
            const settingsSnap = await firebase_1.db.doc(`doctors/${doctorId}/settings/preferences`).get().catch(() => null);
            const useDoctorScheduleForClinicReservations = settingsSnap?.exists && settingsSnap.data().useDoctorScheduleForClinicReservations === false ? false : true;
            if (doctorScheduleSnap.exists && useDoctorScheduleForClinicReservations) {
                const data = doctorScheduleSnap.data();
                const savedSlot = Number(data.slotMinutes || 0);
                if (Number.isFinite(savedSlot) && savedSlot > 0)
                    doctorSlotMinutes = savedSlot;
            }
        }
        const slotMinutes = Number(body.slotMinutes || doctorSlotMinutes || listing.availability?.slotMinutes || 60);
        if (listingRanges.length === 0) {
            res.json({ slots: [] });
            return;
        }
        let doctorRanges = listingRanges;
        if (doctorId) {
            const doctorScheduleSnap = await firebase_1.db.doc(`users/${doctorId}/availability/default`).get();
            const settingsSnap = await firebase_1.db.doc(`doctors/${doctorId}/settings/preferences`).get().catch(() => null);
            const useDoctorScheduleForClinicReservations = settingsSnap?.exists && settingsSnap.data().useDoctorScheduleForClinicReservations === false ? false : true;
            if (useDoctorScheduleForClinicReservations) {
                const schedule = doctorScheduleSnap.exists ? doctorScheduleSnap.data().weeklySchedule : undefined;
                const candidate = normalizeRanges(schedule?.[dayKey]);
                if (candidate.length > 0)
                    doctorRanges = candidate;
            }
        }
        const ownerId = String(listing.ownerId || '');
        let ownerRanges = listingRanges;
        if (ownerId) {
            const ownerScheduleSnap = await firebase_1.db.doc(`users/${ownerId}/availability/default`).get();
            const schedule = ownerScheduleSnap.exists ? ownerScheduleSnap.data().weeklySchedule : undefined;
            const candidate = normalizeRanges(schedule?.[dayKey]);
            if (candidate.length > 0)
                ownerRanges = candidate;
        }
        const inCommon = intersectTwoRanges(intersectTwoRanges(listingRanges, doctorRanges), ownerRanges);
        const dayStart = toDateAtGuatemala(body.date, '00:00');
        const dayEnd = toDateAtGuatemala(body.date, '23:59');
        const bookedSnap = await firebase_1.db
            .collection(`clinics/${body.clinicId}/bookings`)
            .where('listingId', '==', body.listingId)
            .where('status', 'in', ['PENDING', 'CONFIRMED'])
            .where('startDateTime', '>=', firestore_1.Timestamp.fromDate(dayStart))
            .where('startDateTime', '<=', firestore_1.Timestamp.fromDate(dayEnd))
            .get();
        const listingBookings = bookedSnap.docs.map((d) => {
            const data = d.data();
            return {
                start: data.startDateTime.toDate(),
                end: data.endDateTime.toDate(),
            };
        });
        const doctorBusy = [...listingBookings];
        if (doctorId) {
            const doctorBookingsSnap = await firebase_1.db
                .collectionGroup('bookings')
                .where('doctorId', '==', doctorId)
                .where('status', 'in', ['PENDING', 'CONFIRMED'])
                .get();
            for (const doc of doctorBookingsSnap.docs) {
                const b = doc.data();
                const start = b.startDateTime?.toDate?.();
                const end = b.endDateTime?.toDate?.();
                if (!start || !end)
                    continue;
                if (start < dayEnd && end > dayStart) {
                    doctorBusy.push({ start, end });
                }
            }
            const patientApptsSnap = await firebase_1.db.collection(`users/${doctorId}/patient_appointments`).get().catch(() => null);
            if (patientApptsSnap) {
                for (const doc of patientApptsSnap.docs) {
                    const a = doc.data();
                    const status = String(a.status || 'CONFIRMED').toUpperCase();
                    if (status === 'CANCELLED')
                        continue;
                    const startRaw = a.startDateTime || a.start || a.startAt;
                    const endRaw = a.endDateTime || a.end || a.endAt;
                    const start = startRaw?.toDate?.() instanceof Date
                        ? startRaw.toDate()
                        : typeof startRaw === 'string'
                            ? new Date(startRaw)
                            : null;
                    const end = endRaw?.toDate?.() instanceof Date
                        ? endRaw.toDate()
                        : typeof endRaw === 'string'
                            ? new Date(endRaw)
                            : null;
                    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
                        continue;
                    if (start < dayEnd && end > dayStart) {
                        doctorBusy.push({ start, end });
                    }
                }
            }
            const blocksSnap = await firebase_1.db.collection(`users/${doctorId}/time_blocks`).where('status', '==', 'ACTIVE').get().catch(() => null);
            if (blocksSnap) {
                for (const doc of blocksSnap.docs) {
                    const b = doc.data();
                    const start = b.startDateTime?.toDate?.();
                    const end = b.endDateTime?.toDate?.();
                    if (!start || !end)
                        continue;
                    if (start < dayEnd && end > dayStart) {
                        doctorBusy.push({ start, end });
                    }
                }
            }
        }
        const slots = [];
        for (const range of inCommon) {
            for (let start = range.start; start + slotMinutes <= range.end; start += slotMinutes) {
                const end = start + slotMinutes;
                const startDate = toDateAtGuatemala(body.date, toHHMM(start));
                const endDate = toDateAtGuatemala(body.date, toHHMM(end));
                const overlaps = doctorBusy.some((b) => startDate < b.end && endDate > b.start);
                slots.push({
                    label: `${toHHMM(start)} - ${toHHMM(end)}`,
                    startDateTime: startDate.toISOString(),
                    endDateTime: endDate.toISOString(),
                    available: !overlaps,
                });
            }
        }
        res.json({ slots });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/availability/mine', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin', 'platform_admin']);
        const snap = await firebase_1.db.doc(`users/${claims.uid}/availability/default`).get();
        const data = snap.exists ? snap.data() : {};
        res.json({
            weeklySchedule: data.weeklySchedule || {},
            timezone: data.timezone || 'America/Guatemala',
            slotMinutes: Number(data.slotMinutes || 60),
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/availability/saveMine', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin', 'platform_admin']);
        const body = zod_1.z
            .object({
            weeklySchedule: zod_1.z.record(zod_1.z.string(), zod_1.z.array(zod_1.z.object({ start: zod_1.z.string(), end: zod_1.z.string() }))),
            timezone: zod_1.z.string().default('America/Guatemala'),
            slotMinutes: zod_1.z.union([zod_1.z.literal(45), zod_1.z.literal(60)]).default(60),
        })
            .parse(req.body);
        const normalizedSchedule = {};
        for (const key of DAY_KEYS) {
            normalizedSchedule[key] = normalizeRanges((body.weeklySchedule[key] || []));
        }
        const now = new Date();
        const conflicts = [];
        const doctorBookingsSnap = await firebase_1.db
            .collectionGroup('bookings')
            .where('doctorId', '==', claims.uid)
            .where('status', 'in', ['PENDING', 'CONFIRMED'])
            .get();
        for (const doc of doctorBookingsSnap.docs) {
            const b = doc.data();
            const start = b.startDateTime?.toDate?.();
            const end = b.endDateTime?.toDate?.();
            if (!start || !end)
                continue;
            if (end <= now)
                continue;
            const s = toGuatemalaDayAndMinutes(start);
            const e = toGuatemalaDayAndMinutes(end);
            if (s.dayKey !== e.dayKey) {
                conflicts.push(`Reserva ${b.bookingId || doc.id} cruza medianoche`);
                continue;
            }
            const dayRanges = normalizedSchedule[s.dayKey] || [];
            if (!isIntervalCoveredByRanges(s.minutes, e.minutes, dayRanges)) {
                conflicts.push(`Reserva ${b.bookingId || doc.id} (${start.toISOString()})`);
            }
        }
        const patientApptsSnap = await firebase_1.db.collection(`users/${claims.uid}/patient_appointments`).get().catch(() => null);
        if (patientApptsSnap) {
            for (const doc of patientApptsSnap.docs) {
                const a = doc.data();
                const status = String(a.status || 'CONFIRMED').toUpperCase();
                if (status === 'CANCELLED')
                    continue;
                const start = a.startDateTime?.toDate?.();
                const end = a.endDateTime?.toDate?.();
                if (!start || !end)
                    continue;
                if (end <= now)
                    continue;
                const s = toGuatemalaDayAndMinutes(start);
                const e = toGuatemalaDayAndMinutes(end);
                if (s.dayKey !== e.dayKey) {
                    conflicts.push(`Cita paciente ${doc.id} cruza medianoche`);
                    continue;
                }
                const dayRanges = normalizedSchedule[s.dayKey] || [];
                if (!isIntervalCoveredByRanges(s.minutes, e.minutes, dayRanges)) {
                    conflicts.push(`Cita paciente ${doc.id} (${start.toISOString()})`);
                }
            }
        }
        const blocksSnap = await firebase_1.db.collection(`users/${claims.uid}/time_blocks`).where('status', '==', 'ACTIVE').get().catch(() => null);
        if (blocksSnap) {
            for (const doc of blocksSnap.docs) {
                const b = doc.data();
                const start = b.startDateTime?.toDate?.();
                const end = b.endDateTime?.toDate?.();
                if (!start || !end)
                    continue;
                if (end <= now)
                    continue;
                const s = toGuatemalaDayAndMinutes(start);
                const e = toGuatemalaDayAndMinutes(end);
                if (s.dayKey !== e.dayKey) {
                    conflicts.push(`Bloqueo ${doc.id} cruza medianoche`);
                    continue;
                }
                const dayRanges = normalizedSchedule[s.dayKey] || [];
                if (!isIntervalCoveredByRanges(s.minutes, e.minutes, dayRanges)) {
                    conflicts.push(`Bloqueo ${doc.id} (${start.toISOString()})`);
                }
            }
        }
        if (conflicts.length > 0) {
            throw new Error(`No puedes guardar este horario porque rompe citas/reservas ya existentes. Ajusta el rango para incluir: ${conflicts.slice(0, 5).join(', ')}`);
        }
        await firebase_1.db.doc(`users/${claims.uid}/availability/default`).set({
            weeklySchedule: body.weeklySchedule,
            timezone: body.timezone,
            slotMinutes: body.slotMinutes,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/appointments/patientPhone/startVerification', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z
            .object({
            patientPhone: zod_1.z.string().min(8),
            wantsWhatsapp: zod_1.z.boolean().default(true),
        })
            .parse(req.body || {});
        const phoneE164 = normalizeE164Phone(body.patientPhone);
        if (!phoneE164)
            throw new Error('Número de teléfono inválido');
        if (!body.wantsWhatsapp) {
            res.json({ ok: true, verificationRequired: false });
            return;
        }
        const code = `${Math.floor(100000 + Math.random() * 900000)}`;
        const verificationRef = firebase_1.db.collection(`users/${claims.uid}/patient_phone_verifications`).doc();
        const expiresAt = firestore_1.Timestamp.fromDate(new Date(Date.now() + 10 * 60 * 1000));
        await verificationRef.set({
            verificationId: verificationRef.id,
            doctorUid: claims.uid,
            phoneE164,
            wantsWhatsapp: true,
            verified: false,
            codeHash: hashPhoneVerify(claims.uid, phoneE164, code),
            attempts: 0,
            expiresAt,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        const whatsappSent = await sendWhatsAppTemplate({
            to: phoneE164,
            templateName: process.env.WA_TPL_PHONE_VERIFY || '',
            bodyParams: [code],
            fallbackText: `Tu código de verificación Medyko es ${code}. Expira en 10 minutos.`,
        });
        if (!whatsappSent) {
            throw new Error('No se pudo enviar el código por WhatsApp. Verifica plantillas y token de Meta.');
        }
        res.json({
            ok: true,
            verificationRequired: true,
            verificationId: verificationRef.id,
            expiresInSeconds: 600,
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/appointments/patientPhone/confirmVerification', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z
            .object({
            verificationId: zod_1.z.string().min(1),
            code: zod_1.z.string().regex(/^\d{6}$/),
        })
            .parse(req.body || {});
        const ref = firebase_1.db.doc(`users/${claims.uid}/patient_phone_verifications/${body.verificationId}`);
        const snap = await ref.get();
        if (!snap.exists)
            throw new Error('Verificación no encontrada');
        const data = snap.data();
        const phoneE164 = String(data.phoneE164 || '');
        if (!phoneE164)
            throw new Error('Verificación inválida');
        const expiresAt = data.expiresAt?.toDate?.();
        if (!expiresAt || expiresAt.getTime() < Date.now()) {
            throw new Error('Código expirado');
        }
        const expectedHash = String(data.codeHash || '');
        const providedHash = hashPhoneVerify(claims.uid, phoneE164, body.code);
        if (!expectedHash || expectedHash !== providedHash) {
            const nextAttempts = Number(data.attempts || 0) + 1;
            await ref.set({ attempts: nextAttempts, updatedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
            throw new Error('Código inválido');
        }
        const verificationToken = createPhoneVerificationToken(body.verificationId);
        const tokenHash = hashGenericToken(verificationToken);
        await ref.set({
            verified: true,
            verifiedAt: firestore_1.FieldValue.serverTimestamp(),
            phoneVerificationTokenHash: tokenHash,
            phoneVerificationTokenExpiresAt: firestore_1.Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000)),
            codeHash: firestore_1.FieldValue.delete(),
            attempts: firestore_1.FieldValue.delete(),
            expiresAt: firestore_1.FieldValue.delete(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({
            ok: true,
            verified: true,
            verificationToken,
            phoneE164,
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/appointments/mine/list', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z
            .object({
            dateFrom: zod_1.z.string().optional(),
            dateTo: zod_1.z.string().optional(),
            limit: zod_1.z.number().int().positive().max(300).optional(),
        })
            .parse(req.body || {});
        const limit = body.limit || 150;
        const dateFrom = body.dateFrom ? parseIsoDate(body.dateFrom, 'dateFrom') : null;
        const dateTo = body.dateTo ? parseIsoDate(body.dateTo, 'dateTo') : null;
        const snap = await firebase_1.db.collection(`users/${claims.uid}/patient_appointments`).orderBy('startDateTime', 'asc').limit(limit).get();
        const dek = await getDoctorDekOrNull(claims.uid);
        const items = snap.docs
            .map((d) => {
            const data = d.data();
            const appointmentId = String(data.appointmentId || d.id);
            const sensitive = decodeAppointmentSensitive(data, dek, claims.uid, appointmentId);
            const start = data.startDateTime?.toDate?.();
            const end = data.endDateTime?.toDate?.();
            return {
                id: d.id,
                patientName: sensitive.patientName,
                patientEmail: sensitive.patientEmail,
                patientPhoneE164: sensitive.patientPhoneE164,
                patientWhatsappOptIn: Boolean(data.patientWhatsappOptIn),
                patientPhoneVerified: Boolean(data.patientPhoneVerified),
                notes: sensitive.notes,
                status: String(data.status || 'CONFIRMED'),
                startDateTime: start ? start.toISOString() : null,
                endDateTime: end ? end.toISOString() : null,
            };
        })
            .filter((item) => {
            if (!item.startDateTime || !item.endDateTime)
                return false;
            const start = new Date(item.startDateTime);
            if (dateFrom && start < dateFrom)
                return false;
            if (dateTo && start > dateTo)
                return false;
            return true;
        });
        res.json({ appointments: items });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/appointments/mine/slots', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z
            .object({
            date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
            .parse(req.body || {});
        const dayKey = dayKeyFromDate(body.date);
        const scheduleSnap = await firebase_1.db.doc(`users/${claims.uid}/availability/default`).get();
        const data = scheduleSnap.exists ? scheduleSnap.data() : {};
        const slotMinutes = Number(data.slotMinutes || 60);
        const ranges = normalizeRanges((data.weeklySchedule?.[dayKey] || []));
        if (ranges.length === 0) {
            res.json({ slots: [] });
            return;
        }
        const dayStart = toDateAtGuatemala(body.date, '00:00');
        const dayEnd = toDateAtGuatemala(body.date, '23:59');
        const busy = [];
        const apptSnap = await firebase_1.db.collection(`users/${claims.uid}/patient_appointments`).get().catch(() => null);
        if (apptSnap) {
            for (const doc of apptSnap.docs) {
                const a = doc.data();
                const status = String(a.status || 'CONFIRMED').toUpperCase();
                if (status === 'CANCELLED')
                    continue;
                const start = a.startDateTime?.toDate?.();
                const end = a.endDateTime?.toDate?.();
                if (!start || !end)
                    continue;
                if (start < dayEnd && end > dayStart)
                    busy.push({ start, end });
            }
        }
        const bookingSnap = await firebase_1.db.collectionGroup('bookings').where('doctorId', '==', claims.uid).where('status', 'in', ['PENDING', 'CONFIRMED']).get();
        for (const doc of bookingSnap.docs) {
            const b = doc.data();
            const start = b.startDateTime?.toDate?.();
            const end = b.endDateTime?.toDate?.();
            if (!start || !end)
                continue;
            if (start < dayEnd && end > dayStart)
                busy.push({ start, end });
        }
        const blocksSnap = await firebase_1.db.collection(`users/${claims.uid}/time_blocks`).where('status', '==', 'ACTIVE').get().catch(() => null);
        if (blocksSnap) {
            for (const doc of blocksSnap.docs) {
                const b = doc.data();
                const start = b.startDateTime?.toDate?.();
                const end = b.endDateTime?.toDate?.();
                if (!start || !end)
                    continue;
                if (start < dayEnd && end > dayStart)
                    busy.push({ start, end });
            }
        }
        const slots = [];
        for (const range of ranges) {
            for (let start = range.start; start + slotMinutes <= range.end; start += slotMinutes) {
                const end = start + slotMinutes;
                const startDate = toDateAtGuatemala(body.date, toHHMM(start));
                const endDate = toDateAtGuatemala(body.date, toHHMM(end));
                const overlaps = busy.some((b) => startDate < b.end && endDate > b.start);
                slots.push({
                    label: `${toHHMM(start)} - ${toHHMM(end)}`,
                    startDateTime: startDate.toISOString(),
                    endDateTime: endDate.toISOString(),
                    available: !overlaps,
                });
            }
        }
        res.json({ slots });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/appointments/mine/create', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z
            .object({
            patientName: zod_1.z.string().min(2).max(120),
            patientEmail: zod_1.z.string().email().optional(),
            patientPhone: zod_1.z.string().optional(),
            source: zod_1.z.enum(['STANDARD', 'EMERGENCY']).default('STANDARD'),
            emergencyId: zod_1.z.string().optional(),
            wantsWhatsapp: zod_1.z.boolean().default(false),
            phoneVerificationToken: zod_1.z.string().optional(),
            startDateTime: zod_1.z.string(),
            endDateTime: zod_1.z.string(),
            notes: zod_1.z.string().max(1200).optional(),
        })
            .parse(req.body);
        const start = parseIsoDate(body.startDateTime, 'startDateTime');
        const end = parseIsoDate(body.endDateTime, 'endDateTime');
        if (end <= start)
            throw new Error('endDateTime debe ser mayor que startDateTime');
        const conflict = await hasDoctorTimeConflict(claims.uid, start, end);
        if (conflict)
            throw new Error('Conflicto de horario con una reserva/cita existente');
        let resolvedPatientName = body.patientName.trim();
        let resolvedPatientPhoneE164 = normalizeE164Phone(body.patientPhone || '');
        if (body.source === 'EMERGENCY') {
            if (!body.emergencyId)
                throw new Error('emergencyId requerido para citas de emergencia');
            let emergencySnap = await firebase_1.db.doc(`doctors/${claims.uid}/emergencies/${body.emergencyId}`).get().catch(() => null);
            if (!emergencySnap?.exists) {
                const byField = await firebase_1.db
                    .collection(`doctors/${claims.uid}/emergencies`)
                    .where('emergencyId', '==', body.emergencyId)
                    .limit(1)
                    .get()
                    .catch(() => null);
                if (byField && !byField.empty)
                    emergencySnap = byField.docs[0];
            }
            if (!emergencySnap?.exists)
                throw new Error('Emergencia no encontrada');
            const emergency = emergencySnap.data() || {};
            const encrypted = (emergency.ciphertext || {});
            const dek = await getDoctorDekOrNull(claims.uid);
            const emergencyPatientName = decryptDoctorField(encrypted, dek, claims.uid, 'patientName');
            const emergencyPatientPhoneE164 = normalizeE164Phone(decryptDoctorField(encrypted, dek, claims.uid, 'patientPhoneE164'));
            if (!emergencyPatientPhoneE164)
                throw new Error('La solicitud de emergencia no tiene teléfono válido');
            resolvedPatientName = emergencyPatientName || resolvedPatientName;
            resolvedPatientPhoneE164 = emergencyPatientPhoneE164;
        }
        const ref = firebase_1.db.collection(`users/${claims.uid}/patient_appointments`).doc();
        const manageToken = crypto_1.default.randomUUID().replace(/-/g, '');
        const manageTokenHash = hashManageToken(ref.id, manageToken);
        const patientPhoneE164 = resolvedPatientPhoneE164;
        const patientPhoneVerified = Boolean(patientPhoneE164);
        const wantsWhatsapp = Boolean(patientPhoneE164);
        const patientName = resolvedPatientName;
        const notes = body.notes || '';
        const doctorProfile = await getDoctorPublicSnapshot(claims.uid).catch(() => null);
        const doctorName = String(doctorProfile?.fullName || 'Doctor');
        const manageLink = buildAppointmentManageLink(ref.id, manageToken);
        const sensitive = await encryptAppointmentSensitive(claims.uid, ref.id, {
            patientName,
            patientPhoneE164,
            patientEmail: body.patientEmail || '',
            notes,
        });
        await ref.set({
            appointmentId: ref.id,
            doctorId: claims.uid,
            patientName: '',
            patientEmail: '',
            patientPhoneE164: '',
            patientWhatsappOptIn: wantsWhatsapp,
            patientPhoneVerified,
            notes: '',
            sensitiveCipher: sensitive.sensitiveCipher,
            encryptedSchemaVersion: sensitive.encryptedSchemaVersion,
            keyVersion: sensitive.keyVersion,
            status: 'CONFIRMED',
            startDateTime: firestore_1.Timestamp.fromDate(start),
            endDateTime: firestore_1.Timestamp.fromDate(end),
            manageTokenHash,
            manageLink,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        await upsertPublicAppointmentLookup(claims.uid, ref.id).catch(() => null);
        let whatsappSent = false;
        if (patientPhoneE164 && wantsWhatsapp && patientPhoneVerified) {
            if (body.source === 'EMERGENCY') {
                whatsappSent = await sendPatientEmergencyScheduledTemplate({
                    patientName,
                    doctorName,
                    start,
                    manageLink,
                    patientPhoneE164,
                });
            }
            else {
                whatsappSent = await sendPatientTemplateByAction({
                    patientName,
                    doctorName,
                    action: 'created',
                    start,
                    end,
                    manageLink,
                    patientPhoneE164,
                });
            }
        }
        const doctorPhoneE164 = normalizeE164Phone(String(doctorProfile?.phone || ''));
        const hoursUntilStart = (start.getTime() - Date.now()) / (1000 * 60 * 60);
        if (body.source !== 'EMERGENCY' && doctorPhoneE164 && hoursUntilStart >= 0 && hoursUntilStart < 24) {
            await sendDoctorTemplateByAction({
                action: 'booked_lt24',
                doctorPhoneE164,
                doctorName,
                patientName,
                start,
                linkArg: buttonArgFromLink(manageLink),
            });
        }
        res.json({
            ok: true,
            appointmentId: ref.id,
            manageLink,
            whatsappSent,
            warning: wantsWhatsapp && patientPhoneVerified && !whatsappSent ? 'Cita guardada, pero no se pudo enviar WhatsApp al paciente.' : null,
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/appointments/mine/checkConflict', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z
            .object({
            startDateTime: zod_1.z.string(),
            endDateTime: zod_1.z.string(),
        })
            .parse(req.body || {});
        const start = parseIsoDate(body.startDateTime, 'startDateTime');
        const end = parseIsoDate(body.endDateTime, 'endDateTime');
        if (end <= start)
            throw new Error('endDateTime debe ser mayor que startDateTime');
        const conflict = await hasDoctorTimeConflict(claims.uid, start, end);
        res.json({
            conflict,
            message: conflict ? 'El horario interfiere con una cita o reserva existente.' : null,
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/appointments/mine/update', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z
            .object({
            appointmentId: zod_1.z.string().min(1),
            patientName: zod_1.z.string().min(2).max(120).optional(),
            patientEmail: zod_1.z.string().email().optional(),
            patientPhone: zod_1.z.string().optional(),
            wantsWhatsapp: zod_1.z.boolean().optional(),
            phoneVerificationToken: zod_1.z.string().optional(),
            startDateTime: zod_1.z.string().optional(),
            endDateTime: zod_1.z.string().optional(),
            notes: zod_1.z.string().max(1200).optional(),
            status: zod_1.z.enum(['CONFIRMED', 'CANCELLED']).optional(),
        })
            .parse(req.body);
        const ref = firebase_1.db.doc(`users/${claims.uid}/patient_appointments/${body.appointmentId}`);
        const snap = await ref.get();
        if (!snap.exists)
            throw new Error('Cita no encontrada');
        const current = snap.data();
        const dek = await getDoctorDekOrNull(claims.uid);
        const currentSensitive = decodeAppointmentSensitive(current, dek, claims.uid, body.appointmentId);
        const previousStart = current.startDateTime?.toDate?.();
        const previousEnd = current.endDateTime?.toDate?.();
        const start = body.startDateTime ? parseIsoDate(body.startDateTime, 'startDateTime') : current.startDateTime?.toDate?.();
        const end = body.endDateTime ? parseIsoDate(body.endDateTime, 'endDateTime') : current.endDateTime?.toDate?.();
        if (!start || !end)
            throw new Error('Horario inválido');
        if (end <= start)
            throw new Error('endDateTime debe ser mayor que startDateTime');
        const nextStatus = body.status || String(current.status || 'CONFIRMED');
        if (nextStatus !== 'CANCELLED') {
            const conflict = await hasDoctorTimeConflict(claims.uid, start, end, body.appointmentId);
            if (conflict)
                throw new Error('Conflicto de horario con una reserva/cita existente');
        }
        const nextPatientEmail = body.patientEmail ?? currentSensitive.patientEmail;
        const nextPatientName = body.patientName ?? currentSensitive.patientName;
        const nextPatientPhone = body.patientPhone ?? currentSensitive.patientPhoneE164;
        const nextPatientPhoneE164 = normalizeE164Phone(nextPatientPhone);
        const nextWhatsappOptIn = Boolean(nextPatientPhoneE164);
        const nextPhoneVerified = Boolean(nextPatientPhoneE164);
        const nextNotes = body.notes ?? currentSensitive.notes;
        const nextSensitive = await encryptAppointmentSensitive(claims.uid, body.appointmentId, {
            patientName: nextPatientName,
            patientPhoneE164: nextPatientPhoneE164,
            patientEmail: nextPatientEmail,
            notes: nextNotes,
        });
        await ref.set({
            patientName: '',
            patientEmail: '',
            patientPhoneE164: '',
            patientWhatsappOptIn: nextWhatsappOptIn,
            patientPhoneVerified: nextPhoneVerified,
            notes: '',
            sensitiveCipher: nextSensitive.sensitiveCipher,
            encryptedSchemaVersion: nextSensitive.encryptedSchemaVersion,
            keyVersion: nextSensitive.keyVersion,
            status: nextStatus,
            startDateTime: firestore_1.Timestamp.fromDate(start),
            endDateTime: firestore_1.Timestamp.fromDate(end),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        if (nextPatientEmail) {
            if (nextStatus === 'CANCELLED') {
                await sendEmail({
                    to: nextPatientEmail,
                    subject: 'Tu cita fue cancelada',
                    text: `La cita con tu doctor para ${start.toLocaleString('es-GT')} fue cancelada.`,
                });
            }
            else if (previousStart &&
                previousEnd &&
                (previousStart.getTime() !== start.getTime() || previousEnd.getTime() !== end.getTime())) {
                await sendEmail({
                    to: nextPatientEmail,
                    subject: 'Tu cita fue reprogramada',
                    text: `Nueva fecha de cita: ${start.toLocaleString('es-GT')} a ${end.toLocaleString('es-GT')}.`,
                });
            }
        }
        const wasRescheduled = Boolean(previousStart && previousEnd) &&
            (previousStart.getTime() !== start.getTime() || previousEnd.getTime() !== end.getTime());
        const shouldCreateBlock = Boolean(previousStart && previousEnd) &&
            (nextStatus === 'CANCELLED' || wasRescheduled);
        if (shouldCreateBlock) {
            const blockId = `${body.appointmentId}_${previousStart.getTime()}_${previousEnd.getTime()}`;
            await firebase_1.db.doc(`users/${claims.uid}/time_blocks/${blockId}`).set({
                blockId,
                doctorId: claims.uid,
                source: 'APPOINTMENT_DOCTOR_ACTION',
                sourceAppointmentId: body.appointmentId,
                reason: nextStatus === 'CANCELLED' ? 'DOCTOR_CANCELLED_APPOINTMENT' : 'DOCTOR_RESCHEDULED_APPOINTMENT',
                startDateTime: firestore_1.Timestamp.fromDate(previousStart),
                endDateTime: firestore_1.Timestamp.fromDate(previousEnd),
                status: 'ACTIVE',
                createdAt: firestore_1.FieldValue.serverTimestamp(),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        const doctorProfile = await getDoctorPublicSnapshot(claims.uid).catch(() => null);
        const doctorName = String(doctorProfile?.fullName || 'Doctor');
        const appointmentId = body.appointmentId;
        const manageTokenHash = String(current.manageTokenHash || '');
        let manageLink = String(current.manageLink || '');
        if (!manageTokenHash) {
            const token = crypto_1.default.randomUUID().replace(/-/g, '');
            const tokenHash = hashManageToken(appointmentId, token);
            manageLink = buildAppointmentManageLink(appointmentId, token);
            await ref.set({ manageTokenHash: tokenHash, manageLink }, { merge: true });
        }
        let whatsappSent = false;
        if (nextPatientPhoneE164 && nextWhatsappOptIn && nextPhoneVerified) {
            if (nextStatus === 'CANCELLED') {
                whatsappSent = await sendPatientTemplateByAction({
                    patientPhoneE164: nextPatientPhoneE164,
                    patientName: String(nextPatientName || 'Paciente'),
                    doctorName,
                    action: 'cancelled',
                    start,
                    end,
                    manageLink,
                });
            }
            else if (wasRescheduled) {
                whatsappSent = await sendPatientTemplateByAction({
                    patientPhoneE164: nextPatientPhoneE164,
                    patientName: String(nextPatientName || 'Paciente'),
                    doctorName,
                    action: 'rescheduled',
                    start,
                    end,
                    previousStart,
                    manageLink,
                });
            }
        }
        res.json({
            ok: true,
            whatsappSent,
            warning: nextWhatsappOptIn && nextPhoneVerified && !whatsappSent && (nextStatus === 'CANCELLED' || wasRescheduled)
                ? 'Cita actualizada, pero no se pudo enviar WhatsApp al paciente.'
                : null,
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/appointments/public/get', async (req, res) => {
    try {
        const body = zod_1.z.object({ appointmentId: zod_1.z.string().min(1), token: zod_1.z.string().min(10) }).parse(req.body);
        const found = await findPatientAppointmentById(body.appointmentId);
        if (!found || !found.snap.exists)
            throw new Error('Cita no encontrada');
        const doc = found.snap;
        const data = doc.data();
        const doctorId = String(data.doctorId || found.doctorId || '');
        const dek = doctorId ? await getDoctorDekOrNull(doctorId) : null;
        const sensitive = decodeAppointmentSensitive(data, dek, doctorId, body.appointmentId);
        const expectedHash = String(data.manageTokenHash || '');
        const providedHash = hashManageToken(body.appointmentId, body.token);
        if (!expectedHash || expectedHash !== providedHash)
            throw new Error('Token inválido');
        const start = data.startDateTime?.toDate?.();
        const end = data.endDateTime?.toDate?.();
        res.json({
            appointment: {
                appointmentId: data.appointmentId || doc.id,
                doctorId,
                patientName: sensitive.patientName,
                patientEmail: sensitive.patientEmail,
                patientPhoneE164: sensitive.patientPhoneE164,
                patientWhatsappOptIn: Boolean(data.patientWhatsappOptIn),
                patientPhoneVerified: Boolean(data.patientPhoneVerified),
                notes: sensitive.notes,
                status: String(data.status || 'CONFIRMED'),
                startDateTime: start ? start.toISOString() : null,
                endDateTime: end ? end.toISOString() : null,
            },
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/appointments/public/action', async (req, res) => {
    try {
        const body = zod_1.z
            .object({
            appointmentId: zod_1.z.string().min(1),
            token: zod_1.z.string().min(10),
            action: zod_1.z.enum(['CANCEL', 'RESCHEDULE']),
            startDateTime: zod_1.z.string().optional(),
            endDateTime: zod_1.z.string().optional(),
        })
            .parse(req.body);
        const found = await findPatientAppointmentById(body.appointmentId);
        if (!found || !found.snap.exists)
            throw new Error('Cita no encontrada');
        const doc = found.snap;
        const data = doc.data();
        const doctorId = String(data.doctorId || found.doctorId || '');
        if (!doctorId)
            throw new Error('Cita inválida');
        const dek = await getDoctorDekOrNull(doctorId);
        const sensitive = decodeAppointmentSensitive(data, dek, doctorId, body.appointmentId);
        const expectedHash = String(data.manageTokenHash || '');
        const providedHash = hashManageToken(body.appointmentId, body.token);
        if (!expectedHash || expectedHash !== providedHash)
            throw new Error('Token inválido');
        const currentStart = data.startDateTime?.toDate?.();
        const currentEnd = data.endDateTime?.toDate?.();
        if (!currentStart || !currentEnd)
            throw new Error('Cita sin horario');
        const nextStatus = body.action === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED';
        const nextStart = body.action === 'RESCHEDULE'
            ? parseIsoDate(body.startDateTime || '', 'startDateTime')
            : currentStart;
        const nextEnd = body.action === 'RESCHEDULE'
            ? parseIsoDate(body.endDateTime || '', 'endDateTime')
            : currentEnd;
        if (nextEnd <= nextStart)
            throw new Error('endDateTime debe ser mayor que startDateTime');
        if (body.action === 'RESCHEDULE') {
            const conflict = await hasDoctorTimeConflict(doctorId, nextStart, nextEnd, body.appointmentId);
            if (conflict)
                throw new Error('Conflicto de horario');
        }
        await doc.ref.set({
            status: nextStatus,
            startDateTime: firestore_1.Timestamp.fromDate(nextStart),
            endDateTime: firestore_1.Timestamp.fromDate(nextEnd),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        const patientPhoneE164 = normalizeE164Phone(sensitive.patientPhoneE164);
        const patientWhatsappOptIn = Boolean(data.patientWhatsappOptIn);
        const patientPhoneVerified = Boolean(data.patientPhoneVerified);
        const doctorProfile = await getDoctorPublicSnapshot(doctorId).catch(() => null);
        const doctorName = String(doctorProfile?.fullName || 'Doctor');
        const manageLink = buildAppointmentManageLink(body.appointmentId, body.token);
        if (patientPhoneE164 && patientWhatsappOptIn && patientPhoneVerified) {
            await sendPatientTemplateByAction({
                patientPhoneE164,
                patientName: String(sensitive.patientName || 'Paciente'),
                doctorName,
                action: body.action === 'CANCEL' ? 'cancelled' : 'rescheduled',
                start: nextStart,
                end: nextEnd,
                previousStart: currentStart,
                manageLink,
            });
        }
        const doctorPhoneE164 = normalizeE164Phone(String(doctorProfile?.phone || ''));
        if (doctorPhoneE164) {
            if (body.action === 'CANCEL') {
                await sendDoctorTemplateByAction({
                    action: 'cancelled_by_patient',
                    doctorPhoneE164,
                    doctorName,
                    patientName: String(sensitive.patientName || 'Paciente'),
                    start: currentStart,
                    linkArg: buttonArgFromLink(manageLink),
                });
            }
            else {
                await sendDoctorTemplateByAction({
                    action: 'rescheduled_by_patient',
                    doctorPhoneE164,
                    doctorName,
                    patientName: String(sensitive.patientName || 'Paciente'),
                    start: nextStart,
                    previousStart: currentStart,
                    linkArg: buttonArgFromLink(manageLink),
                });
            }
        }
        res.json({ ok: true, status: nextStatus });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/assistant/agenda/query', async (req, res) => {
    try {
        const configuredSecret = process.env.CLOUD_RUN_SHARED_SECRET || '';
        if (configuredSecret) {
            const provided = String(req.header('x-webhook-secret') || req.header('x-assistant-secret') || '');
            if (!provided || provided !== configuredSecret) {
                res.status(401).json({ error: 'unauthorized' });
                return;
            }
        }
        const body = zod_1.z
            .object({
            doctorUid: zod_1.z.string().optional(),
            senderPhone: zod_1.z.string().optional(),
            intent: zod_1.z.enum(['NEXT_PATIENT', 'LAST_TODAY', 'TODAY_SUMMARY']).default('NEXT_PATIENT'),
            nowIso: zod_1.z.string().optional(),
        })
            .parse(req.body || {});
        let doctorUid = String(body.doctorUid || '').trim();
        if (!doctorUid && body.senderPhone) {
            doctorUid = (await resolveDoctorUidByPhone(body.senderPhone)) || '';
        }
        if (!doctorUid)
            throw new Error('No se pudo identificar al doctor por UID o teléfono');
        const now = body.nowIso ? new Date(body.nowIso) : new Date();
        if (Number.isNaN(now.getTime()))
            throw new Error('nowIso inválido');
        const dek = await getDoctorDekOrNull(doctorUid);
        const apptCol = firebase_1.db.collection(`users/${doctorUid}/patient_appointments`);
        if (body.intent === 'NEXT_PATIENT') {
            const snap = await apptCol
                .where('startDateTime', '>=', firestore_1.Timestamp.fromDate(now))
                .orderBy('startDateTime', 'asc')
                .limit(40)
                .get();
            const next = snap.docs
                .map((d) => ({ _id: d.id, ...(d.data() || {}) }))
                .find((a) => String(a.status || 'CONFIRMED') !== 'CANCELLED');
            if (!next) {
                res.json({ ok: true, doctorUid, intent: body.intent, found: false, message: 'No tienes próximos pacientes agendados.' });
                return;
            }
            const start = next.startDateTime?.toDate ? next.startDateTime.toDate() : null;
            const end = next.endDateTime?.toDate ? next.endDateTime.toDate() : null;
            const startFmt = start ? formatDateTimeGT(start) : null;
            const nextApptId = String(next.appointmentId || next._id || '');
            const nextSensitive = decodeAppointmentSensitive(next, dek, doctorUid, nextApptId);
            res.json({
                ok: true,
                doctorUid,
                intent: body.intent,
                found: true,
                appointment: {
                    appointmentId: nextApptId,
                    patientName: nextSensitive.patientName || 'Paciente',
                    reason: next.reason || '',
                    status: next.status || 'CONFIRMED',
                    startDateTime: start?.toISOString() || null,
                    endDateTime: end?.toISOString() || null,
                    dateText: startFmt?.dateText || '',
                    timeText: startFmt?.timeText || '',
                },
            });
            return;
        }
        const { startUtc, endUtc } = getGtDayBounds(now);
        const todaySnap = await apptCol
            .where('startDateTime', '>=', firestore_1.Timestamp.fromDate(startUtc))
            .where('startDateTime', '<=', firestore_1.Timestamp.fromDate(endUtc))
            .orderBy('startDateTime', 'asc')
            .limit(300)
            .get();
        const todayItems = todaySnap.docs
            .map((d) => ({ _id: d.id, ...(d.data() || {}) }))
            .filter((a) => String(a.status || 'CONFIRMED') !== 'CANCELLED');
        if (body.intent === 'LAST_TODAY') {
            const last = todayItems.length > 0 ? todayItems[todayItems.length - 1] : null;
            if (!last) {
                res.json({ ok: true, doctorUid, intent: body.intent, found: false, message: 'No tienes pacientes hoy.' });
                return;
            }
            const start = last.startDateTime?.toDate ? last.startDateTime.toDate() : null;
            const end = last.endDateTime?.toDate ? last.endDateTime.toDate() : null;
            const startFmt = start ? formatDateTimeGT(start) : null;
            const lastApptId = String(last.appointmentId || last._id || '');
            const lastSensitive = decodeAppointmentSensitive(last, dek, doctorUid, lastApptId);
            res.json({
                ok: true,
                doctorUid,
                intent: body.intent,
                found: true,
                appointment: {
                    appointmentId: lastApptId,
                    patientName: lastSensitive.patientName || 'Paciente',
                    reason: last.reason || '',
                    status: last.status || 'CONFIRMED',
                    startDateTime: start?.toISOString() || null,
                    endDateTime: end?.toISOString() || null,
                    dateText: startFmt?.dateText || '',
                    timeText: startFmt?.timeText || '',
                },
            });
            return;
        }
        const nowMs = now.getTime();
        const pending = todayItems.filter((a) => {
            const start = a.startDateTime?.toDate ? a.startDateTime.toDate() : null;
            return start ? start.getTime() >= nowMs : false;
        }).length;
        const completed = todayItems.length - pending;
        res.json({
            ok: true,
            doctorUid,
            intent: body.intent,
            found: true,
            summary: {
                totalToday: todayItems.length,
                pendingToday: pending,
                completedOrPastToday: completed,
            },
            appointments: todayItems.slice(0, 50).map((a) => {
                const start = a.startDateTime?.toDate ? a.startDateTime.toDate() : null;
                const fmt = start ? formatDateTimeGT(start) : null;
                const apptId = String(a.appointmentId || a._id || '');
                const sensitive = decodeAppointmentSensitive(a, dek, doctorUid, apptId);
                return {
                    appointmentId: apptId,
                    patientName: sensitive.patientName || 'Paciente',
                    status: a.status || 'CONFIRMED',
                    dateText: fmt?.dateText || '',
                    timeText: fmt?.timeText || '',
                };
            }),
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/appointments/emergency', async (req, res) => {
    try {
        const body = zod_1.z
            .object({
            doctorUid: zod_1.z.string().min(1),
            patientName: zod_1.z.string().min(2).max(120),
            patientAge: zod_1.z.number().int().min(0).max(120),
            patientPhone: zod_1.z.string().min(8),
            description: zod_1.z.string().min(3).max(1000),
            consentAccepted: zod_1.z.literal(true),
            appointmentId: zod_1.z.string().optional(),
        })
            .parse(req.body);
        const doctorProfile = await getDoctorPublicSnapshot(body.doctorUid);
        if (!doctorProfile)
            throw new Error('Doctor no encontrado');
        const clientIpHash = hashConsentIp(extractClientIp(req));
        const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
        const doctorName = String(doctorProfile.fullName || 'Doctor');
        const doctorPhoneE164 = normalizeE164Phone(String(doctorProfile.phone || ''));
        if (!doctorPhoneE164)
            throw new Error('Doctor sin teléfono de WhatsApp configurado');
        const key = await getOrCreateDoctorDek(body.doctorUid);
        const dek = await (0, crypto_2.unwrapDek)(key);
        const patientPhoneE164 = normalizeE164Phone(body.patientPhone);
        if (!patientPhoneE164)
            throw new Error('Número de teléfono inválido');
        const encrypted = {
            patientName: (0, crypto_2.encryptField)(body.patientName.trim(), dek, { clinicId: 'N/A', docId: body.doctorUid, fieldName: 'patientName', schemaVersion: '1' }, key.keyVersion),
            patientAge: (0, crypto_2.encryptField)(body.patientAge, dek, { clinicId: 'N/A', docId: body.doctorUid, fieldName: 'patientAge', schemaVersion: '1' }, key.keyVersion),
            patientPhoneE164: (0, crypto_2.encryptField)(patientPhoneE164, dek, { clinicId: 'N/A', docId: body.doctorUid, fieldName: 'patientPhoneE164', schemaVersion: '1' }, key.keyVersion),
            description: (0, crypto_2.encryptField)(body.description.trim(), dek, { clinicId: 'N/A', docId: body.doctorUid, fieldName: 'description', schemaVersion: '1' }, key.keyVersion),
        };
        const emergencyRef = firebase_1.db.collection(`doctors/${body.doctorUid}/emergencies`).doc();
        const emergencyId = body.appointmentId || emergencyRef.id;
        await emergencyRef.set({
            emergencyId: emergencyId,
            doctorUid: body.doctorUid,
            ciphertext: encrypted,
            encryptedSchemaVersion: 1,
            keyVersion: key.keyVersion,
            consent: {
                accepted: true,
                acceptedAt: firestore_1.FieldValue.serverTimestamp(),
                ipHash: clientIpHash || null,
                userAgent: userAgent || null,
                policyVersion: '2026-03-02',
            },
            status: 'OPEN',
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        const whatsappSent = await sendDoctorTemplateByAction({
            action: 'emergency',
            doctorPhoneE164,
            doctorName,
            patientName: body.patientName.trim(),
            patientAge: body.patientAge,
            description: body.description.trim(),
            start: new Date(),
            linkArg: emergencyId,
        });
        await emergencyRef.set({
            whatsappSent: Boolean(whatsappSent),
            whatsappLastAttemptAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({
            ok: true,
            emergencyId,
            whatsappSent: Boolean(whatsappSent),
            warning: whatsappSent ? null : 'Emergencia guardada, pero no se pudo enviar WhatsApp al doctor.',
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/appointments/emergency/get', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'platform_admin']);
        const body = zod_1.z
            .object({
            emergencyId: zod_1.z.string().min(1),
            doctorUid: zod_1.z.string().optional(),
        })
            .parse(req.body || {});
        const targetDoctorUid = claims.role === 'platform_admin' ? String(body.doctorUid || claims.uid) : claims.uid;
        if (!targetDoctorUid)
            throw new Error('Doctor inválido');
        let emergencySnap = await firebase_1.db.doc(`doctors/${targetDoctorUid}/emergencies/${body.emergencyId}`).get().catch(() => null);
        if (!emergencySnap?.exists) {
            const byField = await firebase_1.db
                .collection(`doctors/${targetDoctorUid}/emergencies`)
                .where('emergencyId', '==', body.emergencyId)
                .limit(1)
                .get()
                .catch(() => null);
            if (byField && !byField.empty)
                emergencySnap = byField.docs[0];
        }
        if (!emergencySnap?.exists)
            throw new Error('Emergencia no encontrada');
        const row = emergencySnap.data() || {};
        const encrypted = (row.ciphertext || {});
        const dek = await getDoctorDekOrNull(targetDoctorUid);
        const patientName = decryptDoctorField(encrypted, dek, targetDoctorUid, 'patientName') || '-';
        const patientAgeRaw = decryptDoctorField(encrypted, dek, targetDoctorUid, 'patientAge');
        const patientPhoneE164 = normalizeE164Phone(decryptDoctorField(encrypted, dek, targetDoctorUid, 'patientPhoneE164'));
        const description = decryptDoctorField(encrypted, dek, targetDoctorUid, 'description') || '';
        res.json({
            emergency: {
                emergencyId: String(row.emergencyId || emergencySnap.id),
                doctorUid: targetDoctorUid,
                patientName,
                patientAge: Number(patientAgeRaw || 0),
                patientPhoneE164,
                description,
                status: String(row.status || 'OPEN'),
                whatsappSent: Boolean(row.whatsappSent),
                createdAt: row.createdAt?.toDate?.()?.toISOString?.() || null,
            },
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/bookings/cancel', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin', 'platform_admin']);
        const body = zod_1.z.object({ clinicId: zod_1.z.string(), bookingId: zod_1.z.string(), reason: zod_1.z.string().max(500).optional() }).parse(req.body);
        const bookingRef = firebase_1.db.doc(`clinics/${body.clinicId}/bookings/${body.bookingId}`);
        const bookingSnap = await bookingRef.get();
        if (!bookingSnap.exists)
            throw new Error('Booking no encontrado');
        const booking = bookingSnap.data();
        const doctorId = String(booking.doctorId || '');
        if (claims.role === 'doctor' && doctorId !== claims.uid)
            throw new Error('FORBIDDEN');
        if (claims.role === 'clinic_admin' && claims.clinicId !== body.clinicId)
            throw new Error('FORBIDDEN clinic mismatch');
        if (String(booking.status || '') === 'CANCELLED') {
            res.json({ ok: true, alreadyCancelled: true });
            return;
        }
        await bookingRef.set({
            status: 'CANCELLED',
            cancelledBy: claims.uid,
            cancelledReason: body.reason || '',
            cancelledAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            auditLog: firestore_1.FieldValue.arrayUnion({
                action: 'BOOKING_CANCELLED',
                actor: claims.uid,
                reason: body.reason || '',
                timestamp: new Date().toISOString(),
            }),
        }, { merge: true });
        const clinicSnap = await firebase_1.db.doc(`clinics/${body.clinicId}`).get().catch(() => null);
        const clinicOwnerUid = clinicSnap?.exists ? String(clinicSnap.data().ownerUid || '') : '';
        const doctorEmail = doctorId ? await getUserEmail(doctorId) : null;
        const ownerEmail = clinicOwnerUid ? await getUserEmail(clinicOwnerUid) : null;
        const listingType = String(booking.listingType || '');
        const start = booking.startDateTime?.toDate?.();
        const subject = `Reserva cancelada (${listingType === 'OR' ? 'Quirófano' : 'Clínica'})`;
        const whenText = start ? start.toLocaleString('es-GT') : 'fecha no disponible';
        const reasonText = body.reason?.trim() ? `Motivo: ${body.reason.trim()}` : 'Sin motivo';
        const text = `Se canceló la reserva ${body.bookingId} para ${whenText}. ${reasonText}`;
        if (doctorEmail)
            await sendEmail({ to: doctorEmail, subject, text });
        if (ownerEmail && ownerEmail !== doctorEmail)
            await sendEmail({ to: ownerEmail, subject, text });
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/crypto/patient/encryptAndCreate', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['clinic_admin', 'doctor', 'platform_admin']);
        const body = zod_1.z
            .object({
            clinicId: zod_1.z.string().optional(),
            fullName: zod_1.z.string(),
            age: zod_1.z.number().int().nonnegative(),
            idNumber: zod_1.z.string(),
            dateOfBirth: zod_1.z.string(),
        })
            .parse(req.body);
        const clinicId = body.clinicId || claims.clinicId;
        if (!clinicId)
            throw new Error('clinicId requerido');
        const key = await getOrCreatePatientDek(clinicId);
        const dek = await (0, crypto_2.unwrapDek)(key);
        const patientRef = firebase_1.db.collection(`clinics/${clinicId}/patients_cipher`).doc();
        const encrypted = {
            fullName: (0, crypto_2.encryptField)(body.fullName, dek, { clinicId, docId: patientRef.id, fieldName: 'fullName', schemaVersion: '1' }, key.keyVersion),
            age: (0, crypto_2.encryptField)(body.age, dek, { clinicId, docId: patientRef.id, fieldName: 'age', schemaVersion: '1' }, key.keyVersion),
            idNumber: (0, crypto_2.encryptField)(body.idNumber, dek, { clinicId, docId: patientRef.id, fieldName: 'idNumber', schemaVersion: '1' }, key.keyVersion),
            dateOfBirth: (0, crypto_2.encryptField)(body.dateOfBirth, dek, { clinicId, docId: patientRef.id, fieldName: 'dateOfBirth', schemaVersion: '1' }, key.keyVersion),
        };
        await patientRef.set({
            clinicId,
            createdBy: claims.uid,
            schemaVersion: 1,
            ciphertext: encrypted,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        res.json({ patientCipherRef: patientRef.path });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/crypto/patient/decrypt', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['clinic_admin', 'platform_admin']);
        const body = zod_1.z.object({ clinicId: zod_1.z.string(), patientCipherId: zod_1.z.string() }).parse(req.body);
        if (claims.role === 'clinic_admin' && claims.clinicId !== body.clinicId) {
            throw new Error('FORBIDDEN clinic mismatch');
        }
        const patientSnap = await firebase_1.db.doc(`clinics/${body.clinicId}/patients_cipher/${body.patientCipherId}`).get();
        if (!patientSnap.exists)
            throw new Error('Paciente no existe');
        const key = await getOrCreatePatientDek(body.clinicId);
        const dek = await (0, crypto_2.unwrapDek)(key);
        const data = patientSnap.data();
        const cipher = data.ciphertext;
        const decrypted = {
            fullName: (0, crypto_2.decryptField)(cipher.fullName, dek, { clinicId: body.clinicId, docId: body.patientCipherId, fieldName: 'fullName', schemaVersion: '1' }),
            age: (0, crypto_2.decryptField)(cipher.age, dek, { clinicId: body.clinicId, docId: body.patientCipherId, fieldName: 'age', schemaVersion: '1' }),
            idNumber: (0, crypto_2.decryptField)(cipher.idNumber, dek, { clinicId: body.clinicId, docId: body.patientCipherId, fieldName: 'idNumber', schemaVersion: '1' }),
            dateOfBirth: (0, crypto_2.decryptField)(cipher.dateOfBirth, dek, { clinicId: body.clinicId, docId: body.patientCipherId, fieldName: 'dateOfBirth', schemaVersion: '1' }),
        };
        res.json({ patient: decrypted });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/crypto/doctor/encryptAndUpsert', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'platform_admin']);
        const body = zod_1.z
            .object({
            uid: zod_1.z.string().optional(),
            fullName: zod_1.z.string(),
            phone: zod_1.z.string(),
            licenseNumber: zod_1.z.string(),
        })
            .parse(req.body);
        const targetUid = claims.role === 'platform_admin' ? body.uid || claims.uid : claims.uid;
        const key = await getOrCreateDoctorDek(targetUid);
        const dek = await (0, crypto_2.unwrapDek)(key);
        const encrypted = {
            fullName: (0, crypto_2.encryptField)(body.fullName, dek, { clinicId: 'N/A', docId: targetUid, fieldName: 'fullName', schemaVersion: '1' }, key.keyVersion),
            phone: (0, crypto_2.encryptField)(body.phone, dek, { clinicId: 'N/A', docId: targetUid, fieldName: 'phone', schemaVersion: '1' }, key.keyVersion),
            licenseNumber: (0, crypto_2.encryptField)(body.licenseNumber, dek, { clinicId: 'N/A', docId: targetUid, fieldName: 'licenseNumber', schemaVersion: '1' }, key.keyVersion),
        };
        await firebase_1.db.doc(`doctors/${targetUid}/private/profile`).set({
            ciphertext: encrypted,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/crypto/doctor/decrypt', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'platform_admin']);
        const body = zod_1.z.object({ uid: zod_1.z.string().optional() }).parse(req.body);
        const targetUid = claims.role === 'platform_admin' ? body.uid || claims.uid : claims.uid;
        if (claims.role === 'doctor' && targetUid !== claims.uid) {
            throw new Error('FORBIDDEN');
        }
        const profileSnap = await firebase_1.db.doc(`doctors/${targetUid}/private/profile`).get();
        if (!profileSnap.exists)
            throw new Error('Perfil no encontrado');
        const key = await getOrCreateDoctorDek(targetUid);
        const dek = await (0, crypto_2.unwrapDek)(key);
        const cipher = profileSnap.data().ciphertext;
        const decrypted = {
            fullName: (0, crypto_2.decryptField)(cipher.fullName, dek, { clinicId: 'N/A', docId: targetUid, fieldName: 'fullName', schemaVersion: '1' }),
            phone: (0, crypto_2.decryptField)(cipher.phone, dek, { clinicId: 'N/A', docId: targetUid, fieldName: 'phone', schemaVersion: '1' }),
            licenseNumber: (0, crypto_2.decryptField)(cipher.licenseNumber, dek, { clinicId: 'N/A', docId: targetUid, fieldName: 'licenseNumber', schemaVersion: '1' }),
            idNumber: cipher.idNumber
                ? (0, crypto_2.decryptField)(cipher.idNumber, dek, { clinicId: 'N/A', docId: targetUid, fieldName: 'idNumber', schemaVersion: '1' })
                : null,
            dateOfBirth: cipher.dateOfBirth
                ? (0, crypto_2.decryptField)(cipher.dateOfBirth, dek, { clinicId: 'N/A', docId: targetUid, fieldName: 'dateOfBirth', schemaVersion: '1' })
                : null,
        };
        res.json({ profile: decrypted });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/bookings/create', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        const body = zod_1.z
            .object({
            clinicId: zod_1.z.string(),
            listingType: zod_1.z.enum(['CLINIC', 'OR']),
            listingId: zod_1.z.string(),
            startDateTime: zod_1.z.string(),
            endDateTime: zod_1.z.string(),
            patientId: zod_1.z.string().optional(),
            patientCipherRef: zod_1.z.string().optional(),
            baseRent: zod_1.z.number().positive(),
        })
            .parse(req.body);
        const accessRef = firebase_1.db.doc(`clinics/${body.clinicId}/doctor_access/${claims.uid}`);
        const accessSnap = await accessRef.get();
        const access = accessSnap.exists ? accessSnap.data() : null;
        if (!access || access.status !== 'APPROVED') {
            await accessRef.set({
                clinicId: body.clinicId,
                doctorId: claims.uid,
                status: access?.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
                requestedAt: access?.status ? accessSnap.data()?.requestedAt || firestore_1.FieldValue.serverTimestamp() : firestore_1.FieldValue.serverTimestamp(),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
            throw new Error('DOCTOR_EN_ESPERA_APROBACION_CLINICA');
        }
        const conflict = await (0, availability_1.hasBookingConflict)(body);
        if (conflict)
            throw new Error('Conflicto de horario');
        const bookingRef = firebase_1.db.collection(`clinics/${body.clinicId}/bookings`).doc();
        const priceBreakdown = (0, payments_1.computePricing)(body.baseRent);
        await firebase_1.db.runTransaction(async (trx) => {
            const overlap = await firebase_1.db
                .collection(`clinics/${body.clinicId}/bookings`)
                .where('listingId', '==', body.listingId)
                .where('startDateTime', '<', firestore_1.Timestamp.fromDate(new Date(body.endDateTime)))
                .where('endDateTime', '>', firestore_1.Timestamp.fromDate(new Date(body.startDateTime)))
                .where('status', 'in', ['PENDING', 'CONFIRMED'])
                .limit(1)
                .get();
            if (!overlap.empty) {
                throw new Error('Slot ocupado');
            }
            trx.set(bookingRef, {
                bookingId: bookingRef.id,
                clinicId: body.clinicId,
                listingType: body.listingType,
                listingId: body.listingId,
                doctorId: claims.uid,
                patientId: body.patientId || null,
                patientCipherRef: body.patientCipherRef || null,
                startDateTime: firestore_1.Timestamp.fromDate(new Date(body.startDateTime)),
                endDateTime: firestore_1.Timestamp.fromDate(new Date(body.endDateTime)),
                status: 'PENDING',
                paymentStatus: 'UNPAID',
                priceBreakdown,
                auditLog: [
                    {
                        action: 'BOOKING_CREATED',
                        actor: claims.uid,
                        timestamp: new Date().toISOString(),
                    },
                ],
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
        });
        res.json({ bookingId: bookingRef.id });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/bookings/ownerReserveDay', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin']);
        const body = zod_1.z
            .object({
            clinicId: zod_1.z.string().optional(),
            listingType: zod_1.z.enum(['CLINIC', 'OR']),
            listingId: zod_1.z.string(),
            date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            minLeadHours: zod_1.z.number().int().positive().optional(),
        })
            .parse(req.body);
        const clinicId = resolveClinicIdFromClaims(claims, body.clinicId);
        if (!clinicId)
            throw new Error('clinicId requerido');
        if (claims.role !== 'platform_admin' && claims.clinicId && claims.clinicId !== clinicId)
            throw new Error('FORBIDDEN clinic mismatch');
        const collection = body.listingType === 'OR' ? 'or_listings' : 'clinics_listings';
        const listingRef = firebase_1.db.doc(`clinics/${clinicId}/${collection}/${body.listingId}`);
        const listingSnap = await listingRef.get();
        if (!listingSnap.exists)
            throw new Error('Listing no encontrado');
        const listing = listingSnap.data();
        if (String(listing.ownerId || '') !== claims.uid) {
            throw new Error('Solo el owner de la clínica puede bloquear por día');
        }
        const startDate = new Date(`${body.date}T00:00:00-06:00`);
        const endDate = new Date(`${body.date}T23:59:59-06:00`);
        const leadHours = body.minLeadHours || Number(listing.availability?.minLeadTimeHours || 24);
        const minStart = new Date(Date.now() + leadHours * 60 * 60 * 1000);
        if (startDate < minStart) {
            throw new Error(`Debes reservar con al menos ${leadHours} horas de anticipación`);
        }
        const overlap = await firebase_1.db
            .collection(`clinics/${clinicId}/bookings`)
            .where('listingId', '==', body.listingId)
            .where('startDateTime', '<=', firestore_1.Timestamp.fromDate(endDate))
            .where('endDateTime', '>=', firestore_1.Timestamp.fromDate(startDate))
            .where('status', 'in', ['PENDING', 'CONFIRMED'])
            .limit(1)
            .get();
        if (!overlap.empty) {
            throw new Error('Ya existen reservaciones en ese día');
        }
        const bookingRef = firebase_1.db.collection(`clinics/${clinicId}/bookings`).doc();
        await bookingRef.set({
            bookingId: bookingRef.id,
            clinicId,
            listingType: body.listingType,
            listingId: body.listingId,
            doctorId: claims.uid,
            patientId: null,
            patientCipherRef: null,
            startDateTime: firestore_1.Timestamp.fromDate(startDate),
            endDateTime: firestore_1.Timestamp.fromDate(endDate),
            status: 'CONFIRMED',
            paymentStatus: 'UNPAID',
            bookingKind: 'OWNER_DAY_BLOCK',
            isOwnerReservation: true,
            priceBreakdown: (0, payments_1.computePricing)(0),
            auditLog: [
                {
                    action: 'OWNER_DAY_BLOCK_CREATED',
                    actor: claims.uid,
                    timestamp: new Date().toISOString(),
                },
            ],
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        res.json({ bookingId: bookingRef.id, ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/bookings/listForClinic', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin', 'platform_admin']);
        const body = zod_1.z.object({ clinicId: zod_1.z.string().optional(), limit: zod_1.z.number().int().positive().max(200).optional() }).parse(req.body || {});
        const clinicId = resolveClinicIdFromClaims(claims, body.clinicId);
        if (!clinicId)
            throw new Error('clinicId requerido');
        const limit = body.limit || 100;
        const snap = await firebase_1.db.collection(`clinics/${clinicId}/bookings`).orderBy('startDateTime', 'desc').limit(limit).get();
        const bookings = snap.docs.map((d) => {
            const b = d.data();
            return {
                bookingId: d.id,
                clinicId,
                listingType: b.listingType,
                listingId: b.listingId,
                doctorId: b.doctorId,
                status: b.status,
                paymentStatus: b.paymentStatus,
                bookingKind: b.bookingKind || 'STANDARD',
                startDateTime: b.startDateTime?.toDate?.()?.toISOString?.() || null,
                endDateTime: b.endDateTime?.toDate?.()?.toISOString?.() || null,
                review: b.review || null,
            };
        });
        res.json({ bookings });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/bookings/listMine', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'platform_admin']);
        const body = zod_1.z.object({ doctorId: zod_1.z.string().optional(), limit: zod_1.z.number().int().positive().max(300).optional() }).parse(req.body || {});
        const doctorId = claims.role === 'doctor' ? claims.uid : body.doctorId;
        if (!doctorId)
            throw new Error('doctorId requerido');
        const limit = body.limit || 120;
        const snap = await firebase_1.db.collectionGroup('bookings').where('doctorId', '==', doctorId).limit(limit * 3).get();
        const bookings = snap.docs
            .map((d) => {
            const b = d.data();
            return {
                bookingId: b.bookingId || d.id,
                clinicId: b.clinicId || null,
                listingType: b.listingType || null,
                listingId: b.listingId || null,
                status: b.status || null,
                paymentStatus: b.paymentStatus || null,
                startDateTime: b.startDateTime?.toDate?.()?.toISOString?.() || null,
                endDateTime: b.endDateTime?.toDate?.()?.toISOString?.() || null,
            };
        })
            .sort((a, b) => {
            const at = a.startDateTime ? new Date(a.startDateTime).getTime() : 0;
            const bt = b.startDateTime ? new Date(b.startDateTime).getTime() : 0;
            return bt - at;
        })
            .slice(0, limit);
        res.json({ bookings });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/bookings/reviewDoctor', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin', 'platform_admin']);
        const body = zod_1.z
            .object({
            clinicId: zod_1.z.string().optional(),
            bookingId: zod_1.z.string(),
            rating: zod_1.z.number().int().min(1).max(5),
            comment: zod_1.z.string().max(1500).optional(),
        })
            .parse(req.body);
        const clinicId = resolveClinicIdFromClaims(claims, body.clinicId);
        if (!clinicId)
            throw new Error('clinicId requerido');
        const bookingRef = firebase_1.db.doc(`clinics/${clinicId}/bookings/${body.bookingId}`);
        const bookingSnap = await bookingRef.get();
        if (!bookingSnap.exists)
            throw new Error('Booking no encontrado');
        const booking = bookingSnap.data();
        const end = booking.endDateTime?.toDate?.();
        if (!end || end.getTime() > Date.now()) {
            throw new Error('Solo puedes calificar reservas ya finalizadas');
        }
        if (String(booking.status || '') === 'CANCELLED') {
            throw new Error('No se puede calificar una reserva cancelada');
        }
        const doctorId = String(booking.doctorId || '');
        if (!doctorId)
            throw new Error('Booking sin doctor');
        const reviewPayload = {
            rating: body.rating,
            comment: body.comment?.trim() || '',
            byClinicAdmin: claims.uid,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        };
        await bookingRef.set({ review: reviewPayload }, { merge: true });
        await firebase_1.db.doc(`doctors/${doctorId}/reviews/${body.bookingId}`).set({
            bookingId: body.bookingId,
            clinicId,
            doctorId,
            ...reviewPayload,
        }, { merge: true });
        const ratingStats = await getDoctorRatingStats(doctorId);
        await upsertActiveDoctor(doctorId, {
            avgRating: ratingStats.avgRating,
            totalReviews: ratingStats.totalReviews,
        });
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/doctors/myRatingSummary', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'platform_admin']);
        const body = zod_1.z.object({ doctorId: zod_1.z.string().optional() }).parse(req.body || {});
        const doctorId = claims.role === 'doctor' ? claims.uid : body.doctorId;
        if (!doctorId)
            throw new Error('doctorId requerido');
        const snap = await firebase_1.db.collection(`doctors/${doctorId}/reviews`).get();
        const ratings = snap.docs
            .map((d) => Number(d.data().rating || 0))
            .filter((r) => r > 0);
        const count = ratings.length;
        const avg = count ? Number((ratings.reduce((a, b) => a + b, 0) / count).toFixed(2)) : 0;
        const reviewRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const latest = reviewRows
            .sort((a, b) => {
            const at = a.createdAt?.toDate?.()?.getTime?.() || 0;
            const bt = b.createdAt?.toDate?.()?.getTime?.() || 0;
            return bt - at;
        })
            .slice(0, 5)
            .map((r) => ({
            bookingId: r.bookingId || r.id,
            rating: r.rating || 0,
            comment: r.comment || '',
        }));
        res.json({ avgRating: avg, totalReviews: count, latest });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/payments/createCheckout', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor']);
        if (!claims.doctorVerified) {
            throw new Error('Doctor no verificado');
        }
        const body = zod_1.z.object({ bookingId: zod_1.z.string() }).parse(req.body);
        const bookingGroup = await firebase_1.db.collectionGroup('bookings').where('bookingId', '==', body.bookingId).limit(1).get();
        if (bookingGroup.empty)
            throw new Error('Booking no encontrado');
        const bookingDoc = bookingGroup.docs[0];
        const booking = bookingDoc.data();
        if (booking.doctorId !== claims.uid)
            throw new Error('FORBIDDEN');
        const access = await getDoctorClinicAccess(booking.clinicId, claims.uid);
        if (!access || access.status !== 'APPROVED') {
            throw new Error('DOCTOR_EN_ESPERA_APROBACION_CLINICA');
        }
        const conflict = await (0, availability_1.hasBookingConflict)({
            clinicId: booking.clinicId,
            listingId: booking.listingId,
            startDateTime: booking.startDateTime.toDate().toISOString(),
            endDateTime: booking.endDateTime.toDate().toISOString(),
        });
        if (!conflict) {
            throw new Error('Reserva inválida o removida por carrera');
        }
        const breakdown = (0, payments_1.computePricing)(booking.priceBreakdown.baseRent);
        const checkout = await (0, payments_1.createRecurrenteCheckout)({
            bookingId: body.bookingId,
            clinicId: booking.clinicId,
            amount: breakdown.total,
            description: `Reserva Medyko ${body.bookingId}`,
        });
        await bookingDoc.ref.update({ paymentStatus: 'CHECKOUT_CREATED' });
        await bookingDoc.ref.collection('paymentAttempts').doc(checkout.checkoutId).set({
            bookingId: body.bookingId,
            amounts: breakdown,
            recurrenteCheckoutId: checkout.checkoutId,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        res.json({ checkoutUrl: checkout.checkoutUrl });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/platform/admin/overview', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['platform_admin']);
        const body = zod_1.z.object({ limit: zod_1.z.number().int().positive().max(300).optional() }).parse(req.body || {});
        const limit = body.limit || 120;
        const usersSnap = await firebase_1.db.collection('users').limit(1000).get();
        const users = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
        const clinicAdmins = users.filter((u) => Boolean(u.primaryClinicId));
        const doctors = users.filter((u) => u.role === 'doctor');
        const clinicContacts = await Promise.all(clinicAdmins.map(async (u) => {
            const authUser = await firebase_1.adminAuth.getUser(u.uid).catch(() => null);
            return {
                uid: u.uid,
                clinicId: u.primaryClinicId || null,
                name: authUser?.displayName || null,
                email: authUser?.email || null,
                phone: authUser?.phoneNumber || u.phone || null,
            };
        }));
        const doctorContacts = await Promise.all(doctors.map(async (u) => {
            const authUser = await firebase_1.adminAuth.getUser(u.uid).catch(() => null);
            const verSnap = await firebase_1.db.doc(`doctors/${u.uid}/verification/status`).get().catch(() => null);
            const ver = verSnap?.exists ? verSnap.data() : {};
            const identitySnap = await firebase_1.db.doc(`doctors/${u.uid}/verification/identity`).get().catch(() => null);
            const identity = identitySnap?.exists ? identitySnap.data() : {};
            let decryptedName = null;
            try {
                const profileSnap = await firebase_1.db.doc(`doctors/${u.uid}/private/profile`).get();
                if (profileSnap.exists) {
                    const profile = profileSnap.data();
                    const cipher = (profile.ciphertext || {});
                    if (cipher.fullName) {
                        const key = await getOrCreateDoctorDek(u.uid);
                        const dek = await (0, crypto_2.unwrapDek)(key);
                        decryptedName = (0, crypto_2.decryptField)(cipher.fullName, dek, {
                            clinicId: 'N/A',
                            docId: u.uid,
                            fieldName: 'fullName',
                            schemaVersion: '1',
                        });
                    }
                }
            }
            catch {
                decryptedName = null;
            }
            return {
                uid: u.uid,
                name: decryptedName || authUser?.displayName || null,
                email: authUser?.email || null,
                phone: authUser?.phoneNumber || u.phone || null,
                verified: Boolean(ver?.stripeVerified),
                hasFullName: Boolean(identity?.hasFullName),
                hasDateOfBirth: Boolean(identity?.hasDateOfBirth),
                hasIdNumber: Boolean(identity?.hasIdNumber),
                idNumberLast4: identity?.idNumberLast4 || null,
            };
        }));
        const bookingsSnap = await firebase_1.db.collectionGroup('bookings').limit(Math.max(limit * 4, 200)).get();
        const bookingHistory = bookingsSnap.docs
            .map((d) => {
            const b = d.data();
            return {
                bookingId: b.bookingId || d.id,
                clinicId: b.clinicId || null,
                listingType: b.listingType || null,
                listingId: b.listingId || null,
                doctorId: b.doctorId || null,
                status: b.status || null,
                paymentStatus: b.paymentStatus || null,
                startDateTime: b.startDateTime?.toDate?.()?.toISOString?.() || null,
                endDateTime: b.endDateTime?.toDate?.()?.toISOString?.() || null,
            };
        })
            .sort((a, b) => {
            const at = a.startDateTime ? new Date(a.startDateTime).getTime() : 0;
            const bt = b.startDateTime ? new Date(b.startDateTime).getTime() : 0;
            return bt - at;
        })
            .slice(0, limit);
        const dekCache = new Map();
        const getDekCached = async (doctorId) => {
            if (!doctorId)
                return null;
            if (dekCache.has(doctorId))
                return dekCache.get(doctorId) || null;
            const dek = await getDoctorDekOrNull(doctorId);
            dekCache.set(doctorId, dek);
            return dek;
        };
        const apptSnap = await firebase_1.db.collectionGroup('patient_appointments').limit(Math.max(limit * 6, 300)).get();
        const patientAppointmentsRaw = await Promise.all(apptSnap.docs.map(async (d) => {
            const row = d.data() || {};
            const appointmentId = String(row.appointmentId || d.id);
            const doctorId = String(row.doctorId || '');
            const dek = await getDekCached(doctorId);
            const sensitive = decodeAppointmentSensitive(row, dek, doctorId, appointmentId);
            return {
                appointmentId,
                doctorId: doctorId || null,
                patientName: sensitive.patientName || '-',
                status: String(row.status || 'CONFIRMED'),
                startDateTime: row.startDateTime?.toDate?.()?.toISOString?.() || null,
                endDateTime: row.endDateTime?.toDate?.()?.toISOString?.() || null,
                consentAccepted: Boolean(row.consent?.accepted),
                consentAt: row.consent?.acceptedAt || null,
                consentPolicyVersion: String(row.consent?.policyVersion || ''),
            };
        }));
        const patientAppointments = patientAppointmentsRaw
            .sort((a, b) => {
            const at = a.startDateTime ? new Date(a.startDateTime).getTime() : 0;
            const bt = b.startDateTime ? new Date(b.startDateTime).getTime() : 0;
            return bt - at;
        })
            .slice(0, limit);
        const emergenciesSnap = await firebase_1.db.collectionGroup('emergencies').limit(Math.max(limit * 4, 200)).get();
        const emergencies = emergenciesSnap.docs
            .map((d) => {
            const row = d.data() || {};
            return {
                emergencyId: String(row.emergencyId || d.id),
                doctorUid: String(row.doctorUid || ''),
                status: String(row.status || 'OPEN'),
                createdAt: row.createdAt || null,
                whatsappSent: Boolean(row.whatsappSent),
                consentAccepted: Boolean(row.consent?.accepted),
                consentAt: row.consent?.acceptedAt || null,
                consentPolicyVersion: String(row.consent?.policyVersion || ''),
            };
        })
            .sort((a, b) => {
            const at = (a.createdAt && typeof a.createdAt?.toDate === 'function'
                ? a.createdAt.toDate().getTime()
                : a.createdAt
                    ? new Date(String(a.createdAt)).getTime()
                    : 0) || 0;
            const bt = (b.createdAt && typeof b.createdAt?.toDate === 'function'
                ? b.createdAt.toDate().getTime()
                : b.createdAt
                    ? new Date(String(b.createdAt)).getTime()
                    : 0) || 0;
            return bt - at;
        })
            .slice(0, limit);
        res.json({
            totals: {
                clinics: clinicContacts.length,
                doctors: doctorContacts.length,
                bookings: bookingHistory.length,
            },
            clinicContacts,
            doctorContacts,
            bookingHistory,
            patientAppointments,
            emergencies,
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
async function handleRecurrenteWebhook(req, res) {
    try {
        const signature = req.headers['x-recurrente-signature'] || req.headers['svix-signature'];
        if (!signature || signature !== process.env.RECURRENTE_WEBHOOK_SECRET) {
            throw new Error('Firma inválida');
        }
        const event = zod_1.z.object({ id: zod_1.z.string(), type: zod_1.z.string(), data: zod_1.z.any().optional() }).parse(req.body);
        const eventType = event.type;
        const root = req.body;
        const dataObject = (root.data && (root.data.object || root.data)) || {};
        const metadata = (dataObject.metadata || root.metadata || {});
        const bookingId = metadata.bookingId || dataObject.bookingId;
        const clinicId = metadata.clinicId || dataObject.clinicId;
        if (!bookingId || !clinicId) {
            throw new Error('Evento sin bookingId/clinicId en metadata');
        }
        const eventRef = firebase_1.db.doc(`webhook_events/${event.id}`);
        const eventSnap = await eventRef.get();
        if (eventSnap.exists) {
            res.json({ ok: true, idempotent: true });
            return;
        }
        const bookingRef = firebase_1.db.doc(`clinics/${clinicId}/bookings/${bookingId}`);
        const bookingSnap = await bookingRef.get();
        if (!bookingSnap.exists)
            throw new Error('Booking no encontrado');
        const booking = bookingSnap.data();
        const paid = eventType === 'payment_intent.succeeded' || eventType === 'checkout.succeeded';
        const failed = eventType === 'payment_intent.failed' || eventType === 'checkout.failed';
        const refunded = eventType === 'refund.create' || eventType === 'checkout.refunded';
        const paymentStatus = paid ? 'PAID' : failed ? 'FAILED' : refunded ? 'REFUNDED' : 'UNPAID';
        const status = paid ? 'CONFIRMED' : booking.status;
        await firebase_1.db.runTransaction(async (trx) => {
            trx.set(eventRef, { createdAt: firestore_1.FieldValue.serverTimestamp(), event });
            trx.update(bookingRef, { paymentStatus, status });
            if (paid) {
                const baseRent = booking.priceBreakdown.baseRent;
                const platformFee = Number((baseRent * 0.1).toFixed(2));
                const processingFee = Number((baseRent * 0.045 + 2).toFixed(2));
                trx.set(firebase_1.db.collection(`clinics/${booking.clinicId}/ledger`).doc(), {
                    bookingId: booking.bookingId,
                    listingType: booking.listingType,
                    listingId: booking.listingId,
                    baseRent,
                    platformFee,
                    processingFee,
                    total: Number((baseRent + platformFee + processingFee).toFixed(2)),
                    clinicReceivable: Number((baseRent * 0.9).toFixed(2)),
                    status: 'OPEN',
                    createdAt: firestore_1.FieldValue.serverTimestamp(),
                });
            }
        });
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
}
app.post('/webhooks/recurrente', handleRecurrenteWebhook);
recurrenteWebhookApp.post('/', handleRecurrenteWebhook);
stripeWebhookApp.post('/', handleStripeVerificationWebhook);
app.get('/webhooks/whatsapp', (req, res) => {
    try {
        const mode = String(req.query['hub.mode'] || '');
        const token = String(req.query['hub.verify_token'] || '');
        const challenge = String(req.query['hub.challenge'] || '');
        const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || '';
        if (mode === 'subscribe' && verifyToken && token === verifyToken) {
            res.status(200).send(challenge);
            return;
        }
        res.status(403).send('forbidden');
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/webhooks/whatsapp', async (req, res) => {
    try {
        const payload = req.body;
        const entries = Array.isArray(payload.entry) ? payload.entry : [];
        if (entries.length === 0) {
            res.json({ ok: true, processed: 0, skipped: 0 });
            return;
        }
        let processed = 0;
        let skipped = 0;
        for (const entry of entries) {
            const changes = Array.isArray(entry?.changes) ? entry.changes : [];
            for (const change of changes) {
                const value = (change?.value || {});
                const contacts = Array.isArray(value.contacts) ? value.contacts : [];
                const profileName = String(contacts[0]?.profile?.name || '');
                const messages = Array.isArray(value.messages) ? value.messages : [];
                for (const msg of messages) {
                    const messageId = String(msg?.id || '').trim();
                    if (!messageId)
                        continue;
                    const sender = normalizeE164Phone(String(msg?.from || ''));
                    const type = String(msg?.type || '');
                    if (!sender) {
                        skipped += 1;
                        continue;
                    }
                    const doctorUid = await resolveDoctorUidByPhone(sender).catch(() => null);
                    const dedupeRef = firebase_1.db.doc(`wa_inbound_processed/${messageId}`);
                    const dedupeSnap = await dedupeRef.get();
                    if (dedupeSnap.exists) {
                        skipped += 1;
                        continue;
                    }
                    let normalized = null;
                    if (type === 'text') {
                        const text = String(msg?.text?.body || '').trim();
                        if (!text) {
                            skipped += 1;
                            continue;
                        }
                        normalized = {
                            provider: 'whatsapp',
                            messageId,
                            sender,
                            senderProfileName: profileName,
                            type: 'text',
                            doctorUid: doctorUid || undefined,
                            doctorTimezone: 'America/Guatemala',
                            text,
                            timestamp: String(msg?.timestamp || ''),
                            raw: { context: msg?.context || null },
                        };
                    }
                    else if (type === 'audio') {
                        const mediaId = String(msg?.audio?.id || '').trim();
                        if (!mediaId) {
                            skipped += 1;
                            continue;
                        }
                        normalized = {
                            provider: 'whatsapp',
                            messageId,
                            sender,
                            senderProfileName: profileName,
                            type: 'audio',
                            doctorUid: doctorUid || undefined,
                            doctorTimezone: 'America/Guatemala',
                            mediaId,
                            timestamp: String(msg?.timestamp || ''),
                            raw: { mime_type: msg?.audio?.mime_type || '', sha256: msg?.audio?.sha256 || '' },
                        };
                    }
                    else {
                        skipped += 1;
                        continue;
                    }
                    await dedupeRef.set({
                        messageId,
                        sender,
                        type: normalized.type,
                        status: 'RECEIVED',
                        createdAt: firestore_1.FieldValue.serverTimestamp(),
                    }, { merge: true });
                    await enqueueInboundMessage(normalized);
                    await dedupeRef.set({
                        status: 'QUEUED',
                        queuedAt: firestore_1.FieldValue.serverTimestamp(),
                    }, { merge: true });
                    await processInboundQueueForSender(sender);
                    processed += 1;
                }
            }
        }
        res.json({ ok: true, processed, skipped });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/stripe/verification/start', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin']);
        const stripe = getStripeClient();
        const verificationFlowId = process.env.VERIFICATION_FLOW_ID;
        const body = zod_1.z.object({ returnUrl: zod_1.z.string().url().optional(), target: zod_1.z.enum(['DOCTOR', 'OWNER']).optional() }).safeParse(req.body);
        const subjectType = body.success && body.data.target === 'OWNER' ? 'owner' : 'doctor';
        const returnUrl = body.success && body.data.returnUrl
            ? body.data.returnUrl
            : process.env.LEGACY_STRIPE_RETURN_URL || `http://localhost:5173/${subjectType === 'doctor' ? 'doctor' : 'clinic'}/verify`;
        const createArgs = {
            type: 'document',
            client_reference_id: claims.uid,
            return_url: returnUrl,
            metadata: {
                firebase_uid: claims.uid,
                subjectType,
                clinicId: claims.clinicId || '',
            },
            options: {
                document: {
                    require_live_capture: true,
                    require_matching_selfie: true,
                },
            },
        };
        if (verificationFlowId) {
            createArgs.verification_flow = verificationFlowId;
            delete createArgs.type;
            delete createArgs.options;
        }
        const session = await stripe.identity.verificationSessions.create(createArgs);
        await firebase_1.db.doc(`verification/${claims.uid}`).set({
            uid: claims.uid,
            status: 'pending',
            verification_done: false,
            verified: false,
            sessionId: session.id,
            subjectType,
            clinicId: claims.clinicId || null,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        await firebase_1.db.doc(`stripe_verification_sessions/${session.id}`).set({
            uid: claims.uid,
            subjectType,
            clinicId: claims.clinicId || null,
            returnUrl,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        res.json({ url: session.url || null, sessionId: session.id, status: session.status || 'pending' });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/stripe/verification/status', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin']);
        const stripe = getStripeClient();
        const stripeIdentity = getStripeIdentityClient();
        const body = zod_1.z.object({ sessionId: zod_1.z.string().nullable().optional(), target: zod_1.z.enum(['DOCTOR', 'OWNER']).optional() }).parse(req.body);
        const verificationRef = firebase_1.db.doc(`verification/${claims.uid}`);
        const verificationSnap = await verificationRef.get();
        const currentData = verificationSnap.exists ? verificationSnap.data() : {};
        const sessionId = body.sessionId || currentData.sessionId;
        let status = currentData.status || 'pending';
        let failedAttempts = Number(currentData.failedAttempts || currentData.attempts || 0);
        let verified = Boolean(currentData.verified || currentData.verification_done);
        if (sessionId && !verified) {
            try {
                const session = await stripeIdentity.identity.verificationSessions.retrieve(sessionId);
                status = session.status || status;
                verified = session.status === 'verified';
                if (session.status === 'canceled' || session.status === 'requires_input') {
                    failedAttempts = Math.max(failedAttempts, 1);
                }
            }
            catch (error) {
                if (!isStripeRestrictedIdentityError(error)) {
                    throw error;
                }
                // If key lacks sensitive Identity scope, rely on webhook-updated Firestore state.
            }
        }
        const requestedTarget = body.target === 'OWNER' ? 'owner' : 'doctor';
        if (requestedTarget === 'doctor') {
            await firebase_1.db.doc(`doctors/${claims.uid}/verification/status`).set({
                stripeVerified: verified,
                verificationStatus: status,
                failedAttempts,
                verifiedAt: verified ? firestore_1.FieldValue.serverTimestamp() : null,
            }, { merge: true });
        }
        else if (claims.clinicId) {
            await firebase_1.db.doc(`clinics/${claims.clinicId}/verification/status`).set({
                ownerUid: claims.uid,
                stripeVerified: verified,
                identityVerified: verified,
                verificationStatus: status,
                failedAttempts,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        await verificationRef.set({
            verified,
            verification_done: verified,
            status,
            failedAttempts,
            attempts: failedAttempts,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        if (verified) {
            if (requestedTarget === 'doctor' && sessionId) {
                const identitySnap = await firebase_1.db.doc(`doctors/${claims.uid}/verification/identity`).get().catch(() => null);
                const identity = identitySnap?.exists ? (identitySnap.data() || {}) : {};
                const hasSensitiveAlready = Boolean(identity.hasFullName && identity.hasDateOfBirth);
                try {
                    if (!hasSensitiveAlready) {
                        const fullSession = await stripeIdentity.identity.verificationSessions.retrieve(sessionId, {
                            expand: [
                                'verified_outputs.dob',
                                'last_verification_report.document',
                            ],
                        });
                        await saveDoctorIdentityFromStripe(claims.uid, fullSession);
                    }
                }
                catch (error) {
                    if (!isStripeRestrictedIdentityError(error)) {
                        throw error;
                    }
                    // Keep flow successful when Stripe limits sensitive expansion.
                }
            }
            const user = await firebase_1.adminAuth.getUser(claims.uid);
            await firebase_1.adminAuth.setCustomUserClaims(claims.uid, {
                ...(user.customClaims || {}),
                ...(requestedTarget === 'doctor' ? { doctorIdentityVerified: true } : {}),
                ...(requestedTarget === 'owner' ? { clinicOwnerIdentityVerified: true } : {}),
            });
        }
        const identitySnap = await firebase_1.db.doc(`doctors/${claims.uid}/verification/identity`).get().catch(() => null);
        const identity = identitySnap?.exists ? (identitySnap.data() || {}) : {};
        res.json({
            verified,
            status,
            failedAttempts,
            identitySaved: {
                hasFullName: Boolean(identity.hasFullName),
                hasDateOfBirth: Boolean(identity.hasDateOfBirth),
                hasIdNumber: Boolean(identity.hasIdNumber),
                idNumberLast4: identity.idNumberLast4 || null,
            },
        });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
async function handleStripeVerificationWebhook(req, res) {
    try {
        const primarySecret = process.env.STRIPE_WEBHOOK_SECRET || '';
        const extraSecrets = String(process.env.STRIPE_WEBHOOK_SECRETS || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        const webhookSecrets = Array.from(new Set([primarySecret, ...extraSecrets].filter(Boolean)));
        if (webhookSecrets.length === 0) {
            throw new Error('STRIPE_WEBHOOK_SECRET missing');
        }
        const stripe = getStripeClient();
        const stripeIdentity = getStripeIdentityClient();
        const signature = req.headers['stripe-signature'];
        if (!signature || Array.isArray(signature)) {
            throw new Error('Stripe signature missing');
        }
        const rawCandidate = req.rawBody;
        const rawPayload = Buffer.isBuffer(rawCandidate)
            ? rawCandidate
            : typeof rawCandidate === 'string'
                ? Buffer.from(rawCandidate)
                : Buffer.isBuffer(req.body)
                    ? req.body
                    : Buffer.alloc(0);
        if (!rawPayload.length) {
            throw new Error('stripe_webhook_missing_raw_body');
        }
        let event = null;
        let lastSignatureError = null;
        for (const secret of webhookSecrets) {
            try {
                event = stripe.webhooks.constructEvent(rawPayload, signature, secret);
                break;
            }
            catch (error) {
                lastSignatureError = error;
            }
        }
        if (!event) {
            throw new Error(`stripe_webhook_invalid_signature: ${cleanError(lastSignatureError)}`);
        }
        const dataObject = event.data.object;
        const uid = await resolveStripeVerificationUid(dataObject);
        if (!uid) {
            console.warn('stripe_webhook_uid_not_resolved', {
                sessionId: dataObject.id,
                clientReferenceId: dataObject.client_reference_id || null,
                hasFirebaseUidMetadata: Boolean(dataObject.metadata?.firebase_uid),
            });
            res.json({ ok: true, ignored: true });
            return;
        }
        const verified = event.type === 'identity.verification_session.verified';
        const failed = event.type === 'identity.verification_session.canceled' || event.type === 'identity.verification_session.requires_input';
        if (verified || failed) {
            const verificationRef = firebase_1.db.doc(`verification/${uid}`);
            const verificationSnap = await verificationRef.get();
            const existing = verificationSnap.exists ? verificationSnap.data() : {};
            const sessionMapSnap = dataObject.id ? await firebase_1.db.doc(`stripe_verification_sessions/${dataObject.id}`).get().catch(() => null) : null;
            const sessionMap = sessionMapSnap?.exists ? (sessionMapSnap.data() || {}) : {};
            const subjectType = (dataObject.metadata?.subjectType || sessionMap.subjectType || existing.subjectType || 'doctor');
            const clinicId = (dataObject.metadata?.clinicId || sessionMap.clinicId || existing.clinicId || null);
            const update = {
                sessionId: dataObject.id,
                verified,
                verification_done: verified,
                status: verified ? 'verified' : 'failed',
                subjectType,
                clinicId,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            };
            if (failed) {
                const nextFailed = Number(existing.failedAttempts || existing.attempts || 0) + 1;
                update.failedAttempts = nextFailed;
                update.attempts = nextFailed;
            }
            else {
                update.failedAttempts = 0;
                update.attempts = 0;
            }
            await verificationRef.set(update, { merge: true });
            if (dataObject.id) {
                await firebase_1.db.doc(`stripe_verification_sessions/${dataObject.id}`).set({
                    uid,
                    subjectType,
                    clinicId,
                    lastEventType: event.type,
                    lastEventAt: firestore_1.FieldValue.serverTimestamp(),
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
            if (subjectType === 'doctor') {
                await firebase_1.db.doc(`doctors/${uid}/verification/status`).set({
                    stripeVerified: verified,
                    verificationStatus: verified ? 'verified' : 'failed',
                    failedAttempts: update.failedAttempts ?? 0,
                    verifiedAt: verified ? firestore_1.FieldValue.serverTimestamp() : null,
                }, { merge: true });
            }
            else if (subjectType === 'owner' && clinicId) {
                await firebase_1.db.doc(`clinics/${clinicId}/verification/status`).set({
                    ownerUid: uid,
                    stripeVerified: verified,
                    identityVerified: verified,
                    verificationStatus: verified ? 'verified' : 'failed',
                    failedAttempts: update.failedAttempts ?? 0,
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                }, { merge: true });
            }
            if (verified) {
                if (subjectType === 'doctor') {
                    // Save whatever Identity fields are present directly in webhook payload first.
                    await saveDoctorIdentityFromStripe(uid, dataObject);
                    try {
                        const fullSession = await stripeIdentity.identity.verificationSessions.retrieve(dataObject.id, {
                            expand: [
                                'verified_outputs.dob',
                                'last_verification_report.document',
                            ],
                        });
                        await saveDoctorIdentityFromStripe(uid, fullSession);
                    }
                    catch (error) {
                        if (!isStripeRestrictedIdentityError(error)) {
                            throw error;
                        }
                    }
                }
                const user = await firebase_1.adminAuth.getUser(uid);
                await firebase_1.adminAuth.setCustomUserClaims(uid, {
                    ...(user.customClaims || {}),
                    ...(subjectType === 'doctor' ? { doctorIdentityVerified: true } : {}),
                    ...(subjectType === 'owner' ? { clinicOwnerIdentityVerified: true } : {}),
                });
            }
        }
        res.json({ ok: true });
    }
    catch (error) {
        console.error('stripe_webhook_error', cleanError(error));
        res.status(400).json({ error: cleanError(error) });
    }
}
app.post('/listings/autosaveDraft', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin']);
        const body = zod_1.z
            .object({
            title: zod_1.z.string(),
            zone: zod_1.z.string(),
            type: zod_1.z.enum(['CLINIC', 'OR']),
            photos: zod_1.z.array(zod_1.z.string().url()).max(10).optional(),
        })
            .parse(req.body);
        const clinicId = resolveClinicIdFromClaims(claims);
        if (!clinicId)
            throw new Error('clinicId missing in claims');
        const collection = body.type === 'OR' ? 'or_listings' : 'clinics_listings';
        const draftRef = firebase_1.db.collection(`clinics/${clinicId}/${collection}`).doc('draft_autosave');
        await draftRef.set({
            title: body.title,
            type: body.type,
            location: { city: 'Guatemala', zone: Number(body.zone || 1), address: 'Pendiente' },
            photos: body.photos || [],
            status: 'DRAFT',
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
            ownerId: claims.uid,
            clinicId,
        });
        res.json({ ok: true });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/listings/publish', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin']);
        const body = zod_1.z
            .object({
            title: zod_1.z.string(),
            zone: zod_1.z.string(),
            type: zod_1.z.enum(['CLINIC', 'OR']),
            photos: zod_1.z.array(zod_1.z.string().url()).max(10).optional(),
        })
            .parse(req.body);
        const clinicId = resolveClinicIdFromClaims(claims);
        if (!clinicId)
            throw new Error('clinicId missing in claims');
        const verificationSnap = await firebase_1.db.doc(`clinics/${clinicId}/verification/status`).get();
        const verification = verificationSnap.exists ? verificationSnap.data() : {};
        if (verification.status !== 'APPROVED') {
            throw new Error('Tu clínica aún no está aprobada por plataforma para publicar');
        }
        const existingCollection = body.type === 'OR' ? 'or_listings' : 'clinics_listings';
        const existingByOwner = await firebase_1.db.collection(`clinics/${clinicId}/${existingCollection}`).where('ownerId', '==', claims.uid).get();
        const existingCount = existingByOwner.docs.filter((d) => d.id !== 'draft_autosave').length;
        if (existingCount >= 1) {
            throw new Error(body.type === 'OR'
                ? 'Solo puedes tener 1 quirófano para renta por doctor owner'
                : 'Solo puedes tener 1 clínica para renta por doctor owner');
        }
        const collection = body.type === 'OR' ? 'or_listings' : 'clinics_listings';
        const ref = firebase_1.db.collection(`clinics/${clinicId}/${collection}`).doc();
        await ref.set({
            id: ref.id,
            clinicId,
            ownerId: claims.uid,
            title: body.title,
            description: 'Publicado desde wizard Medyko',
            location: { address: 'Guatemala', city: 'Guatemala', zone: Number(body.zone), lat: null, lng: null },
            photos: body.photos || [],
            status: 'PUBLISHED',
            verificationBadge: false,
            tags: { equipmentTags: [], amenitiesTags: [] },
            policies: { cancellationPolicy: 'Flexible', depositPolicy: 'Sin depósito', requirements: 'Doctor verificado' },
            pricing: { hourly: 0, daily: 0, currency: 'GTQ', priceRules: [] },
            availability: {
                timezone: 'America/Guatemala',
                slotMinutes: 30,
                weeklySchedule: {
                    mon: [{ start: '08:00', end: '17:00' }],
                    tue: [{ start: '08:00', end: '17:00' }],
                    wed: [{ start: '08:00', end: '17:00' }],
                    thu: [{ start: '08:00', end: '17:00' }],
                    fri: [{ start: '08:00', end: '17:00' }],
                    sat: [],
                    sun: [],
                },
                blackoutDates: [],
                minLeadTimeHours: 4,
                maxBookingHours: 8,
                bufferMinutesBetweenBookings: 15,
            },
            ...(body.type === 'OR'
                ? {
                    orType: 'MAJOR',
                    anesthesiaSupport: true,
                    sterileProcessing: true,
                    nursingAvailable: true,
                    nursingStaffTypes: ['instrumentista'],
                    emergencyEquipment: [],
                    allowedProcedures: [],
                    certificationsDocs: [],
                }
                : {
                    consultationRoomsCount: 3,
                    specialtiesAllowed: ['Medicina general'],
                    waitingRoomAvailable: true,
                }),
            createdAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        res.json({ listingId: ref.id });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
app.post('/listings/mine', async (req, res) => {
    try {
        const claims = await (0, auth_1.getClaims)(req);
        (0, auth_1.requireRole)(claims, ['doctor', 'clinic_admin', 'platform_admin']);
        const body = zod_1.z.object({ clinicId: zod_1.z.string().optional() }).parse(req.body || {});
        const clinicId = resolveClinicIdFromClaims(claims, body.clinicId);
        if (!clinicId)
            throw new Error('clinicId requerido');
        const [clinicSnap, orSnap] = await Promise.all([
            firebase_1.db.collection(`clinics/${clinicId}/clinics_listings`).where('ownerId', '==', claims.uid).get(),
            firebase_1.db.collection(`clinics/${clinicId}/or_listings`).where('ownerId', '==', claims.uid).get(),
        ]);
        const listings = [
            ...clinicSnap.docs.map((d) => {
                const row = d.data();
                return {
                    id: d.id,
                    type: 'CLINIC',
                    title: String(row.title || d.id),
                    status: String(row.status || 'DRAFT'),
                };
            }),
            ...orSnap.docs.map((d) => {
                const row = d.data();
                return {
                    id: d.id,
                    type: 'OR',
                    title: String(row.title || d.id),
                    status: String(row.status || 'DRAFT'),
                };
            }),
        ];
        res.json({ listings });
    }
    catch (error) {
        res.status(400).json({ error: cleanError(error) });
    }
});
async function syncPublicListing(clinicId, listingId, type, data) {
    const publicRef = firebase_1.db.doc(`public_listings/${listingId}`);
    if (!data || data.status !== 'PUBLISHED') {
        await publicRef.delete().catch(() => null);
        return;
    }
    const payload = {
        objectID: listingId,
        id: listingId,
        clinicId,
        type,
        title: data.title,
        description: data.description,
        photos: Array.isArray(data.photos) ? data.photos : [],
        zone: data.location?.zone,
        city: data.location?.city,
        tags: data.tags,
        hourly: data.pricing?.hourly ?? null,
        daily: data.pricing?.daily ?? null,
        nursingAvailable: type === 'OR' ? Boolean(data.nursingAvailable) : false,
        status: data.status,
        updatedAt: new Date().toISOString(),
    };
    await publicRef.set(payload, { merge: true });
    const appId = process.env.ALGOLIA_APP_ID;
    const key = process.env.ALGOLIA_ADMIN_KEY;
    const indexName = process.env.ALGOLIA_INDEX || 'public_listings_index';
    if (appId && key) {
        const client = (0, algoliasearch_1.default)(appId, key);
        const index = client.initIndex(indexName);
        await index.saveObject(payload);
    }
}
exports.api = functions.https.onRequest(app);
exports.recurrenteWebhook = functions.https.onRequest(recurrenteWebhookApp);
exports.stripeVerificationWebhook = functions.https.onRequest(stripeWebhookApp);
exports.syncClinicListings = functions.firestore
    .document('clinics/{clinicId}/clinics_listings/{listingId}')
    .onWrite(async (change, context) => {
    const clinicId = context.params.clinicId;
    const listingId = context.params.listingId;
    await syncPublicListing(clinicId, listingId, 'CLINIC', change.after.exists ? change.after.data() : undefined);
});
exports.syncORListings = functions.firestore
    .document('clinics/{clinicId}/or_listings/{listingId}')
    .onWrite(async (change, context) => {
    const clinicId = context.params.clinicId;
    const listingId = context.params.listingId;
    await syncPublicListing(clinicId, listingId, 'OR', change.after.exists ? change.after.data() : undefined);
});
exports.purgeOldAppointmentSensitiveData = functions.pubsub.schedule('every 24 hours').onRun(async () => {
    const retentionDays = Math.max(30, Number(process.env.APPOINTMENT_PII_RETENTION_DAYS || 365));
    const maxUpdates = Math.max(100, Number(process.env.APPOINTMENT_PII_PURGE_MAX_UPDATES || 1200));
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const cutoffTs = firestore_1.Timestamp.fromDate(cutoff);
    const usersSnap = await firebase_1.db.collection('users').select().get();
    let updated = 0;
    for (const userDoc of usersSnap.docs) {
        if (updated >= maxUpdates)
            break;
        const uid = userDoc.id;
        const apptSnap = await firebase_1.db
            .collection(`users/${uid}/patient_appointments`)
            .where('endDateTime', '<=', cutoffTs)
            .limit(Math.min(300, maxUpdates - updated))
            .get()
            .catch(() => null);
        if (!apptSnap || apptSnap.empty)
            continue;
        const batch = firebase_1.db.batch();
        let batchCount = 0;
        for (const apptDoc of apptSnap.docs) {
            if (updated >= maxUpdates)
                break;
            const row = apptDoc.data() || {};
            if (row.piiPurgedAt)
                continue;
            batch.set(apptDoc.ref, {
                patientName: '',
                patientPhoneE164: '',
                patientEmail: '',
                notes: '',
                patientWhatsappOptIn: false,
                patientPhoneVerified: false,
                sensitiveCipher: firestore_1.FieldValue.delete(),
                piiPurgedAt: firestore_1.FieldValue.serverTimestamp(),
                piiRetentionDays: retentionDays,
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            }, { merge: true });
            batchCount += 1;
            updated += 1;
            if (batchCount >= 400)
                break;
        }
        if (batchCount > 0)
            await batch.commit();
    }
    console.log('purgeOldAppointmentSensitiveData complete', { updated, retentionDays, cutoffIso: cutoff.toISOString() });
    return null;
});
