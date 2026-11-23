/**
 * Features a bundle switches on for the whole shop. Kept apart from src/bundles/index.ts, which
 * imports every bundle: the bundles call withCapabilities while that file is still loading them.
 */
export type Capability =
  /** Composite items, menu groups, kitchen questions, portions: the Menu tab. */
  | 'recipes'
  /** An amount picked at the counter (airtime). */
  | 'priceOptions'
  /** Sold but never counted (vouchers). */
  | 'untracked'
  /** Cut to any length and sold by the metre: the length pad (./lengthSale.ts). */
  | 'lengthSale'
  /** "Make offcut" and the Offcuts item (./offcuts.ts). */
  | 'offcuts'

/** A bundle's capability set and its `has`. */
export const withCapabilities = (caps: Capability[]) => {
  const capabilities: ReadonlySet<Capability> = new Set(caps)
  return { capabilities, has: (c: Capability) => capabilities.has(c) }
}
