# volley-spike game server (Colyseus) for Boxity Hosting (hosting.bloxity.io/docs).
# Listens on $PORT (Legion injects it), answers GET /health, runs as the non-root `node` user,
# and drains on SIGTERM (server/room.js onBeforeShutdown: warns players, saves, closes after DRAIN_SECONDS).
# The client is NOT baked into this image; the deploy workflow uploads it as the frontend zip.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Legion injects PORT at runtime (server/index.js only falls back to 2567 for local runs).
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared ./shared
COPY server ./server
# File-store fallback (used only when MONGODB_URI is absent) must be writable.
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
USER node
EXPOSE 2567
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
