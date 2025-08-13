# Multi-stage build for better optimization
FROM ubuntu:22.04 as base

# Avoid prompts from apt
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies in one layer
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    gnupg \
    gnupg2 \
    lsb-release \
    apt-transport-https \
    ca-certificates \
    xvfb \
    fluxbox \
    openbox \
    ffmpeg \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 18.x
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Production stage
FROM base as production

# Set working directory
WORKDIR /app

# Create app user
RUN useradd -m -s /bin/bash appuser \
    && mkdir -p /app/temp-recordings \
    && chown -R appuser:appuser /app

# Copy package files first for better caching
COPY package*.json ./

# Configure npm for faster installs
RUN npm config set registry https://registry.npmjs.org/ && \
    npm config set fetch-retries 3 && \
    npm config set fetch-retry-factor 2 && \
    npm config set fetch-retry-mintimeout 10000 && \
    npm config set fetch-retry-maxtimeout 30000 && \
    npm config set progress false && \
    npm config set loglevel warn

# Install dependencies with timeout and retries
RUN timeout 600 npm ci --only=production --no-audit --no-fund --prefer-offline || \
    (echo "First attempt failed, retrying..." && npm ci --only=production --no-audit --no-fund)

# Copy application files
COPY . .

# Set ownership
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Create temp directory
RUN mkdir -p temp-recordings

# Expose port
EXPOSE 3003

# Health check with curl installation check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3003/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start command
CMD ["node", "slides-recording-api-minio.js"]