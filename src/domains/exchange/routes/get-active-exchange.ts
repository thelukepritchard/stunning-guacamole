import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';
import type { ActiveExchangeRecord, ActiveExchangeResponse } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Returns the authenticated user's active exchange.
 *
 * If no ACTIVE preference record exists, returns demo defaults.
 *
 * @param event - Cognito-authenticated API Gateway event.
 * @returns 200 with the active exchange response.
 */
export async function getActiveExchange(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext.authorizer?.claims?.sub;
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const result = await ddbDoc.send(new GetCommand({
    TableName: process.env.CONNECTIONS_TABLE_NAME!,
    Key: { sub, connectionId: 'ACTIVE' },
  }));

  const activeRecord = result.Item as ActiveExchangeRecord | undefined;

  const response: ActiveExchangeResponse = activeRecord
    ? { exchangeId: activeRecord.exchangeId, baseCurrency: activeRecord.baseCurrency }
    : { exchangeId: 'demo', baseCurrency: 'AUD' };

  return jsonResponse(200, response);
}
