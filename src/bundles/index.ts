/**
 * The kind of business a shop is, as one thing the app asks questions of.
 *
 * A screen never checks "is this a spaza?". It asks the shop's bundle: which categories, which Sell
 * groups, which starter catalogue, whether there is a menu of food made from ingredients. A new kind
 * of business is a new file here, not a branch in every screen.
 */
import type { ProductInput } from '../data/actions'
import type { KotaBuild, StarterPack, StarterSelection } from '../data/starterPacks'
import type { AppState, BusinessKey, CategoryKey, Family, Product } from '../data/types'
import { fabric } from './fabric'
import { spaza } from './spaza'

export type Bundle = {
  key: BusinessKey
  label: string
  /** What its products sort into, in the order Home's stock health shows them. */
  categories: { key: CategoryKey; label: string; icon: string }[]
  /** Built-in Sell-grid groups with a picker of their own (bread → brand). Empty = none. */
  families: { key: Family; label: string; icon: string }[]
  /** Onboarding's "what do you sell" choices. */
  packs: StarterPack[]
  /** Made-to-order items onboarding offers when their pack is picked. Empty = no such step. */
  kotaBuilds: KotaBuild[]
  /** The products a new shop starts with, from what was picked in onboarding. */
  catalogue(sel: StarterSelection): Product[]
  /** Everyday items Home offers once to a shop that has none of its groups yet. Empty = no offer. */
  commonBrands(existing: Product[]): ProductInput[]
  /** Food made from ingredients, whose recipes take them off stock: the Menu. */
  recipes: boolean
}

const BUNDLES: Record<BusinessKey, Bundle> = { spaza, fabric }

/** The shop's bundle. Shops saved before there was a choice are spazas. */
export const bundleFor = (s: Pick<AppState, 'business'>): Bundle => BUNDLES[s.business ?? 'spaza'] ?? spaza
