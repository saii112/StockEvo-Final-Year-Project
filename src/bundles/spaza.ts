/** A spaza shop or kota stand: bread, cold drinks, airtime, groceries, and kotas made to order. */
import { buildStarterCatalogue, commonBrands, KOTA_BUILDS, PACKS } from '../data/starterPacks'
import { CATEGORIES, FAMILIES } from '../data/types'
import type { Bundle } from '.'

export const spaza: Bundle = {
  key: 'spaza',
  label: 'Spaza shop',
  categories: CATEGORIES,
  families: FAMILIES,
  packs: PACKS,
  kotaBuilds: KOTA_BUILDS,
  catalogue: buildStarterCatalogue,
  commonBrands,
  recipes: true,
}
