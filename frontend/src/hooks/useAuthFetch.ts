/**
 * @fileoverview Authenticated fetch hook for Clerk JWT.
 *
 * This hook provides a fetch wrapper that automatically includes
 * the Clerk JWT token in the Authorization header.
 *
 * @module hooks/useAuthFetch
 */

import { useAuth } from '@clerk/clerk-react';
import { useCallback } from 'react';

// API base URL - empty string means same origin
const API_BASE = '';

/**
 * Hook that returns an authenticated fetch function.
 *
 * The returned function automatically adds the Clerk JWT to requests.
 *
 * @example
 * const { authFetch } = useAuthFetch();
 *
 * // GET request
 * const response = await authFetch('/api/threads');
 *
 * // POST request with body
 * const response = await authFetch('/api/threads', {
 *   method: 'POST',
 *   body: JSON.stringify({ title: 'New thread' }),
 * });
 */
export function useAuthFetch() {
  const { getToken } = useAuth();

  const authFetch = useCallback(async (
    path: string,
    options: RequestInit = {}
  ): Promise<Response> => {
    // Get fresh JWT token
    const token = await getToken();

    // Build headers with auth token
    const headers = new Headers(options.headers);

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    // Default to JSON content type for POST/PATCH requests
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    // Make the authenticated request
    return fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  }, [getToken]);

  return { authFetch };
}

export default useAuthFetch;
