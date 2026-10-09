import test from 'node:test';
import assert from 'node:assert/strict';
import { Curve, initAuthCreds } from '@whiskeysockets/baileys';
import { decodeBinaryJson, decryptJson, encryptJson } from './crypto.js';

/**
 * Regression guard for the pairing failure: JSON.stringify calls Buffer#toJSON()
 * before a replacer can see the value, so Baileys' keys used to persist as plain
 * { type: 'Buffer', data } objects. On the next start the noise handshake threw
 * ERR_INVALID_ARG_TYPE and every connection died before a code could be typed.
 */
test('Baileys credential buffers survive an encrypt/decrypt round trip', () => {
  const creds = {
    ...initAuthCreds(),
    noiseKey: Curve.generateKeyPair(),
    signedIdentityKey: Curve.generateKeyPair(),
  };

  const restored = decryptJson<typeof creds>(encryptJson(creds));

  for (const key of ['noiseKey', 'signedIdentityKey'] as const) {
    for (const half of ['public', 'private'] as const) {
      const value = restored[key][half];
      assert.ok(Buffer.isBuffer(value), `${key}.${half} came back as ${Object.prototype.toString.call(value)}`);
      assert.ok(Buffer.compare(value, creds[key][half]) === 0, `${key}.${half} did not round-trip unchanged`);
    }
  }
});

test('a session written by the old encoder reads back as bytes', () => {
  const legacy = JSON.stringify({ noiseKey: { public: { type: 'Buffer', data: [1, 2, 3] } } });
  const restored = decodeBinaryJson(legacy) as { noiseKey: { public: unknown } };
  assert.ok(Buffer.isBuffer(restored.noiseKey.public), 'legacy key must be repaired, not handed to Baileys as an object');
  assert.deepEqual([...(restored.noiseKey.public as Buffer)], [1, 2, 3]);
});
