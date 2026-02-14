# Multi-stage build for production
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend package files and install dependencies
COPY frontend/package*.json ./frontend/
WORKDIR /app/frontend
RUN npm ci

# Go back to root and copy source code
WORKDIR /app
COPY . .

# Build TypeScript (includes frontend)
RUN npm run build

# Production stage
FROM node:20-alpine AS runtime

# Security: Run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S orchestrator -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Create data directory
RUN mkdir -p /app/data && \
    chown -R orchestrator:nodejs /app

# Switch to non-root user
USER orchestrator

# Expose port
EXPOSE 5100

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5100/health || exit 1

# Start application
CMD ["node", "dist/index.js"]
