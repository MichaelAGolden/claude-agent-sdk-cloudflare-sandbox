---
title: Work with Git · Cloudflare Sandbox SDK docs
description: Clone repositories, manage branches, and automate Git operations.
lastUpdated: 2025-10-21T14:02:11.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/sandbox/guides/git-workflows/
  md: https://developers.cloudflare.com/sandbox/guides/git-workflows/index.md
---

This guide shows you how to clone repositories, manage branches, and automate Git operations in the sandbox.

## Clone repositories

* JavaScript

  ```js
  import { getSandbox } from "@cloudflare/sandbox";


  const sandbox = getSandbox(env.Sandbox, "my-sandbox");


  // Basic clone
  await sandbox.gitCheckout("https://github.com/user/repo");


  // Clone specific branch
  await sandbox.gitCheckout("https://github.com/user/repo", {
    branch: "develop",
  });


  // Shallow clone (faster for large repos)
  await sandbox.gitCheckout("https://github.com/user/large-repo", {
    depth: 1,
  });


  // Clone to specific directory
  await sandbox.gitCheckout("https://github.com/user/my-app", {
    targetDir: "/workspace/project",
  });
  ```

* TypeScript

  ```ts
  import { getSandbox } from '@cloudflare/sandbox';


  const sandbox = getSandbox(env.Sandbox, 'my-sandbox');


  // Basic clone
  await sandbox.gitCheckout('https://github.com/user/repo');


  // Clone specific branch
  await sandbox.gitCheckout('https://github.com/user/repo', {
    branch: 'develop'
  });


  // Shallow clone (faster for large repos)
  await sandbox.gitCheckout('https://github.com/user/large-repo', {
    depth: 1
  });


  // Clone to specific directory
  await sandbox.gitCheckout('https://github.com/user/my-app', {
    targetDir: '/workspace/project'
  });
  ```

## Clone private repositories

Use a personal access token in the URL:

* JavaScript

  ```js
  const token = env.GITHUB_TOKEN;
  const repoUrl = `https://${token}@github.com/user/private-repo.git`;


  await sandbox.gitCheckout(repoUrl);
  ```

* TypeScript

  ```ts
  const token = env.GITHUB_TOKEN;
  const repoUrl = `https://${token}@github.com/user/private-repo.git`;


  await sandbox.gitCheckout(repoUrl);
  ```

## Clone and build

Clone a repository and run build steps:

* JavaScript

  ```js
  await sandbox.gitCheckout("https://github.com/user/my-app");


  const repoName = "my-app";


  // Install and build
  await sandbox.exec(`cd ${repoName} && npm install`);
  await sandbox.exec(`cd ${repoName} && npm run build`);


  console.log("Build complete");
  ```

* TypeScript

  ```ts
  await sandbox.gitCheckout('https://github.com/user/my-app');


  const repoName = 'my-app';


  // Install and build
  await sandbox.exec(`cd ${repoName} && npm install`);
  await sandbox.exec(`cd ${repoName} && npm run build`);


  console.log('Build complete');
  ```

## Work with branches

* JavaScript

  ```js
  await sandbox.gitCheckout("https://github.com/user/repo");


  // Switch branches
  await sandbox.exec("cd repo && git checkout feature-branch");


  // Create new branch
  await sandbox.exec("cd repo && git checkout -b new-feature");
  ```

* TypeScript

  ```ts
  await sandbox.gitCheckout('https://github.com/user/repo');


  // Switch branches
  await sandbox.exec('cd repo && git checkout feature-branch');


  // Create new branch
  await sandbox.exec('cd repo && git checkout -b new-feature');
  ```

## Make changes and commit

* JavaScript

  ```js
  await sandbox.gitCheckout("https://github.com/user/repo");


  // Modify a file
  const readme = await sandbox.readFile("/workspace/repo/README.md");
  await sandbox.writeFile(
    "/workspace/repo/README.md",
    readme.content + "\n\n## New Section",
  );


  // Commit changes
  await sandbox.exec('cd repo && git config user.name "Sandbox Bot"');
  await sandbox.exec('cd repo && git config user.email "bot@example.com"');
  await sandbox.exec("cd repo && git add README.md");
  await sandbox.exec('cd repo && git commit -m "Update README"');
  ```

* TypeScript

  ```ts
  await sandbox.gitCheckout('https://github.com/user/repo');


  // Modify a file
  const readme = await sandbox.readFile('/workspace/repo/README.md');
  await sandbox.writeFile('/workspace/repo/README.md', readme.content + '\n\n## New Section');


  // Commit changes
  await sandbox.exec('cd repo && git config user.name "Sandbox Bot"');
  await sandbox.exec('cd repo && git config user.email "bot@example.com"');
  await sandbox.exec('cd repo && git add README.md');
  await sandbox.exec('cd repo && git commit -m "Update README"');
  ```

## Best practices

* **Use shallow clones** - Faster for large repos with `depth: 1`
* **Store credentials securely** - Use environment variables for tokens
* **Clean up** - Delete unused repositories to save space

## Troubleshooting

### Authentication fails

Verify your token is set:

* JavaScript

  ```js
  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN not configured");
  }


  const repoUrl = `https://${env.GITHUB_TOKEN}@github.com/user/private-repo.git`;
  await sandbox.gitCheckout(repoUrl);
  ```

* TypeScript

  ```ts
  if (!env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN not configured');
  }


  const repoUrl = `https://${env.GITHUB_TOKEN}@github.com/user/private-repo.git`;
  await sandbox.gitCheckout(repoUrl);
  ```

### Large repository timeout

Use shallow clone:

* JavaScript

  ```js
  await sandbox.gitCheckout("https://github.com/user/large-repo", {
    depth: 1,
  });
  ```

* TypeScript

  ```ts
  await sandbox.gitCheckout('https://github.com/user/large-repo', {
    depth: 1
  });
  ```

## Related resources

* [Files API reference](https://developers.cloudflare.com/sandbox/api/files/) - File operations after cloning
* [Execute commands guide](https://developers.cloudflare.com/sandbox/guides/execute-commands/) - Run git commands
* [Manage files guide](https://developers.cloudflare.com/sandbox/guides/manage-files/) - Work with cloned files
