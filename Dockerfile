# Multi-stage production Dockerfile with Playwright Chromium & noVNC
FROM node:20-bookworm-slim AS base

# Install system dependencies for Chromium, Xvfb, x11vnc, and websockify
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    net-tools \
    curl \
    ca-certificates \
    libnss3 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libx11-xcb1 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcups2 \
    libxkbcommon0 \
    libxkbcommon-x11-0 \
    fonts-liberation \
    procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Install Playwright browser dependencies and chromium
RUN npx playwright install --with-deps chromium

# Copy application source code
COPY . .

# Generate Prisma Client and compile TypeScript
RUN npx prisma generate
RUN npm run build

# Expose HTTP API Port and noVNC base port
EXPOSE 4000
EXPOSE 6080

# Environment variables
ENV NODE_ENV=production
ENV PORT=4000

# Start command with Prisma migration check
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
