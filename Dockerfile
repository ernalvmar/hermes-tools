# Next.js 15 production Dockerfile — hermes-dashboard
FROM node:22-bullseye-slim AS base
WORKDIR /app

# Dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Build
COPY . .
RUN npm run build

# Production
FROM node:22-bullseye-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/.next ./.next
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/public ./public/ 2>/dev/null || true

EXPOSE 3000
CMD ["npm", "run", "start"]
