---
title: Code Interpreter · Cloudflare Sandbox SDK docs
description: Execute Python, JavaScript, and TypeScript code with support for
  data visualizations, tables, and rich output formats. Contexts maintain state
  (variables, imports, functions) across executions.
lastUpdated: 2025-11-06T16:25:37.000Z
chatbotDeprioritize: false
source_url:
  html: https://developers.cloudflare.com/sandbox/api/interpreter/
  md: https://developers.cloudflare.com/sandbox/api/interpreter/index.md
---

Execute Python, JavaScript, and TypeScript code with support for data visualizations, tables, and rich output formats. Contexts maintain state (variables, imports, functions) across executions.

## Methods

### `createCodeContext()`

Create a persistent execution context for running code.

```ts
const context = await sandbox.createCodeContext(options?: CreateContextOptions): Promise<CodeContext>
```

**Parameters**:

* `options` (optional):

  * `language` - `"python" | "javascript" | "typescript"` (default: `"python"`)
  * `cwd` - Working directory (default: `"/workspace"`)
  * `envVars` - Environment variables
  * `timeout` - Request timeout in milliseconds (default: 30000)

**Returns**: `Promise<CodeContext>` with `id`, `language`, `cwd`, `createdAt`, `lastUsed`

* JavaScript

  ```js
  const ctx = await sandbox.createCodeContext({
    language: "python",
    envVars: { API_KEY: env.API_KEY },
  });
  ```

* TypeScript

  ```ts
  const ctx = await sandbox.createCodeContext({
    language: 'python',
    envVars: { API_KEY: env.API_KEY }
  });
  ```

### `runCode()`

Execute code in a context and return the complete result.

```ts
const result = await sandbox.runCode(code: string, options?: RunCodeOptions): Promise<ExecutionResult>
```

**Parameters**:

* `code` - The code to execute (required)

* `options` (optional):

  * `context` - Context to run in (recommended - see below)
  * `language` - `"python" | "javascript" | "typescript"` (default: `"python"`)
  * `timeout` - Execution timeout in milliseconds (default: 60000)
  * `onStdout`, `onStderr`, `onResult`, `onError` - Streaming callbacks

**Returns**: `Promise<ExecutionResult>` with:

* `code` - The executed code
* `logs` - `stdout` and `stderr` arrays
* `results` - Array of rich outputs (see [Rich Output Formats](#rich-output-formats))
* `error` - Execution error if any
* `executionCount` - Execution counter

**Recommended usage - create explicit context**:

* JavaScript

  ```js
  const ctx = await sandbox.createCodeContext({ language: "python" });


  await sandbox.runCode("import math; radius = 5", { context: ctx });
  const result = await sandbox.runCode("math.pi * radius ** 2", { context: ctx });


  console.log(result.results[0].text); // "78.53981633974483"
  ```

* TypeScript

  ```ts
  const ctx = await sandbox.createCodeContext({ language: 'python' });


  await sandbox.runCode('import math; radius = 5', { context: ctx });
  const result = await sandbox.runCode('math.pi * radius ** 2', { context: ctx });


  console.log(result.results[0].text); // "78.53981633974483"
  ```

Default context behavior

If no `context` is provided, a default context is automatically created/reused for the specified `language`. While convenient for quick tests, **explicitly creating contexts is recommended** for production use to maintain predictable state.

* JavaScript

  ```js
  const result = await sandbox.runCode(
    `
  data = [1, 2, 3, 4, 5]
  print(f"Sum: {sum(data)}")
  sum(data)
  `,
    { language: "python" },
  );


  console.log(result.logs.stdout); // ["Sum: 15"]
  console.log(result.results[0].text); // "15"
  ```

* TypeScript

  ```ts
  const result = await sandbox.runCode(`
  data = [1, 2, 3, 4, 5]
  print(f"Sum: {sum(data)}")
  sum(data)
  `, { language: 'python' });


  console.log(result.logs.stdout); // ["Sum: 15"]
  console.log(result.results[0].text); // "15"
  ```

**Error handling**:

* JavaScript

  ```js
  const result = await sandbox.runCode("x = 1 / 0", { language: "python" });


  if (result.error) {
    console.error(result.error.name); // "ZeroDivisionError"
    console.error(result.error.value); // "division by zero"
    console.error(result.error.traceback); // Stack trace array
  }
  ```

* TypeScript

  ```ts
  const result = await sandbox.runCode('x = 1 / 0', { language: 'python' });


  if (result.error) {
    console.error(result.error.name);      // "ZeroDivisionError"
    console.error(result.error.value);     // "division by zero"
    console.error(result.error.traceback); // Stack trace array
  }
  ```

### `listCodeContexts()`

List all active code execution contexts.

```ts
const contexts = await sandbox.listCodeContexts(): Promise<CodeContext[]>
```

* JavaScript

  ```js
  const contexts = await sandbox.listCodeContexts();
  console.log(`Found ${contexts.length} contexts`);
  ```

* TypeScript

  ```ts
  const contexts = await sandbox.listCodeContexts();
  console.log(`Found ${contexts.length} contexts`);
  ```

### `deleteCodeContext()`

Delete a code execution context and free its resources.

```ts
await sandbox.deleteCodeContext(contextId: string): Promise<void>
```

* JavaScript

  ```js
  const ctx = await sandbox.createCodeContext({ language: "python" });
  await sandbox.runCode('print("Hello")', { context: ctx });
  await sandbox.deleteCodeContext(ctx.id);
  ```

* TypeScript

  ```ts
  const ctx = await sandbox.createCodeContext({ language: 'python' });
  await sandbox.runCode('print("Hello")', { context: ctx });
  await sandbox.deleteCodeContext(ctx.id);
  ```

## Rich Output Formats

Results include: `text`, `html`, `png`, `jpeg`, `svg`, `latex`, `markdown`, `json`, `chart`, `data`

**Charts (matplotlib)**:

* JavaScript

  ```js
  const result = await sandbox.runCode(
    `
  import matplotlib.pyplot as plt
  import numpy as np


  x = np.linspace(0, 10, 100)
  plt.plot(x, np.sin(x))
  plt.show()
  `,
    { language: "python" },
  );


  if (result.results[0]?.png) {
    const imageBuffer = Buffer.from(result.results[0].png, "base64");
    return new Response(imageBuffer, {
      headers: { "Content-Type": "image/png" },
    });
  }
  ```

* TypeScript

  ```ts
  const result = await sandbox.runCode(`
  import matplotlib.pyplot as plt
  import numpy as np


  x = np.linspace(0, 10, 100)
  plt.plot(x, np.sin(x))
  plt.show()
  `, { language: 'python' });


  if (result.results[0]?.png) {
    const imageBuffer = Buffer.from(result.results[0].png, 'base64');
    return new Response(imageBuffer, {
      headers: { 'Content-Type': 'image/png' }
    });
  }
  ```

**Tables (pandas)**:

* JavaScript

  ```js
  const result = await sandbox.runCode(
    `
  import pandas as pd
  df = pd.DataFrame({'Name': ['Alice', 'Bob'], 'Age': [25, 30]})
  df
  `,
    { language: "python" },
  );


  if (result.results[0]?.html) {
    return new Response(result.results[0].html, {
      headers: { "Content-Type": "text/html" },
    });
  }
  ```

* TypeScript

  ```ts
  const result = await sandbox.runCode(`
  import pandas as pd
  df = pd.DataFrame({'Name': ['Alice', 'Bob'], 'Age': [25, 30]})
  df
  `, { language: 'python' });


  if (result.results[0]?.html) {
    return new Response(result.results[0].html, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
  ```

## Related resources

* [Build an AI Code Executor](https://developers.cloudflare.com/sandbox/tutorials/ai-code-executor/) - Complete tutorial
* [Commands API](https://developers.cloudflare.com/sandbox/api/commands/) - Lower-level command execution
* [Files API](https://developers.cloudflare.com/sandbox/api/files/) - File operations
