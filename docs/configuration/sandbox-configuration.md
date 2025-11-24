---
title: Wrangler configuration · Cloudflare Sandbox SDK docs
description: "The minimum required configuration for using Sandbox SDK:"
lastUpdated: 2025-10-21T14:02:11.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/sandbox/configuration/wrangler/
  md: https://developers.cloudflare.com/sandbox/configuration/wrangler/index.md
---

## Minimal configuration

The minimum required configuration for using Sandbox SDK:

```jsonc
{
  "name": "my-sandbox-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-10-13",
  "compatibility_flags": ["nodejs_compat"],
  "containers": [
    {
      "class_name": "Sandbox",
      "image": "./Dockerfile",
    },
  ],
  "durable_objects": {
    "bindings": [
      {
        "class_name": "Sandbox",
        "name": "Sandbox",
      },
    ],
  },
  "migrations": [
    {
      "new_sqlite_classes": ["Sandbox"],
      "tag": "v1",
    },
  ],
}
```

## Required settings

The Sandbox SDK is built on Cloudflare Containers. Your configuration requires three sections:

1. **containers** - Define the container image (your runtime environment)
2. **durable\_objects.bindings** - Bind the Sandbox Durable Object to your Worker
3. **migrations** - Initialize the Durable Object class

The minimal configuration shown above includes all required settings. For detailed configuration options, refer to the [Containers configuration documentation](https://developers.cloudflare.com/workers/wrangler/configuration/#containers).

## Troubleshooting

### Binding not found

**Error**: `TypeError: env.Sandbox is undefined`

**Solution**: Ensure your `wrangler.jsonc` includes the Durable Objects binding:

```jsonc
{
  "durable_objects": {
    "bindings": [
      {
        "class_name": "Sandbox",
        "name": "Sandbox",
      },
    ],
  },
}
```

### Missing migrations

**Error**: Durable Object not initialized

**Solution**: Add migrations for the Sandbox class:

```jsonc
{
  "migrations": [
    {
      "new_sqlite_classes": ["Sandbox"],
      "tag": "v1",
    },
  ],
}
```

## Related resources

* [Wrangler documentation](https://developers.cloudflare.com/workers/wrangler/) - Complete Wrangler reference
* [Durable Objects setup](https://developers.cloudflare.com/durable-objects/get-started/) - DO-specific configuration
* [Dockerfile reference](https://developers.cloudflare.com/sandbox/configuration/dockerfile/) - Custom container images
* [Environment variables](https://developers.cloudflare.com/sandbox/configuration/environment-variables/) - Passing configuration to sandboxes
* [Get Started guide](https://developers.cloudflare.com/sandbox/get-started/) - Initial setup walkthrough
