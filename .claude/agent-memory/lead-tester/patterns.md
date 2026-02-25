# Testing Patterns

## AWS SDK Mocking

Always mock both packages when a handler uses DynamoDB:

```ts
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: mockSend })) },
  GetCommand: jest.fn((params) => ({ ...params, _type: 'Get' })),
  QueryCommand: jest.fn((params) => ({ ...params, _type: 'Query' })),
  ScanCommand: jest.fn((params) => ({ ...params, _type: 'Scan' })),
  PutCommand: jest.fn((params) => ({ ...params, _type: 'Put' })),
  UpdateCommand: jest.fn((params) => ({ ...params, _type: 'Update' })),
  DeleteCommand: jest.fn((params) => ({ ...params, _type: 'Delete' })),
  BatchWriteCommand: jest.fn((params) => ({ ...params, _type: 'BatchWrite' })),
}));
```

Only include commands that the handler actually uses.

## Handler Dispatch Tests (preferred pattern)

Mock all route modules so handler tests don't depend on DynamoDB:

```ts
const mockListItems = jest.fn().mockResolvedValue(mockResponse);
jest.mock('../routes/list-items', () => ({ listItems: mockListItems }));
import { handler } from '../index';
```

Reference: `trading/__tests__/handler.test.ts`, `portfolio/__tests__/handler.test.ts`

## Auth-Protected Route Events

The shared `buildEvent()` has an empty `requestContext: {}` — no sub. For auth-protected routes, always provide:

```ts
requestContext: {
  authorizer: { claims: { sub: 'user-123' } },
} as unknown as APIGatewayProxyEvent['requestContext'],
```

## KMS Mocking

```ts
const mockKmsSend = jest.fn();
jest.mock('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn(() => ({ send: mockKmsSend })),
  EncryptCommand: jest.fn((params) => ({ ...params, _type: 'Encrypt' })),
}));
```

## EventBridge Mocking

```ts
const mockEventBridgeSend = jest.fn();
jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: mockEventBridgeSend })),
  PutEventsCommand: jest.fn((params) => ({ ...params, _type: 'PutEvents' })),
}));
```

## SNS Mocking

```ts
const mockSnsSend = jest.fn();
jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn(() => ({ send: mockSnsSend })),
  PublishCommand: jest.fn((params) => ({ ...params, _type: 'Publish' })),
  SubscribeCommand: jest.fn((params) => ({ ...params, _type: 'Subscribe' })),
  UnsubscribeCommand: jest.fn((params) => ({ ...params, _type: 'Unsubscribe' })),
  SetSubscriptionAttributesCommand: jest.fn((params) => ({ ...params, _type: 'SetSubscriptionAttributes' })),
}));
```

## price-publisher Requires Both SNS + DynamoDB Mocks

The price-publisher handler writes price history to DynamoDB AND publishes to SNS.
Both must be mocked or the test will fail with a real AWS credential resolution attempt.
