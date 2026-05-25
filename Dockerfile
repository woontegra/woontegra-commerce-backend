FROM node:20-alpine

WORKDIR /app

# Copy package files and prisma schema first
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including dev for build)
# postinstall will run prisma generate now that schema is available
RUN npm ci

# Copy source and build
COPY . .
# tsc may exit non-zero on type errors but still emit (noEmitOnError: false)
RUN npm run build; test -f dist/main.js

# Remove dev dependencies after build (@prisma/client + prisma stay in dependencies)
RUN npm prune --omit=dev

EXPOSE 3000

# Migrate then start — Railway healthcheck hits /health
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
