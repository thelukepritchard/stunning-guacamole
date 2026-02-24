import { handler } from '../index';
import { buildEvent } from '../../test-utils';

jest.mock('../routes/submit-feedback', () => ({
  submitFeedback: jest.fn().mockResolvedValue({
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'fb-1' }),
  }),
}));

describe('core handler', () => {
  it('routes POST /core/feedback to submitFeedback', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'POST',
      resource: '/core/feedback',
      body: JSON.stringify({ category: 'bug', message: 'broken' }),
    }));

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toEqual({ id: 'fb-1' });
  });

  it('returns 404 for unknown routes', async () => {
    const result = await handler(buildEvent({ httpMethod: 'GET', resource: '/core/feedback' }));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
