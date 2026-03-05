# Overlord Server Dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install Go for agent building and other tools
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       openssl \
       curl \
       ca-certificates \
       wget \
       git \
    && rm -rf /var/lib/apt/lists/*

# Install Go (latest stable version)
ENV GO_VERSION=1.25.6
ARG TARGETARCH
RUN case "${TARGETARCH}" in \
        amd64) GO_ARCH=amd64 ;; \
        arm64) GO_ARCH=arm64 ;; \
        *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && wget -q https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz \
    && tar -C /usr/local -xzf go${GO_VERSION}.linux-${GO_ARCH}.tar.gz \
    && rm go${GO_VERSION}.linux-${GO_ARCH}.tar.gz

ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH="/go"
ENV PATH="${GOPATH}/bin:${PATH}"

# Install garble for obfuscated agent builds (requires Go 1.25+)
RUN go install mvdan.cc/garble@latest

# Copy package files
COPY Overlord-Server/package.json Overlord-Server/bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code and client code (needed for builds)
COPY Overlord-Server/ ./
COPY Overlord-Client/ ../Overlord-Client/

# Create necessary directories
RUN mkdir -p certs public data

# Expose the default port
EXPOSE 5173

# Set environment variables (can be overridden)
ENV PORT=5173
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data
ENV NODE_ENV=production

# Run the server
CMD ["bun", "run", "src/index.ts"]
