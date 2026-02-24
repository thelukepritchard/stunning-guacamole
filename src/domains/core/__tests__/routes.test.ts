import { buildEvent } from '../../test-utils';

const mockSend = jest.fn().mockResolvedValue({});

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: mockSend }) },
  PutCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

import { submitFeedback } from '../routes/submit-feedback';

describe('submitFeedback', () => {
  beforeEach(() => {
    process.env.FEEDBACK_TABLE_NAME = 'Feedback-test';
    mockSend.mockClear();
  });

  it('returns 201 with the created feedback item', async () => {
    const result = await submitFeedback(buildEvent({
      httpMethod: 'POST',
      resource: '/core/feedback',
      body: JSON.stringify({ category: 'bug', message: 'Something is broken' }),
      requestContext: {
        authorizer: { claims: { email: 'user@example.com' } },
      } as any,
    }));
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(201);
    expect(body).toEqual(expect.objectContaining({
      email: 'user@example.com',
      category: 'bug',
      message: 'Something is broken',
    }));
    expect(body.id).toBeDefined();
    expect(body.createdAt).toBeDefined();
  });

  it('writes the item to DynamoDB', async () => {
    await submitFeedback(buildEvent({
      httpMethod: 'POST',
      resource: '/core/feedback',
      body: JSON.stringify({ category: 'feature', message: 'Add dark mode' }),
      requestContext: {
        authorizer: { claims: { email: 'test@example.com' } },
      } as any,
    }));

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      TableName: 'Feedback-test',
      Item: expect.objectContaining({
        email: 'test@example.com',
        category: 'feature',
        message: 'Add dark mode',
      }),
    }));
  });

  it('defaults category to general when not provided', async () => {
    const result = await submitFeedback(buildEvent({
      httpMethod: 'POST',
      resource: '/core/feedback',
      body: JSON.stringify({ message: 'Hello' }),
      requestContext: {
        authorizer: { claims: { email: 'user@example.com' } },
      } as any,
    }));
    const body = JSON.parse(result.body);

    expect(body.category).toBe('general');
  });
});
