import type { APIGatewayProxyEvent } from 'aws-lambda';

/**
 * Builds a mock {@link APIGatewayProxyEvent} with sensible defaults.
 * Override individual properties as needed for each test case.
 *
 * @param overrides - Partial event properties to merge into the defaults.
 * @returns A fully-formed mock API Gateway proxy event.
 */
export function buildEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    resource: '/',
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    ...overrides,
  };
}
