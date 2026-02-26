import { handler } from '../index';
import { buildEvent } from '../../test-utils';

jest.mock('../routes/submit-feedback', () => ({
  submitFeedback: jest.fn().mockResolvedValue({
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'fb-1' }),
  }),
}));

jest.mock('../routes/delete-account', () => ({
  deleteAccount: jest.fn().mockResolvedValue({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Account deleted successfully' }),
  }),
}));

/**
 * Tests for the core Lambda handler route dispatch.
 */
describe('core handler', () => {
  /** Verifies POST /core/feedback is dispatched to submitFeedback. */
  it('routes POST /core/feedback to submitFeedback', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'POST',
      resource: '/core/feedback',
      body: JSON.stringify({ category: 'bug', message: 'broken' }),
    }));

    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body)).toEqual({ id: 'fb-1' });
  });

  /** Verifies DELETE /core/account is dispatched to deleteAccount. */
  it('routes DELETE /core/account to deleteAccount', async () => {
    const result = await handler(buildEvent({
      httpMethod: 'DELETE',
      resource: '/core/account',
    }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ message: 'Account deleted successfully' });
  });

  /** Verifies that unrecognised route keys return 404. */
  it('returns 404 for unknown routes', async () => {
    const result = await handler(buildEvent({ httpMethod: 'GET', resource: '/core/feedback' }));

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
