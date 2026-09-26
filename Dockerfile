# Corgis vs Cats — production image: one Node process serves the client build (dist/) and the authoritative
# game WebSocket (/ws) on one port. See docs/ops/DEPLOY.md.
#   docker build -t corgis-vs-cats . && docker run -p 8080:8080 corgis-vs-cats   → http://localhost:8080

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# client (Vite) + server bundle (Vite SSR build of server/prod.ts → dist-server/prod.js, no tsx at runtime)
RUN npm run build && npm run build:server

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/dist
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/prod.js"]
