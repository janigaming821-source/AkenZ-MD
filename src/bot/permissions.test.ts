import test from 'node:test';
import assert from 'node:assert/strict';
import { isOwner } from './permissions.js';

/**
 * Regression guard for the owner being locked out of their own bot: WhatsApp
 * addresses 1:1 chats by LID now, so the sender JID on a private message carries
 * no phone number at all and a digits-only comparison can never match.
 */
test('a phone-number sender matches the configured owner number', () => {
  assert.equal(isOwner('94776041953:3@s.whatsapp.net', '94776041953'), true);
  assert.equal(isOwner('94771234567@s.whatsapp.net', '94776041953'), false);
});

test('a LID-addressed private chat is invisible to a number-only check', () => {
  assert.equal(isOwner('148649053003791@lid', '94776041953'), false);
  assert.equal(isOwner('148649053003791@lid', '94776041953', '148649053003791@lid'), true);
});

test('the stored owner JID matches whichever device slot WhatsApp used', () => {
  assert.equal(isOwner('148649053003791:7@lid', '94776041953', '148649053003791@lid'), true);
  assert.equal(isOwner('148649053003792@lid', '94776041953', '148649053003791@lid'), false);
});

test('an unconfigured owner identity never matches somebody by accident', () => {
  for (const ownerJid of [undefined, '']) {
    assert.equal(isOwner('148649053003791@lid', '', ownerJid), false);
  }
  assert.equal(isOwner(null, '94776041953', '148649053003791@lid'), false);
  assert.equal(isOwner('94776041953@s.whatsapp.net', '94776041953', ''), true);
});
