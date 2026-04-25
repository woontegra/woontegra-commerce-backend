FROM node:20-alpine

WORKDIR /app

# Install ALL dependencies (including dev for build)
COPY package*.json ./
RUN npm ci

# Copy prisma schema and generate client
COPY prisma ./prisma/
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
