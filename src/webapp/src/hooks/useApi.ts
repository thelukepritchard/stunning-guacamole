import { useCallback } from 'react';
import { fetchAuthSession } from 'aws-amplify/auth';

/** HTTP methods supported by the API hook. */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Reusable hook that wraps `fetch` with Cognito ID token injection.
 *
 * @returns A `request` function that makes authenticated API calls.
 */
export function useApi() {
  /**
   * Makes an authenticated API request to the backend.
   *
   * @param method - HTTP method.
   * @param path - API path (e.g. '/bots').
   * @param body - Optional request body (will be JSON-stringified).
   * @returns The parsed JSON response.
   */
  const request = useCallback(async <T = unknown>(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();

    const res = await fetch(`${import.meta.env.VITE_API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ?? '',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new Error((errorBody as { error?: string }).error ?? `Request failed: ${res.status}`);
    }

    return res.json() as Promise<T>;
  }, []);

  return { request };
}
