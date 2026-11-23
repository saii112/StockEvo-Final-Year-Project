/**
 * Offcuts: short ends moved out of a fabric's metres into one flat-price Offcuts item. Any bundle
 * with the `offcuts` capability uses this. The state change itself is makeOffcut in actions.ts.
 */
import { metres } from '../../lib/format'
import type { AppState, Product } from '../../data/types'
import type { Template } from '../../data/starterPacks'

/** How the Offcuts item is found, whatever id the store gave it. */
export const OFFCUT_TEMPLATE = 'fabric-offcut'

/** The Offcuts item: sold by the piece at one price (R30 until the owner changes it), counted in pieces. */
export const OFFCUT_ITEM: Template = {
  id: OFFCUT_TEMPLATE,
  name: 'Offcut piece',
  detail: 'Short ends, one price each',
  category: 'offcuts',
  icon: 'content_cut',
  price: 30,
  unit: 'piece',
  unitPlural: 'pieces',
  packSize: 1,
  packLabel: 'single piece',
}

/** A new Offcuts item, for a shop whose catalogue doesn't have one yet. */
export const offcutProduct = (id: string): Product => ({
  ...OFFCUT_ITEM,
  id,
  icon: OFFCUT_ITEM.icon!,
  sellable: true,
  cost: 0,
  stock: 0,
  template: OFFCUT_TEMPLATE,
})

export const findOffcutItem = (s: Pick<AppState, 'products'>) => s.products.find((p) => p.template === OFFCUT_TEMPLATE)

/** The sheet's confirm line: "Takes 0.6 m off Navy Cotton and adds 1 offcut." */
export const offcutConfirmText = (fabric: Product, length: number, pieces = 1) =>
  `Takes ${metres(length)} off ${fabric.name} and adds ${pieces} ${pieces === 1 ? 'offcut' : 'offcuts'}.`

/**
 * Profit's "Offcuts written down: R84": what the metres moved into offcuts had cost, in [from, to).
 * Without it a fabric's earnings look better than they are: those metres left stock unsold.
 */
export function offcutsWrittenDown(s: Pick<AppState, 'offcuts'>, from: number, to: number) {
  const made = (s.offcuts ?? []).filter((o) => o.at >= from && o.at < to)
  return {
    count: made.reduce((n, o) => n + o.pieces, 0),
    metres: Math.round(made.reduce((t, o) => t + o.metres, 0) * 1000) / 1000,
    value: Math.round(made.reduce((t, o) => t + o.value, 0) * 100) / 100,
  }
}
