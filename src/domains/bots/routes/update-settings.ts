import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { KMSClient, EncryptCommand } from '@aws-sdk/client-kms';
import { jsonResponse } from '../utils';
import type { TradingSettingsRecord, TradingSettingsResponse, ExchangeId } from '../../shared/types';
import { SUPPORTED_EXCHANGES, EXCHANGE_BASE_CURRENCIES } from '../../shared/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const kms = new KMSClient({});

/**
 * Encrypts a plaintext string using KMS and returns a Base64-encoded ciphertext.
 *
 * @param plaintext - The string to encrypt.
 * @returns Base64-encoded ciphertext.
 */
async function encrypt(plaintext: string): Promise<string> {
  const result = await kms.send(new EncryptCommand({
    KeyId: process.env.KMS_KEY_ID!,
    Plaintext: new TextEncoder().encode(plaintext),
  }));
  return Buffer.from(result.CiphertextBlob!).toString('base64');
}

/**
 * Masks an API key for safe display, showing only the last 4 characters.
 *
 * @param apiKey - The full API key.
 * @returns A masked string like '••••••••abcd'.
 */
function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return apiKey;
  return '\u2022'.repeat(8) + apiKey.slice(-4);
}

/**
 * Disables all active bots belonging to a user by setting their status to 'paused'.
 *
 * @param sub - The user's Cognito sub.
 */
async function disableAllBots(sub: string): Promise<void> {
  const result = await ddbDoc.send(new QueryCommand({
    TableName: process.env.BOTS_TABLE_NAME!,
    KeyConditionExpression: '#sub = :sub',
    ExpressionAttributeNames: { '#sub': 'sub' },
    ExpressionAttributeValues: { ':sub': sub },
    FilterExpression: '#status = :active',
  }));

  const activeBots = result.Items ?? [];
  if (activeBots.length === 0) return;

  const now = new Date().toISOString();
  await Promise.all(activeBots.map((bot) =>
    ddbDoc.send(new UpdateCommand({
      TableName: process.env.BOTS_TABLE_NAME!,
      Key: { sub, botId: bot.botId },
      UpdateExpression: 'SET #status = :paused, #updatedAt = :now',
      ExpressionAttributeNames: { '#status': 'status', '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: { ':paused': 'paused', ':now': now },
    })),
  ));
}

/**
 * Updates the authenticated user's trading settings.
 *
 * Expects a JSON body with `exchange`, `baseCurrency`, `apiKey`, and `apiSecret`.
 * Only real exchanges (not demo) can be selected — demo is the implicit default
 * when no settings record exists. If the exchange changes from the current setting,
 * all active bots are immediately disabled (set to paused). Base currency must be
 * valid for the selected exchange.
 *
 * @param event - The incoming API Gateway event.
 * @returns A JSON response with the updated trading settings (secrets stripped).
 */
export async function updateSettings(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const sub: string = event.requestContext.authorizer?.claims?.sub ?? '';
  if (!sub) return jsonResponse(401, { error: 'Unauthorized' });

  const body = JSON.parse(event.body ?? '{}');
  const { exchange, baseCurrency, apiKey, apiSecret } = body;

  if (!exchange || !baseCurrency || !apiKey || !apiSecret) {
    return jsonResponse(400, { error: 'Missing required fields: exchange, baseCurrency, apiKey, apiSecret' });
  }

  if (!SUPPORTED_EXCHANGES.includes(exchange as ExchangeId)) {
    return jsonResponse(400, { error: `Unsupported exchange. Must be one of: ${SUPPORTED_EXCHANGES.join(', ')}` });
  }

  const validCurrencies = EXCHANGE_BASE_CURRENCIES[exchange as ExchangeId];
  if (!validCurrencies.includes(baseCurrency)) {
    return jsonResponse(400, {
      error: `Invalid base currency for ${exchange}. Must be one of: ${validCurrencies.join(', ')}`,
    });
  }

  // Check if the exchange is changing — if so, disable all active bots
  const existing = await ddbDoc.send(new GetCommand({
    TableName: process.env.SETTINGS_TABLE_NAME!,
    Key: { sub },
  }));
  const currentSettings = existing.Item as TradingSettingsRecord | undefined;

  if (currentSettings && currentSettings.exchange !== exchange) {
    await disableAllBots(sub);
  }

  const [encryptedApiKey, encryptedApiSecret] = await Promise.all([
    encrypt(apiKey),
    encrypt(apiSecret),
  ]);

  const now = new Date().toISOString();
  const item: TradingSettingsRecord = {
    sub,
    exchange: exchange as ExchangeId,
    baseCurrency,
    encryptedApiKey,
    encryptedApiSecret,
    maskedApiKey: maskApiKey(apiKey),
    updatedAt: now,
  };

  await ddbDoc.send(new PutCommand({
    TableName: process.env.SETTINGS_TABLE_NAME!,
    Item: item,
  }));

  const response: TradingSettingsResponse = {
    exchange: item.exchange,
    baseCurrency: item.baseCurrency,
    maskedApiKey: item.maskedApiKey,
    updatedAt: item.updatedAt,
  };

  return jsonResponse(200, response);
}
