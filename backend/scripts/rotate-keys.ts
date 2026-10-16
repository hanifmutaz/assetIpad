// Enkripsi ulang semua credential & variabel rahasia dengan DATA_KEY_ACTIVE.
import { cfg } from '../src/config.js';
import { pool, tx } from '../src/db.js';
import { encrypt, decrypt, keyIdOf } from '../src/crypto.js';

let n = 0;
await tx(async (c) => {
  for (const r of (await c.query('SELECT device_id, field, enc FROM device_credential FOR UPDATE')).rows) {
    if (keyIdOf(r.enc) === cfg.activeKeyId) continue;
    const ctx = `device:${r.device_id}:${r.field}`;
    await c.query('UPDATE device_credential SET enc=$3 WHERE device_id=$1 AND field=$2', [r.device_id, r.field, encrypt(decrypt(r.enc, ctx), ctx)]);
    n++;
  }
  for (const r of (await c.query('SELECT id, key, enc FROM config_var_value WHERE enc IS NOT NULL FOR UPDATE')).rows) {
    if (keyIdOf(r.enc) === cfg.activeKeyId) continue;
    const ctx = `var:${r.key}:${r.id}`;
    await c.query('UPDATE config_var_value SET enc=$2 WHERE id=$1', [r.id, encrypt(decrypt(r.enc, ctx), ctx)]);
    n++;
  }
});
console.log(`✓ ${n} nilai dienkripsi ulang dengan kunci ${cfg.activeKeyId}`);
await pool.end();
