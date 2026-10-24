# ── Build stage: TypeScript → dist, generate the Prisma client ──────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage: production deps + the compiled bot ───────────────────────
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    python3 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# The standalone yt-dlp launcher is the newest release at build time —
# Debian's apt package goes stale fast, and stale versions break extraction.
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
      -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The generated Prisma client (query engine included) comes from the builder —
# the production install has no prisma CLI to regenerate it.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
# The dashboard serves these files directly from /app/src/web/public at runtime.
COPY --from=builder /app/src/web/public ./src/web/public
# Read at runtime: the menu banner and the en/si translations.
COPY assets ./assets
COPY locales ./locales

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DATABASE_URL=file:../data/noaura.db
ENV SESSION_DIR=./data/session

EXPOSE 3000

CMD ["node", "dist/index.js"]
