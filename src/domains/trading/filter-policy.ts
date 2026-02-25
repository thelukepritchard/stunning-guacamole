import type { Rule, RuleGroup } from './types';
import { NUMERIC_INDICATOR_FIELDS, STRING_INDICATOR_FIELDS } from './types';

/**
 * Maps a rule operator to an SNS numeric filter condition.
 *
 * @param operator - The comparison operator.
 * @param value - The rule value string.
 * @returns An SNS numeric condition array, or null if unsupported.
 */
function numericCondition(operator: string, value: string): unknown[] | null {
  const num = parseFloat(value);
  if (isNaN(num)) return null;

  switch (operator) {
    case '>':
      return [{ numeric: ['>', num] }];
    case '<':
      return [{ numeric: ['<', num] }];
    case '>=':
      return [{ numeric: ['>=', num] }];
    case '<=':
      return [{ numeric: ['<=', num] }];
    case '=':
      return [{ numeric: ['=', num] }];
    case 'between': {
      const parts = value.split(',').map((v) => parseFloat(v.trim()));
      if (parts.length !== 2 || parts.some(isNaN)) return null;
      return [{ numeric: ['>=', parts[0]!, '<=', parts[1]!] }];
    }
    default:
      return null;
  }
}

/**
 * Extracts flat AND rules from a rule group into an SNS filter policy.
 *
 * Only processes top-level AND rules. Nested OR groups are skipped
 * (the bot executor Lambda re-evaluates the full rule tree).
 *
 * @param query - The rule group to extract from.
 * @param policy - The policy object to populate.
 */
function extractRules(query: RuleGroup, policy: Record<string, unknown>): void {
  if (query.combinator !== 'and') return;

  for (const child of query.rules) {
    // Skip nested groups — executor will handle them
    if ('rules' in child) continue;

    const rule = child as Rule;
    const isNumeric = (NUMERIC_INDICATOR_FIELDS as readonly string[]).includes(rule.field);
    const isString = (STRING_INDICATOR_FIELDS as readonly string[]).includes(rule.field);

    if (isNumeric) {
      const condition = numericCondition(rule.operator, rule.value);
      if (condition) {
        policy[rule.field] = condition;
      }
    } else if (isString && rule.operator === '=') {
      policy[rule.field] = [rule.value];
    }
  }
}

/**
 * Generates an SNS filter policy for a single rule group (buy or sell).
 *
 * Extracts top-level AND rules for pre-filtering via SNS MessageAttributes.
 * Nested OR groups and non-AND combinators are skipped — the bot executor
 * re-evaluates the full rule tree regardless.
 *
 * Always includes a `pair` attribute for pair-level filtering.
 *
 * @param pair - The trading pair (e.g. "BTC/USDT").
 * @param query - The rule group to derive the filter policy from (optional).
 * @returns An SNS filter policy object.
 */
export function generateFilterPolicy(
  pair: string,
  query?: RuleGroup,
): Record<string, unknown> {
  const policy: Record<string, unknown> = {
    pair: [pair],
  };

  if (query) {
    extractRules(query, policy);
  }

  return policy;
}
