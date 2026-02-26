import { jsonResponse } from '../utils';

describe('jsonResponse', () => {
  /** Verifies the correct status code is set. */
  it('sets the correct status code', () => {
    const result = jsonResponse(201, { ok: true });
    expect(result.statusCode).toBe(201);
  });

  /** Verifies the body is JSON-stringified. */
  it('stringifies the body', () => {
    const result = jsonResponse(200, { msg: 'hello' });
    expect(JSON.parse(result.body)).toEqual({ msg: 'hello' });
  });

  /** Verifies CORS headers are present. */
  it('includes CORS headers', () => {
    const result = jsonResponse(200, {});
    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*');
    expect(result.headers?.['Content-Type']).toBe('application/json');
  });
});
