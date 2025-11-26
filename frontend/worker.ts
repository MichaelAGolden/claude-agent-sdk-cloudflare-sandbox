/// <reference types="@cloudflare/workers-types" />

/**
 * Frontend Worker
 *
 * Serves static assets and proxies API calls to the backend worker via service binding.
 * Socket.IO connects directly to the backend worker URL (service bindings don't support WebSocket).
 */

interface Env {
  BACKEND: Fetcher;  // Service binding to claude-agent-worker
  BACKEND_WORKER_URL?: string;  // Optional fallback URL
  ASSETS: Fetcher;   // Static assets (from [assets] config)
}

// Cache backend info to avoid repeated RPC calls
let cachedBackendInfo: { publicUrl: string; socketPath: string } | null = null;

/**
 * Fetch backend info via service binding (internal RPC).
 * Caches the result since the URL doesn't change during runtime.
 */
async function getBackendInfo(env: Env): Promise<{ publicUrl: string; socketPath: string }> {
  if (cachedBackendInfo) {
    return cachedBackendInfo;
  }

  try {
    // Fetch from backend via service binding
    const response = await env.BACKEND.fetch(new Request('https://internal/_info'));
    if (response.ok) {
      const info = await response.json() as { publicUrl: string; socketPath: string };
      cachedBackendInfo = info;
      return info;
    }
  } catch (error) {
    console.error('[Frontend Worker] Failed to fetch backend info:', error);
  }

  // Fallback to env var if RPC fails
  const fallback = {
    publicUrl: env.BACKEND_WORKER_URL || 'https://claude-agent-worker.michael-a-golden.workers.dev',
    socketPath: '/socket.io/',
  };
  cachedBackendInfo = fallback;
  return fallback;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Proxy API calls through service binding (internal network, no external HTTP)
    if (path.startsWith('/api/')) {
      return proxyToBackend(request, env);
    }

    // Proxy Socket.IO HTTP polling through service binding
    // WebSocket upgrades will be handled by the backend directly
    if (path.startsWith('/socket.io/')) {
      const upgradeHeader = request.headers.get('Upgrade');

      if (upgradeHeader?.toLowerCase() === 'websocket') {
        // WebSocket upgrade - redirect to backend worker URL
        // Service bindings don't support WebSocket, so client must connect directly
        const backendInfo = await getBackendInfo(env);
        const backendUrl = new URL(request.url);
        backendUrl.hostname = new URL(backendInfo.publicUrl).hostname;
        return Response.redirect(backendUrl.toString(), 307);
      }

      // HTTP polling - proxy through service binding
      return proxyToBackend(request, env);
    }

    // Health check endpoint
    if (path === '/health' || path === '/_health') {
      return proxyToBackend(request, env);
    }

    // Provide backend URL for frontend to use for WebSocket connections
    // Fetches from backend via service binding for single source of truth
    if (path === '/_config') {
      const backendInfo = await getBackendInfo(env);
      return Response.json({
        backendUrl: backendInfo.publicUrl,
        socketPath: backendInfo.socketPath,
      });
    }

    // Everything else - serve static assets
    // The [assets] config handles this automatically, but we explicitly call it
    // to ensure proper fallback to index.html for SPA routing
    try {
      const response = await env.ASSETS.fetch(request);

      // If asset found, return it
      if (response.status !== 404) {
        return response;
      }

      // SPA fallback - serve index.html for any non-asset route
      const indexRequest = new Request(new URL('/index.html', request.url), request);
      return env.ASSETS.fetch(indexRequest);
    } catch {
      // Fallback to index.html on any error
      const indexRequest = new Request(new URL('/index.html', request.url), request);
      return env.ASSETS.fetch(indexRequest);
    }
  },
};

/**
 * Proxy request to backend worker via service binding.
 * This uses Cloudflare's internal network - faster and no egress costs.
 */
async function proxyToBackend(request: Request, env: Env): Promise<Response> {
  try {
    // Create a new request with the same properties
    const backendRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual',
    });

    // Call backend via service binding
    const response = await env.BACKEND.fetch(backendRequest);

    // Return response with CORS headers for frontend
    const corsHeaders = new Headers(response.headers);
    corsHeaders.set('Access-Control-Allow-Origin', '*');
    corsHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: corsHeaders,
    });
  } catch (error: unknown) {
    console.error('[Frontend Worker] Backend proxy error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json(
      { error: 'Backend service unavailable', details: message },
      { status: 502 }
    );
  }
}
