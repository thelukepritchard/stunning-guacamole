import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { calculateAllIndicators, type KlineData, type Ticker24h } from '../indicators';
import { NUMERIC_INDICATOR_FIELDS, STRING_INDICATOR_FIELDS } from '../types';
import type { IndicatorSnapshot } from '../types';

const sns = new SNSClient({});

const SYMBOL = 'BTCUSDT';
const PAIR = 'BTC/USDT';

/**
 * EventBridge-triggered Lambda that fetches BTC/USDT market data from Binance,
 * calculates technical indicators, and publishes them to SNS.
 *
 * Runs every 1 minute via EventBridge rule.
 */
export async function handler(): Promise<void> {
  // Fetch klines (200 x 1-minute candles) and 24h ticker in parallel
  const [klinesRes, tickerRes] = await Promise.all([
    fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL}&interval=1m&limit=200`),
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${SYMBOL}`),
  ]);

  if (!klinesRes.ok || !tickerRes.ok) {
    throw new Error(`Binance API error: klines=${klinesRes.status}, ticker=${tickerRes.status}`);
  }

  const candles = await klinesRes.json() as (string | number)[][];
  const ticker24h = await tickerRes.json() as Ticker24h;

  const klines: KlineData = { candles };
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

  await sns.send(new PublishCommand({
    TopicArn: process.env.SNS_TOPIC_ARN!,
    Message: JSON.stringify(indicators),
    MessageAttributes: messageAttributes,
  }));

  console.log('Published indicators:', { pair: PAIR, price: indicators.price });
}
