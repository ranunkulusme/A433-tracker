FROM node:22-alpine

WORKDIR /app

# Install system dependencies
RUN apk add --no-cache ca-certificates tzdata curl

# Install Mieru binary for anti-censorship tunnel
ARG MIERU_VERSION=3.39.0
RUN ARCH=$(uname -m) && \
    case "$ARCH" in \
      x86_64) MIERU_ARCH="amd64" ;; \
      aarch64) MIERU_ARCH="arm64" ;; \
      *) MIERU_ARCH="amd64" ;; \
    esac && \
    (curl -fsSL "https://github.com/enfein/mieru/releases/download/v${MIERU_VERSION}/mieru_${MIERU_VERSION}_linux_${MIERU_ARCH}.tar.gz" -o /tmp/mieru.tar.gz && \
     tar -xzf /tmp/mieru.tar.gz -C /usr/local/bin/ 2>/dev/null || true) && \
    rm -f /tmp/mieru.tar.gz && \
    if [ -f /usr/local/bin/mieru ]; then chmod +x /usr/local/bin/mieru; fi

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]

