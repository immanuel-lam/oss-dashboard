# Self-hosted dashboard: workerd (via wrangler dev) + local D1 (SQLite) + built-in scheduler.
# docker compose up -d   →  http://localhost:8787
FROM node:22-bookworm-slim
WORKDIR /app
# workerd needs system CA certificates for outbound HTTPS to the analytics APIs.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV WRANGLER_SEND_METRICS=false NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force
COPY . .
RUN npx vite build
ENV HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
VOLUME /data
EXPOSE 8787
CMD ["node","scripts/selfhost.mjs"]
