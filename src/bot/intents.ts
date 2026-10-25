import { resolveCommand } from './registry.js';
import type { Command } from '../types.js';

/**
 * Plain words instead of commands.
 *
 * Nobody types a dot at a shop. A customer writes "topup" or "how much" and
 * waits, and a bot that stays quiet after that looks dead — which is how an
 * order is lost. So the counter reads the first word of a short message and
 * answers it with the command the customer meant.
 *
 * Only whole sentences that stay under SHOUT_LEN are matched. Anything longer
 * is a question written for the seller, and the forwarder still owns it.
 */
const SHOUT_LEN = 60;

/** Checked in order, so "cancel my order" never lands on the order command. */
const INTENTS: Array<{ name: string; words: string[] }> = [
  {
    name: 'nevermind',
    words: ['cancel', 'stop', 'nevermind', 'never mind', 'leave it', 'no need'],
  },
  {
    name: 'ezcash',
    words: ['pay', 'payment', 'ezcash', 'ez cash', 'how to pay', 'deposit'],
  },
  {
    name: 'track',
    words: ['track', 'status', 'my order', 'my orders', 'where is my order', 'pending'],
  },
  {
    name: 'support',
    words: ['support', 'problem', 'issue', 'complaint', 'scam', 'human', 'help me'],
  },
  {
    name: 'buy',
    words: ['buy', 'purchase', 'i want', 'i need', 'want to buy', 'order', 'new order'],
  },
  {
    name: 'menu',
    words: ['hi', 'hello', 'hey', 'start', 'menu', 'commands', 'help', 'ආයුබෝවන්'],
  },
  {
    name: 'prices',
    words: [
      'topup', 'top up', 'top-up', 'topups', 'recharge', 'diamond', 'diamonds', 'dm',
      'price', 'prices', 'pricelist', 'price list', 'how much', 'cost', 'rate', 'rates',
      'pack', 'packs', 'shop', 'store', 'list', 'catalog', 'catalogue', 'මිල', 'ටොප්අප්',
    ],
  },
];

/** Lowercased, punctuation gone, one space between words. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'`()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hits(message: string, phrase: string): boolean {
  if (message === phrase) return true;
  if (message.length > SHOUT_LEN) return false;
  // Word boundaries, so "dm" does not answer "hold me" and "hi" does not
  // answer "this is my number".
  return new RegExp(`(^| )${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(message);
}

/** A bare message that resolves to a real, installed command. */
export interface Spoken {
  command: Command;
  args: string[];
}

/** The command a bare message means, or nothing when it reads as a question. */
export function intentOf(text: string): Spoken | undefined {
  const message = normalize(text);
  if (!message) return undefined;
  for (const intent of INTENTS) {
    const word = intent.words.find((w) => hits(message, w));
    if (!word) continue;
    const command = resolveCommand(intent.name);
    if (!command) continue;
    // "buy monthly" keeps its pack because the trigger opened the message. A
    // sentence that buries the word ("i want to buy monthly") keeps nothing,
    // so no prose is ever fed to the pack parser as an argument.
    return {
      command,
      args: message.startsWith(`${word} `) ? message.slice(word.length + 1).split(' ') : [],
    };
  }
  return undefined;
}
