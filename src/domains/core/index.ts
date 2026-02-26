import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { submitFeedback } from './routes/submit-feedback';
import { deleteAccount } from './routes/delete-account';

/**
 * Lambda entry-point. Routes the incoming API Gateway request to the
 * appropriate handler based on HTTP method and resource path.
 *
 * @param event - The API Gateway proxy event.
 * @returns The API Gateway proxy result.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const routeKey = `${event.httpMethod} ${event.resource}`;

  switch (routeKey) {
    case 'POST /core/feedback': return submitFeedback(event);
    case 'DELETE /core/account': return deleteAccount(event);
    default:
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        },
        body: JSON.stringify({ error: 'Route not found' }),
      };
  }
}
