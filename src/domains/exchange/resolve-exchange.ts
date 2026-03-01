import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { decrypt } from './crypto';
import type { ExchangeId, ActiveExchangeRecord, ExchangeConnectionRecord } from '../shared/types';
import type { ExchangeCredentials } from './adapters/types';

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** Resolved exchange context returned by {@link resolveActiveExchange}. */
export interface ResolvedExchange {
  /** The active exchange identifier. */
  exchangeId: ExchangeId;
  /** Decrypted credentials — only present for real (non-demo) exchanges. */
  credentials?: ExchangeCredentials;
}

/**
 * Resolves the user's active exchange and decrypts credentials if needed.
 *
 * Reads the ACTIVE preference record from the connections table. If absent,
 * the user defaults to the demo exchange. For real exchanges, the connection
 * record is fetched and credentials are decrypted (with in-memory caching).
 *
 * @param sub - The user's Cognito sub.
 * @returns The resolved exchange with optional decrypted credentials.
 */
export async function resolveActiveExchange(sub: string): Promise<ResolvedExchange> {
  const activeResult = await ddbDoc.send(new GetCommand({
    TableName: process.env.CONNECTIONS_TABLE_NAME!,
    Key: { sub, connectionId: 'ACTIVE' },
  }));

  const activeRecord = activeResult.Item as ActiveExchangeRecord | undefined;
  if (!activeRecord) {
    return { exchangeId: 'demo' };
  }

  const connectionResult = await ddbDoc.send(new GetCommand({
    TableName: process.env.CONNECTIONS_TABLE_NAME!,
    Key: { sub, connectionId: activeRecord.exchangeId },
  }));

  const connection = connectionResult.Item as ExchangeConnectionRecord | undefined;
  if (!connection) {
    return { exchangeId: 'demo' };
  }

  const [apiKey, apiSecret] = await Promise.all([
    decrypt(connection.encryptedApiKey),
    decrypt(connection.encryptedApiSecret),
  ]);

  return {
    exchangeId: activeRecord.exchangeId,
    credentials: {
      apiKey,
      apiSecret,
      baseCurrency: activeRecord.baseCurrency,
    },
  };
}
