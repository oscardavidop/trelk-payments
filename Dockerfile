# ──────────────────────────────────────────────────────────────
# Dockerfile — API Process
# Imagen: node:20-alpine (ligera, ~180MB base)
# Build: multi-stage para excluir devDependencies del final
# Usuario: node (non-root por seguridad)
# ──────────────────────────────────────────────────────────────

# ── Stage 1: Build ────────────────────────────────────────────
FROM node:20-alpine AS builder

# Instalar dependencias de compilación nativas (ej: bcrypt, canvas)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copiar manifests primero (cache layer: solo se reinstala si cambian)
COPY package.json package-lock.json ./

# Instalar TODAS las dependencias (incluyendo dev para compilar TS)
RUN npm ci --frozen-lockfile

# Copiar fuente y compilar
COPY tsconfig.json nest-cli.json ./
COPY src/ ./src/

RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────
FROM node:20-alpine AS production

# Instalar dumb-init: gestiona señales de proceso correctamente en Docker
# (evita que SIGTERM no llegue al proceso Node cuando Docker para el contenedor)
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copiar solo lo necesario del stage de build
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Archivos estáticos si los hay
COPY public/ ./public/ 2>/dev/null || true

# ── Seguridad: correr como usuario no-root ─────────────────────
# El usuario 'node' existe por defecto en node:alpine
RUN chown -R node:node /app
USER node

# ── Variables de entorno por defecto ──────────────────────────
ENV NODE_ENV=production \
    PORT=3001 \
    NODE_OPTIONS="--max-old-space-size=256"

EXPOSE 3001

# ── Health check para Docker Compose / Swarm ──────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', r => r.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

# dumb-init como PID 1: reenvía señales correctamente a Node
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
