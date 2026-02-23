import { handler } from '../index';
import { buildEvent } from '../../test-utils';

describe('portfolio handler', () => {
  it('routes GET /portfolio to listPortfolios', async () => {
    const result = await handler(buildEvent({ httpMethod: 'GET', resource: '/portfolio' }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).items).toHaveLength(2);
  });

  it('routes POST /portfolio to createPortfolio', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'POST',
      resource: '/portfolio',
      body: JSON.stringify({ name: 'Test' }),
    }));

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body).name).toBe('Test');
  });

  it('routes GET /portfolio/{id} to getPortfolio', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'GET',
      resource: '/portfolio/{id}',
      pathParameters: { id: 'p-001' },
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).id).toBe('p-001');
  });

  it('routes PUT /portfolio/{id} to updatePortfolio', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'PUT',
      resource: '/portfolio/{id}',
      pathParameters: { id: 'p-001' },
      body: JSON.stringify({ name: 'Renamed' }),
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ id: 'p-001', name: 'Renamed' });
  });

  it('routes DELETE /portfolio/{id} to deletePortfolio', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'DELETE',
      resource: '/portfolio/{id}',
      pathParameters: { id: 'p-001' },
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ id: 'p-001', deleted: true });
  });

  it('returns 404 for unknown routes', async () => {
    const result = await handler(buildEvent({ httpMethod: 'PATCH', resource: '/portfolio' }));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
