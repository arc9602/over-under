import { formatCurrency } from "./formatCurrency";

/**
 * Bets can be denominated in money or in any arbitrary thing -- slices of
 * pizza, beers, push-ups. 'USD' is the sentinel for money and gets real
 * currency formatting; everything else is a free-text singular label.
 *
 * Markets are always money and don't go through here.
 */
export const MONEY_UNIT = "USD";

export function isMoneyUnit(unit: string | null | undefined): boolean {
  return !unit || unit === MONEY_UNIT;
}

function pluralizeWord(word: string): string {
  if (/(ch|sh)$/i.test(word) || /[sxz]$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/**
 * Pluralize the head noun, not the tail: "slice of pizza" -> "slices of
 * pizza", never "slice of pizzas". Anything this gets wrong can be overridden
 * by storing an explicit plural on the bet.
 */
export function pluralizeUnit(unit: string): string {
  const compound = unit.match(/^(\S+)(\s+of\s+.+)$/i);
  if (compound) return pluralizeWord(compound[1]) + compound[2];
  return pluralizeWord(unit);
}

/** Trailing zeros are noise: 3 -> "3", 2.50 -> "2.5", 1.333 -> "1.33". */
export function formatUnitAmount(amount: number): string {
  return String(Number(amount.toFixed(2)));
}

/** The right noun for this quantity, e.g. 1 -> "slice of pizza". */
export function unitNoun(
  amount: number,
  unit: string,
  unitPlural?: string | null
): string {
  if (Math.abs(Number(amount.toFixed(2))) === 1) return unit;
  return unitPlural?.trim() || pluralizeUnit(unit);
}

/** "$20.00" for money, "3 slices of pizza" for anything else. */
export function formatStake(
  amount: number,
  unit: string | null | undefined,
  unitPlural?: string | null
): string {
  if (isMoneyUnit(unit)) return formatCurrency(amount);
  return `${formatUnitAmount(amount)} ${unitNoun(amount, unit as string, unitPlural)}`;
}

/** Bare plural for headings and field labels, e.g. "slices of pizza". */
export function unitLabel(unit: string | null | undefined, unitPlural?: string | null): string {
  if (isMoneyUnit(unit)) return "money";
  return unitPlural?.trim() || pluralizeUnit(unit as string);
}

export const STAKE_UNIT_PRESETS: { emoji: string; unit: string; plural: string }[] = [
  { emoji: "🍕", unit: "slice of pizza", plural: "slices of pizza" },
  { emoji: "🍺", unit: "beer", plural: "beers" },
  { emoji: "☕", unit: "coffee", plural: "coffees" },
  { emoji: "💪", unit: "push-up", plural: "push-ups" },
];
