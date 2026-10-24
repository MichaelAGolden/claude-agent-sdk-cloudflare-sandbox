# syntax=docker/dockerfile:1.7
# ==============================================================================
# DOCKERFILE FOR CLAUDE AGENT SDK ON CLOUDFLARE SANDBOX
# ==============================================================================
#
# ARCHITECTURE OVERVIEW (v2 - On-Demand Agent Start)
# ---------------------------------------------------
# 1. Container starts → Control plane ONLY (no agent yet)
# 2. User connects via Socket.IO → server.ts detects first connection
# 3. server.ts loads skills from R2 to filesystem
# 4. server.ts starts agent via sandbox.startProcess()
# 5. Agent discovers skills (they were loaded BEFORE agent started)
#
# WHY ON-DEMAND?
# --------------
# - Skills are loaded BEFORE agent starts (guaranteed discovery)
# - Agent can be restarted from frontend without container restart
# - Users can add skills via UI and restart agent to load them
# - More efficient resource usage (agent only runs when needed)
#
# ==============================================================================

# Patched runtimes for the CVE-2026-111497 hotfix at the end of this file
FROM node:24.22.1-slim AS node-runtime
FROM oven/bun:1.4.4 AS bun-runtime

# Ubuntu 22.04 has not shipped a fixed libbrotli1 (still 1.0.9), so build upstream
# 1.0.10 -- the fixed release on the same ABI branch -- on the base image's OS
FROM ubuntu:22.04 AS brotli-build
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential cmake && \
    rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:b517ebdb5266b963d28d6e639b973479874ec72086deb6ee4a2d639e1b13606b \
    https://github.com/google/brotli/archive/refs/tags/v1.0.10.tar.gz /tmp/brotli-1.0.10.tar.gz
RUN tar -xzf /tmp/brotli-1.0.10.tar.gz -C /tmp && \
    cmake -S /tmp/brotli-1.0.10 -B /tmp/build -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/brotli -DBROTLI_DISABLE_TESTS=ON && \
    cmake --build /tmp/build -j"$(nproc)" && \
    cmake --install /tmp/build

# Base image: Cloudflare's sandbox with Node.js, Bun, and control plane
FROM cloudflare/sandbox:0.6.0-python

# Set working directory for our application
WORKDIR /app

# Copy package files first for layer caching
# (If dependencies don't change, npm install layer is cached)
COPY container/package.json container/package-lock.json* ./

# Install dependencies (baked into image)
RUN npm install

# Copy source code (main file + lib/ and routes/ modules)
COPY container/tsconfig.json ./
COPY container/agent-sdk.ts ./
COPY container/lib/ ./lib/
COPY container/routes/ ./routes/

# Build TypeScript to JavaScript
# Validates that the build succeeds and output exists
RUN npm run build && \
    echo "Build completed successfully" && \
    ls -la /app/dist/ && \
    test -f /app/dist/agent-sdk.js || (echo "ERROR: agent-sdk.js not found!" && exit 1)

# Create directory structure for skills
# Note: This creates the base directory at build time, but skill subdirectories
# are created at runtime via sandbox.mkdir() before loading each skill
RUN mkdir -p /workspace/.claude/skills && \
    echo "Container build: $(date -u +%Y-%m-%dT%H:%M:%SZ)" > /workspace/.claude/.build-info

# Document the port our agent will use (when started via sandbox.startProcess())
EXPOSE 3001

# ==============================================================================
# CVE-2026-111497 RUNTIME HOTFIX (Brotli decoder RCE, "Node2Shell")
# ==============================================================================
#
# cloudflare/sandbox:0.6.0-python ships Node 20 (EOL, will not be fixed), Bun 1.3.x
# and Ubuntu's libbrotli1 1.0.9 (used by curl/libcurl/freetype), all with the
# vulnerable decoder. Swap in fixed runtimes AFTER the app build so no build step
# runs the new Bun: Bun 1.4.4's amd64 build hangs under QEMU, which is how amd64
# images get built on Apple Silicon unless Docker Desktop uses Rosetta.
#
# Remove this section when the base moves to cloudflare/sandbox:0.12.14 or later
# (Node 24 + Bun 1.4.4); that also needs @cloudflare/sandbox bumped to match.
#
# ==============================================================================
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun

# /usr/local/lib precedes /usr/lib/x86_64-linux-gnu in ld.so.conf, so the fixed
# libraries win; fail the build if either fix is not in effect
COPY --from=brotli-build /opt/brotli/lib/ /tmp/brotli-lib/
RUN cp -a /tmp/brotli-lib/libbrotli*.so* /usr/local/lib/ && \
    rm -rf /tmp/brotli-lib && \
    ldconfig && \
    node -e "process.exit(require('zlib').constants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH === undefined ? 1 : 0)" && \
    ldd /usr/bin/curl | grep -q '/usr/local/lib/libbrotlidec.so.1'

# ==============================================================================
# STARTUP COMMAND
# ==============================================================================
#
# IMPORTANT: We ONLY start the control plane, NOT the agent.
#
# The agent (node /app/dist/agent-sdk.js) is started ON-DEMAND by server.ts
# via sandbox.startProcess() AFTER skills have been loaded from R2.
#
# This ensures:
# 1. Skills are on the filesystem BEFORE agent starts
# 2. Agent can be restarted without container restart
# 3. Frontend can trigger agent restart via API
#
# ==============================================================================
CMD ["bun", "/container-server/dist/index.js"]
