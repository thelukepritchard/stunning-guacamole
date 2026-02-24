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
 * Generates an SNS filter policy from a bot's rule group.
 *
 * Only extracts top-level AND rules from the root group. Nested OR groups
 * are skipped (the bot executor Lambda re-evaluates the full rule tree).
 * Always includes a `pair` attribute for pair-level filtering.
 *
 * @param query - The bot's rule group.
 * @param pair - The trading pair (e.g. "BTC/USDT").
 * @returns An SNS filter policy object.
 */
export function generateFilterPolicy(
  query: RuleGroup,
  pair: string,
): Record<string, unknown> {
  const policy: Record<string, unknown> = {
    pair: [pair],
  };

  // Only extract flat AND rules from root
  if (query.combinator !== 'and') return policy;

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

  return policy;
}
