import { jsonResponse } from '../utils';

/**
 * Tests for the jsonResponse helper utility.
 * Verifies correct status code, Content-Type header, and JSON body serialisation.
 */
describe('jsonResponse', () => {
  /** Verifies the status code is set correctly. */
  it('sets the given status code', () => {
    const result = jsonResponse(201, { ok: true });

    expect(result.statusCode).toBe(201);
  });

  /** Verifies the Content-Type header is application/json. */
  it('sets the Content-Type header to application/json', () => {
    const result = jsonResponse(200, {});

    expect(result.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
  });

  /** Verifies the body is properly serialised as JSON. */
  it('serialises the body as JSON', () => {
    const payload = { botId: 'bot-001', name: 'Test Bot' };
    const result = jsonResponse(200, payload);

    expect(JSON.parse(result.body)).toEqual(payload);
  });

  /** Verifies null body is handled gracefully. */
  it('handles null body', () => {
    const result = jsonResponse(204, null);

    expect(JSON.parse(result.body)).toBeNull();
  });

  /** Verifies array body is serialised correctly. */
  it('serialises an array body', () => {
    const payload = [{ id: 1 }, { id: 2 }];
    const result = jsonResponse(200, payload);

    expect(JSON.parse(result.body)).toEqual(payload);
  });

  /** Verifies a 500 status code is returned correctly. */
  it('handles error status codes', () => {
    const result = jsonResponse(500, { error: 'Internal Server Error' });

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({ error: 'Internal Server Error' });
  });
});
