export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const { attempts = 3, baseDelayMs = 500 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelayMs * (attempt + 1)),
        );
      }
    }
  }

  throw lastError;
}
