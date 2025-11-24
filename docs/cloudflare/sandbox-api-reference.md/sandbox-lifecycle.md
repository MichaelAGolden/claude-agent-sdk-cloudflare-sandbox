---
title: Lifecycle · Cloudflare Sandbox SDK docs
description: Create and manage sandbox containers. Get sandbox instances,
  configure options, and clean up resources.
lastUpdated: 2025-11-18T19:18:00.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/sandbox/api/lifecycle/
  md: https://developers.cloudflare.com/sandbox/api/lifecycle/index.md
---

Create and manage sandbox containers. Get sandbox instances, configure options, and clean up resources.

## Methods

### `getSandbox()`

Get or create a sandbox instance by ID.

```ts
const sandbox = getSandbox(
  binding: DurableObjectNamespace<Sandbox>,
  sandboxId: string,
  options?: SandboxOptions
): Sandbox
```

**Parameters**:

* `binding` - The Durable Object namespace binding from your Worker environment

* `sandboxId` - Unique identifier for this sandbox. The same ID always returns the same sandbox instance

* `options` (optional) - See [SandboxOptions](https://developers.cloudflare.com/sandbox/configuration/sandbox-options/) for all available options:

  * `sleepAfter` - Duration of inactivity before automatic sleep (default: `"10m"`)
  * `keepAlive` - Prevent automatic sleep entirely (default: `false`)
  * `containerTimeouts` - Configure container startup timeouts
  * `normalizeId` - Lowercase sandbox IDs for preview URL compatibility (default: `false`)

**Returns**: `Sandbox` instance

Note

The container starts lazily on first operation. Calling `getSandbox()` returns immediately—the container only spins up when you execute a command, write a file, or perform other operations. See [Sandbox lifecycle](https://developers.cloudflare.com/sandbox/concepts/sandboxes/) for details.

* JavaScript

  ```js
  import { getSandbox } from "@cloudflare/sandbox";


  export default {
    async fetch(request, env) {
      const sandbox = getSandbox(env.Sandbox, "user-123");
      const result = await sandbox.exec("python script.py");
      return Response.json(result);
    },
  };
  ```

* TypeScript

  ```ts
  import { getSandbox } from '@cloudflare/sandbox';


  export default {
    async fetch(request: Request, env: Env): Promise<Response> {
      const sandbox = getSandbox(env.Sandbox, 'user-123');
      const result = await sandbox.exec('python script.py');
      return Response.json(result);
    }
  };
  ```

Warning

When using `keepAlive: true`, you **must** call `destroy()` when finished to prevent containers running indefinitely.

***

### `destroy()`

Destroy the sandbox container and free up resources.

```ts
await sandbox.destroy(): Promise<void>
```

Immediately terminates the container and permanently deletes all state:

* All files in `/workspace`, `/tmp`, and `/home`
* All running processes
* All sessions (including the default session)
* Network connections and exposed ports

- JavaScript

  ```js
  async function executeCode(code) {
    const sandbox = getSandbox(env.Sandbox, `temp-${Date.now()}`);


    try {
      await sandbox.writeFile("/tmp/code.py", code);
      const result = await sandbox.exec("python /tmp/code.py");
      return result.stdout;
    } finally {
      await sandbox.destroy();
    }
  }
  ```

- TypeScript

  ```ts
  async function executeCode(code: string): Promise<string> {
    const sandbox = getSandbox(env.Sandbox, `temp-${Date.now()}`);


    try {
      await sandbox.writeFile('/tmp/code.py', code);
      const result = await sandbox.exec('python /tmp/code.py');
      return result.stdout;
    } finally {
      await sandbox.destroy();
    }
  }
  ```

Note

Containers automatically sleep after 10 minutes of inactivity but still count toward account limits. Use `destroy()` to immediately free up resources.

***

## Related resources

* [Sandbox lifecycle concept](https://developers.cloudflare.com/sandbox/concepts/sandboxes/) - Understanding container lifecycle and state
* [Sandbox options configuration](https://developers.cloudflare.com/sandbox/configuration/sandbox-options/) - Configure `keepAlive` and other options
* [Sessions API](https://developers.cloudflare.com/sandbox/api/sessions/) - Create isolated execution contexts within a sandbox
