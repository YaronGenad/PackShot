# Stage 1: Build frontend
FROM node:18-alpine AS builder

# VITE_ vars are baked into the JS bundle at build time — must be passed as ARGs
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_PAYPAL_CLIENT_ID
ARG VITE_TURNSTILE_SITE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_PAYPAL_CLIENT_ID=$VITE_PAYPAL_CLIENT_ID
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production runtime
FROM node:18-alpine

# Sharp and librawspeed runtime dependencies + curl for healthcheck
RUN apk add --no-cache vips fftw curl

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy backend source
COPY server.ts ./
COPY src/lib/ ./src/lib/

# Copy frontend build
COPY --from=builder /app/dist ./dist

# Create uploads directory
RUN mkdir -p uploads && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD curl -f http://localhost:3000/api/ping || exit 1

ENV NODE_ENV=production
# Fly.io default VM is 2GB. Cap Node heap at 1536MB so we leave room for Sharp/OpenCV native memory.
ENV NODE_OPTIONS=--max-old-space-size=1536
CMD ["node_modules/.bin/tsx", "server.ts"]
