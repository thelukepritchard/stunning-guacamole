import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { submitFeedback } from './routes/submit-feedback';

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
    default:
      return { statusCode: 404, body: JSON.stringify({ error: 'Route not found' }) };
  }
}
