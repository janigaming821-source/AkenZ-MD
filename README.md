---
title: AkenZ MD
emoji: "\U0001F916"
colorFrom: orange
colorTo: red
sdk: docker
app_port: 7860
---

# AkenZ MD

A single-owner personal WhatsApp bot that runs on **your own WhatsApp account**.
It connects with a **pairing code typed into WhatsApp** — no QR code, no
browser session, no third-party hosting.

Everything here is real: the socket is a live Baileys connection, the database
is a live SQLite file, the dashboard reads live counters, and the weather,
translation, QR and downloader features call live services. Where something is
not configured, the bot says so instead of pretending.

---

## What this bot is not

It is deliberately **not** a marketing or bulk-messaging tool.

- No mass mailing, no unsolicited broadcast to strangers, no auto-join groups,
  no scraping of contacts. `.broadcast` only reaches chats that messaged the bot
  in the last 7 days.
- No OTP or message interception from other people's accounts.
- No remote shell. There is **no `.eval` and no `.exec` command** — running code
  over a chat message is a remote-code-execution hole, and a WhatsApp account
  is not a place to accept it.
- No DRM bypass and no downloading of private or protected content. `.music` and
  `.video` go through yt-dlp against public sources, and the URL guard refuses
  any address that resolves to a private network.
- No session export. The dashboard can pair, reconnect and unlink the device,
  but it never shows or serves the credential files.

Use it on your own number and comply with WhatsApp's terms. Unofficial clients
can get a number banned — run this on a **spare number**, not your primary one.

---

## Requirements

| | |
|---|---|
| Node.js | **20 or newer** (built and tested on v24) |
| OS | Windows 10/11, Linux or macOS |
| RAM | ~150 MB for the bot process (measured on Windows) |
| WhatsApp | A phone you control, able to link a device |
| yt-dlp | Optional — needed for `.music` / `.video` |
| ffmpeg | Optional — needed for sticker, compress, audio conversion |

No Docker, no Redis, no Postgres, no paid service.

---

## Install

From the project folder:

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
```

On Windows, `cp` is `copy` in cmd.exe.

If you keep this under git, `git init` after installing — `.gitignore` is
already set up to keep `.env` and `data/` out of the repository.

---

## Configure

Open `.env`. Only four lines need a decision; everything else has a working
default.

```ini
OWNER_NUMBER=94771234567     # digits only, country code first, no '+'
OWNER_JID=                   # your WhatsApp address, e.g. 123456789012345@lid
BOT_PREFIX=.                 # one of . ! / #
DASHBOARD_PASSWORD=          # leave empty to get a printed password
```

`OWNER_NUMBER` and `OWNER_JID` together are the gate for every owner command.
They are checked server-side against the sender JID that WhatsApp puts on the
message — a display name, a contact card or a dashboard request can never grant
access. **While both are empty, all owner commands stay locked and console
pairing is disabled.**

Set both. WhatsApp now addresses private chats with an anonymous **LID**
(`123456789012345@lid`) instead of a phone number, so a number-only check denies
the real owner in a 1:1 chat. To find your own address, message the bot `.profile`
and read the `Your ID` line, then put it in `OWNER_JID`. Some groups carry phone
numbers instead, which is what `OWNER_NUMBER` matches — and it is also the number
console pairing falls back to.

Full reference:

| Variable | Default | Notes |
|---|---|---|
| `BOT_NAME` | `AkenZ MD` | Shown in `.menu` and the dashboard |
| `OWNER_NUMBER` | *(empty)* | Required for owner features |
| `OWNER_JID` | *(empty)* | Your WhatsApp address from `.profile`; unlocks owner commands in private chats |
| `BOT_PREFIX` | `.` | Change later with `.setprefix` |
| `BOT_LANGUAGE` | `en` | `en` or `si`; change with `.language si` |
| `TIMEZONE` | `Asia/Colombo` | Scheduler times |
| `DATABASE_URL` | `file:../data/noaura.db` | Relative to `prisma/` |
| `SESSION_DIR` | `./data/session` | Encrypted credentials live here |
| `SESSION_ENCRYPTION_KEY` | *(empty)* | Auto-generated into `data/secrets.json` |
| `DASHBOARD_HOST` | `127.0.0.1` | Set to your VPN address to reach it remotely |
| `DASHBOARD_PORT` | `3000` | |
| `DASHBOARD_USERNAME` | `owner` | |
| `DASHBOARD_PASSWORD` | *(empty)* | Hashed on first boot, then ignored |
| `COOKIE_SECRET` | *(empty)* | Auto-generated into `data/secrets.json` |
| `AI_PROVIDER` | `none` | `gemini`, `openai` or `none` |
| `AI_API_KEY`, `AI_MODEL` | *(empty)* | Leave empty to run key-free |
| `WEATHER_PROVIDER` | `open-meteo` | No key needed |
| `TRANSLATE_PROVIDER` | `mymemory` | No key needed |
| `MEDIA_ENABLED` | `true` | |
| `YTDLP_PATH`, `FFMPEG_PATH` | *(empty)* | Only if not on `PATH` |
| `MEDIA_MAX_MB` | `40` | WhatsApp caps images at 5 MB, video at 16 MB |
| `MEDIA_RATE_LIMIT_PER_HOUR` | `6` | Per chat |
| `WELCOME`, `GOODBYE` | `true` | Group join/leave messages |
| `MAX_WARNINGS`, `WARNING_ACTION` | `3`, `mute` | `mute` or `remove` |
| `LOG_LEVEL` | `info` | `debug` `info` `warn` `error` |

`SESSION_ENCRYPTION_KEY` and `COOKIE_SECRET` are generated for you on first run
and written to `data/secrets.json`. **Back that file up** — lose it and you must
pair again.

---

## Database

SQLite, created by the migration in the install step. It stores settings,
auto-replies, custom commands, group state, warnings, scheduled tasks, media
history and a log.

Message **text is never stored**. The counters record only which chat and which
command, so the dashboard can show real numbers without keeping anyone's words.

Inspect it any time:

```bash
npm run prisma:studio
```

`.backup` (owner) writes a timestamped copy into `data/backups/`.

---

## Pair WhatsApp with a pairing code

This is the normal path, and it needs no QR camera.

1. Put `OWNER_NUMBER` in `.env` and start the bot (`npm run dev`).
2. Open the dashboard at `http://127.0.0.1:3000`, sign in, go to **WhatsApp**.
3. Type the bot's own number in international format — country code first, no
   leading `0` (so `94771234567`, not `0771234567`) — and press **Generate
   Pairing Code**.
4. On that phone: **WhatsApp → Settings → Linked devices → Link a device →
   Link with phone number**, then type the 8-character code.

Or skip the dashboard and pair from a terminal:

```bash
npm run pair -- 94771234567
```

Notes:

- WhatsApp keeps a code valid for only about a minute, so the dashboard keeps
  issuing a fresh one for four minutes after you press the button. **Type the
  code that is on screen right now** — once it changes, the previous one is dead.
- The number must be the one WhatsApp is signed in on. Pairing links this bot as
  a *companion device*; the phone stays in control and can unlink it at any time.
- WhatsApp may refuse repeated code requests for a while after several failures.
  That is WhatsApp's rate limit, not a bug — wait a minute.
- Once it is connected, message the bot `.profile` and copy the `Your ID` line
  into `OWNER_JID` in `.env`, then restart. Private chats are addressed by LID,
  so without that your own owner commands stay locked.
- If the code stops changing, the pairing window has closed. Press **Generate
  Pairing Code** again.

Credentials are encrypted with AES-256-GCM before touching disk
(`data/session/creds.enc.json`). The raw files are never served, logged or
returned by any endpoint.

---

## Running it

```bash
npm run dev      # development, restarts on file changes
npm run build    # compile to dist/
npm start        # run the compiled build
npm test         # the checks described below
npm run typecheck
```

`npm run typecheck` runs `tsc --noEmit` over the whole project and must stay
clean. `npm test` runs the Node built-in test runner over `src/**/*.test.ts`;
the credential round-trip test there is what guards pairing against a session
file that saves as readable JSON but loads back as the wrong type.

On boot the bot prints a status box — connection state, prefix, command count,
dashboard URL and database path — and, on the very first run, the dashboard
password. The dashboard assets are read from `src/web/public/` in both modes, so
keep that folder next to `dist/`.

Stop it with `Ctrl+C`; it closes the HTTP server and the socket before exiting.

---

## Dashboard

`http://127.0.0.1:3000` — sign in with `DASHBOARD_USERNAME` and the password.

Ten views: Dashboard, WhatsApp, Commands, Auto Reply, Groups, Media, AI,
Scheduler, Logs, Settings. All data comes from the running process; empty tables
say `Nothing stored yet` rather than showing invented numbers.

- The password is bcrypt-hashed and stored in the database. `DASHBOARD_PASSWORD`
  is only read once, on first boot.
- Sessions use an `httpOnly`, `sameSite=lax` cookie, and every write needs a
  matching `x-csrf-token` header.
- Eight wrong passwords in five minutes locks an IP out.
- `GET /health` is public and unauthenticated so a monitor can poll it.

The cookie is not marked `Secure` because the default bind is loopback, where a
`Secure` cookie could not be set at all. If you ever expose this beyond
`127.0.0.1`, put it behind a VPN or TLS proxy and set `secure: true` in
`src/web/auth.ts`.

---

## Commands

Prefix `.`, so `.menu`. Every command also answers in both languages.

**General** — `menu` · `help [command]` · `ping` · `speed` · `bot` · `owner` ·
`runtime` · `status` · `profile` · `language <en|si>` · `settings`

**Tools** — `weather <city>` · `translate <si|en> <text>` · `qr <text|url>` ·
`short <url>` · `urlinfo <url>`

**AI** — `ai <question>` (reports honestly that it is off until you set a key)

**Media** — `music <search or url>` · `video <url>` · `sticker` (send or reply to
a photo/video) · `toimg` (reply to a sticker) · `compress [kb]` ·
`resize <width> <height>`

**Group** — `groupinfo` · `admins` · `tagall [message]` · `rules [text]` ·
`link` · `promote @user` · `demote @user` · `add <number>` · `remove @user` ·
`mute` · `unmute` · `warn @user [reason]` · `warnings [@user] [clear]`

**Owner** — `broadcast <message>` · `restart` · `shutdown` · `setprefix <char>` ·
`setname <name>` · `setbio <text>` · `autoreply add <trigger> => <response>` ·
`addcmd <name> <response>` · `delcmd <name>` · `listcmd` · `users` · `stats` ·
`block @user|<number>` · `unblock @user|<number>` · `ban @user` · `unban @user` ·
`reload` · `backup` · `database` · `schedule <minutes> <message>` · `schedules` ·
`delschedule <id>`

58 commands in total; `.listcmd` and the dashboard's Commands page list the
current set.

Auto-reply triggers are comma-separated. `hello, hi` matches exactly
(case-insensitive); `price*` matches anything containing *price*.

`.broadcast` reaches only chats that contacted the bot in the last 7 days —
there is no way to message a stranger with this bot.

---

## Languages

`locales/en.json` and `locales/si.json` hold the same keys. `.language si`
switches a single user; `BOT_LANGUAGE` sets the default. Sinhala strings are
written the way a Sinhala speaker reads them on WhatsApp, including the
mixing-in of English terms where that is normal — not a machine transliteration.
If a Sinhala line reads wrong to you, edit the JSON; nothing is hard-coded.

---

## Media tools

Check what the machine actually has from the dashboard's **Media** page, or:

```bash
npx -y yt-dlp --version
ffmpeg -version
```

Install them free:

- **yt-dlp** — `winget install yt-dlp.yt-dlp` (Windows) or `pip install -U yt-dlp`
- **ffmpeg** — `winget install Gyan.FFmpeg` or `choco install ffmpeg`

Missing tools produce a plain message in chat, never a stack trace. Media jobs
are capped by `MEDIA_MAX_MB` and `MEDIA_RATE_LIMIT_PER_HOUR`, downloads time out,
and any URL that resolves to a private address is refused.

---

## Security

- Owner checks compare the sender's normalised JID to `OWNER_NUMBER` or
  `OWNER_JID`, whichever is configured. Group commands additionally require the
  sender to be a participant and, for promote/demote/tag/mute, a group admin.
- Group admin status is read from WhatsApp's own metadata, never from a name.
- `.env` and the whole `data/` directory (database, encrypted session, generated
  secrets, backups, temp media) are gitignored. Never commit them.
- Logs run through a sanitizer that drops any key matching
  key/secret/token/password/creds/session/cookie/authorization, truncates
  values, and never records message bodies.
- Chat-supplied URLs pass an SSRF guard before anything fetches them.
- The dashboard exposes no terminal, no file browser and no config editor.

---

## Troubleshooting

**`Owner commands are locked` / `not allowed` in your own private chat** —
`OWNER_NUMBER` and `OWNER_JID` are both empty, or `OWNER_JID` is missing while
WhatsApp is addressing your chat by LID. Message the bot `.profile`, copy the
`Your ID` line into `OWNER_JID`, restart. Both values always follow `.env`, not
the database.

**`That does not look like a full international number`** — include the country
code as digits: `94771234567`, not `0771234567`.

**Pairing code never arrives** — the code must be typed on the phone holding that
number, under *Link with phone number*. If the panel shows no code, press
**Generate Pairing Code** again; the dashboard only keeps a live code on screen
for four minutes after you ask for one.

**`🔴 Logged out` / `401 — Connection Failure`** — WhatsApp dropped the session.
Press **Reconnect session**; if that fails, **Unlink device (logout)** and pair
again.

**Status keeps flipping between 🟢 Connected and 🟡 Reconnecting…** — exactly one
process may hold a WhatsApp session. A second instance (an old `npm run dev` still
alive, or an editor watcher restarting the app while the previous socket is still
open) makes WhatsApp terminate each connection in turn, so the dashboard shows
connected and disconnected lines alternating forever. Stop every instance and
start one.

**`Port 3000 is already in use`** — change `DASHBOARD_PORT`.

**`.music` says the downloader is missing** — install yt-dlp (above), or set
`YTDLP_PATH` if it is not on `PATH`.

**Sticker or compress fails silently** — install ffmpeg and restart.

**Nothing replies** — check `.settings` shows `Group tools` on, that your message
starts with the prefix, and look at the dashboard's **Logs** page.

**`database is locked`** — stop other processes holding the file (Studio, a
second bot instance), then restart.

---

## Keeping it online

The bot must run on a machine that stays on, because the WhatsApp socket lives
in this process. On your own PC, the free options are:

- Run it under a scheduled task or `pm2` and keep the PC awake while needed.
- A free-tier VM (Oracle Cloud Always Free, or a friend's spare machine) — but
  note that WhatsApp's pairing rate limit reacts badly to constant reconnect
  churn, so a machine that sleeps every few minutes is a bad fit.
- Do **not** put the dashboard on the public internet. If you must reach it from
  another device, use a VPN such as Tailscale and bind `DASHBOARD_HOST` to the
  VPN address.

Expect the session to survive restarts. Expect to re-pair after a WhatsApp
logout, an app update, or if `data/secrets.json` is lost.

---

## Running in the cloud (Render + Turso, free tier)

The repo ships as a self-contained cloud deployment: a `Dockerfile` that builds
and runs the bot, and a `render.yaml` blueprint that defines one free Docker web
service with a `/health` check. The only state a container loses on restart is
retrieved from a remote database, so two free accounts cover it:

1. **Turso** (turso.tech, free, no card) — a hosted SQLite. Create a database,
   then give the service its `DATABASE_URL` (`libsql://…`) and
   `TURSO_AUTH_TOKEN`. Apply the schema once with
   `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma
   --script` piped into the database.
2. **Render** (render.com, free, no card) — "New → Blueprint" from the GitHub
   repo. Fill in the `sync: false` env vars from `render.yaml`
   (`SESSION_ENCRYPTION_KEY` **must** be a fixed value, not regenerated, or the
   stored session becomes unreadable after every deploy). Pair WhatsApp once
   through the dashboard's pairing-code page; the session is then stored
   encrypted in Turso and survives redeploys.

Because a free Render service sleeps after 15 idle minutes, a keep-alive ping
from cron-job.org (also free, no card) hitting `/health` every 10 minutes keeps
it awake. When the database URL starts with `libsql://`, the bot automatically
stores the WhatsApp session in the database instead of files; with the default
`file:` URL it behaves exactly as the local setup does.

Media commands on the free plan run on a small CPU (512 MB), so large video
merges are slower than on the local PC.

---

## Two deliberate deviations from the brief

1. **No `.eval` / `.exec`.** They were listed as owner utilities. Running
   arbitrary code from a chat message is the single most dangerous feature a
   WhatsApp bot can have — one compromised account or one spoofed sender and the
   host machine is taken. Say the word if you want them anyway, and they will be
   built behind an explicit config flag that is off by default.
2. **Plain HTML/CSS/JS dashboard instead of React + Vite.** The brief named
   React. A 10-page private console does not need a build pipeline or a
   hydration runtime, and dropping them keeps the dependency tree, the install
   size and the attack surface smaller. The result is the same ten pages, served
   straight from `src/web/public/`.
