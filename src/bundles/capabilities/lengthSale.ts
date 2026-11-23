/**
 * Selling by length: the length pad's rules, with no React in it. Any bundle with the
 * `lengthSale` capability uses this; a product opts in with `soldBy: 'length'`.
 *
 * A length line is an ordinary sale line whose qty is metres, so recordSale, stock and restock
 * need nothing of their own. The exact length typed is charged; nothing is rounded up.
 */
import { metres, rand } from '../../lib/format'
import type { AppState, Product } from '../../data/types'

export const DEFAULT_MIN_CUT = 0.5
export const DEFAULT_CUT_STEP = 0.1
/** The pad's quick picks. */
export const QUICK_LENGTHS = [1, 1.5, 2, 3, 5]

export const isByLength = (p: Product | undefined) => p?.soldBy === 'length'
export const minCutOf = (p: Product) => p.minCut ?? DEFAULT_MIN_CUT
export const cutStepOf = (p: Product) => p.cutStep ?? DEFAULT_CUT_STEP

const round3 = (n: number) => Math.round(n * 1000) / 1000
const decimalsOf = (step: number) => (String(step).split('.')[1] ?? '').length

/** Whether the pad may show this text: digits, and no more decimals than the cut step has (0.1 m = one). */
export function lengthInputOk(text: string, p: Product): boolean {
  const d = decimalsOf(cutStepOf(p))
  return new RegExp(d ? `^\\d{0,3}(\\.\\d{0,${d}})?$` : '^\\d{0,3}$').test(text)
}

export type LengthCheck = {
  metres: number
  total: number
  /** Add is enabled. */
  canAdd: boolean
  /** "Smaller than the 0.5 m smallest cut", with Sell anyway. Never blocks. */
  belowMinCut: boolean
  /** Metres left when the sale wants more: "Only 1.2 m left. The count will go below zero". Null = enough. */
  short: number | null
  /** What stays on the roll when that is under the smallest cut: ask "Make it an offcut?". Null = no prompt. */
  leftover: number | null
}

/**
 * What the pad says about a length. `inSale` is what this colour already has in the sale, since
 * adding it again merges into one line.
 */
export function checkLength(p: Product, length: number, inSale = 0): LengthCheck {
  const m = Number.isFinite(length) && length > 0 ? round3(length) : 0
  const left = round3(p.stock - inSale - m)
  return {
    metres: m,
    total: Math.round(m * p.price * 100) / 100,
    canAdd: m > 0,
    belowMinCut: m > 0 && m < minCutOf(p),
    short: m > 0 && left < 0 ? Math.max(0, round3(p.stock - inSale)) : null,
    leftover: m > 0 && left > 0 && left < minCutOf(p) ? left : null,
  }
}

/** The live line on the pad: "2.3 m x R65 = R149.50". */
export const lengthLineText = (p: Product, length: number) =>
  `${metres(length)} x ${rand(p.price, { whole: Number.isInteger(p.price) })} = ${rand(Math.round(length * p.price * 100) / 100)}`

/** The prompt after Add: "0.3 m left on Navy Cotton." */
export const leftoverText = (p: Product, left: number) => `${metres(left)} left on ${p.name}.`

/**
 * Every colour of this product's material. Price per metre, smallest cut, cut step and roll length
 * belong to the material, so they are edited on all of them together ("Applies to all 6 Cotton colours").
 */
export function materialColours(s: Pick<AppState, 'products'>, p: Product): Product[] {
  if (!isByLength(p) || !p.variant) return [p]
  return s.products.filter((x) => isByLength(x) && x.family === p.family && x.variant === p.variant)
}
