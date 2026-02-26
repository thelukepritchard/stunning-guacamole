import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ORDERS_TABLE = process.env.ORDERS_TABLE_NAME!;

/**
 * Lists all demo orders for a user.
 *
 * @param event - API Gateway event with `sub` query parameter.
 * @returns JSON response containing the user's demo orders.
 */
export async function listOrders(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.queryStringParameters?.sub;
  if (!sub) {
    return jsonResponse(400, { error: 'Missing required query parameter: sub' });
  }

  const { Items = [] } = await ddbDoc.send(new QueryCommand({
    TableName: ORDERS_TABLE,
    KeyConditionExpression: '#sub = :sub',
    ExpressionAttributeNames: { '#sub': 'sub' },
    ExpressionAttributeValues: { ':sub': sub },
  }));

  return jsonResponse(200, { orders: Items });
}
