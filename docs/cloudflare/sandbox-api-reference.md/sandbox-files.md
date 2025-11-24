---
title: Files · Cloudflare Sandbox SDK docs
description: Read, write, and manage files in the sandbox filesystem. All paths
  are absolute (e.g., /workspace/app.js).
lastUpdated: 2025-11-18T19:18:00.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/sandbox/api/files/
  md: https://developers.cloudflare.com/sandbox/api/files/index.md
---

Read, write, and manage files in the sandbox filesystem. All paths are absolute (e.g., `/workspace/app.js`).

## Methods

### `writeFile()`

Write content to a file.

```ts
await sandbox.writeFile(path: string, content: string, options?: WriteFileOptions): Promise<void>
```

**Parameters**:

* `path` - Absolute path to the file
* `content` - Content to write
* `options` (optional):
  * `encoding` - File encoding (`"utf-8"` or `"base64"`, default: `"utf-8"`)

- JavaScript

  ```js
  await sandbox.writeFile("/workspace/app.js", `console.log('Hello!');`);


  // Binary data
  await sandbox.writeFile("/tmp/image.png", base64Data, { encoding: "base64" });
  ```

- TypeScript

  ```ts
  await sandbox.writeFile('/workspace/app.js', `console.log('Hello!');`);


  // Binary data
  await sandbox.writeFile('/tmp/image.png', base64Data, { encoding: 'base64' });
  ```

Base64 validation

When using `encoding: 'base64'`, content must contain only valid base64 characters (A-Z, a-z, 0-9, +, /, =). Invalid base64 content returns a validation error.

### `readFile()`

Read a file from the sandbox.

```ts
const file = await sandbox.readFile(path: string, options?: ReadFileOptions): Promise<FileInfo>
```

**Parameters**:

* `path` - Absolute path to the file
* `options` (optional):
  * `encoding` - File encoding (`"utf-8"` or `"base64"`, default: auto-detected from MIME type)

**Returns**: `Promise<FileInfo>` with `content` and `encoding`

* JavaScript

  ```js
  const file = await sandbox.readFile("/workspace/package.json");
  const pkg = JSON.parse(file.content);


  // Binary data (auto-detected or forced)
  const image = await sandbox.readFile("/tmp/image.png", { encoding: "base64" });


  // Force encoding (override MIME detection)
  const textAsBase64 = await sandbox.readFile("/workspace/data.txt", {
    encoding: "base64",
  });
  ```

* TypeScript

  ```ts
  const file = await sandbox.readFile('/workspace/package.json');
  const pkg = JSON.parse(file.content);


  // Binary data (auto-detected or forced)
  const image = await sandbox.readFile('/tmp/image.png', { encoding: 'base64' });


  // Force encoding (override MIME detection)
  const textAsBase64 = await sandbox.readFile('/workspace/data.txt', { encoding: 'base64' });
  ```

Encoding behavior

When `encoding` is specified, it overrides MIME-based auto-detection. Without `encoding`, the SDK detects the appropriate encoding from the file's MIME type.

### `exists()`

Check if a file or directory exists.

```ts
const result = await sandbox.exists(path: string): Promise<FileExistsResult>
```

**Parameters**:

* `path` - Absolute path to check

**Returns**: `Promise<FileExistsResult>` with `exists` boolean

* JavaScript

  ```js
  const result = await sandbox.exists("/workspace/package.json");
  if (result.exists) {
    const file = await sandbox.readFile("/workspace/package.json");
    // process file
  }


  // Check directory
  const dirResult = await sandbox.exists("/workspace/src");
  if (!dirResult.exists) {
    await sandbox.mkdir("/workspace/src");
  }
  ```

* TypeScript

  ```ts
  const result = await sandbox.exists('/workspace/package.json');
  if (result.exists) {
    const file = await sandbox.readFile('/workspace/package.json');
    // process file
  }


  // Check directory
  const dirResult = await sandbox.exists('/workspace/src');
  if (!dirResult.exists) {
    await sandbox.mkdir('/workspace/src');
  }
  ```

Available on sessions

Both `sandbox.exists()` and `session.exists()` are supported.

### `mkdir()`

Create a directory.

```ts
await sandbox.mkdir(path: string, options?: MkdirOptions): Promise<void>
```

**Parameters**:

* `path` - Absolute path to the directory
* `options` (optional):
  * `recursive` - Create parent directories if needed (default: `false`)

- JavaScript

  ```js
  await sandbox.mkdir("/workspace/src");


  // Nested directories
  await sandbox.mkdir("/workspace/src/components/ui", { recursive: true });
  ```

- TypeScript

  ```ts
  await sandbox.mkdir('/workspace/src');


  // Nested directories
  await sandbox.mkdir('/workspace/src/components/ui', { recursive: true });
  ```

### `deleteFile()`

Delete a file.

```ts
await sandbox.deleteFile(path: string): Promise<void>
```

**Parameters**:

* `path` - Absolute path to the file

- JavaScript

  ```js
  await sandbox.deleteFile("/workspace/temp.txt");
  ```

- TypeScript

  ```ts
  await sandbox.deleteFile('/workspace/temp.txt');
  ```

### `renameFile()`

Rename a file.

```ts
await sandbox.renameFile(oldPath: string, newPath: string): Promise<void>
```

**Parameters**:

* `oldPath` - Current file path
* `newPath` - New file path

- JavaScript

  ```js
  await sandbox.renameFile("/workspace/draft.txt", "/workspace/final.txt");
  ```

- TypeScript

  ```ts
  await sandbox.renameFile('/workspace/draft.txt', '/workspace/final.txt');
  ```

### `moveFile()`

Move a file to a different directory.

```ts
await sandbox.moveFile(sourcePath: string, destinationPath: string): Promise<void>
```

**Parameters**:

* `sourcePath` - Current file path
* `destinationPath` - Destination path

- JavaScript

  ```js
  await sandbox.moveFile("/tmp/download.txt", "/workspace/data.txt");
  ```

- TypeScript

  ```ts
  await sandbox.moveFile('/tmp/download.txt', '/workspace/data.txt');
  ```

### `gitCheckout()`

Clone a git repository.

```ts
await sandbox.gitCheckout(repoUrl: string, options?: GitCheckoutOptions): Promise<void>
```

**Parameters**:

* `repoUrl` - Git repository URL

* `options` (optional):

  * `branch` - Branch to checkout (default: main branch)
  * `targetDir` - Directory to clone into (default: repo name)
  * `depth` - Clone depth for shallow clone

- JavaScript

  ```js
  await sandbox.gitCheckout("https://github.com/user/repo");


  // Specific branch
  await sandbox.gitCheckout("https://github.com/user/repo", {
    branch: "develop",
    targetDir: "my-project",
  });
  ```

- TypeScript

  ```ts
  await sandbox.gitCheckout('https://github.com/user/repo');


  // Specific branch
  await sandbox.gitCheckout('https://github.com/user/repo', {
    branch: 'develop',
    targetDir: 'my-project'
  });
  ```

## Related resources

* [Manage files guide](https://developers.cloudflare.com/sandbox/guides/manage-files/) - Detailed guide with best practices
* [Commands API](https://developers.cloudflare.com/sandbox/api/commands/) - Execute commands
