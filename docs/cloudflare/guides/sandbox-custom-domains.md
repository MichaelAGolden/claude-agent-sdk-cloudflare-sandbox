---
title: Deploy to Production · Cloudflare Sandbox SDK docs
description: Set up custom domains for preview URLs in production.
lastUpdated: 2025-11-08T10:22:38.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/sandbox/guides/production-deployment/
  md: https://developers.cloudflare.com/sandbox/guides/production-deployment/index.md
---

Only required for preview URLs

Custom domain setup is ONLY needed if you use `exposePort()` to expose services from sandboxes. If your application does not expose ports, you can deploy to `.workers.dev` without this configuration.

Deploy your Sandbox SDK application to production with preview URL support. Preview URLs require wildcard DNS routing because they generate unique subdomains for each exposed port: `https://8080-abc123.yourdomain.com`.

The `.workers.dev` domain does not support wildcard subdomains, so production deployments that use preview URLs need a custom domain.

## Prerequisites

* Active Cloudflare zone with a domain
* Worker that uses `exposePort()`
* [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed

## Setup

### Create Wildcard DNS Record

In the Cloudflare dashboard, go to your domain and create an A record:

* **Type**: A
* **Name**: \* (wildcard)
* **IPv4 address**: 192.0.2.0
* **Proxy status**: Proxied (orange cloud)

This routes all subdomains through Cloudflare's proxy. The IP address `192.0.2.0` is a documentation address (RFC 5737) that Cloudflare recognizes when proxied.

### Configure Worker Routes

Add a wildcard route to your Wrangler configuration:

* wrangler.jsonc

  ```jsonc
  {
    "$schema": "./node_modules/wrangler/config-schema.json",
    "name": "my-sandbox-app",
    "main": "src/index.ts",
    "compatibility_date": "2025-11-22",
    "routes": [
      {
        "pattern": "*.yourdomain.com/*",
        "zone_name": "yourdomain.com"
      }
    ]
  }
  ```

* wrangler.toml

  ```toml
  name = "my-sandbox-app"
  main = "src/index.ts"
  compatibility_date = "2025-11-22"


  [[routes]]
  pattern = "*.yourdomain.com/*"
  zone_name = "yourdomain.com"
  ```

Replace `yourdomain.com` with your actual domain. This routes all subdomain requests to your Worker and enables Cloudflare to provision SSL certificates automatically.

### Deploy

Deploy your Worker:

```sh
npx wrangler deploy
```

## Verify

Test that preview URLs work:

```typescript
// Extract hostname from request
const { hostname } = new URL(request.url);


const sandbox = getSandbox(env.Sandbox, 'test-sandbox');
await sandbox.startProcess('python -m http.server 8080');
const exposed = await sandbox.exposePort(8080, { hostname });


console.log(exposed.exposedAt);
// https://8080-test-sandbox.yourdomain.com
```

Visit the URL in your browser to confirm your service is accessible.

## Troubleshooting

* **CustomDomainRequiredError**: Verify your Worker is not deployed to `.workers.dev` and that the wildcard DNS record and route are configured correctly.
* **SSL/TLS errors**: Wait a few minutes for certificate provisioning. Verify the DNS record is proxied and SSL/TLS mode is set to "Full" or "Full (strict)" in your dashboard.
* **Preview URL not resolving**: Confirm the wildcard DNS record exists and is proxied. Wait 30-60 seconds for DNS propagation.
* **Port not accessible**: Ensure your service binds to `0.0.0.0` (not `localhost`) and that `proxyToSandbox()` is called first in your Worker's fetch handler.

For detailed troubleshooting, see the [Workers routing documentation](https://developers.cloudflare.com/workers/configuration/routing/).

## Related Resources

* [Preview URLs](https://developers.cloudflare.com/sandbox/concepts/preview-urls/) - How preview URLs work
* [Expose Services](https://developers.cloudflare.com/sandbox/guides/expose-services/) - Patterns for exposing ports
* [Workers Routing](https://developers.cloudflare.com/workers/configuration/routing/) - Advanced routing configuration
* [Cloudflare DNS](https://developers.cloudflare.com/dns/) - DNS management
