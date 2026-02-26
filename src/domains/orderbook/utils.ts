import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** Route handler function type. */
export type RouteHandler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

/** Base URL of the demo exchange API — set via Lambda environment variable. */
export const DEMO_EXCHANGE_API_URL = process.env.DEMO_EXCHANGE_API_URL!;

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
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
    body: JSON.stringify(body),
  };
}
