/**
 * Formats a number with locale-aware thousand separators and fixed decimal places.
 *
 * @param value - The number to format.
 * @param decimals - Number of decimal places (default: 2).
 * @returns The formatted string, e.g. "97,243.50".
 */
export function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Formats a number as a dollar amount with thousand separators.
 *
 * @param value - The number to format.
 * @param decimals - Number of decimal places (default: 2).
 * @returns The formatted string with $ prefix, e.g. "$97,243.50".
 */
export function formatDollar(value: number, decimals = 2): string {
  return `$${formatNumber(value, decimals)}`;
}

/**
 * Formats a number as a percentage with a sign prefix.
 *
 * @param value - The percentage value.
 * @param decimals - Number of decimal places (default: 1).
 * @returns The formatted string, e.g. "+14.1%".
 */
export function formatPercent(value: number, decimals = 1): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${formatNumber(value, decimals)}%`;
}
