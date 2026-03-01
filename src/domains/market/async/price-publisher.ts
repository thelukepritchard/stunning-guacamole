import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { calculateAllIndicators, type KlineData, type Ticker24h } from '../../shared/indicators';
import { NUMERIC_INDICATOR_FIELDS, STRING_INDICATOR_FIELDS } from '../../shared/types';
import type { IndicatorSnapshot, PriceHistoryRecord } from '../../shared/types';

const sns = new SNSClient({});
const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/** 30 days in seconds — TTL offset for price history records. */
const PRICE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Kraken pair identifier for BTC/AUD. */
const SYMBOL = 'XBTAUD';

/** Internal pair identifier used across the platform. */
const PAIR = 'BTC';

/**
 * EventBridge-triggered Lambda that fetches BTC/AUD market data from Kraken,
 * calculates technical indicators, and publishes them to SNS.
 *
 * Runs every 1 minute via EventBridge rule.
 */
export async function handler(): Promise<void> {
  // Fetch OHLC (200 x 1-minute candles) and ticker from Kraken in parallel
  const since = Math.floor(Date.now() / 1000) - 200 * 60;
  const [ohlcRes, tickerRes] = await Promise.all([
    fetch(`https://api.kraken.com/0/public/OHLC?pair=${SYMBOL}&interval=1&since=${since}`),
    fetch(`https://api.kraken.com/0/public/Ticker?pair=${SYMBOL}`),
  ]);

  if (!ohlcRes.ok || !tickerRes.ok) {
    throw new Error(`Kraken API error: ohlc=${ohlcRes.status}, ticker=${tickerRes.status}`);
  }

  const ohlcData = await ohlcRes.json() as { error: string[]; result: Record<string, (string | number)[][]> };
  const tickerData = await tickerRes.json() as { error: string[]; result: Record<string, { c: string[]; v: string[]; o: string }> };

  if (ohlcData.error?.length > 0) {
    throw new Error(`Kraken OHLC error: ${ohlcData.error.join(', ')}`);
  }
  if (tickerData.error?.length > 0) {
    throw new Error(`Kraken Ticker error: ${tickerData.error.join(', ')}`);
  }

  // Kraken returns candles keyed by pair name — extract the first result key
  const ohlcKey = Object.keys(ohlcData.result).find(k => k !== 'last')!;
  const candles = ohlcData.result[ohlcKey]!;

  // Kraken candle format: [timestamp, open, high, low, close, vwap, volume, count]
  // Close is at index 4 — same position as Binance, so calculateAllIndicators works unchanged
  const klines: KlineData = { candles };

  // Parse Kraken ticker: c[0] = last price, v[1] = 24h volume, o = today's open
  const tickerKey = Object.keys(tickerData.result)[0]!;
  const rawTicker = tickerData.result[tickerKey]!;
  const lastPrice = parseFloat(rawTicker.c[0]!);
  const openPrice = parseFloat(rawTicker.o);
  const priceChangePct = openPrice > 0 ? ((lastPrice - openPrice) / openPrice) * 100 : 0;

  const ticker24h: Ticker24h = {
    lastPrice: rawTicker.c[0]!,
    volume: rawTicker.v[1]!,
    priceChangePercent: String(priceChangePct),
  };

  const indicators = calculateAllIndicators(klines, ticker24h);

  // Build SNS message attributes from indicators
  const messageAttributes: Record<string, { DataType: string; StringValue: string }> = {
    pair: { DataType: 'String', StringValue: PAIR },
  };

  for (const field of NUMERIC_INDICATOR_FIELDS) {
    messageAttributes[field] = {
      DataType: 'Number',
      StringValue: String(indicators[field as keyof IndicatorSnapshot]),
    };
  }

  for (const field of STRING_INDICATOR_FIELDS) {
    messageAttributes[field] = {
      DataType: 'String',
      StringValue: String(indicators[field as keyof IndicatorSnapshot]),
    };
  }

  const now = new Date();
  const priceRecord: PriceHistoryRecord = {
    pair: PAIR,
    timestamp: now.toISOString(),
    price: indicators.price,
    volume_24h: indicators.volume_24h,
    price_change_pct: indicators.price_change_pct,
    indicators,
    ttl: Math.floor(now.getTime() / 1000) + PRICE_TTL_SECONDS,
  };

  await Promise.all([
    ddbDoc.send(new PutCommand({
      TableName: process.env.PRICE_HISTORY_TABLE_NAME!,
      Item: priceRecord,
    })),
    sns.send(new PublishCommand({
      TopicArn: process.env.SNS_TOPIC_ARN!,
      Message: JSON.stringify(indicators),
      MessageAttributes: messageAttributes,
    })),
  ]);

  console.log('Published indicators and stored price history:', { pair: PAIR, price: indicators.price });
}
