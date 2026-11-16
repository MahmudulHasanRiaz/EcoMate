export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function readJson<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      body && typeof body === 'object'
        ? (body as { message?: string | string[] }).message
        : undefined;
    const text = Array.isArray(message)
      ? message.join(' ')
      : typeof message === 'string' && message.trim()
        ? message
        : `Request failed (${response.status})`;
    throw new ApiError(text, response.status);
  }
  return body as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}
