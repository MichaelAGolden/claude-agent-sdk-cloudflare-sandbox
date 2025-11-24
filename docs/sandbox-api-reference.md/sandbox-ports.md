---
title: Ports · Cloudflare Sandbox SDK docs
description: Expose services running in your sandbox via public preview URLs.
  See Preview URLs concept for details.
lastUpdated: 2025-11-08T10:22:38.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/sandbox/api/ports/
  md: https://developers.cloudflare.com/sandbox/api/ports/index.md
---

Production requires custom domain

Preview URLs require a custom domain with wildcard DNS routing in production. See [Production Deployment](https://developers.cloudflare.com/sandbox/guides/production-deployment/).

Expose services running in your sandbox via public preview URLs. See [Preview URLs concept](https://developers.cloudflare.com/sandbox/concepts/preview-urls/) for details.

## Methods

### `exposePort()`

Expose a port and get a preview URL.

```ts
const response = await sandbox.exposePort(port: number, options: ExposePortOptions): Promise<ExposePortResponse>
```

**Parameters**:

* `port` - Port number to expose (1024-65535)

* `options`:

  * `hostname` - Your Worker's domain name (e.g., `'example.com'`). Required to construct preview URLs with wildcard subdomains like `https://8080-sandbox-abc123.example.com`. Cannot be a `.workers.dev` domain as it doesn't support wildcard DNS patterns.
  * `name` - Friendly name for the port (optional)

**Returns**: `Promise<ExposePortResponse>` with `port`, `exposedAt` (preview URL), `name`

* JavaScript

  ```js
  // Extract hostname from request
  const { hostname } = new URL(request.url);


  await sandbox.startProcess("python -m http.server 8000");
  const exposed = await sandbox.exposePort(8000, { hostname });


  console.log("Available at:", exposed.exposedAt);
  // https://8000-abc123.yourdomain.com


  // Multiple services with names
  await sandbox.startProcess("node api.js");
  const api = await sandbox.exposePort(3000, { hostname, name: "api" });


  await sandbox.startProcess("npm run dev");
  const frontend = await sandbox.exposePort(5173, { hostname, name: "frontend" });
  ```

* TypeScript

  ```ts
  // Extract hostname from request
  const { hostname } = new URL(request.url);


  await sandbox.startProcess('python -m http.server 8000');
  const exposed = await sandbox.exposePort(8000, { hostname });


  console.log('Available at:', exposed.exposedAt);
  // https://8000-abc123.yourdomain.com


  // Multiple services with names
  await sandbox.startProcess('node api.js');
  const api = await sandbox.exposePort(3000, { hostname, name: 'api' });


  await sandbox.startProcess('npm run dev');
  const frontend = await sandbox.exposePort(5173, { hostname, name: 'frontend' });
  ```

Local development

When using `wrangler dev`, you must add `EXPOSE` directives to your Dockerfile for each port. See [Expose Services guide](https://developers.cloudflare.com/sandbox/guides/expose-services/#local-development) for details.

### `unexposePort()`

Remove an exposed port and close its preview URL.

```ts
await sandbox.unexposePort(port: number): Promise<void>
```

**Parameters**:

* `port` - Port number to unexpose

- JavaScript

  ```js
  await sandbox.unexposePort(8000);
  ```

- TypeScript

  ```ts
  await sandbox.unexposePort(8000);
  ```

### `getExposedPorts()`

Get information about all currently exposed ports.

```ts
const response = await sandbox.getExposedPorts(): Promise<GetExposedPortsResponse>
```

**Returns**: `Promise<GetExposedPortsResponse>` with `ports` array (containing `port`, `exposedAt`, `name`)

* JavaScript

  ```js
  const { ports } = await sandbox.getExposedPorts();


  for (const port of ports) {
    console.log(`${port.name || port.port}: ${port.exposedAt}`);
  }
  ```

* TypeScript

  ```ts
  const { ports } = await sandbox.getExposedPorts();


  for (const port of ports) {
  console.log(`${port.name || port.port}: ${port.exposedAt}`);
  }
  ```

### `wsConnect()`

Connect to WebSocket servers running in the sandbox. Use this when your Worker needs to establish WebSocket connections with services in the sandbox.

**Common use cases:**

* Route incoming WebSocket upgrade requests with custom authentication or authorization
* Connect from your Worker to get real-time data from sandbox services

For exposing WebSocket services via public preview URLs, use `exposePort()` with `proxyToSandbox()` instead. See [WebSocket Connections guide](https://developers.cloudflare.com/sandbox/guides/websocket-connections/) for examples.

```ts
const response = await sandbox.wsConnect(request: Request, port: number): Promise<Response>
```

**Parameters**:

* `request` - Incoming WebSocket upgrade request
* `port` - Port number (1024-65535, excluding 3000)

**Returns**: `Promise<Response>` - WebSocket response establishing the connection

* JavaScript

  ```js
  import { getSandbox } from "@cloudflare/sandbox";


  export { Sandbox } from "@cloudflare/sandbox";


  export default {
    async fetch(request, env) {
      if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
        const sandbox = getSandbox(env.Sandbox, "my-sandbox");
        return await sandbox.wsConnect(request, 8080);
      }


      return new Response("WebSocket endpoint", { status: 200 });
    },
  };
  ```

* TypeScript

  ```ts
  import { getSandbox } from "@cloudflare/sandbox";


  export { Sandbox } from "@cloudflare/sandbox";


  export default {
    async fetch(request: Request, env: Env): Promise<Response> {
      if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        const sandbox = getSandbox(env.Sandbox, 'my-sandbox');
        return await sandbox.wsConnect(request, 8080);
      }


      return new Response('WebSocket endpoint', { status: 200 });
    }
  };
  ```

## Related resources

* [Preview URLs concept](https://developers.cloudflare.com/sandbox/concepts/preview-urls/) - How preview URLs work
* [Commands API](https://developers.cloudflare.com/sandbox/api/commands/) - Start background processes
