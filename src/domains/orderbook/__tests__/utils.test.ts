import { jsonResponse } from '../utils';

describe('jsonResponse', () => {
  it('sets the given status code', () => {
    const result = jsonResponse(201, { ok: true });

    expect(result.statusCode).toBe(201);
  });

  it('sets the Content-Type header to application/json', () => {
    const result = jsonResponse(200, {});

    expect(result.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
  });

  it('serialises the body as JSON', () => {
    const payload = { id: '1', symbol: 'AAPL' };
    const result = jsonResponse(200, payload);

    expect(JSON.parse(result.body)).toEqual(payload);
  });

  it('handles null body', () => {
    const result = jsonResponse(204, null);

    expect(JSON.parse(result.body)).toBeNull();
  });
});
