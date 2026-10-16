import crypto from 'node:crypto';
const b = (n: number) => crypto.randomBytes(n).toString('base64');
console.log('# Tempel ke backend/.env – simpan cadangan DATA_KEYS & HMAC_KEY di brankas (bukan di Git)');
console.log(`SESSION_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
console.log(`DATA_KEYS=k1:${b(32)}`);
console.log('DATA_KEY_ACTIVE=k1');
console.log(`HMAC_KEY=${b(32)}`);
