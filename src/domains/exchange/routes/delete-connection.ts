import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';
import type { ActiveExchangeRecord } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Deletes an exchange connection for the authenticated user.
 *
 * Removes the connection record identified by the `connectionId` path
 * parameter. If the ACTIVE record points to the deleted exchange, the
 * ACTIVE record is also removed (falling back to demo mode).
 *
 * @param event - Cognito-authenticated API Gateway event with `connectionId` path param.
 * @returns 200 on success.
 */
export async function deleteConnection(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext.authorizer?.claims?.sub;
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const connectionId = event.pathParameters?.connectionId;
  if (!connectionId) {
    return jsonResponse(400, { error: 'Missing required path parameter: connectionId' });
  }

  if (connectionId === 'ACTIVE') {
    return jsonResponse(400, { error: 'Invalid connectionId' });
  }

  // Delete the connection record
  await ddbDoc.send(new DeleteCommand({
    TableName: process.env.CONNECTIONS_TABLE_NAME!,
    Key: { sub, connectionId },
  }));

  // If ACTIVE record points to this exchange, remove it (falls back to demo)
  const activeResult = await ddbDoc.send(new GetCommand({
    TableName: process.env.CONNECTIONS_TABLE_NAME!,
    Key: { sub, connectionId: 'ACTIVE' },
  }));

  const activeRecord = activeResult.Item as ActiveExchangeRecord | undefined;
  if (activeRecord && activeRecord.exchangeId === connectionId) {
    await ddbDoc.send(new DeleteCommand({
      TableName: process.env.CONNECTIONS_TABLE_NAME!,
      Key: { sub, connectionId: 'ACTIVE' },
    }));
  }

  return jsonResponse(200, { message: 'Connection deleted' });
}
