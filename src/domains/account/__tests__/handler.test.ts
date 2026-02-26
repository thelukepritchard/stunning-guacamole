import { handler } from '../index';
import { buildEvent } from '../../test-utils';

jest.mock('../routes/submit-feedback', () => ({
  submitFeedback: jest.fn().mockResolvedValue({ statusCode: 201, headers: {}, body: '{}' }),
}));
jest.mock('../routes/delete-account', () => ({
  deleteAccount: jest.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' }),
}));

import { submitFeedback } from '../routes/submit-feedback';
import { deleteAccount } from '../routes/delete-account';

describe('account handler', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Should dispatch POST /feedback to submitFeedback.
   */
  it('should dispatch POST /feedback to submitFeedback', async () => {
    const event = buildEvent({ httpMethod: 'POST', resource: '/feedback' });
    await handler(event);
    expect(submitFeedback).toHaveBeenCalledWith(event);
  });

  /**
   * Should dispatch DELETE /account to deleteAccount.
   */
  it('should dispatch DELETE /account to deleteAccount', async () => {
    const event = buildEvent({ httpMethod: 'DELETE', resource: '/account' });
    await handler(event);
    expect(deleteAccount).toHaveBeenCalledWith(event);
  });

  /**
   * Should return 404 for unknown routes.
   */
  it('should return 404 for unknown routes', async () => {
    const event = buildEvent({ httpMethod: 'GET', resource: '/unknown' });
    const result = await handler(event);
    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({ error: 'Route not found' });
  });
});
