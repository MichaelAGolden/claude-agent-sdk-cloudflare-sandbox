---
title: Commands · Cloudflare Sandbox SDK docs
description: Execute commands and manage background processes in the sandbox's
  isolated container environment.
lastUpdated: 2025-11-06T16:25:37.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/sandbox/api/commands/
  md: https://developers.cloudflare.com/sandbox/api/commands/index.md
---

Execute commands and manage background processes in the sandbox's isolated container environment.

## Methods

### `exec()`

Execute a command and return the complete result.

```ts
const result = await sandbox.exec(command: string, options?: ExecOptions): Promise<ExecuteResponse>
```

**Parameters**:

* `command` - The command to execute (can include arguments)

* `options` (optional):

  * `stream` - Enable streaming callbacks (default: `false`)
  * `onOutput` - Callback for real-time output: `(stream: 'stdout' | 'stderr', data: string) => void`
  * `timeout` - Maximum execution time in milliseconds

**Returns**: `Promise<ExecuteResponse>` with `success`, `stdout`, `stderr`, `exitCode`

* JavaScript

  ```js
  const result = await sandbox.exec("npm run build");


  if (result.success) {
    console.log("Build output:", result.stdout);
  } else {
    console.error("Build failed:", result.stderr);
  }


  // With streaming
  await sandbox.exec("npm install", {
    stream: true,
    onOutput: (stream, data) => console.log(`[${stream}] ${data}`),
  });
  ```

* TypeScript

  ```ts
  const result = await sandbox.exec('npm run build');


  if (result.success) {
    console.log('Build output:', result.stdout);
  } else {
    console.error('Build failed:', result.stderr);
  }


  // With streaming
  await sandbox.exec('npm install', {
    stream: true,
    onOutput: (stream, data) => console.log(`[${stream}] ${data}`)
  });
  ```

### `execStream()`

Execute a command and return a Server-Sent Events stream for real-time processing.

```ts
const stream = await sandbox.execStream(command: string, options?: ExecOptions): Promise<ReadableStream>
```

**Parameters**:

* `command` - The command to execute
* `options` - Same as `exec()`

**Returns**: `Promise<ReadableStream>` emitting `ExecEvent` objects (`start`, `stdout`, `stderr`, `complete`, `error`)

* JavaScript

  ```js
  import { parseSSEStream } from "@cloudflare/sandbox";


  const stream = await sandbox.execStream("npm run build");


  for await (const event of parseSSEStream(stream)) {
    switch (event.type) {
      case "stdout":
        console.log("Output:", event.data);
        break;
      case "complete":
        console.log("Exit code:", event.exitCode);
        break;
      case "error":
        console.error("Failed:", event.error);
        break;
    }
  }
  ```

* TypeScript

  ```ts
  import { parseSSEStream, type ExecEvent } from '@cloudflare/sandbox';


  const stream = await sandbox.execStream('npm run build');


  for await (const event of parseSSEStream<ExecEvent>(stream)) {
    switch (event.type) {
      case 'stdout':
        console.log('Output:', event.data);
        break;
      case 'complete':
        console.log('Exit code:', event.exitCode);
        break;
      case 'error':
        console.error('Failed:', event.error);
        break;
    }
  }
  ```

### `startProcess()`

Start a long-running background process.

```ts
const process = await sandbox.startProcess(command: string, options?: ProcessOptions): Promise<ProcessInfo>
```

**Parameters**:

* `command` - The command to start as a background process

* `options` (optional):

  * `cwd` - Working directory
  * `env` - Environment variables

**Returns**: `Promise<ProcessInfo>` with `id`, `pid`, `command`, `status`

* JavaScript

  ```js
  const server = await sandbox.startProcess("python -m http.server 8000");
  console.log("Started with PID:", server.pid);


  // With custom environment
  const app = await sandbox.startProcess("node app.js", {
    cwd: "/workspace/my-app",
    env: { NODE_ENV: "production", PORT: "3000" },
  });
  ```

* TypeScript

  ```ts
  const server = await sandbox.startProcess('python -m http.server 8000');
  console.log('Started with PID:', server.pid);


  // With custom environment
  const app = await sandbox.startProcess('node app.js', {
    cwd: '/workspace/my-app',
    env: { NODE_ENV: 'production', PORT: '3000' }
  });
  ```

### `listProcesses()`

List all running processes.

```ts
const processes = await sandbox.listProcesses(): Promise<ProcessInfo[]>
```

* JavaScript

  ```js
  const processes = await sandbox.listProcesses();


  for (const proc of processes) {
    console.log(`${proc.id}: ${proc.command} (PID ${proc.pid})`);
  }
  ```

* TypeScript

  ```ts
  const processes = await sandbox.listProcesses();


  for (const proc of processes) {
    console.log(`${proc.id}: ${proc.command} (PID ${proc.pid})`);
  }
  ```

### `killProcess()`

Terminate a specific process.

```ts
await sandbox.killProcess(processId: string, signal?: string): Promise<void>
```

**Parameters**:

* `processId` - The process ID (from `startProcess()` or `listProcesses()`)
* `signal` - Signal to send (default: `"SIGTERM"`)

- JavaScript

  ```js
  const server = await sandbox.startProcess("python -m http.server 8000");
  await sandbox.killProcess(server.id);
  ```

- TypeScript

  ```ts
  const server = await sandbox.startProcess('python -m http.server 8000');
  await sandbox.killProcess(server.id);
  ```

### `killAllProcesses()`

Terminate all running processes.

```ts
await sandbox.killAllProcesses(): Promise<void>
```

* JavaScript

  ```js
  await sandbox.killAllProcesses();
  ```

* TypeScript

  ```ts
  await sandbox.killAllProcesses();
  ```

### `streamProcessLogs()`

Stream logs from a running process in real-time.

```ts
const stream = await sandbox.streamProcessLogs(processId: string): Promise<ReadableStream>
```

**Parameters**:

* `processId` - The process ID

**Returns**: `Promise<ReadableStream>` emitting `LogEvent` objects

* JavaScript

  ```js
  import { parseSSEStream } from "@cloudflare/sandbox";


  const server = await sandbox.startProcess("node server.js");
  const logStream = await sandbox.streamProcessLogs(server.id);


  for await (const log of parseSSEStream(logStream)) {
    console.log(`[${log.timestamp}] ${log.data}`);


    if (log.data.includes("Server started")) break;
  }
  ```

* TypeScript

  ```ts
  import { parseSSEStream, type LogEvent } from '@cloudflare/sandbox';


  const server = await sandbox.startProcess('node server.js');
  const logStream = await sandbox.streamProcessLogs(server.id);


  for await (const log of parseSSEStream<LogEvent>(logStream)) {
    console.log(`[${log.timestamp}] ${log.data}`);


    if (log.data.includes('Server started')) break;
  }
  ```

### `getProcessLogs()`

Get accumulated logs from a process.

```ts
const logs = await sandbox.getProcessLogs(processId: string): Promise<string>
```

**Parameters**:

* `processId` - The process ID

**Returns**: `Promise<string>` with all accumulated output

* JavaScript

  ```js
  const server = await sandbox.startProcess("node server.js");
  await new Promise((resolve) => setTimeout(resolve, 5000));


  const logs = await sandbox.getProcessLogs(server.id);
  console.log("Server logs:", logs);
  ```

* TypeScript

  ```ts
  const server = await sandbox.startProcess('node server.js');
  await new Promise(resolve => setTimeout(resolve, 5000));


  const logs = await sandbox.getProcessLogs(server.id);
  console.log('Server logs:', logs);
  ```

## Related resources

* [Background processes guide](https://developers.cloudflare.com/sandbox/guides/background-processes/) - Managing long-running processes
* [Files API](https://developers.cloudflare.com/sandbox/api/files/) - File operations
