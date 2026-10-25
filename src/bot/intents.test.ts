import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCommand } from './registry.js';
import { intentOf } from './intents.js';
import type { Command } from '../types.js';

// The real command set is registered at boot; a matcher test only needs to know
// that a name resolves.
for (const name of ['prices', 'buy', 'track', 'ezcash', 'nevermind', 'support', 'menu']) {
  registerCommand({
    name,
    category: 'topup',
    description: name,
    usage: name,
    inMenu: true,
    async execute() {},
  });
}

const answered = (text: string) => intentOf(text)?.command.name;

test('a bare word at the counter opens the shop', () => {
  for (const text of ['topup', 'TopUp', 'TOPUP?', 'diamond', 'diamonds', 'price', 'how much']) {
    assert.equal(answered(text), 'prices', text);
  }
});

test('the words that mean an order, a payment or a status get their own command', () => {
  assert.equal(answered('buy'), 'buy');
  assert.equal(answered('i want to buy'), 'buy');
  assert.equal(answered('ezcash'), 'ezcash');
  assert.equal(answered('how to pay'), 'ezcash');
  assert.equal(answered('status'), 'track');
  assert.equal(answered('where is my order'), 'track');
  assert.equal(answered('cancel'), 'nevermind');
  assert.equal(answered('support'), 'support');
  assert.equal(answered('hi'), 'menu');
});

test('the most specific word wins, so "cancel my order" never starts an order', () => {
  assert.equal(answered('cancel my order'), 'nevermind');
  assert.equal(answered('my order status'), 'track');
});

test('a pack named after the trigger is kept, a sentence buried in prose is not', () => {
  assert.deepEqual(intentOf('buy monthly')?.args, ['monthly']);
  assert.deepEqual(intentOf('i want to buy monthly')?.args, []);
});

test('a message written for a human is left alone', () => {
  for (const text of [
    '',
    '   ',
    '0776041953',
    '94776041953',
    // Long enough to be a question, so the seller answers it, not the bot.
    'is it possible to get a discount if i take the monthly pass for two accounts',
  ]) {
    assert.equal(intentOf(text), undefined, text);
  }
});

test('a short word inside a longer word does not fire', () => {
  // "dm" is diamonds to a customer and nothing else; it must not answer "hold".
  assert.equal(answered('send me the album'), undefined);
  assert.equal(answered('this is fine'), undefined);
});
