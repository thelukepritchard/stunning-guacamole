import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { jsonResponse } from '../utils';
import { encrypt, maskApiKey } from '../crypto';
import { getAdapter } from '../adapters';
import type { ExchangeId, ExchangeConnectionRecord, ExchangeConnectionResponse, ActiveExchangeRecord } from '../../shared/types';
import { PHASE_1_EXCHANGES, EXCHANGE_BASE_CURRENCIES } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Creates or updates an exchange connection for the authenticated user.
 *
 * Validates the exchange identifier and base currency, then calls the
 * exchange adapter to verify the API credentials are accepted. On success,
 * encrypts the credentials and writes the connection record. If no ACTIVE
 * record exists, auto-sets this exchange as the active exchange.
 *
 * @param event - Cognito-authenticated API Gateway event with JSON body.
 * @returns 201 with the connection response, or 400 on validation failure.
 */
export async function createConnection(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub = event.requestContext.authorizer?.claims?.sub;
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const exchangeId = typeof body.exchangeId === 'string' ? body.exchangeId : '';
  const baseCurrency = typeof body.baseCurrency === 'string' ? body.baseCurrency : '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const apiSecret = typeof body.apiSecret === 'string' ? body.apiSecret.trim() : '';

  if (!exchangeId || !baseCurrency || !apiKey || !apiSecret) {
    return jsonResponse(400, { error: 'Missing required fields: exchangeId, baseCurrency, apiKey, apiSecret' });
  }

  if (!PHASE_1_EXCHANGES.includes(exchangeId as ExchangeId)) {
    return jsonResponse(400, { error: `Unsupported exchange. Must be one of: ${PHASE_1_EXCHANGES.join(', ')}` });
  }

  const validCurrencies = EXCHANGE_BASE_CURRENCIES[exchangeId as ExchangeId];
  if (!validCurrencies || !validCurrencies.includes(baseCurrency)) {
    return jsonResponse(400, {
      error: `Invalid base currency for ${exchangeId}. Must be one of: ${(validCurrencies ?? []).join(', ')}`,
    });
  }

  // Validate credentials against the exchange
  const adapter = getAdapter(exchangeId as ExchangeId);
  const isValid = await adapter.validateCredentials({ apiKey, apiSecret, baseCurrency });
  if (!isValid) {
    return jsonResponse(400, { error: 'Invalid API credentials. Please check your API key and secret.' });
  }

  const [encryptedApiKey, encryptedApiSecret] = await Promise.all([
    encrypt(apiKey),
    encrypt(apiSecret),
  ]);

  const now = new Date().toISOString();
  const connectionRecord: ExchangeConnectionRecord = {
    sub,
    connectionId: exchangeId,
    exchangeId: exchangeId as ExchangeId,
    baseCurrency,
    encryptedApiKey,
    encryptedApiSecret,
    maskedApiKey: maskApiKey(apiKey),
    createdAt: now,
    updatedAt: now,
  };

  await ddbDoc.send(new PutCommand({
    TableName: process.env.CONNECTIONS_TABLE_NAME!,
    Item: connectionRecord,
  }));

  // Auto-set as active if no ACTIVE record exists
  const activeResult = await ddbDoc.send(new GetCommand({
    TableName: process.env.CONNECTIONS_TABLE_NAME!,
    Key: { sub, connectionId: 'ACTIVE' },
  }));

  if (!activeResult.Item) {
    const activeRecord: ActiveExchangeRecord = {
      sub,
      connectionId: 'ACTIVE',
      exchangeId: exchangeId as ExchangeId,
      baseCurrency,
      updatedAt: now,
    };
    await ddbDoc.send(new PutCommand({
      TableName: process.env.CONNECTIONS_TABLE_NAME!,
      Item: activeRecord,
    }));
  }

  const response: ExchangeConnectionResponse = {
    exchangeId: connectionRecord.exchangeId,
    baseCurrency: connectionRecord.baseCurrency,
    maskedApiKey: connectionRecord.maskedApiKey,
    createdAt: connectionRecord.createdAt,
    updatedAt: connectionRecord.updatedAt,
  };

  return jsonResponse(201, response);
}
