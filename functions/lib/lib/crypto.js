"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.unwrapDek = unwrapDek;
exports.createWrappedDek = createWrappedDek;
exports.encryptField = encryptField;
exports.decryptField = decryptField;
const crypto_1 = __importDefault(require("crypto"));
const KEY_BYTES = 32;
function buildAad(meta) {
    return Buffer.from(JSON.stringify(meta), 'utf-8');
}
function unwrapFallback(wrappedKey) {
    const master = process.env.FALLBACK_MASTER_KEY;
    if (!master) {
        throw new Error('FALLBACK_MASTER_KEY missing');
    }
    const masterKey = Buffer.from(master, 'base64');
    const iv = Buffer.alloc(12, 0);
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', masterKey, iv);
    const payload = Buffer.from(wrappedKey, 'base64');
    const encrypted = payload.subarray(0, payload.length - 16);
    const tag = payload.subarray(payload.length - 16);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
function wrapFallback(rawDek) {
    const master = process.env.FALLBACK_MASTER_KEY;
    if (!master) {
        throw new Error('FALLBACK_MASTER_KEY missing');
    }
    const masterKey = Buffer.from(master, 'base64');
    const iv = Buffer.alloc(12, 0);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(rawDek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([encrypted, tag]).toString('base64');
}
async function unwrapDek(keyDoc) {
    if (process.env.KMS_ENABLED === 'true') {
        throw new Error('KMS integration placeholder: add Cloud KMS unwrap implementation');
    }
    return unwrapFallback(keyDoc.wrappedKey);
}
async function createWrappedDek(keyVersion) {
    const rawDek = crypto_1.default.randomBytes(KEY_BYTES);
    if (process.env.KMS_ENABLED === 'true') {
        throw new Error('KMS integration placeholder: add Cloud KMS wrap implementation');
    }
    return {
        rawDek,
        wrappedKey: wrapFallback(rawDek),
        keyVersion,
    };
}
function encryptField(value, dek, aadMeta, keyVersion) {
    const iv = crypto_1.default.randomBytes(12);
    const aad = buildAad(aadMeta);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(aad);
    const plaintext = Buffer.from(JSON.stringify(value), 'utf-8');
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([encrypted, tag]).toString('base64');
    return {
        v: 1,
        alg: 'AES-GCM',
        iv: iv.toString('base64'),
        aadHash: crypto_1.default.createHash('sha256').update(aad).digest('hex'),
        ciphertext,
        keyVersion,
    };
}
function decryptField(payload, dek, aadMeta) {
    const aad = buildAad(aadMeta);
    const encryptedWithTag = Buffer.from(payload.ciphertext, 'base64');
    const encrypted = encryptedWithTag.subarray(0, encryptedWithTag.length - 16);
    const tag = encryptedWithTag.subarray(encryptedWithTag.length - 16);
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', dek, Buffer.from(payload.iv, 'base64'));
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(plain.toString('utf-8'));
}
