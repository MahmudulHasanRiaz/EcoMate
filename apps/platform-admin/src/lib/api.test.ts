import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage, readJson } from './api';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('readJson', () => {
  it('returns the parsed body for a successful response', async () => {
    const body = await readJson<{ delivered: boolean }>(
      jsonResponse({ delivered: true }, 200),
    );

    expect(body).toEqual({ delivered: true });
  });

  it('throws an ApiError carrying the server message for an error response', async () => {
    const message = 'TLS handshake failed: write EPROTO: wrong version number';

    const caught = await readJson(
      jsonResponse({ statusCode: 502, message }, 502),
    ).then(
      () => null,
      (err: unknown) => err,
    );

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).message).toBe(message);
    expect((caught as ApiError).status).toBe(502);
  });

  it('falls back to "Request failed (status)" when the body has no message', async () => {
    const caught = await readJson(jsonResponse({}, 500)).then(
      () => null,
      (err: unknown) => err,
    );

    expect((caught as ApiError).message).toBe('Request failed (500)');
  });

  it('joins an array message with spaces', async () => {
    const caught = await readJson(
      jsonResponse({ message: ['first', 'second'] }, 400),
    ).then(
      () => null,
      (err: unknown) => err,
    );

    expect((caught as ApiError).message).toBe('first second');
  });
});

describe('errorMessage', () => {
  it('returns the ApiError message — the text the SMTP section renders inline', () => {
    // The SMTP test handler does setTestError(errorMessage(err)); this
    // is the exact text that lands in the inline ErrorNote, so a
    // specific server message (TLS/auth/connection) must survive intact.
    expect(
      errorMessage(
        new ApiError('SMTP authentication failed: Invalid login', 502),
      ),
    ).toBe('SMTP authentication failed: Invalid login');
  });

  it('falls back to a generic message for non-errors', () => {
    expect(errorMessage(null)).toBe(
      'Something went wrong. Please try again.',
    );
    expect(errorMessage(undefined)).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
