# Cloudflare Sandbox SDK Reference

This document serves as a comprehensive reference for the Cloudflare Sandbox SDK, summarizing the documentation found in `docs/cloudflare/`. It is designed to assist LLMs in understanding the SDK's architecture, configuration, usage, and API.

## Core Concepts

### [Architecture Overview](docs/cloudflare/concepts/sandbox-architecture-overview.md)
**Summary**: Explains the high-level architecture of the Sandbox SDK, which consists of three main layers:
1.  **Workers**: The entry point for requests, handling authentication and routing.
2.  **Durable Objects**: Manage the state and lifecycle of sandboxes.
3.  **Containers**: The actual execution environments (Firecracker microVMs) where code runs.
**Key Takeaways**:
-   Sandboxes are ephemeral but can be kept alive.
-   The architecture ensures secure isolation between sandboxes.

### [Container Runtime](docs/cloudflare/concepts/sandbox-container-runtime.md)
**Summary**: Details the environment within the sandbox container.
**Key Takeaways**:
-   **OS**: Alpine Linux.
-   **Filesystem**: Ephemeral, resets on destruction.
-   **Networking**: Outbound access allowed; inbound via preview URLs.
-   **Pre-installed**: Node.js, Python, and common utilities.
-   **Process Management**: Supports background processes and signal handling.

### [Lifecycle](docs/cloudflare/concepts/sandbox-lifecycle.md)
**Summary**: Describes the lifecycle states of a sandbox: Created, Active, Idle, and Destroyed.
**Key Takeaways**:
-   **Creation**: Lazy initialization upon first interaction.
-   **Idle**: Automatically sleeps after inactivity (default 10m) unless `keepAlive` is set.
-   **Destruction**: `destroy()` permanently removes all data and processes.
-   **Naming**: Consistent IDs map to the same sandbox instance.

### [Preview URLs](docs/cloudflare/concepts/sandbox-preview-url.md)
**Summary**: Explains how to expose services running inside the sandbox to the public internet.
**Key Takeaways**:
-   **Format**: `https://<port>-<sandbox-id>.<custom-domain>`.
-   **Requirements**: Custom domain with wildcard DNS in production.
-   **Security**: TLS termination handled by Cloudflare.
-   **Port 3000**: Reserved for internal use.

### [Security Model](docs/cloudflare/concepts/sandbox-security-model.md)
**Summary**: Outlines the security measures and responsibilities.
**Key Takeaways**:
-   **Isolation**: Each sandbox runs in a dedicated Firecracker microVM.
-   **Authentication**: Handled by the Worker (developer's responsibility).
-   **Secrets**: Should be passed via environment variables, not hardcoded.
-   **Input Validation**: Crucial for commands executed in the sandbox.

### [Session Management](docs/cloudflare/concepts/sandbox-session-management.md)
**Summary**: Explains "Sessions" as isolated shell contexts within a single sandbox.
**Key Takeaways**:
-   **Isolation**: Environment variables and CWD are isolated per session.
-   **Shared**: Filesystem and network are shared across all sessions in a sandbox.
-   **Usage**: Useful for concurrent user sessions or distinct tasks.

## Configuration

### [Configuration](docs/cloudflare/configuration/sandbox-configuration.md)
**Summary**: Details the `wrangler.jsonc` configuration.
**Key Takeaways**:
-   **Bindings**: Requires a `durable_objects` binding for the Sandbox class.
-   **Migrations**: Essential for Durable Object state persistence.
-   **Browser Rendering**: Optional binding for browser automation.

### [Dockerfile](docs/cloudflare/configuration/sandbox-dockerfile.md)
**Summary**: Explains how to customize the sandbox environment.
**Key Takeaways**:
-   **Base Image**: Must match the SDK version.
-   **Customization**: Install packages, copy files, set env vars.
-   **Startup Script**: Can be overridden for custom initialization.

### [Environment Variables](docs/cloudflare/configuration/sandbox-environment-variables.md)
**Summary**: Methods for managing environment variables.
**Key Takeaways**:
-   **Levels**: Sandbox-level (`setEnvVars`), Session-level (`createSession`), Command-level (`exec`).
-   **Precedence**: Command > Session > Sandbox.
-   **Secrets**: Use Worker secrets (`env.SECRET`) to pass sensitive data.

### [Options](docs/cloudflare/configuration/sandbox-options.md)
**Summary**: Options for `getSandbox(env, id, options)`.
**Key Takeaways**:
-   `keepAlive`: Prevents auto-sleep (requires manual `destroy()`).
-   `sleepAfter`: Custom inactivity timeout.
-   `normalizeId`: Forces lowercase IDs (recommended for preview URLs).
-   `containerTimeouts`: Adjust startup limits.

## Guides

### [Background Processes](docs/cloudflare/guides/sandbox-background-processes.md)
**Summary**: Managing long-running processes.
**Key Takeaways**:
-   **API**: `startProcess()`, `listProcesses()`, `killProcess()`.
-   **Logs**: Stream logs using `streamProcessLogs()`.
-   **Persistence**: Use `keepAlive` for processes that must survive request lifecycles.

### [Custom Domains](docs/cloudflare/guides/sandbox-custom-domains.md)
**Summary**: Setting up custom domains for preview URLs.
**Key Takeaways**:
-   **Production**: Required for exposing ports.
-   **Setup**: Wildcard DNS record (`*.sandbox.example.com`) pointing to the Worker.
-   **Worker**: Handle routing for the custom domain.

### [Execute Commands](docs/cloudflare/guides/sandbox-execute-commands.md)
**Summary**: Running shell commands.
**Key Takeaways**:
-   **API**: `exec()` (blocking), `execStream()` (streaming).
-   **Safety**: Sanitize inputs to prevent injection.
-   **Output**: Returns stdout, stderr, and exit code.

### [Expose Services](docs/cloudflare/guides/sandbox-expose-services.md)
**Summary**: Exposing internal ports.
**Key Takeaways**:
-   **API**: `exposePort(port, { hostname })`.
-   **Local Dev**: Requires `EXPOSE` in Dockerfile.
-   **Discovery**: `getExposedPorts()` lists active mappings.

### [File Management](docs/cloudflare/guides/sandbox-manage-files.md)
**Summary**: interacting with the filesystem.
**Key Takeaways**:
-   **API**: `writeFile()`, `readFile()`, `mkdir()`, `deleteFile()`, `moveFile()`.
-   **Formats**: Supports text and binary (base64).
-   **Paths**: Always use absolute paths (e.g., `/workspace/file.txt`).

### [Getting Started](docs/cloudflare/guides/sandbox-getting-started.md)
**Summary**: Step-by-step setup guide.
**Key Takeaways**:
-   **Template**: `npm create cloudflare@latest -- --template cloudflare/sandbox-template`.
-   **Dev**: `wrangler dev` works with local Docker.
-   **Deploy**: `wrangler deploy` pushes to Cloudflare network.

### [Mounting Buckets](docs/cloudflare/guides/sandbox-mounting-buckets.md)
**Summary**: Mounting R2/S3 buckets as local directories.
**Key Takeaways**:
-   **API**: `mountBucket(bucket, path, options)`.
-   **Providers**: R2 (recommended), S3, GCS.
-   **Usage**: Access bucket files via standard file APIs (`readFile`, `exec('ls')`).
-   **Limitation**: Not supported in `wrangler dev`.

### [Streaming Output](docs/cloudflare/guides/sandbox-stream-output.md)
**Summary**: Handling real-time command output.
**Key Takeaways**:
-   **API**: `execStream()` returns an SSE stream.
-   **Events**: `stdout`, `stderr`, `complete`, `error`.
-   **Usage**: Essential for long-running builds or interactive feedback.

### [Code Interpreter](docs/cloudflare/guides/sandbox-use-code-interpreter.md)
**Summary**: Executing code snippets with rich output.
**Key Takeaways**:
-   **API**: `createCodeContext()`, `runCode()`.
-   **Languages**: Python (default), JavaScript.
-   **Features**: State persistence within context, rich output (charts, tables).

### [WebSockets](docs/cloudflare/guides/sandbox-websocket.md)
**Summary**: Handling WebSocket connections.
**Key Takeaways**:
-   **Internal**: `wsConnect()` for Worker-to-Sandbox connections.
-   **External**: Expose via `exposePort()` for client-to-Sandbox connections.

### [Git Workflows](docs/cloudflare/guides/sandbox-work-with-git.md)
**Summary**: Cloning and managing git repositories.
**Key Takeaways**:
-   **API**: `gitCheckout(url, options)`.
-   **Auth**: Embed tokens in URL for private repos.
-   **Optimization**: Use shallow clones (`depth: 1`) for speed.

## API Reference

### [Commands](docs/cloudflare/sandbox-api-reference.md/sandbox-commands.md)
**Methods**:
-   `exec(command, options)`: Execute command, return result.
-   `execStream(command, options)`: Execute command, stream output.
-   `startProcess(command, options)`: Start background process.
-   `listProcesses()`: List running processes.
-   `killProcess(id)`: Stop a process.
-   `streamProcessLogs(id)`: Stream logs from a process.

### [Files](docs/cloudflare/sandbox-api-reference.md/sandbox-files.md)
**Methods**:
-   `writeFile(path, content, options)`: Write file.
-   `readFile(path, options)`: Read file.
-   `exists(path)`: Check existence.
-   `mkdir(path, options)`: Create directory.
-   `deleteFile(path)`: Delete file.
-   `renameFile(old, new)`: Rename file.
-   `moveFile(source, dest)`: Move file.
-   `gitCheckout(url, options)`: Clone repo.

### [Interpreter](docs/cloudflare/sandbox-api-reference.md/sandbox-interpreter.md)
**Methods**:
-   `createCodeContext(options)`: Create execution context.
-   `runCode(code, options)`: Run code in context.
-   `listCodeContexts()`: List active contexts.
-   `deleteCodeContext(id)`: Delete context.

### [Lifecycle](docs/cloudflare/sandbox-api-reference.md/sandbox-lifecycle.md)
**Methods**:
-   `getSandbox(binding, id, options)`: Get/create sandbox instance.
-   `destroy()`: Terminate sandbox and clear data.

### [Ports](docs/cloudflare/sandbox-api-reference.md/sandbox-ports.md)
**Methods**:
-   `exposePort(port, options)`: Expose port via preview URL.
-   `unexposePort(port)`: Close preview URL.
-   `getExposedPorts()`: List exposed ports.
-   `wsConnect(request, port)`: Establish WebSocket connection.

### [Sessions](docs/cloudflare/sandbox-api-reference.md/sandbox-sessions.md)
**Methods**:
-   `createSession(options)`: Create isolated session.
-   `getSession(id)`: Get existing session.
-   `deleteSession(id)`: Delete session.
-   `setEnvVars(vars)`: Set environment variables.

### [Storage](docs/cloudflare/sandbox-api-reference.md/sandbox-storage.md)
**Methods**:
-   `mountBucket(bucket, path, options)`: Mount S3/R2 bucket.
-   `unmountBucket(path)`: Unmount bucket.
