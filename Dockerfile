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
