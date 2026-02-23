import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** Route handler function type. */
export type RouteHandler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

/**
 * Creates a JSON response with the given status code and body.
 *
 * @param statusCode - HTTP status code.
 * @param body - Response payload to serialise as JSON.
 * @returns An API Gateway proxy result.
 */
export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
