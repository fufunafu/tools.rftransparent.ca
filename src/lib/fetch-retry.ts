/**
 * Fetch wrapper with exponential backoff retry for transient failures.
 * Retries on network errors and 5xx responses.
 */
export async function fetchWithRetry(
  input: string | URL | Request,
  init?: RequestInit,
  options?: { retries?: number; baseDelayMs?: number }
): Promise<Response> {
  const maxRetries = options?.retries ?? 3;
  const baseDelay = options?.baseDelayMs ?? 500;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(input, init);

      // Don't retry client errors (4xx) — only transient server errors
      if (res.status < 500 || attempt === maxRetries) {
        return res;
      }

      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      // Network error (DNS failure, connection refused, timeout, etc.)
      lastError = err;
      if (attempt === maxRetries) break;
    }

    // Exponential backoff with jitter: base * 2^attempt + random(0..base)
    const delay = baseDelay * Math.pow(2, attempt) + Math.random() * baseDelay;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw lastError;
}
