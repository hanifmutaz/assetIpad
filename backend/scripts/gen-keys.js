// Buat nilai acak untuk .env (SESSION_SECRET, DATA_KEYS, HMAC_KEY). Tidak menulis file apa pun.
import crypto from 'node:crypto';
const b = (n) => crypto.randomBytes(n).toString('base64');
console.log('# Tempel ke backend/.env – simpan juga cadangannya di tempat aman (bukan di Git)');
console.log(`SESSION_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
console.log(`DATA_KEYS=k1:${b(32)}`);
console.log('DATA_KEY_ACTIVE=k1');
console.log(`HMAC_KEY=${b(32)}`);
