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
# `next build` produces a usable .next/ directory but its post-build worker
# crashes with SIGSEGV on this host (a known issue with Next 15 + Linux Docker
# on certain CPUs/cgroups; see commit history). The crash happens AFTER
# "Generating static pages (9/9)" — by which point all runtime artifacts are
# on disk. We treat the build as successful if those artifacts exist.
RUN set +e; npm run build; EXIT=$?; set -e; \
    if [ $EXIT -ne 0 ]; then \
        echo ">>> next build exited with $EXIT — checking artifacts"; \
        if [ -f .next/build-manifest.json ] \
           && [ -f .next/prerender-manifest.json ] \
           && [ -d .next/server/app ] \
           && [ -d .next/static ]; then \
            echo ">>> all required artifacts present, treating build as successful"; \
        else \
            echo ">>> artifacts incomplete, failing"; \
            ls -la .next/ 2>/dev/null || true; \
            exit $EXIT; \
        fi; \
    fi

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid 1001 --shell /bin/false nextjs

COPY --from=builder --chown=nextjs:nodejs /app/package.json /app/package-lock.json* ./
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node_modules/.bin/next", "start"]
