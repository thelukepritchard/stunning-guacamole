import type { Field } from 'react-querybuilder';

/** Trading rule field definitions for react-querybuilder. */
export const botFields: Field[] = [
  // ─── Price & Volume ─────────────────────────────────────────────
  {
    name: 'price',
    label: 'Price',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
      { name: '=', label: '=' },
      { name: 'between', label: 'between' },
    ],
  },
  {
    name: 'volume_24h',
    label: 'Volume (24h)',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
      { name: 'between', label: 'between' },
    ],
  },
  {
    name: 'price_change_pct',
    label: 'Price Change %',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
      { name: 'between', label: 'between' },
    ],
  },

  // ─── RSI ────────────────────────────────────────────────────────
  {
    name: 'rsi_14',
    label: 'RSI (14)',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
      { name: 'between', label: 'between' },
    ],
  },
  {
    name: 'rsi_7',
    label: 'RSI (7)',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
      { name: 'between', label: 'between' },
    ],
  },

  // ─── MACD ───────────────────────────────────────────────────────
  {
    name: 'macd_histogram',
    label: 'MACD Histogram',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
    ],
  },
  {
    name: 'macd_signal',
    label: 'MACD Signal',
    operators: [
      { name: '=', label: '=' },
    ],
    valueEditorType: 'select',
    values: [
      { name: 'bullish_crossover', label: 'Bullish crossover' },
      { name: 'bearish_crossover', label: 'Bearish crossover' },
      { name: 'above_signal', label: 'Above signal line' },
      { name: 'below_signal', label: 'Below signal line' },
    ],
  },

  // ─── Moving Averages ───────────────────────────────────────────
  {
    name: 'sma_20',
    label: 'SMA (20)',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
    ],
  },
  {
    name: 'sma_50',
    label: 'SMA (50)',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
    ],
  },
  {
    name: 'sma_200',
    label: 'SMA (200)',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
    ],
  },
  {
    name: 'ema_12',
    label: 'EMA (12)',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
    ],
  },
  {
    name: 'ema_20',
    label: 'EMA (20)',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
    ],
  },
  {
    name: 'ema_26',
    label: 'EMA (26)',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
    ],
  },

  // ─── Bollinger Bands ───────────────────────────────────────────
  {
    name: 'bb_upper',
    label: 'BB Upper',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
    ],
  },
  {
    name: 'bb_lower',
    label: 'BB Lower',
    inputType: 'number',
    operators: [
      { name: '>', label: '>' },
      { name: '<', label: '<' },
      { name: '>=', label: '>=' },
      { name: '<=', label: '<=' },
    ],
  },
  {
    name: 'bb_position',
    label: 'BB Position',
    operators: [
      { name: '=', label: '=' },
    ],
    valueEditorType: 'select',
    values: [
      { name: 'above_upper', label: 'Above upper band' },
      { name: 'below_lower', label: 'Below lower band' },
      { name: 'between_bands', label: 'Between bands' },
      { name: 'near_upper', label: 'Near upper band' },
      { name: 'near_lower', label: 'Near lower band' },
    ],
  },
];
