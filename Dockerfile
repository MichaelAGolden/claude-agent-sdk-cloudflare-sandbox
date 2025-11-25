FROM docker.io/cloudflare/sandbox:0.5.1

# Build the agent application
WORKDIR /app

# Copy package files and install dependencies first (better layer caching)
COPY container/package.json container/package-lock.json* ./
RUN npm install

# Copy source files and TypeScript config
COPY container/tsconfig.json ./
COPY container/agent-sdk.ts ./

# Build TypeScript to JavaScript
RUN npm run build && \
    echo "Build completed successfully" && \
    ls -la /app/dist/ && \
    test -f /app/dist/agent-sdk.js || (echo "ERROR: agent-sdk.js not found after build!" && exit 1)

# Create the .claude directory structure for skills (will be populated at runtime)
# Using /workspace as it's the standard sandbox working directory
RUN mkdir -p /workspace/.claude/skills

# Expose the agent port (NOT 3000 - that's reserved for sandbox control plane)
EXPOSE 3001

# Run both the agent server (background) and the sandbox control plane (foreground)
# The control plane MUST be the foreground process for the sandbox SDK to work
CMD node /app/dist/agent-sdk.js & exec bun /container-server/dist/index.js
