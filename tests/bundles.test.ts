/**
 * The business type is one module: shops saved before the choice are spazas, and a shop's
 * bundle decides its categories.
 */
import { describe, expect, it } from 'vitest'
import { bundleFor } from '../src/bundles'
import { createSeedState } from '../src/data/seed'
import { analyticsOf } from '../src/data/analytics'

describe('bundleFor', () => {
  it('treats a shop with no business as a spaza', () => {
    const s = createSeedState()
    expect(s.business).toBeUndefined()
    expect(bundleFor(s).key).toBe('spaza')
    expect(bundleFor(s).has('recipes')).toBe(true)
  })

  it('shows stock health in the bundle’s own categories', () => {
    const spaza = createSeedState()
    const fabric = { ...spaza, business: 'fabric' as const }
    expect(analyticsOf(spaza).categories.length).toBeGreaterThan(0)
    // None of the demo spaza products are in a fabric category
    expect(analyticsOf(fabric).categories).toEqual([])
  })
})
