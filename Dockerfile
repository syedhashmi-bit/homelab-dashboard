# Runtime-only image. Build happens on the dev PC and .next/ is shipped via git.
# (TrueNAS Docker can't run `next build` reliably — see commit history for the
# diagnostic trail. The Next.js build worker SIGSEGVs at varying phases on this
# host, so we just don't build inside Docker anymore.)

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid 1001 --shell /bin/false nextjs

# Install production deps only — saves ~150 MB vs full node_modules from build.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy the prebuilt artifacts. `.next/` is checked into git for this repo.
COPY --chown=nextjs:nodejs .next ./.next

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node_modules/.bin/next", "start"]
