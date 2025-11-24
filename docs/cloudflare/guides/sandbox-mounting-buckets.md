---
title: Mount buckets · Cloudflare Sandbox SDK docs
description: Mount S3-compatible object storage as local filesystems for
  persistent data storage.
lastUpdated: 2025-11-18T19:18:00.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/sandbox/guides/mount-buckets/
  md: https://developers.cloudflare.com/sandbox/guides/mount-buckets/index.md
---

Mount S3-compatible object storage buckets as local filesystem paths. Access object storage using standard file operations.

S3-compatible providers

The SDK works with any S3-compatible object storage provider. Examples include Cloudflare R2, Amazon S3, Google Cloud Storage, Backblaze B2, MinIO, and [many others](https://github.com/s3fs-fuse/s3fs-fuse/wiki/Non-Amazon-S3). The SDK automatically detects and optimizes for R2, S3, and GCS.

Production only

Bucket mounting does not work with `wrangler dev` because it requires FUSE support that wrangler does not currently provide. Deploy your Worker with `wrangler deploy` to use this feature. All other Sandbox SDK features work in local development.

## When to mount buckets

Mount S3-compatible buckets when you need:

* **Persistent data** - Data survives sandbox destruction
* **Large datasets** - Process data without downloading
* **Shared storage** - Multiple sandboxes access the same data
* **Cost-effective persistence** - Cheaper than keeping sandboxes alive

## Mount an R2 bucket

* JavaScript

  ```js
  import { getSandbox } from "@cloudflare/sandbox";


  const sandbox = getSandbox(env.Sandbox, "data-processor");


  // Mount R2 bucket
  await sandbox.mountBucket("my-r2-bucket", "/data", {
    endpoint: "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com",
  });


  // Access bucket with standard filesystem operations
  await sandbox.exec("ls", { args: ["/data"] });
  await sandbox.writeFile("/data/results.json", JSON.stringify(results));


  // Use from Python
  await sandbox.exec("python", {
    args: [
      "-c",
      `
  import pandas as pd
  df = pd.read_csv('/data/input.csv')
  df.describe().to_csv('/data/summary.csv')
  `,
    ],
  });
  ```

* TypeScript

  ```ts
  import { getSandbox } from '@cloudflare/sandbox';


  const sandbox = getSandbox(env.Sandbox, 'data-processor');


  // Mount R2 bucket
  await sandbox.mountBucket('my-r2-bucket', '/data', {
    endpoint: 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com'
  });


  // Access bucket with standard filesystem operations
  await sandbox.exec('ls', { args: ['/data'] });
  await sandbox.writeFile('/data/results.json', JSON.stringify(results));


  // Use from Python
  await sandbox.exec('python', { args: ['-c', `
  import pandas as pd
  df = pd.read_csv('/data/input.csv')
  df.describe().to_csv('/data/summary.csv')
  `] });
  ```

Mounting affects entire sandbox

Mounted buckets are visible across all sessions since they share the filesystem. Mount once per sandbox.

## Credentials

### Automatic detection

Set credentials as Worker secrets and the SDK automatically detects them:

```sh
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
```

* JavaScript

  ```js
  // Credentials automatically detected from environment
  await sandbox.mountBucket("my-r2-bucket", "/data", {
    endpoint: "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com",
  });
  ```

* TypeScript

  ```ts
  // Credentials automatically detected from environment
  await sandbox.mountBucket('my-r2-bucket', '/data', {
    endpoint: 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com'
  });
  ```

### Explicit credentials

Pass credentials directly when needed:

* JavaScript

  ```js
  await sandbox.mountBucket("my-r2-bucket", "/data", {
    endpoint: "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com",
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  ```

* TypeScript

  ```ts
  await sandbox.mountBucket('my-r2-bucket', '/data', {
    endpoint: 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com',
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY
    }
  });
  ```

## Read-only mounts

Protect data by mounting buckets in read-only mode:

* JavaScript

  ```js
  await sandbox.mountBucket("dataset-bucket", "/data", {
    endpoint: "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com",
    readOnly: true,
  });


  // Reads work
  await sandbox.exec("cat", { args: ["/data/dataset.csv"] });


  // Writes fail
  await sandbox.writeFile("/data/new-file.txt", "data"); // Error: Read-only filesystem
  ```

* TypeScript

  ```ts
  await sandbox.mountBucket('dataset-bucket', '/data', {
    endpoint: 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com',
    readOnly: true
  });


  // Reads work
  await sandbox.exec('cat', { args: ['/data/dataset.csv'] });


  // Writes fail
  await sandbox.writeFile('/data/new-file.txt', 'data');  // Error: Read-only filesystem
  ```

## Unmount buckets

* JavaScript

  ```js
  // Mount for processing
  await sandbox.mountBucket("my-bucket", "/data", { endpoint: "..." });


  // Do work
  await sandbox.exec("python process_data.py");


  // Clean up
  await sandbox.unmountBucket("/data");
  ```

* TypeScript

  ```ts
  // Mount for processing
  await sandbox.mountBucket('my-bucket', '/data', { endpoint: '...' });


  // Do work
  await sandbox.exec('python process_data.py');


  // Clean up
  await sandbox.unmountBucket('/data');
  ```

Automatic cleanup

Mounted buckets are automatically unmounted when the sandbox is destroyed. Manual unmounting is optional.

## Other providers

The SDK supports any S3-compatible object storage. Here are examples for common providers:

### Amazon S3

* JavaScript

  ```js
  await sandbox.mountBucket("my-s3-bucket", "/data", {
    endpoint: "https://s3.us-west-2.amazonaws.com", // Regional endpoint
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
  ```

* TypeScript

  ```ts
  await sandbox.mountBucket('my-s3-bucket', '/data', {
    endpoint: 'https://s3.us-west-2.amazonaws.com',  // Regional endpoint
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY
    }
  });
  ```

### Google Cloud Storage

* JavaScript

  ```js
  await sandbox.mountBucket("my-gcs-bucket", "/data", {
    endpoint: "https://storage.googleapis.com",
    credentials: {
      accessKeyId: env.GCS_ACCESS_KEY_ID, // HMAC key
      secretAccessKey: env.GCS_SECRET_ACCESS_KEY,
    },
  });
  ```

* TypeScript

  ```ts
  await sandbox.mountBucket('my-gcs-bucket', '/data', {
    endpoint: 'https://storage.googleapis.com',
    credentials: {
      accessKeyId: env.GCS_ACCESS_KEY_ID,  // HMAC key
      secretAccessKey: env.GCS_SECRET_ACCESS_KEY
    }
  });
  ```

GCS requires HMAC keys

Generate HMAC keys in GCS console under Settings → Interoperability.

### Other S3-compatible providers

For providers like Backblaze B2, MinIO, Wasabi, or others, use the standard mount pattern:

* JavaScript

  ```js
  await sandbox.mountBucket("my-bucket", "/data", {
    endpoint: "https://s3.us-west-000.backblazeb2.com", // Provider-specific endpoint
    credentials: {
      accessKeyId: env.ACCESS_KEY_ID,
      secretAccessKey: env.SECRET_ACCESS_KEY,
    },
  });
  ```

* TypeScript

  ```ts
  await sandbox.mountBucket('my-bucket', '/data', {
    endpoint: 'https://s3.us-west-000.backblazeb2.com',  // Provider-specific endpoint
    credentials: {
      accessKeyId: env.ACCESS_KEY_ID,
      secretAccessKey: env.SECRET_ACCESS_KEY
    }
  });
  ```

For provider-specific configuration, see the [s3fs-fuse wiki](https://github.com/s3fs-fuse/s3fs-fuse/wiki/Non-Amazon-S3) which documents supported providers and their recommended flags.

## Troubleshooting

### Missing credentials error

**Error**: `MissingCredentialsError: No credentials found`

**Solution**: Set credentials as Worker secrets:

```sh
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
```

### Mount failed error

**Error**: `S3FSMountError: mount failed`

**Common causes**:

* Incorrect endpoint URL
* Invalid credentials
* Bucket doesn't exist
* Network connectivity issues

Verify your endpoint format and credentials:

* JavaScript

  ```js
  try {
    await sandbox.mountBucket("my-bucket", "/data", {
      endpoint: "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com",
    });
  } catch (error) {
    console.error("Mount failed:", error.message);
    // Check endpoint format, credentials, bucket existence
  }
  ```

* TypeScript

  ```ts
  try {
    await sandbox.mountBucket('my-bucket', '/data', {
      endpoint: 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com'
    });
  } catch (error) {
    console.error('Mount failed:', error.message);
    // Check endpoint format, credentials, bucket existence
  }
  ```

### Path already mounted error

**Error**: `InvalidMountConfigError: Mount path already in use`

**Solution**: Unmount first or use a different path:

* JavaScript

  ```js
  // Unmount existing
  await sandbox.unmountBucket("/data");


  // Or use different path
  await sandbox.mountBucket("bucket2", "/storage", { endpoint: "..." });
  ```

* TypeScript

  ```ts
  // Unmount existing
  await sandbox.unmountBucket('/data');


  // Or use different path
  await sandbox.mountBucket('bucket2', '/storage', { endpoint: '...' });
  ```

### Slow file access

File operations on mounted buckets are slower than local filesystem due to network latency.

**Solution**: Copy frequently accessed files locally:

* JavaScript

  ```js
  // Copy to local filesystem
  await sandbox.exec("cp", {
    args: ["/data/large-dataset.csv", "/workspace/dataset.csv"],
  });


  // Work with local copy (faster)
  await sandbox.exec("python", {
    args: ["process.py", "/workspace/dataset.csv"],
  });


  // Save results back to bucket
  await sandbox.exec("cp", {
    args: ["/workspace/results.json", "/data/results/output.json"],
  });
  ```

* TypeScript

  ```ts
  // Copy to local filesystem
  await sandbox.exec('cp', { args: ['/data/large-dataset.csv', '/workspace/dataset.csv'] });


  // Work with local copy (faster)
  await sandbox.exec('python', { args: ['process.py', '/workspace/dataset.csv'] });


  // Save results back to bucket
  await sandbox.exec('cp', { args: ['/workspace/results.json', '/data/results/output.json'] });
  ```

## Best practices

* **Mount early** - Mount buckets at sandbox initialization
* **Use R2 for Cloudflare** - Zero egress fees and optimized configuration
* **Secure credentials** - Always use Worker secrets, never hardcode
* **Read-only when possible** - Protect data with read-only mounts
* **Mount paths** - Use `/data`, `/storage`, or `/mnt/*` (avoid `/workspace`, `/tmp`)
* **Handle errors** - Wrap mount operations in try/catch blocks
* **Optimize access** - Copy frequently accessed files locally

## Related resources

* [Persistent storage tutorial](https://developers.cloudflare.com/sandbox/tutorials/persistent-storage/) - Complete R2 example
* [Storage API reference](https://developers.cloudflare.com/sandbox/api/storage/) - Full method documentation
* [Environment variables](https://developers.cloudflare.com/sandbox/configuration/environment-variables/) - Credential configuration
* [R2 documentation](https://developers.cloudflare.com/r2/) - Learn about Cloudflare R2
