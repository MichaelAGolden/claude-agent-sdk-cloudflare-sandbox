---
title: Run background processes · Cloudflare Sandbox SDK docs
description: Start and manage long-running services and applications.
lastUpdated: 2025-11-08T10:22:38.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/sandbox/guides/background-processes/
  md: https://developers.cloudflare.com/sandbox/guides/background-processes/index.md
---

This guide shows you how to start, monitor, and manage long-running background processes in the sandbox.

## When to use background processes

Use `startProcess()` instead of `exec()` when:

* **Running web servers** - HTTP servers, APIs, WebSocket servers
* **Long-running services** - Database servers, caches, message queues
* **Development servers** - Hot-reloading dev servers, watch modes
* **Continuous monitoring** - Log watchers, health checkers
* **Parallel execution** - Multiple services running simultaneously

Note

For **one-time commands, builds, or scripts that complete and exit**, use `exec()` instead. See the [Execute commands guide](https://developers.cloudflare.com/sandbox/guides/execute-commands/).

## Start a background process

* JavaScript

  ```js
  import { getSandbox } from "@cloudflare/sandbox";


  const sandbox = getSandbox(env.Sandbox, "my-sandbox");


  // Start a web server
  const server = await sandbox.startProcess("python -m http.server 8000");


  console.log("Server started");
  console.log("Process ID:", server.id);
  console.log("PID:", server.pid);
  console.log("Status:", server.status); // 'running'


  // Process runs in background - your code continues
  ```

* TypeScript

  ```ts
  import { getSandbox } from '@cloudflare/sandbox';


  const sandbox = getSandbox(env.Sandbox, 'my-sandbox');


  // Start a web server
  const server = await sandbox.startProcess('python -m http.server 8000');


  console.log('Server started');
  console.log('Process ID:', server.id);
  console.log('PID:', server.pid);
  console.log('Status:', server.status); // 'running'


  // Process runs in background - your code continues
  ```

## Configure process environment

Set working directory and environment variables:

* JavaScript

  ```js
  const process = await sandbox.startProcess("node server.js", {
    cwd: "/workspace/api",
    env: {
      NODE_ENV: "production",
      PORT: "8080",
      API_KEY: env.API_KEY,
      DATABASE_URL: env.DATABASE_URL,
    },
  });


  console.log("API server started");
  ```

* TypeScript

  ```ts
  const process = await sandbox.startProcess('node server.js', {
    cwd: '/workspace/api',
    env: {
      NODE_ENV: 'production',
      PORT: '8080',
      API_KEY: env.API_KEY,
      DATABASE_URL: env.DATABASE_URL
    }
  });


  console.log('API server started');
  ```

## Monitor process status

List and check running processes:

* JavaScript

  ```js
  const processes = await sandbox.listProcesses();


  console.log(`Running ${processes.length} processes:`);


  for (const proc of processes) {
    console.log(`${proc.id}: ${proc.command} (${proc.status})`);
  }


  // Check if specific process is running
  const isRunning = processes.some(
    (p) => p.id === processId && p.status === "running",
  );
  ```

* TypeScript

  ```ts
  const processes = await sandbox.listProcesses();


  console.log(`Running ${processes.length} processes:`);


  for (const proc of processes) {
    console.log(`${proc.id}: ${proc.command} (${proc.status})`);
  }


  // Check if specific process is running
  const isRunning = processes.some(p => p.id === processId && p.status === 'running');
  ```

## Monitor process logs

Stream logs in real-time to detect when a service is ready:

* JavaScript

  ```js
  import { parseSSEStream } from "@cloudflare/sandbox";


  const server = await sandbox.startProcess("node server.js");


  // Stream logs
  const logStream = await sandbox.streamProcessLogs(server.id);


  for await (const log of parseSSEStream(logStream)) {
    console.log(log.data);


    if (log.data.includes("Server listening")) {
      console.log("Server is ready!");
      break;
    }
  }
  ```

* TypeScript

  ```ts
  import { parseSSEStream, type LogEvent } from '@cloudflare/sandbox';


  const server = await sandbox.startProcess('node server.js');


  // Stream logs
  const logStream = await sandbox.streamProcessLogs(server.id);


  for await (const log of parseSSEStream<LogEvent>(logStream)) {
    console.log(log.data);


    if (log.data.includes('Server listening')) {
      console.log('Server is ready!');
      break;
    }
  }
  ```

Or get accumulated logs:

* JavaScript

  ```js
  const logs = await sandbox.getProcessLogs(server.id);
  console.log("Logs:", logs);
  ```

* TypeScript

  ```ts
  const logs = await sandbox.getProcessLogs(server.id);
  console.log('Logs:', logs);
  ```

## Stop processes

* JavaScript

  ```js
  // Stop specific process
  await sandbox.killProcess(server.id);


  // Force kill if needed
  await sandbox.killProcess(server.id, "SIGKILL");


  // Stop all processes
  await sandbox.killAllProcesses();
  ```

* TypeScript

  ```ts
  // Stop specific process
  await sandbox.killProcess(server.id);


  // Force kill if needed
  await sandbox.killProcess(server.id, 'SIGKILL');


  // Stop all processes
  await sandbox.killAllProcesses();
  ```

## Run multiple processes

Start services in sequence, waiting for dependencies:

* JavaScript

  ```js
  import { parseSSEStream } from "@cloudflare/sandbox";


  // Start database first
  const db = await sandbox.startProcess("redis-server");


  // Wait for database to be ready
  const dbLogs = await sandbox.streamProcessLogs(db.id);
  for await (const log of parseSSEStream(dbLogs)) {
    if (log.data.includes("Ready to accept connections")) {
      break;
    }
  }


  // Now start API server (depends on database)
  const api = await sandbox.startProcess("node api-server.js", {
    env: { DATABASE_URL: "redis://localhost:6379" },
  });


  console.log("All services running");
  ```

* TypeScript

  ```ts
  import { parseSSEStream, type LogEvent } from '@cloudflare/sandbox';


  // Start database first
  const db = await sandbox.startProcess('redis-server');


  // Wait for database to be ready
  const dbLogs = await sandbox.streamProcessLogs(db.id);
  for await (const log of parseSSEStream<LogEvent>(dbLogs)) {
    if (log.data.includes('Ready to accept connections')) {
      break;
    }
  }


  // Now start API server (depends on database)
  const api = await sandbox.startProcess('node api-server.js', {
    env: { DATABASE_URL: 'redis://localhost:6379' }
  });


  console.log('All services running');
  ```

## Keep containers alive for long-running processes

By default, containers automatically shut down after 10 minutes of inactivity. For long-running processes that may have idle periods (like CI/CD pipelines, batch jobs, or monitoring tasks), use the [`keepAlive` option](https://developers.cloudflare.com/sandbox/configuration/sandbox-options/#keepalive):

* JavaScript

  ```js
  import { getSandbox, parseSSEStream } from "@cloudflare/sandbox";


  export { Sandbox } from "@cloudflare/sandbox";


  export default {
    async fetch(request, env) {
      // Enable keepAlive for long-running processes
      const sandbox = getSandbox(env.Sandbox, "build-job-123", {
        keepAlive: true,
      });


      try {
        // Start a long-running build process
        const build = await sandbox.startProcess("npm run build:production");


        // Monitor progress
        const logs = await sandbox.streamProcessLogs(build.id);


        // Process can run indefinitely without container shutdown
        for await (const log of parseSSEStream(logs)) {
          console.log(log.data);
          if (log.data.includes("Build complete")) {
            break;
          }
        }


        return new Response("Build completed");
      } finally {
        // Important: Must explicitly destroy when done
        await sandbox.destroy();
      }
    },
  };
  ```

* TypeScript

  ```ts
  import { getSandbox, parseSSEStream, type LogEvent } from '@cloudflare/sandbox';


  export { Sandbox } from '@cloudflare/sandbox';


  export default {
    async fetch(request: Request, env: Env): Promise<Response> {
      // Enable keepAlive for long-running processes
      const sandbox = getSandbox(env.Sandbox, 'build-job-123', {
        keepAlive: true
      });


      try {
        // Start a long-running build process
        const build = await sandbox.startProcess('npm run build:production');


        // Monitor progress
        const logs = await sandbox.streamProcessLogs(build.id);


        // Process can run indefinitely without container shutdown
        for await (const log of parseSSEStream<LogEvent>(logs)) {
          console.log(log.data);
          if (log.data.includes('Build complete')) {
            break;
          }
        }


        return new Response('Build completed');
      } finally {
        // Important: Must explicitly destroy when done
        await sandbox.destroy();
      }
    }
  };
  ```

Always destroy with keepAlive

When using `keepAlive: true`, containers will not automatically timeout. You **must** call `sandbox.destroy()` when finished to prevent containers running indefinitely and counting toward your account limits.

## Best practices

* **Wait for readiness** - Stream logs to detect when services are ready
* **Clean up** - Always stop processes when done
* **Handle failures** - Monitor logs for errors and restart if needed
* **Use try/finally** - Ensure cleanup happens even on errors
* **Use `keepAlive` for long-running tasks** - Prevent container shutdown during processes with idle periods

## Troubleshooting

### Process exits immediately

Check logs to see why:

* JavaScript

  ```js
  const process = await sandbox.startProcess("node server.js");
  await new Promise((resolve) => setTimeout(resolve, 1000));


  const processes = await sandbox.listProcesses();
  if (!processes.find((p) => p.id === process.id)) {
    const logs = await sandbox.getProcessLogs(process.id);
    console.error("Process exited:", logs);
  }
  ```

* TypeScript

  ```ts
  const process = await sandbox.startProcess('node server.js');
  await new Promise(resolve => setTimeout(resolve, 1000));


  const processes = await sandbox.listProcesses();
  if (!processes.find(p => p.id === process.id)) {
    const logs = await sandbox.getProcessLogs(process.id);
    console.error('Process exited:', logs);
  }
  ```

### Port already in use

Kill existing processes before starting:

* JavaScript

  ```js
  await sandbox.killAllProcesses();
  const server = await sandbox.startProcess("node server.js");
  ```

* TypeScript

  ```ts
  await sandbox.killAllProcesses();
  const server = await sandbox.startProcess('node server.js');
  ```

## Related resources

* [Commands API reference](https://developers.cloudflare.com/sandbox/api/commands/) - Complete process management API
* [Sandbox options configuration](https://developers.cloudflare.com/sandbox/configuration/sandbox-options/) - Configure `keepAlive` and other options
* [Lifecycle API](https://developers.cloudflare.com/sandbox/api/lifecycle/) - Create and manage sandboxes
* [Sessions API reference](https://developers.cloudflare.com/sandbox/api/sessions/) - Create isolated execution contexts
* [Execute commands guide](https://developers.cloudflare.com/sandbox/guides/execute-commands/) - One-time command execution
* [Expose services guide](https://developers.cloudflare.com/sandbox/guides/expose-services/) - Make processes accessible
* [Streaming output guide](https://developers.cloudflare.com/sandbox/guides/streaming-output/) - Monitor process output
