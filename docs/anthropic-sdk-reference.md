# Anthropic Claude Agent SDK Reference Map

This document provides a site-mapping and summarization of the Claude Agent SDK reference documentation found in `llm-reference-docs/anthropic/`. It is intended as a quick reference for developers and LLMs to understand the structure and content of the SDK documentation.

## Core Documentation

### [Overview](anthropic/claude-agent-sdk-overview.md)
**File:** `claude-agent-sdk-overview.md`
**Summary:** High-level introduction to the Claude Agent SDK. Covers installation, core concepts (Authentication, Subagents, Skills, Hooks, MCP), and branding guidelines. It explains *what* the SDK is and *why* to use it.

### [TypeScript API Reference](anthropic/claude-agent-sdk-typescript-doc.md)
**File:** `claude-agent-sdk-typescript-doc.md`
**Summary:** The comprehensive API reference for the TypeScript SDK. It details the `query()` function, `tool()` helper, `createSdkMcpServer()`, and all related types (`Options`, `AgentDefinition`, `PermissionMode`, `SDKMessage`, etc.). This is the primary technical reference for function signatures and type definitions.

### [Migration Guide](anthropic/claude-agent-sdk-migration-guide.md)
**File:** `claude-agent-sdk-migration-guide.md`
**Summary:** A guide for migrating from the older `claude-code` SDK to the new `claude-agent-sdk`. Highlights breaking changes such as package renaming, default system prompt behavior (now empty by default), and setting sources (filesystem settings not loaded by default).

## Core Features

### [System Prompts](anthropic/claude-agent-sdk-system-prompt.md)
**File:** `claude-agent-sdk-system-prompt.md`
**Summary:** Explains how to customize Claude's behavior. Methods include:
1.  **CLAUDE.md**: Project-level instructions (requires `settingSources: ['project']`).
2.  **Output Styles**: Persistent configurations.
3.  **Append**: Adding to the default `claude_code` preset.
4.  **Custom**: Replacing the system prompt entirely.

### [Custom Tools](anthropic/claude-agent-sdk-custom-tools.md)
**File:** `claude-agent-sdk-custom-tools.md`
**Summary:** Guide to creating custom tools using `createSdkMcpServer` and `tool`. It covers defining schemas with Zod (TS) or Python types, implementation logic, and how to register these tools with the `query` function using `mcpServers`.

### [Agent Skills](anthropic/claude-agent-sdk-agent-skills-in-the-SDK.md)
**File:** `claude-agent-sdk-agent-skills-in-the-SDK.md`
**Summary:** Describes how to use "Skills" (filesystem-based capabilities defined in `SKILL.md` files). Key points:
-   Must configure `settingSources` to load them.
-   Must add "Skill" to `allowedTools`.
-   Skills are automatically discovered from `.claude/skills/`.

### [Structured Outputs](anthropic/claude-agent-sdk-structured-outputs.md)
**File:** `claude-agent-sdk-structured-outputs.md`
**Summary:** How to force the agent to return validated JSON matching a specific schema. Uses the `outputFormat` option with `type: 'json_schema'`. Supports Zod and Pydantic for schema definition.

## Advanced Features

### [Subagents](anthropic/claude-agent-sdk-subagents-in-the-SDK.md)
**File:** `claude-agent-sdk-subagents-in-the-sdk.md`
**Summary:** Explains how to define specialized subagents to handle specific tasks. Subagents can be defined programmatically via the `agents` option (recommended) or via filesystem (`.claude/agents/`). They have their own prompts, tools, and models.

### [Slash Commands](anthropic/claude-agent-sdk-slash-commands-in-the-sdk.md)
**File:** `claude-agent-sdk-slash-commands-in-the-sdk.md`
**Summary:** Covers built-in commands like `/compact` and `/clear`, and how to create custom slash commands using markdown files in `.claude/commands/`. Custom commands can accept arguments and execute bash scripts.

### [Plugins](anthropic/claude-agent-sdk-plugins.md)
**File:** `claude-agent-sdk-plugins.md`
**Summary:** How to load plugins using the `plugins` option. Plugins are packages that can contain commands, agents, skills, hooks, and MCP servers. Useful for sharing functionality across projects.

### [MCP Servers](anthropic/claude-agent-sdk-mcp-servers.md)
**File:** `claude-agent-sdk-mcp-servers.md`
**Summary:** Configuring Model Context Protocol (MCP) servers. Can be done via `.mcp.json` or programmatically in `options.mcpServers`. Supports `stdio`, `sse`, and `http` transports for connecting to external tools.

### [Todo Lists](anthropic/claude-agent-sdk-todo-lists-in-sdk.md)
**File:** `claude-agent-sdk-todo-lists-in-sdk.md`
**Summary:** Describes the built-in todo tracking functionality. The SDK automatically creates and updates todos for complex tasks. Developers can monitor these updates via the `TodoWrite` tool use events.

## Operations & Infrastructure

### [Session Management](anthropic/claude-agent-sdk-session-management.md)
**File:** `claude-agent-sdk-session-management.md`
**Summary:** Details how to manage conversation state.
-   **Start**: Sessions start automatically; ID is in the `init` message.
-   **Resume**: Use `resume: sessionId` to continue.
-   **Fork**: Use `forkSession: true` to branch a conversation.

### [Handling Permissions](anthropic/claude-agent-sdk-handling-permissions.md)
**File:** `claude-agent-sdk-handling-permissions.md`
**Summary:** Comprehensive guide to permission control.
-   **Modes**: `default`, `acceptEdits` (auto-approve files), `bypassPermissions` (auto-approve all).
-   **Callback**: `canUseTool` for custom logic and user interaction.
-   **Hooks**: Intercept tool execution.
-   **Flow**: Hooks -> Rules -> Mode -> Callback.

### [Streaming vs Single Mode](anthropic/claude-agent-sdk-streaming.md)
**File:** `claude-agent-sdk-streaming.md`
**Summary:** Compares input modes.
-   **Streaming (Recommended)**: Uses async generators. Supports images, queued messages, interruptions, and hooks.
-   **Single Message**: One-shot queries. Simpler but limited (no images, no hooks).

### [Tracking Costs](anthropic/claude-agent-sdk-tracking-costs.md)
**File:** `claude-agent-sdk-tracking-costs.md`
**Summary:** How to track token usage and costs. Usage data is attached to assistant messages. Important to deduplicate by message ID and use the final `result` message for total session cost.

### [Hosting](anthropic/claude-agent-sdk-hosting.md)
**File:** `claude-agent-sdk-hosting.md`
**Summary:** Architecture and best practices for deploying the SDK. Recommends container-based sandboxing (Cloudflare, Modal, etc.) due to the stateful, long-running nature of the agent process.
