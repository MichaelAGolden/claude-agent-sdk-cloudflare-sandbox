---
title: Manage files · Cloudflare Sandbox SDK docs
description: Read, write, organize, and synchronize files in the sandbox.
lastUpdated: 2025-11-18T19:18:00.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/sandbox/guides/manage-files/
  md: https://developers.cloudflare.com/sandbox/guides/manage-files/index.md
---

This guide shows you how to read, write, organize, and synchronize files in the sandbox filesystem.

## Path conventions

File operations support both absolute and relative paths:

* `/workspace` - Default working directory for application files
* `/tmp` - Temporary files (may be cleared)
* `/home` - User home directory

- JavaScript

  ```js
  // Absolute paths
  await sandbox.writeFile("/workspace/app.js", code);


  // Relative paths (session-aware)
  const session = await sandbox.createSession();
  await session.exec("cd /workspace/my-project");
  await session.writeFile("app.js", code); // Writes to /workspace/my-project/app.js
  await session.writeFile("src/index.js", code); // Writes to /workspace/my-project/src/index.js
  ```

- TypeScript

  ```ts
  // Absolute paths
  await sandbox.writeFile('/workspace/app.js', code);


  // Relative paths (session-aware)
  const session = await sandbox.createSession();
  await session.exec('cd /workspace/my-project');
  await session.writeFile('app.js', code);  // Writes to /workspace/my-project/app.js
  await session.writeFile('src/index.js', code);  // Writes to /workspace/my-project/src/index.js
  ```

## Write files

* JavaScript

  ```js
  import { getSandbox } from "@cloudflare/sandbox";


  const sandbox = getSandbox(env.Sandbox, "my-sandbox");


  // Write text file
  await sandbox.writeFile(
    "/workspace/app.js",
    `console.log('Hello from sandbox!');`,
  );


  // Write JSON
  const config = { name: "my-app", version: "1.0.0" };
  await sandbox.writeFile(
    "/workspace/config.json",
    JSON.stringify(config, null, 2),
  );


  // Write binary file (base64)
  const buffer = await fetch(imageUrl).then((r) => r.arrayBuffer());
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  await sandbox.writeFile("/workspace/image.png", base64, { encoding: "base64" });
  ```

* TypeScript

  ```ts
  import { getSandbox } from '@cloudflare/sandbox';


  const sandbox = getSandbox(env.Sandbox, 'my-sandbox');


  // Write text file
  await sandbox.writeFile('/workspace/app.js', `console.log('Hello from sandbox!');`);


  // Write JSON
  const config = { name: 'my-app', version: '1.0.0' };
  await sandbox.writeFile('/workspace/config.json', JSON.stringify(config, null, 2));


  // Write binary file (base64)
  const buffer = await fetch(imageUrl).then(r => r.arrayBuffer());
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  await sandbox.writeFile('/workspace/image.png', base64, { encoding: 'base64' });
  ```

## Read files

* JavaScript

  ```js
  // Read text file
  const file = await sandbox.readFile("/workspace/app.js");
  console.log(file.content);


  // Read and parse JSON
  const configFile = await sandbox.readFile("/workspace/config.json");
  const config = JSON.parse(configFile.content);


  // Read binary file
  const imageFile = await sandbox.readFile("/workspace/image.png", {
    encoding: "base64",
  });
  return new Response(atob(imageFile.content), {
    headers: { "Content-Type": "image/png" },
  });


  // Force encoding for transmission (text → base64)
  const textAsBase64 = await sandbox.readFile("/workspace/data.txt", {
    encoding: "base64",
  });
  // Useful for transmitting text files without encoding issues
  ```

* TypeScript

  ```ts
  // Read text file
  const file = await sandbox.readFile('/workspace/app.js');
  console.log(file.content);


  // Read and parse JSON
  const configFile = await sandbox.readFile('/workspace/config.json');
  const config = JSON.parse(configFile.content);


  // Read binary file
  const imageFile = await sandbox.readFile('/workspace/image.png', { encoding: 'base64' });
  return new Response(atob(imageFile.content), {
    headers: { 'Content-Type': 'image/png' }
  });


  // Force encoding for transmission (text → base64)
  const textAsBase64 = await sandbox.readFile('/workspace/data.txt', { encoding: 'base64' });
  // Useful for transmitting text files without encoding issues
  ```

## Organize files

* JavaScript

  ```js
  // Create directories
  await sandbox.mkdir("/workspace/src", { recursive: true });
  await sandbox.mkdir("/workspace/tests", { recursive: true });


  // Rename file
  await sandbox.renameFile("/workspace/draft.txt", "/workspace/final.txt");


  // Move file
  await sandbox.moveFile("/tmp/download.txt", "/workspace/data.txt");


  // Delete file
  await sandbox.deleteFile("/workspace/temp.txt");
  ```

* TypeScript

  ```ts
  // Create directories
  await sandbox.mkdir('/workspace/src', { recursive: true });
  await sandbox.mkdir('/workspace/tests', { recursive: true });


  // Rename file
  await sandbox.renameFile('/workspace/draft.txt', '/workspace/final.txt');


  // Move file
  await sandbox.moveFile('/tmp/download.txt', '/workspace/data.txt');


  // Delete file
  await sandbox.deleteFile('/workspace/temp.txt');
  ```

## Batch operations

Write multiple files in parallel:

* JavaScript

  ```js
  const files = {
    "/workspace/src/app.js": 'console.log("app");',
    "/workspace/src/utils.js": 'console.log("utils");',
    "/workspace/README.md": "# My Project",
  };


  await Promise.all(
    Object.entries(files).map(([path, content]) =>
      sandbox.writeFile(path, content),
    ),
  );
  ```

* TypeScript

  ```ts
  const files = {
    '/workspace/src/app.js': 'console.log("app");',
    '/workspace/src/utils.js': 'console.log("utils");',
    '/workspace/README.md': '# My Project'
  };


  await Promise.all(
    Object.entries(files).map(([path, content]) =>
      sandbox.writeFile(path, content)
    )
  );
  ```

## Check if file exists

* JavaScript

  ```js
  const result = await sandbox.exists("/workspace/config.json");
  if (!result.exists) {
    // Create default config
    await sandbox.writeFile("/workspace/config.json", "{}");
  }


  // Check directory
  const dirResult = await sandbox.exists("/workspace/data");
  if (!dirResult.exists) {
    await sandbox.mkdir("/workspace/data");
  }


  // Also available on sessions
  const sessionResult = await session.exists("/workspace/temp.txt");
  ```

* TypeScript

  ```ts
  const result = await sandbox.exists('/workspace/config.json');
  if (!result.exists) {
    // Create default config
    await sandbox.writeFile('/workspace/config.json', '{}');
  }


  // Check directory
  const dirResult = await sandbox.exists('/workspace/data');
  if (!dirResult.exists) {
    await sandbox.mkdir('/workspace/data');
  }


  // Also available on sessions
  const sessionResult = await session.exists('/workspace/temp.txt');
  ```

## Best practices

* **Use `/workspace`** - Default working directory for app files
* **Use absolute paths** - Always use full paths like `/workspace/file.txt`
* **Batch operations** - Use `Promise.all()` for multiple independent file writes
* **Create parent directories** - Use `recursive: true` when creating nested paths
* **Handle errors** - Check for `FILE_NOT_FOUND` errors gracefully

## Troubleshooting

### Directory doesn't exist

Create parent directories first:

* JavaScript

  ```js
  // Create directory, then write file
  await sandbox.mkdir("/workspace/data", { recursive: true });
  await sandbox.writeFile("/workspace/data/file.txt", content);
  ```

* TypeScript

  ```ts
  // Create directory, then write file
  await sandbox.mkdir('/workspace/data', { recursive: true });
  await sandbox.writeFile('/workspace/data/file.txt', content);
  ```

### Binary file encoding

Use base64 for binary files:

* JavaScript

  ```js
  // Write binary
  await sandbox.writeFile("/workspace/image.png", base64Data, {
    encoding: "base64",
  });


  // Read binary
  const file = await sandbox.readFile("/workspace/image.png", {
    encoding: "base64",
  });
  ```

* TypeScript

  ```ts
  // Write binary
  await sandbox.writeFile('/workspace/image.png', base64Data, {
    encoding: 'base64'
  });


  // Read binary
  const file = await sandbox.readFile('/workspace/image.png', {
    encoding: 'base64'
  });
  ```

### Base64 validation errors

When writing with `encoding: 'base64'`, content must contain only valid base64 characters:

* JavaScript

  ```js
  try {
    // Invalid: contains invalid base64 characters
    await sandbox.writeFile("/workspace/data.bin", "invalid!@#$", {
      encoding: "base64",
    });
  } catch (error) {
    if (error.code === "VALIDATION_FAILED") {
      // Content contains invalid base64 characters
      console.error("Invalid base64 content");
    }
  }
  ```

* TypeScript

  ```ts
  try {
    // Invalid: contains invalid base64 characters
    await sandbox.writeFile('/workspace/data.bin', 'invalid!@#$', {
      encoding: 'base64'
    });
  } catch (error) {
    if (error.code === 'VALIDATION_FAILED') {
      // Content contains invalid base64 characters
      console.error('Invalid base64 content');
    }
  }
  ```

## Related resources

* [Files API reference](https://developers.cloudflare.com/sandbox/api/files/) - Complete method documentation
* [Execute commands guide](https://developers.cloudflare.com/sandbox/guides/execute-commands/) - Run file operations with commands
* [Git workflows guide](https://developers.cloudflare.com/sandbox/guides/git-workflows/) - Clone and manage repositories
* [Code Interpreter guide](https://developers.cloudflare.com/sandbox/guides/code-execution/) - Generate and execute code files
