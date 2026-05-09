# Multi-stage build. CI (GitHub Actions on Ubuntu x86_64) builds this reliably;
# the SIGSEGV that originally drove us to a runtime-only Dockerfile only
# manifests on certain TrueNAS hosts. The published GHCR image therefore goes
# back to a single self-contained image with `next build` happening inside.
#
# If you're building this locally on a host that hits the same SIGSEGV: pull
# the prebuilt image from ghcr.io/<owner>/<repo>:latest instead of running a
# local `docker build`.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid 1001 --shell /bin/false nextjs

# Production deps only — saves ~150 MB vs the full builder node_modules.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled output + the optional bookmarks.json baked in at build time.
# Override at runtime via `-v /path/bookmarks.json:/app/bookmarks.json:ro`.
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --chown=nextjs:nodejs bookmarks.example.json ./bookmarks.example.json

# Optional bookmarks file — only present when the build-context happened to
# include a bookmarks.json. Falls back to /api/config's DEFAULT_BOOKMARKS if
# absent.
COPY --chown=nextjs:nodejs bookmarks.jso[n] ./

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node_modules/.bin/next", "start"]
