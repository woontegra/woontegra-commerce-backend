FROM node:20-alpine

WORKDIR /app

# Copy package files and prisma schema first
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including dev for build)
# postinstall will run prisma generate now that schema is available
RUN npm ci

# Ensure Prisma client is generated
RUN npx prisma generate

# Copy source and build
COPY . .
RUN npm run build || echo "Build warnings ignored"

# Remove dev dependencies after build
RUN npm prune --omit=dev

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "dist/main.js"]
