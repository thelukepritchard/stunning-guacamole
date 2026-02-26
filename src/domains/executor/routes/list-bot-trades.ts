import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Lists trade signals for a specific bot, newest first.
 *
 * Verifies the bot belongs to the authenticated user before returning trades.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response containing the list of trades for the bot.
 */
export async function listBotTrades(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const botId = event.pathParameters?.botId;
  if (!botId) return jsonResponse(400, { error: 'Missing botId' });

  // Verify bot belongs to user
  const botResult = await ddbDoc.send(new GetCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    Key: { sub, botId },
  }));

  if (!botResult.Item) return jsonResponse(404, { error: 'Bot not found' });

  const limit = parseInt(event.queryStringParameters?.limit ?? '50', 10);

  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.TRADES_TABLE_NAME!,
    KeyConditionExpression: 'botId = :botId',
    ExpressionAttributeValues: { ':botId': botId },
    ScanIndexForward: false,
    Limit: limit,
  }));

  return jsonResponse(200, { items: result.Items ?? [] });
}
