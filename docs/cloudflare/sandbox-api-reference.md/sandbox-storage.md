---
title: Storage · Cloudflare Sandbox SDK docs
description: Mount S3-compatible object storage as local filesystem paths for
  persistent storage across sandbox lifecycles.
lastUpdated: 2025-11-18T19:18:00.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/sandbox/api/storage/
  md: https://developers.cloudflare.com/sandbox/api/storage/index.md
---

Mount S3-compatible object storage as local filesystem paths for persistent storage across sandbox lifecycles.

Production only

Bucket mounting does not work with `wrangler dev` because it requires FUSE support that wrangler does not currently provide. Deploy your Worker to use this feature. See [Mount buckets guide](https://developers.cloudflare.com/sandbox/guides/mount-buckets/) for details.

## Methods

### `mountBucket()`

Mount an S3-compatible bucket as a local directory.

```ts
await sandbox.mountBucket(
  bucket: string,
  mountPath: string,
  options: MountBucketOptions
): Promise<void>
```

**Parameters**:

* `bucket` - Bucket name (e.g., `"my-r2-bucket"`)
* `mountPath` - Local filesystem path to mount at (e.g., `"/data"`)
* `options` - Mount configuration (see [`MountBucketOptions`](#mountbucketoptions))

- JavaScript

  ```js
  // Mount R2 bucket
  await sandbox.mountBucket("my-r2-bucket", "/data", {
    endpoint: "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com",
  });


  // Access mounted bucket
  await sandbox.exec("ls", { args: ["/data"] });
  await sandbox.writeFile("/data/results.json", JSON.stringify(data));


  // Mount with explicit credentials
  await sandbox.mountBucket("my-bucket", "/storage", {
    endpoint: "https://s3.amazonaws.com",
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });


  // Read-only mount
  await sandbox.mountBucket("datasets", "/datasets", {
    endpoint: "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com",
    readOnly: true,
  });
  ```

- TypeScript

  ```ts
  // Mount R2 bucket
  await sandbox.mountBucket('my-r2-bucket', '/data', {
    endpoint: 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com'
  });


  // Access mounted bucket
  await sandbox.exec('ls', { args: ['/data'] });
  await sandbox.writeFile('/data/results.json', JSON.stringify(data));


  // Mount with explicit credentials
  await sandbox.mountBucket('my-bucket', '/storage', {
    endpoint: 'https://s3.amazonaws.com',
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY
    }
  });


  // Read-only mount
  await sandbox.mountBucket('datasets', '/datasets', {
    endpoint: 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com',
    readOnly: true
  });
  ```

**Throws**:

* `MissingCredentialsError` - No credentials found in environment or options
* `InvalidMountConfigError` - Invalid endpoint, bucket name, or mount path
* `S3FSMountError` - Mount operation failed (network, permissions, bucket not found)

Automatic credential detection

The SDK automatically detects `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from environment variables if credentials are not explicitly provided.

Available on sessions

Both `sandbox.mountBucket()` and `session.mountBucket()` are supported. Mounts affect the entire sandbox filesystem and are visible across all sessions.

### `unmountBucket()`

Unmount a previously mounted bucket.

```ts
await sandbox.unmountBucket(mountPath: string): Promise<void>
```

**Parameters**:

* `mountPath` - Path where the bucket is mounted (e.g., `"/data"`)

- JavaScript

  ```js
  await sandbox.mountBucket("my-bucket", "/data", { endpoint: "..." });


  // Do work
  await sandbox.exec("python process.py");


  // Unmount
  await sandbox.unmountBucket("/data");
  ```

- TypeScript

  ```ts
  await sandbox.mountBucket('my-bucket', '/data', { endpoint: '...' });


  // Do work
  await sandbox.exec('python process.py');


  // Unmount
  await sandbox.unmountBucket('/data');
  ```

Automatic cleanup

Mounted buckets are automatically unmounted when the sandbox is destroyed. Manual unmounting is optional.

## Types

### `MountBucketOptions`

Configuration for mounting a bucket.

```ts
interface MountBucketOptions {
  endpoint: string;
  provider?: BucketProvider;
  credentials?: BucketCredentials;
  readOnly?: boolean;
  s3fsOptions?: Record<string, string>;
}
```

**Fields**:

* `endpoint` (required) - S3-compatible endpoint URL

  * R2: `https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com`
  * S3: `https://s3.amazonaws.com` or regional endpoint
  * GCS: `https://storage.googleapis.com`

* `provider` (optional) - Storage provider hint (`'r2'` | `'s3'` | `'gcs'`)

  * Default: Auto-detected from endpoint URL

* `credentials` (optional) - S3 access credentials

  * Default: Uses `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables

* `readOnly` (optional) - Mount in read-only mode

  * Default: `false`

* `s3fsOptions` (optional) - Advanced s3fs mount flags

  * Example: `{ 'use_cache': '/tmp/cache' }`

### `BucketProvider`

Storage provider hint for automatic s3fs flag optimization.

```ts
type BucketProvider = 'r2' | 's3' | 'gcs';
```

* `'r2'` - Cloudflare R2 (recommended, applies `nomixupload` flag)
* `'s3'` - Amazon S3
* `'gcs'` - Google Cloud Storage

The SDK auto-detects the provider from the endpoint URL and applies optimized flags. For other S3-compatible providers (Backblaze, MinIO, etc.), omit this field or use the `s3fsOptions` parameter for custom configuration.

### `BucketCredentials`

S3-compatible access credentials.

```ts
interface BucketCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}
```

* JavaScript

  ```js
  await sandbox.mountBucket("my-bucket", "/data", {
    endpoint: "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com",
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
  ```

* TypeScript

  ```ts
  await sandbox.mountBucket('my-bucket', '/data', {
    endpoint: 'https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com',
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY
    }
  });
  ```

Security

Never hardcode credentials. Use Worker secrets or environment variables.

## Related resources

* [Mount buckets guide](https://developers.cloudflare.com/sandbox/guides/mount-buckets/) - Complete mounting reference
* [Persistent storage tutorial](https://developers.cloudflare.com/sandbox/tutorials/persistent-storage/) - Example with R2
* [Environment variables](https://developers.cloudflare.com/sandbox/configuration/environment-variables/) - Credential configuration
* [R2 documentation](https://developers.cloudflare.com/r2/) - Learn about Cloudflare R2
