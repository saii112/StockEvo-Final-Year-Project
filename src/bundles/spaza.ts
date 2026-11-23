/** A spaza shop or kota stand: bread, cold drinks, airtime, groceries, and kotas made to order. */
import { buildStarterCatalogue, commonBrands, KOTA_BUILDS, PACKS } from '../data/starterPacks'
import { CATEGORIES, FAMILIES } from '../data/types'
import type { Bundle } from '.'
import { withCapabilities } from './capabilities'

export const spaza: Bundle = {
  key: 'spaza',
  label: 'Spaza and food',
  blurb: 'Groceries, cold drinks, airtime and kotas',
  icon: 'storefront',
  categories: CATEGORIES,
  families: FAMILIES,
  packs: PACKS,
  kotaBuilds: KOTA_BUILDS,
  catalogue: (sel) => buildStarterCatalogue(sel),
  commonBrands,
  ...withCapabilities(['recipes', 'priceOptions', 'untracked']),
  // LOW_DAYS and TARGET_DAYS in inventory.ts (not imported: inventory reads the bundle)
  stock: { lowDays: 4, restockDays: 7 },
}
