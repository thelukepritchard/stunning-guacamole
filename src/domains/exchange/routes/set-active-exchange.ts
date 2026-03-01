import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';
import type { ExchangeId, ExchangeConnectionRecord, ActiveExchangeRecord, ActiveExchangeResponse } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Sets the active exchange for the authenticated user.
 *
 * If `exchangeId` is `'demo'`, the ACTIVE record is deleted (demo is the
 * implicit default). For real exchanges, verifies the connection exists
 * before writing the ACTIVE preference record.
 *
 * @param event - Cognito-authenticated API Gateway event with JSON body.
 * @returns 200 with the active exchange response.
 */
export async function setActiveExchange(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext.authorizer?.claims?.sub;
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }
  const { exchangeId } = body;

  if (!exchangeId) {
    return jsonResponse(400, { error: 'Missing required field: exchangeId' });
  }

  // Setting to demo — delete ACTIVE record
  if (exchangeId === 'demo') {
    await ddbDoc.send(new DeleteCommand({
      TableName: process.env.CONNECTIONS_TABLE_NAME!,
      Key: { sub, connectionId: 'ACTIVE' },
    }));

    const response: ActiveExchangeResponse = { exchangeId: 'demo', baseCurrency: 'AUD' };
    return jsonResponse(200, response);
  }

  // Verify the connection exists
  const connectionResult = await ddbDoc.send(new GetCommand({
    TableName: process.env.CONNECTIONS_TABLE_NAME!,
    Key: { sub, connectionId: exchangeId },
  }));

  const connection = connectionResult.Item as ExchangeConnectionRecord | undefined;
  if (!connection) {
    return jsonResponse(404, { error: `No connection found for exchange: ${exchangeId}` });
  }

  const now = new Date().toISOString();
  const activeRecord: ActiveExchangeRecord = {
    sub,
    connectionId: 'ACTIVE',
    exchangeId: exchangeId as ExchangeId,
    baseCurrency: connection.baseCurrency,
    updatedAt: now,
  };

  await ddbDoc.send(new PutCommand({
    TableName: process.env.CONNECTIONS_TABLE_NAME!,
    Item: activeRecord,
  }));

  const response: ActiveExchangeResponse = {
    exchangeId: activeRecord.exchangeId,
    baseCurrency: activeRecord.baseCurrency,
  };

  return jsonResponse(200, response);
}
