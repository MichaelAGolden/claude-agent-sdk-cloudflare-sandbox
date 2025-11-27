import { SignIn } from "@clerk/clerk-react";
import { useState } from "react";
import { ModeToggle } from "./mode-toggle";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import {
  CheckIcon,
  CopyIcon,
  DatabaseIcon,
  GlobeIcon,
  LayersIcon,
  MessageSquareIcon,
  ServerIcon,
  ShieldIcon,
  ZapIcon,
  GitBranchIcon,
  CodeIcon,
  CloudIcon,
  HardDriveIcon,
  BoxIcon,
  UsersIcon,
} from "lucide-react";

export function LandingPage() {
  const [showSignIn, setShowSignIn] = useState(false);
  const [copied, setCopied] = useState(false);

  const cliCommand = "npx create-cloudflare@latest my-claude-agent -- --template=MichaelAGolden/claude-agent-sdk-cloudflare-sandbox";

  const copyCommand = () => {
    navigator.clipboard.writeText(cliCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (showSignIn) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background overflow-y-auto h-screen">
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowSignIn(false)}>
            Back
          </Button>
          <ModeToggle />
        </div>
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Welcome to ezagentsdk
          </h1>
          <p className="text-muted-foreground">
            Sign in to access your conversations
          </p>
        </div>
        <SignIn
          appearance={{
            elements: {
              rootBox: "mx-auto",
              card: "bg-card border border-border shadow-lg",
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background overflow-y-auto h-screen">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <CloudIcon className="h-6 w-6 text-orange-500" />
              <span className="font-bold text-xl">ezagentsdk</span>
            </div>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/MichaelAGolden/claude-agent-sdk-cloudflare-sandbox"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                GitHub
              </a>
              <ModeToggle />
              <Button onClick={() => setShowSignIn(true)}>
                Sign In
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 text-orange-600 dark:text-orange-400 text-sm font-medium mb-6">
            <ZapIcon className="h-4 w-4" />
            Reference Implementation
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6">
            Deploy the Claude Agent SDK on{" "}
            <span className="text-orange-500">Cloudflare</span>{" "}
            in Minutes
          </h1>

          <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            A complete, production-ready implementation showing how easy it is to build
            AI agents with persistent conversations, real-time streaming, and the full
            Cloudflare stack.
          </p>

          {/* CLI Command */}
          <div className="relative max-w-3xl mx-auto mb-8">
            <div className="bg-zinc-950 dark:bg-zinc-900 rounded-lg p-4 font-mono text-sm text-left overflow-x-auto">
              <div className="flex items-center justify-between gap-4">
                <code className="text-green-400 whitespace-nowrap">
                  <span className="text-zinc-500">$</span> {cliCommand}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={copyCommand}
                  className="shrink-0 text-zinc-400 hover:text-white"
                >
                  {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-3">
              You'll need a{" "}
              <a href="https://clerk.com" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:underline">
                Clerk account
              </a>{" "}
              for authentication.{" "}
              <a href="#deploy" className="text-orange-500 hover:underline">
                See full setup guide →
              </a>
            </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" onClick={() => setShowSignIn(true)}>
              Try the Demo
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a
                href="https://github.com/MichaelAGolden/claude-agent-sdk-cloudflare-sandbox"
                target="_blank"
                rel="noopener noreferrer"
              >
                <GitBranchIcon className="mr-2 h-4 w-4" />
                View on GitHub
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Architecture Diagram Section */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Architecture Overview</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Built entirely on Cloudflare's edge infrastructure with Clerk for authentication.
              One deploy command, global distribution.
            </p>
          </div>

          {/* Architecture Diagram Placeholder */}
          <div className="bg-card border rounded-xl p-8 mb-8">
            <div className="aspect-[16/9] bg-muted rounded-lg flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <LayersIcon className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Architecture Diagram</p>
                <p className="text-sm mt-2 max-w-md">
                  Full-stack architecture on Cloudflare's edge. Frontend Worker serves static
                  assets and proxies API calls. Backend Worker handles Socket.IO, D1/R2 storage,
                  and spawns Sandbox containers running the Claude Agent SDK.
                </p>
                {/* Mermaid diagram description for later */}
                <details className="mt-4 text-left max-w-2xl mx-auto">
                  <summary className="cursor-pointer text-xs text-muted-foreground/60 hover:text-muted-foreground">
                    View Mermaid diagram spec
                  </summary>
                  <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-x-auto">
{`flowchart TB
    subgraph Client
        A[React Frontend<br/>Socket.IO Client]
    end

    subgraph External
        I[Clerk Auth]
        J[Anthropic API]
    end

    subgraph Cloudflare["Cloudflare Edge"]
        B[Frontend Worker<br/>Static Assets + API Proxy]
        C[Backend Worker<br/>Hono + Socket.IO]
    end

    subgraph Sandbox["Cloudflare Sandbox"]
        E[Container<br/>Express + Socket.IO]
        F[Claude Agent SDK]
    end

    subgraph Storage
        G[(D1 Database<br/>Threads, Messages, Users)]
        H[(R2 Bucket<br/>Transcripts, Skills)]
    end

    A -->|Auth| I
    A -->|Static Assets| B
    A -.->|WebSocket| C
    B -->|Service Binding| C
    C -->|wsConnect :3001| E
    E --> F
    F -->|API Calls| J
    C -->|Read/Write| G
    C -->|Sync Transcripts| H
    E -.->|Mount Skills| H`}
                  </pre>
                </details>
              </div>
            </div>
          </div>

          {/* Data Flow Diagram Placeholder */}
          <div className="bg-card border rounded-xl p-8">
            <div className="aspect-[16/7] bg-muted rounded-lg flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <MessageSquareIcon className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Real-Time Streaming Flow</p>
                <p className="text-sm mt-2 max-w-md">
                  Complete message lifecycle: Socket.IO connection, real-time streaming from
                  Claude API, SDK session capture for thread resumption, and post-streaming
                  persistence to D1 and R2.
                </p>
                <details className="mt-4 text-left max-w-2xl mx-auto">
                  <summary className="cursor-pointer text-xs text-muted-foreground/60 hover:text-muted-foreground">
                    View Mermaid diagram spec
                  </summary>
                  <pre className="mt-2 p-3 bg-muted rounded text-xs overflow-x-auto">
{`sequenceDiagram
    participant Browser
    participant Backend Worker
    participant Sandbox
    participant Claude API
    participant D1
    participant R2

    Browser->>Backend Worker: Socket.IO Connect (/socket.io/)
    Backend Worker->>Sandbox: wsConnect(port 3001)

    Note over Browser,Sandbox: User sends message
    Browser->>Sandbox: emit("message", {prompt, options})
    Sandbox->>Sandbox: Queue in MessageStream
    Sandbox->>Claude API: SDK query()

    Note over Claude API,Sandbox: SDK captures session_id
    Sandbox-->>Browser: emit("message", {role:"system", session_id})
    Browser->>D1: Update thread.session_id

    loop Streaming Response
        Claude API-->>Sandbox: text_delta chunk
        Sandbox-->>Browser: emit("stream", {type:"text", content})
    end

    Claude API-->>Sandbox: message complete
    Sandbox-->>Browser: emit("message", {role:"assistant", content})
    Sandbox-->>Browser: emit("result", {cost_usd, duration_ms})

    Note over Browser,D1: After streaming completes
    loop Persist each message
        Browser->>D1: POST /threads/{id}/messages
    end

    Note over Sandbox,R2: Production only
    Sandbox->>Backend Worker: POST /sessions/{id}/sync
    Backend Worker->>R2: Save transcript .jsonl`}
                  </pre>
                </details>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Tech Stack Section */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">The Cloudflare Stack</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Every component runs on Cloudflare's global network, except authentication
              which uses Clerk for simplicity.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center mb-2">
                  <ServerIcon className="h-5 w-5 text-orange-500" />
                </div>
                <CardTitle>Workers</CardTitle>
                <CardDescription>Serverless compute at the edge</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Two Workers: one serves the React frontend, another handles API requests
                and WebSocket proxying with Hono.js. Global deployment, zero cold starts.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center mb-2">
                  <BoxIcon className="h-5 w-5 text-blue-500" />
                </div>
                <CardTitle>Sandbox Containers</CardTitle>
                <CardDescription>Isolated agent runtime</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Full Node.js containers running the Claude Agent SDK. Each user gets
                an isolated sandbox with file system access for skills and transcripts.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center mb-2">
                  <DatabaseIcon className="h-5 w-5 text-green-500" />
                </div>
                <CardTitle>D1 Database</CardTitle>
                <CardDescription>SQLite at the edge</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Stores threads, messages, and user data. Soft deletes preserve data
                for usage tracking. Indexed for fast queries by user and thread.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center mb-2">
                  <HardDriveIcon className="h-5 w-5 text-purple-500" />
                </div>
                <CardTitle>R2 Storage</CardTitle>
                <CardDescription>S3-compatible object storage</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Stores session transcripts for conversation resume and user-uploaded
                skills. Mounted directly into sandbox containers in production.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-yellow-500/10 flex items-center justify-center mb-2">
                  <LayersIcon className="h-5 w-5 text-yellow-500" />
                </div>
                <CardTitle>Durable Objects</CardTitle>
                <CardDescription>Stateful coordination</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Manages sandbox lifecycle and session state. One Durable Object per
                user ensures consistent routing and resource cleanup.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="h-10 w-10 rounded-lg bg-pink-500/10 flex items-center justify-center mb-2">
                  <UsersIcon className="h-5 w-5 text-pink-500" />
                </div>
                <CardTitle>Clerk (External)</CardTitle>
                <CardDescription>Authentication & users</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                The only non-Cloudflare service. Handles OAuth, user management,
                and session tokens. Easy to swap for your own auth solution.
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Code Snippets Section */}
      <section className="py-20 px-4 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Key Integration Points</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              See how the pieces connect. Clean, minimal code that's easy to extend.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-8">
            {/* SDK Initialization */}
            <div>
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <CodeIcon className="h-4 w-4 text-orange-500" />
                Claude Agent SDK Setup
              </h3>
              <div className="bg-zinc-950 dark:bg-zinc-900 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                <pre className="text-zinc-300">
{`import { query } from "@anthropic-ai/claude-agent-sdk";

const result = await query({
  prompt: userMessage,
  options: {
    model: "claude-sonnet-4-5-20250929",
    // Resume previous conversation
    resume: thread.session_id,
  },
  hooks: {
    // Capture session ID for persistence
    onEvent: (event) => {
      if (event.session_id) {
        saveSessionId(threadId, event.session_id);
      }
    }
  }
});`}
                </pre>
              </div>
            </div>

            {/* Socket.IO Streaming */}
            <div>
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <ZapIcon className="h-4 w-4 text-orange-500" />
                Real-Time Streaming
              </h3>
              <div className="bg-zinc-950 dark:bg-zinc-900 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                <pre className="text-zinc-300">
{`// Container: Stream to frontend
for await (const event of result) {
  if (event.type === "text") {
    socket.emit("stream", {
      text: event.text
    });
  }
}
socket.emit("result", { complete: true });

// Frontend: Receive stream
socket.on("stream", ({ text }) => {
  appendToMessage(text);
});`}
                </pre>
              </div>
            </div>

            {/* Worker Proxy */}
            <div>
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <ServerIcon className="h-4 w-4 text-orange-500" />
                Worker → Sandbox Proxy
              </h3>
              <div className="bg-zinc-950 dark:bg-zinc-900 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                <pre className="text-zinc-300">
{`import { getSandbox } from "@cloudflare/sandbox";

app.all("/socket.io/*", async (c) => {
  const userId = c.req.query("sessionId");
  const sandbox = getSandbox(c.env.Sandbox, userId);

  // WebSocket upgrade
  if (isWebSocket(c.req)) {
    return sandbox.wsConnect(c.req.raw, 3001);
  }

  // HTTP polling fallback
  return sandbox.fetch(request);
});`}
                </pre>
              </div>
            </div>

            {/* Thread Persistence */}
            <div>
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <DatabaseIcon className="h-4 w-4 text-orange-500" />
                Conversation Persistence
              </h3>
              <div className="bg-zinc-950 dark:bg-zinc-900 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                <pre className="text-zinc-300">
{`// Save transcript to R2 on session end
await bucket.put(
  \`users/\${userId}/transcripts/\${sessionId}.jsonl\`,
  transcript
);

// Restore before resume
const obj = await bucket.get(transcriptKey);
await sandbox.writeFile(localPath, obj);

// Query with resume option
await query({ resume: sessionId, ... });`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">What You Get</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              A complete foundation for building AI agent applications.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="flex gap-4">
              <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                <MessageSquareIcon className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold mb-2">Persistent Multi-Thread Conversations</h3>
                <p className="text-sm text-muted-foreground">
                  Create unlimited threads per user. Switch between conversations
                  seamlessly. Resume any thread with full context preserved via SDK
                  session transcripts.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                <ZapIcon className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold mb-2">Real-Time Streaming</h3>
                <p className="text-sm text-muted-foreground">
                  Watch responses generate character by character. Socket.IO provides
                  WebSocket with automatic HTTP polling fallback. Interrupt mid-stream
                  when needed.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                <LayersIcon className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold mb-2">Hook System</h3>
                <p className="text-sm text-muted-foreground">
                  Intercept SDK lifecycle events. Handle tool approvals, display
                  notifications, and customize behavior at PreToolUse, PostToolUse,
                  Stop, and more.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                <CodeIcon className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold mb-2">Custom Skills</h3>
                <p className="text-sm text-muted-foreground">
                  Upload user-specific skills as markdown files. The SDK discovers
                  and loads them automatically. Extend agent capabilities per user.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                <ShieldIcon className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold mb-2">User Isolation</h3>
                <p className="text-sm text-muted-foreground">
                  Each user gets their own sandbox container. Data is isolated by
                  user ID in D1 and R2. No cross-user data access possible.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="h-10 w-10 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0">
                <GlobeIcon className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <h3 className="font-semibold mb-2">Global Edge Deployment</h3>
                <p className="text-sm text-muted-foreground">
                  Deploy once, run everywhere. Cloudflare's network puts your agent
                  close to users worldwide. Sub-100ms latency for API calls.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Deploy Section */}
      <section id="deploy" className="py-20 px-4 bg-muted/30">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Deploy Your Own</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Fork it, customize it, ship it. Here's how to get started.
            </p>
          </div>

          <div className="space-y-6">
            <div className="bg-card border rounded-xl p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-orange-500 text-white text-sm flex items-center justify-center">1</span>
                Clone and Install
              </h3>
              <div className="bg-zinc-950 dark:bg-zinc-900 rounded-lg p-4 font-mono text-sm">
                <pre className="text-zinc-300">
{`git clone https://github.com/MichaelAGolden/claude-agent-sdk-cloudflare-sandbox
cd claude-agent-sdk-cloudflare-sandbox
npm run install:all`}
                </pre>
              </div>
            </div>

            <div className="bg-card border rounded-xl p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-orange-500 text-white text-sm flex items-center justify-center">2</span>
                Set Up Clerk Authentication
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create a free account at{" "}
                <a href="https://clerk.com" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:underline">
                  clerk.com
                </a>
                {" "}and add your publishable key:
              </p>
              <div className="bg-zinc-950 dark:bg-zinc-900 rounded-lg p-4 font-mono text-sm">
                <pre className="text-zinc-300">
{`# frontend/.env.local
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...`}
                </pre>
              </div>
            </div>

            <div className="bg-card border rounded-xl p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-orange-500 text-white text-sm flex items-center justify-center">3</span>
                Configure Cloudflare Resources
              </h3>
              <div className="bg-zinc-950 dark:bg-zinc-900 rounded-lg p-4 font-mono text-sm">
                <pre className="text-zinc-300">
{`# Create D1 database
npx wrangler d1 create my-agent-db

# Create R2 bucket
npx wrangler r2 bucket create my-agent-data

# Add your Anthropic API key
npx wrangler secret put ANTHROPIC_API_KEY`}
                </pre>
              </div>
            </div>

            <div className="bg-card border rounded-xl p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <span className="h-6 w-6 rounded-full bg-orange-500 text-white text-sm flex items-center justify-center">4</span>
                Deploy
              </h3>
              <div className="bg-zinc-950 dark:bg-zinc-900 rounded-lg p-4 font-mono text-sm">
                <pre className="text-zinc-300">
{`# Run database migration
npx wrangler d1 execute my-agent-db --remote --file=migrations/schema.sql

# Deploy everything
npm run deploy`}
                </pre>
              </div>
            </div>
          </div>

          <div className="mt-10 text-center">
            <Button size="lg" asChild>
              <a
                href="https://github.com/MichaelAGolden/claude-agent-sdk-cloudflare-sandbox"
                target="_blank"
                rel="noopener noreferrer"
              >
                <GitBranchIcon className="mr-2 h-4 w-4" />
                View Full README on GitHub
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <CloudIcon className="h-5 w-5 text-orange-500" />
                <span className="font-bold">ezagentsdk</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Deploy the Claude Agent SDK on Cloudflare in minutes.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Resources</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="https://github.com/MichaelAGolden/claude-agent-sdk-cloudflare-sandbox" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                    GitHub Repository
                  </a>
                </li>
                <li>
                  <a href="https://docs.anthropic.com/en/docs/claude-agent-sdk" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                    Claude Agent SDK Docs
                  </a>
                </li>
                <li>
                  <a href="https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/sandbox/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                    Cloudflare Sandbox Docs
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Cloudflare</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="https://developers.cloudflare.com/workers/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                    Workers
                  </a>
                </li>
                <li>
                  <a href="https://developers.cloudflare.com/d1/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                    D1 Database
                  </a>
                </li>
                <li>
                  <a href="https://developers.cloudflare.com/r2/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                    R2 Storage
                  </a>
                </li>
                <li>
                  <a href="https://developers.cloudflare.com/durable-objects/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                    Durable Objects
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">More</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href="https://clerk.com" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                    Clerk Authentication
                  </a>
                </li>
                <li>
                  <a href="https://www.anthropic.com" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                    Anthropic
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t text-center text-sm text-muted-foreground space-y-2">
            <p>
              Built by{" "}
              <a href="https://github.com/MichaelAGolden" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:underline">
                Michael Golden
              </a>
              {" "}as a reference implementation for the Claude Agent SDK on Cloudflare.
            </p>
            <p>
              Inspired by and extended from{" "}
              <a href="https://github.com/receipting/claude-agent-sdk-cloudflare" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:underline">
                receipting/claude-agent-sdk-cloudflare
              </a>
              . MIT License.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
