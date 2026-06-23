# Next.js 14 production Dockerfile — hermes-dashboard (standalone)
FROM node:22-bullseye-slim AS base
WORKDIR /app

# Dependencies
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Build
COPY . .
RUN npm run build

# Production — standalone mode (Next.js 14 output: 'standalone')
FROM node:22-bullseye-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Copy standalone output (includes server.js + minimal node_modules)
COPY --from=base /app/.next/standalone ./
COPY --from=base /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
