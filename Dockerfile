# Stage 1: Build frontend
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production runtime
FROM node:18-alpine

# Sharp and librawspeed runtime dependencies
RUN apk add --no-cache vips fftw

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy backend source
COPY server.ts ./
COPY src/lib/focus-stack.ts src/lib/focus-stack-types.ts ./src/lib/

# Copy frontend build
COPY --from=builder /app/dist ./dist

# Create uploads directory
RUN mkdir -p uploads && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/ping').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

ENV NODE_ENV=production
CMD ["node", "--max-old-space-size=4096", "server.ts"]
