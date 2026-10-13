import type { AnyMessageContent, WAMessage } from 'baileys';
import type {
  AutoReply,
  BotConfig,
  BotLog,
  CustomCommand,
  Group,
  GroupSettings,
  MediaHistory,
  OwnerAction,
  ScheduledTask,
  User,
  Warning,
} from '@prisma/client';

export type {
  AutoReply,
  BotConfig,
  BotLog,
  CustomCommand,
  Group,
  GroupSettings,
  MediaHistory,
  OwnerAction,
  ScheduledTask,
  User,
  Warning,
};

export type Language = 'en' | 'si';

export type CommandCategory = 'general' | 'ai' | 'media' | 'group' | 'tools' | 'utility' | 'owner';

export interface ReplyOptions {
  quoted?: boolean;
  mentions?: string[];
}

/** Everything a command needs, already permission-checked and localized. */
export interface CommandContext {
  command: string;
  args: string[];
  fullArgs: string;
  /** Original message text with the prefix included. */
  text: string;
  prefix: string;
  lang: Language;
  settings: BotConfig;
  chatJid: string;
  isGroup: boolean;
  groupJid: string | null;
  senderJid: string;
  pushName: string | null;
  isOwner: boolean;
  isAdmin: () => Promise<boolean>;
  isBotAdmin: () => Promise<boolean>;
  message: WAMessage;
  /** When this process received the triggering message (ms epoch). */
  receivedAt: number;
  reply: (text: string, options?: ReplyOptions) => Promise<void>;
  sendMedia: (content: AnyMessageContent) => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Media/AI commands call this to tell the user work is happening. */
  status: (text: string) => Promise<void>;
}

export interface CommandMeta {
  name: string;
  category: CommandCategory;
  description: string;
  /** e.g. "music <search>" — shown by .help */
  usage: string;
  ownerOnly?: boolean;
  groupOnly?: boolean;
  adminOnly?: boolean;
  /** Shown in .menu */
  inMenu: boolean;
  aliases?: string[];
  rateLimitSeconds?: number;
}

export interface Command extends CommandMeta {
  execute: (ctx: CommandContext) => Promise<void>;
}
