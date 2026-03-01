import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { decrypt } from './crypto';
import type { ExchangeId, ExchangeConnectionRecord } from '../shared/types';
import type { ResolvedExchange } from './resolve-exchange';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Resolves exchange credentials for a specific exchange by exchangeId.
 *
 * Used by the bot executor to look up the correct exchange connection for
 * a bot's assigned exchange, rather than the user's active exchange.
 *
 * - If exchangeId is 'demo', returns immediately with no credentials.
 * - Otherwise, fetches the connection record and decrypts API credentials.
 *
 * @param sub - The user's Cognito sub.
 * @param exchangeId - The exchange to resolve credentials for.
 * @returns The resolved exchange with optional decrypted credentials.
 * @throws If the connection record is not found for a real exchange.
 */
export async function resolveBotExchange(sub: string, exchangeId: ExchangeId): Promise<ResolvedExchange> {
  if (exchangeId === 'demo') {
    return { exchangeId: 'demo' };
  }

  const result = await ddbDoc.send(new GetCommand({
    TableName: process.env.CONNECTIONS_TABLE_NAME!,
    Key: { sub, connectionId: exchangeId },
  }));

  const connection = result.Item as ExchangeConnectionRecord | undefined;
  if (!connection) {
    throw new Error(`No connection found for exchange ${exchangeId} (user: ${sub})`);
  }

  const [apiKey, apiSecret] = await Promise.all([
    decrypt(connection.encryptedApiKey),
    decrypt(connection.encryptedApiSecret),
  ]);

  return {
    exchangeId,
    credentials: {
      apiKey,
      apiSecret,
      baseCurrency: connection.baseCurrency,
    },
  };
}
