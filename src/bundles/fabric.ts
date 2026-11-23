/**
 * A fabric shop. Only its categories so far: nothing picks this bundle until onboarding asks what
 * kind of shop it is, and selling by length and offcuts are still to be built.
 */
import type { Bundle } from '.'

export const fabric: Bundle = {
  key: 'fabric',
  label: 'Fabric shop',
  categories: [
    { key: 'fabric', label: 'Fabric', icon: 'text_fields' },
    { key: 'notions', label: 'Notions', icon: 'thimbles' },
  ],
  families: [],
  packs: [],
  kotaBuilds: [],
  catalogue: () => [],
  commonBrands: () => [],
  recipes: false,
}
