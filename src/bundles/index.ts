/**
 * The kind of business a shop is, as one thing the app asks questions of.
 *
 * A screen never checks "is this a spaza?". It asks the shop's bundle: which categories, which Sell
 * groups, which starter catalogue, which features are on. A new kind of business is a new file
 * here, not a branch in every screen.
 */
import type { ProductInput } from '../data/actions'
import type { KotaBuild, StarterPack, StarterSelection } from '../data/starterPacks'
import type { AppState, BusinessKey, CategoryKey, FamilyDef, Product } from '../data/types'
import type { Capability } from './capabilities'
import { fabric } from './fabric'
import { spaza } from './spaza'

export type { Capability } from './capabilities'

export type Bundle = {
  key: BusinessKey
  label: string
  /** One line on the setup tile. */
  blurb: string
  icon: string
  /** What its products sort into, in the order Home's stock health shows them. */
  categories: { key: CategoryKey; label: string; icon: string }[]
  /** Built-in Sell-grid groups with a picker of their own (bread → brand). Empty = none. */
  families: FamilyDef[]
  /** Onboarding's "what do you sell" choices. */
  packs: StarterPack[]
  /** Made-to-order items onboarding offers when their pack is picked. Empty = no such step. */
  kotaBuilds: KotaBuild[]
  /** The products a new shop starts with, from what was picked in onboarding. */
  catalogue(sel: StarterSelection): Product[]
  /** Everyday items Home offers once to a shop that has none of its groups yet. Empty = no offer. */
  commonBrands(existing: Product[]): ProductInput[]
  capabilities: ReadonlySet<Capability>
  has(c: Capability): boolean
  /**
   * Days of cover: under `lowDays` an item shows as low, and a restock buys for `restockDays`.
   * Fabric sells slowly and comes in rolls, so it looks further ahead than a spaza.
   */
  stock: { lowDays: number; restockDays: number }
}

const BUNDLES: Record<BusinessKey, Bundle> = { spaza, fabric }

/** The shop's bundle. Shops saved before there was a choice are spazas. */
export const bundleFor = (s: Pick<AppState, 'business'>): Bundle => BUNDLES[s.business ?? 'spaza'] ?? spaza

/** A business type that can be picked now. */
export const isBusiness = (key: string): key is BusinessKey => Object.prototype.hasOwnProperty.call(BUNDLES, key)

export type ShopType = { key: string; label: string; blurb: string; icon: string; status: 'ready' | 'soon' }

/** "What kind of shop is this?": every type, Coming soon ones last and not pickable. */
export const SHOP_TYPES: ShopType[] = [
  ...Object.values(BUNDLES).map(({ key, label, blurb, icon }) => ({ key, label, blurb, icon, status: 'ready' as const })),
  { key: 'clothing', label: 'Clothing', blurb: 'Clothes in sizes S to XL', icon: 'checkroom', status: 'soon' },
  { key: 'accessories', label: 'Accessories', blurb: 'Bags, jewellery, hair', icon: 'diamond', status: 'soon' },
]
