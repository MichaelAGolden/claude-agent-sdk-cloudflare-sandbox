---
title: Sessions · Cloudflare Sandbox SDK docs
description: Create isolated execution contexts within a sandbox. Each session
  maintains its own shell state, environment variables, and working directory.
  See Session management concept for details.
lastUpdated: 2025-11-06T16:25:37.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/sandbox/api/sessions/
  md: https://developers.cloudflare.com/sandbox/api/sessions/index.md
---

Create isolated execution contexts within a sandbox. Each session maintains its own shell state, environment variables, and working directory. See [Session management concept](https://developers.cloudflare.com/sandbox/concepts/sessions/) for details.

Note

Every sandbox has a default session that automatically maintains shell state. Create additional sessions when you need isolated shell contexts for different environments or parallel workflows. For sandbox-level operations like creating containers or destroying the entire sandbox, see the [Lifecycle API](https://developers.cloudflare.com/sandbox/api/lifecycle/).

## Methods

### `createSession()`

Create a new isolated execution session.

```ts
const session = await sandbox.createSession(options?: SessionOptions): Promise<ExecutionSession>
```

**Parameters**:

* `options` (optional):

  * `id` - Custom session ID (auto-generated if not provided)
  * `env` - Environment variables for this session
  * `cwd` - Working directory (default: `"/workspace"`)

**Returns**: `Promise<ExecutionSession>` with all sandbox methods bound to this session

* JavaScript

  ```js
  // Multiple isolated environments
  const prodSession = await sandbox.createSession({
    id: "prod",
    env: { NODE_ENV: "production", API_URL: "https://api.example.com" },
    cwd: "/workspace/prod",
  });


  const testSession = await sandbox.createSession({
    id: "test",
    env: { NODE_ENV: "test", API_URL: "http://localhost:3000" },
    cwd: "/workspace/test",
  });


  // Run in parallel
  const [prodResult, testResult] = await Promise.all([
    prodSession.exec("npm run build"),
    testSession.exec("npm run build"),
  ]);
  ```

* TypeScript

  ```ts
  // Multiple isolated environments
  const prodSession = await sandbox.createSession({
    id: 'prod',
    env: { NODE_ENV: 'production', API_URL: 'https://api.example.com' },
    cwd: '/workspace/prod'
  });


  const testSession = await sandbox.createSession({
    id: 'test',
    env: { NODE_ENV: 'test', API_URL: 'http://localhost:3000' },
    cwd: '/workspace/test'
  });


  // Run in parallel
  const [prodResult, testResult] = await Promise.all([
    prodSession.exec('npm run build'),
    testSession.exec('npm run build')
  ]);
  ```

### `getSession()`

Retrieve an existing session by ID.

```ts
const session = await sandbox.getSession(sessionId: string): Promise<ExecutionSession>
```

**Parameters**:

* `sessionId` - ID of an existing session

**Returns**: `Promise<ExecutionSession>` bound to the specified session

* JavaScript

  ```js
  // First request - create session
  const session = await sandbox.createSession({ id: "user-123" });
  await session.exec("git clone https://github.com/user/repo.git");
  await session.exec("cd repo && npm install");


  // Second request - resume session (environment and cwd preserved)
  const session = await sandbox.getSession("user-123");
  const result = await session.exec("cd repo && npm run build");
  ```

* TypeScript

  ```ts
  // First request - create session
  const session = await sandbox.createSession({ id: 'user-123' });
  await session.exec('git clone https://github.com/user/repo.git');
  await session.exec('cd repo && npm install');


  // Second request - resume session (environment and cwd preserved)
  const session = await sandbox.getSession('user-123');
  const result = await session.exec('cd repo && npm run build');
  ```

***

### `deleteSession()`

Delete a session and clean up its resources.

```ts
const result = await sandbox.deleteSession(sessionId: string): Promise<SessionDeleteResult>
```

**Parameters**:

* `sessionId` - ID of the session to delete (cannot be `"default"`)

**Returns**: `Promise<SessionDeleteResult>` containing:

* `success` - Whether deletion succeeded
* `sessionId` - ID of the deleted session
* `timestamp` - Deletion timestamp

- JavaScript

  ```js
  // Create a temporary session for a specific task
  const tempSession = await sandbox.createSession({ id: "temp-task" });


  try {
    await tempSession.exec("npm run heavy-task");
  } finally {
    // Clean up the session when done
    await sandbox.deleteSession("temp-task");
  }
  ```

- TypeScript

  ```ts
  // Create a temporary session for a specific task
  const tempSession = await sandbox.createSession({ id: 'temp-task' });


  try {
    await tempSession.exec('npm run heavy-task');
  } finally {
    // Clean up the session when done
    await sandbox.deleteSession('temp-task');
  }
  ```

Warning

Deleting a session immediately terminates all running commands. The default session cannot be deleted.

***

### `setEnvVars()`

Set environment variables in the sandbox.

```ts
await sandbox.setEnvVars(envVars: Record<string, string>): Promise<void>
```

**Parameters**:

* `envVars` - Key-value pairs of environment variables to set

Warning

Call `setEnvVars()` **before** any other sandbox operations to ensure environment variables are available from the start.

* JavaScript

  ```js
  const sandbox = getSandbox(env.Sandbox, "user-123");


  // Set environment variables first
  await sandbox.setEnvVars({
    API_KEY: env.OPENAI_API_KEY,
    DATABASE_URL: env.DATABASE_URL,
    NODE_ENV: "production",
  });


  // Now commands can access these variables
  await sandbox.exec("python script.py");
  ```

* TypeScript

  ```ts
  const sandbox = getSandbox(env.Sandbox, 'user-123');


  // Set environment variables first
  await sandbox.setEnvVars({
    API_KEY: env.OPENAI_API_KEY,
    DATABASE_URL: env.DATABASE_URL,
    NODE_ENV: 'production'
  });


  // Now commands can access these variables
  await sandbox.exec('python script.py');
  ```

***

## ExecutionSession methods

The `ExecutionSession` object has all sandbox methods bound to the specific session:

| Category | Methods |
| - | - |
| **Commands** | [`exec()`](https://developers.cloudflare.com/sandbox/api/commands/#exec), [`execStream()`](https://developers.cloudflare.com/sandbox/api/commands/#execstream) |
| **Processes** | [`startProcess()`](https://developers.cloudflare.com/sandbox/api/commands/#startprocess), [`listProcesses()`](https://developers.cloudflare.com/sandbox/api/commands/#listprocesses), [`killProcess()`](https://developers.cloudflare.com/sandbox/api/commands/#killprocess), [`killAllProcesses()`](https://developers.cloudflare.com/sandbox/api/commands/#killallprocesses), [`getProcessLogs()`](https://developers.cloudflare.com/sandbox/api/commands/#getprocesslogs), [`streamProcessLogs()`](https://developers.cloudflare.com/sandbox/api/commands/#streamprocesslogs) |
| **Files** | [`writeFile()`](https://developers.cloudflare.com/sandbox/api/files/#writefile), [`readFile()`](https://developers.cloudflare.com/sandbox/api/files/#readfile), [`mkdir()`](https://developers.cloudflare.com/sandbox/api/files/#mkdir), [`deleteFile()`](https://developers.cloudflare.com/sandbox/api/files/#deletefile), [`renameFile()`](https://developers.cloudflare.com/sandbox/api/files/#renamefile), [`moveFile()`](https://developers.cloudflare.com/sandbox/api/files/#movefile), [`gitCheckout()`](https://developers.cloudflare.com/sandbox/api/files/#gitcheckout) |
| **Environment** | [`setEnvVars()`](https://developers.cloudflare.com/sandbox/api/sessions/#setenvvars) |
| **Code Interpreter** | [`createCodeContext()`](https://developers.cloudflare.com/sandbox/api/interpreter/#createcodecontext), [`runCode()`](https://developers.cloudflare.com/sandbox/api/interpreter/#runcode), [`listCodeContexts()`](https://developers.cloudflare.com/sandbox/api/interpreter/#listcodecontexts), [`deleteCodeContext()`](https://developers.cloudflare.com/sandbox/api/interpreter/#deletecodecontext) |

## Related resources

* [Session management concept](https://developers.cloudflare.com/sandbox/concepts/sessions/) - How sessions work
* [Commands API](https://developers.cloudflare.com/sandbox/api/commands/) - Execute commands
