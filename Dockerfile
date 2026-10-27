# syntax=docker/dockerfile:1

# --- test: installs dev tooling and runs the full check; the image only builds if it passes ---
FROM node:22-bookworm-slim AS test
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force
COPY . .
RUN npm run check

# --- runtime: no node_modules needed (zero third-party runtime dependencies) ---
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3100 \
    DATABASE_PATH=/data/company-pulse.sqlite
WORKDIR /app

# Copying from the test stage makes BuildKit run it (unreferenced stages are skipped).
COPY --from=test --chown=node:node /app/package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public

RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# node is PID 1 and receives SIGTERM directly (graceful shutdown in src/server.js).
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
