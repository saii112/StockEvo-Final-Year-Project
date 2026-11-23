/**
 * The fabric store bundle: its catalogue, selling by length, offcuts, its stock windows, and what
 * the SQLite store keeps of it. Spaza behaviour is covered by every other test file, unchanged.
 */
import { describe, expect, it, vi } from 'vitest'
import { bundleFor, isBusiness, SHOP_TYPES } from '../src/bundles'
import { checkLength, lengthInputOk, lengthLineText, leftoverText, materialColours, QUICK_LENGTHS } from '../src/bundles/capabilities/lengthSale'
import { findOffcutItem, offcutConfirmText, offcutsWrittenDown, OFFCUT_TEMPLATE } from '../src/bundles/capabilities/offcuts'
import { colourTemplateId, FABRIC_MATERIALS, fabricCatalogue } from '../src/bundles/fabric'
import { isValidState, makeOffcut, recordSale, setBusiness, undoOffcut, updateMaterial } from '../src/data/actions'
import { healthOf, unitQty } from '../src/data/inventory'
import { productMeta } from '../src/data/sqlitePersist'
import type { StarterSelection } from '../src/data/starterPacks'
import type { AppState, Product } from '../src/data/types'
import { createLoadShopUseCase } from '../src/backend/useCases/loadShop'
import { createSaveOffcutsUseCase, createSetBusinessUseCase } from '../src/backend/useCases/settings'
import { metres, pluralOf } from '../src/lib/format'
import { packText, restockList } from '../src/screens/Restock/restockModel'
import { addLength, addHit, emptySession, needsLength, sessionCount } from '../src/screens/Scan/scanModel'
import { addToDraft, buildTiles, draftCount, emptyDraft, shortName } from '../src/screens/Sell/sellModel'

// Hoisted above the imports by vitest.
// settings.js reads its keys from the repo module, which opens the native database
vi.mock('../src/backend/Repositories/DeviceSettingsRepo', () => ({
  SETTINGS_KEYS: { business: 'business', offcuts: 'offcuts' },
  DEFAULT_SELL_GRID: {},
}))
// sellModel formats money through the theme, which loads React Native
vi.mock('../src/theme/tokens', () => ({ money: (n: number) => `R${n}` }))

const NOW = Date.UTC(2026, 10, 23, 10)
const DAY = 86_400_000

const ALL: StarterSelection = { packs: ['fabrics', 'lining', 'haberdashery', 'trims'], kotas: [] }

function shop(products: Product[], extra: Partial<AppState> = {}): AppState {
  return {
    version: 1, business: 'fabric', products, suppliers: [], prices: [], sales: [], purchases: [], preferred: {}, budget: 0,
    profile: { ownerName: 'T', storeName: 'T', role: 'Owner', memberSince: 0 }, queue: [], lastSyncedAt: 0, onboardedAt: 0,
    ...extra,
  }
}

const catalogue = (sel: StarterSelection = ALL) => fabricCatalogue(sel)
const byId = (ps: Product[], id: string) => ps.find((p) => p.id === id)!
const navyCotton = (extra: Partial<Product> = {}) => ({ ...byId(catalogue(), colourTemplateId('Cotton', 'Navy')), ...extra })

describe('the bundle', () => {
  const fabric = bundleFor({ business: 'fabric' })

  it('has categories, packs, two-level groups, and length selling and offcuts but no recipes', () => {
    expect(fabric.categories.length).toBeGreaterThan(0)
    expect(fabric.packs.map((p) => p.key)).toEqual(['fabrics', 'lining', 'haberdashery', 'trims'])
    expect(fabric.families.every((f) => f.levels === 2)).toBe(true)
    expect([fabric.has('lengthSale'), fabric.has('offcuts'), fabric.has('recipes')]).toEqual([true, true, false])
    expect(fabric.stock).toEqual({ lowDays: 14, restockDays: 30 })
  })

  it('puts every starter item in one of its own categories', () => {
    const keys = new Set(fabric.categories.map((c) => c.key))
    expect(catalogue().every((p) => keys.has(p.category))).toBe(true)
    expect(isValidState(shop(catalogue()))).toBe(true)
  })

  it('lists Coming soon types for setup, which cannot be picked', () => {
    expect(SHOP_TYPES.map((t) => [t.key, t.status])).toEqual([
      ['spaza', 'ready'], ['fabric', 'ready'], ['clothing', 'soon'], ['accessories', 'soon'],
    ])
    expect(isBusiness('clothing')).toBe(false)
    const s = shop([], { business: undefined })
    expect(setBusiness(s, 'clothing')).toBe(s)
    expect(setBusiness(s, 'fabric').business).toBe('fabric')
    // Switching keeps products and sales
    expect(setBusiness(shop(catalogue()), 'spaza').products).toHaveLength(catalogue().length)
  })
})

describe('starter catalogue', () => {
  it('makes one product per material and colour, in metres, at stock 0 and cost unknown', () => {
    const ps = catalogue()
    const fabrics = FABRIC_MATERIALS.reduce((n, m) => n + m.colours.length, 0)
    expect(ps.filter((p) => p.soldBy === 'length')).toHaveLength(fabrics)
    const p = navyCotton()
    expect(p).toMatchObject({
      name: 'Navy Cotton', family: 'fabric', variant: 'Cotton', size: 'Navy', unit: 'm',
      price: 45, stock: 0, cost: 0, packSize: 30, packLabel: 'roll of 30', minCut: 0.5, cutStep: 0.1,
    })
    expect(byId(ps, colourTemplateId('Lace', 'White'))).toMatchObject({ family: 'trims', minCut: 0.1, packSize: 25 })
  })

  it('adds the Offcuts item with Fabrics, and not without it', () => {
    expect(findOffcutItem({ products: catalogue() })).toMatchObject({ price: 30, unit: 'piece', category: 'offcuts' })
    expect(findOffcutItem({ products: catalogue({ packs: ['haberdashery'], kotas: [] }) })).toBeUndefined()
  })

  it('takes the price and smallest cut set on a material for all its colours, added colours, and unticked ones', () => {
    const ps = catalogue({
      ...ALL,
      materials: { Cotton: { price: 55, minCut: 1 } },
      colours: { Cotton: ['Mustard'] },
      exclude: [colourTemplateId('Cotton', 'Red')],
    })
    const cotton = ps.filter((p) => p.variant === 'Cotton')
    expect(cotton.map((p) => p.size)).toEqual(['Black', 'White', 'Navy', 'Mustard'])
    expect(cotton.every((p) => p.price === 55 && p.minCut === 1)).toBe(true)
    expect(byId(ps, colourTemplateId('Denim', 'Navy')).price).toBe(110)
  })
})

describe('selling by length', () => {
  it('a 2.3 m sale takes 2.3 m off that colour and charges the exact length', () => {
    const s = shop([navyCotton({ stock: 30, price: 65 })])
    const r = recordSale(s, [{ productId: navyCotton().id, qty: 2.3 }])
    expect(r.ok).toBe(true)
    expect(r.state!.products[0].stock).toBe(27.7)
    expect(r.state!.sales[0].total).toBe(149.5)
  })

  it('the pad warns but never blocks, and offers an offcut for a short end', () => {
    const p = navyCotton({ stock: 3, price: 65 })
    expect(lengthLineText(p, 2.3)).toBe('2.3 m x R65 = R149.50')
    expect(checkLength(p, 0).canAdd).toBe(false)
    expect(checkLength(p, 0.4)).toMatchObject({ canAdd: true, belowMinCut: true })
    expect(checkLength(p, 4)).toMatchObject({ canAdd: true, short: 3 })
    expect(checkLength(p, 2.7)).toMatchObject({ leftover: 0.3, short: null })
    // 2 m of it already in the sale: only 1 m is left for this cut
    expect(checkLength(p, 1.2, 2)).toMatchObject({ short: 1 })
    expect(leftoverText(p, 0.3)).toBe('30 cm left on Navy Cotton.')
    expect(QUICK_LENGTHS).toEqual([1, 1.5, 2, 3, 5])
  })

  it('the keypad takes only as many decimals as the cut step', () => {
    const p = navyCotton()
    expect(['2', '2.', '2.3'].every((t) => lengthInputOk(t, p))).toBe(true)
    expect(lengthInputOk('2.35', p)).toBe(false)
    expect(lengthInputOk('2.35', { ...p, cutStep: 0.05 })).toBe(true)
  })

  it('shows short lengths in cm and plural metres as m', () => {
    expect([metres(0.4), metres(2.3), metres(1)]).toEqual(['40 cm', '2.3 m', '1 m'])
    expect(unitQty(navyCotton(), 0.5)).toBe('50 cm')
    expect(pluralOf('m')).toBe('m')
  })

  it('Sell shows a two-level Fabric tile, names lines "Cotton, Navy", merges lengths, and counts a length as one item', () => {
    const ps = catalogue()
    const tiles = buildTiles(ps, bundleFor({ business: 'fabric' }).families)
    expect(tiles.find((t) => t.id === 'family:fabric')).toMatchObject({ kind: 'group', label: 'Fabric', levels: 2 })
    // A spaza's groups don't pick up fabric
    expect(buildTiles(ps).some((t) => t.id === 'family:fabric')).toBe(false)
    const p = navyCotton()
    expect(shortName(p)).toBe('Cotton, Navy')
    let d = addToDraft(emptyDraft(1), { productId: p.id, price: p.price, byLength: true }, 2.3)
    d = addToDraft(d, { productId: p.id, price: p.price, byLength: true }, 1.5)
    d = addToDraft(d, { productId: 'fabric-thread', price: 12 }, 2)
    expect(d.lines[0].qty).toBe(3.8)
    expect(draftCount(d)).toBe(3)
  })

  it('a roll scanned at the counter waits for a length instead of adding 1', () => {
    const p = navyCotton()
    const hit = { product: p, pack: false }
    expect(needsLength(hit)).toBe(true)
    expect(addHit(emptySession(), hit).lines).toEqual([])
    const s = addLength(addLength(emptySession(), p, 2.3), p, 0.2)
    expect(s.lines).toEqual([expect.objectContaining({ productId: p.id, qty: 2.5, byLength: true })])
    expect(sessionCount(s)).toBe(1)
  })
})

describe('materials', () => {
  it('a price, cut or roll length set on one colour applies to every colour of that material only', () => {
    const s = shop(catalogue())
    const navy = colourTemplateId('Cotton', 'Navy')
    expect(materialColours(s, byId(s.products, navy))).toHaveLength(4)
    const next = updateMaterial(s, navy, { price: 50, rollLength: 50, minCut: 0 })
    const cotton = next.products.filter((p) => p.variant === 'Cotton')
    expect(cotton.every((p) => p.price === 50 && p.packSize === 50 && p.packLabel === 'roll of 50' && p.minCut === 0.5)).toBe(true)
    expect(byId(next.products, colourTemplateId('Denim', 'Navy')).price).toBe(110)
    expect(updateMaterial(s, navy, {})).toBe(s)
  })
})

describe('offcuts', () => {
  const fabricWithCost = navyCotton({ stock: 10, cost: 30 })

  it('moves metres off the fabric into Offcuts pieces, worth what the metres cost', () => {
    const s = shop([fabricWithCost])
    const r = makeOffcut(s, { fabricId: fabricWithCost.id, metres: 0.6 }, 'offcut-uuid', NOW)
    expect(r).toMatchObject({ ok: true, message: 'Offcut made: 60 cm off Navy Cotton.' })
    const next = r.state!
    expect(byId(next.products, fabricWithCost.id).stock).toBe(9.4)
    // A shop without the Offcuts item gets one, with the id the store gave it
    expect(byId(next.products, 'offcut-uuid')).toMatchObject({ stock: 1, price: 30, template: OFFCUT_TEMPLATE })
    expect(next.offcuts).toEqual([expect.objectContaining({ metres: 0.6, pieces: 1, value: 18, offcutId: 'offcut-uuid' })])
    expect(offcutsWrittenDown(next, NOW - DAY, NOW + DAY)).toEqual({ count: 1, metres: 0.6, value: 18 })
    expect(offcutsWrittenDown(next, NOW + 1, NOW + DAY).count).toBe(0)
  })

  it('uses the Offcuts item already there, and Undo puts everything back', () => {
    const s = shop(catalogue().map((p) => (p.id === fabricWithCost.id ? fabricWithCost : p)))
    const r = makeOffcut(s, { fabricId: fabricWithCost.id, metres: 1.2, pieces: 2 }, 'unused', NOW)
    const item = findOffcutItem(r.state!)!
    expect(item.id).toBe(OFFCUT_TEMPLATE)
    expect(item.stock).toBe(2)
    const back = undoOffcut(r.state!, r.offcut!.id)
    expect(byId(back.products, fabricWithCost.id).stock).toBe(10)
    expect(findOffcutItem(back)!.stock).toBe(0)
    expect(back.offcuts).toEqual([])
  })

  it('refuses what is not a length item, no length, or part pieces', () => {
    const s = shop(catalogue())
    expect(makeOffcut(s, { fabricId: 'fabric-thread', metres: 1 }).ok).toBe(false)
    expect(makeOffcut(s, { fabricId: fabricWithCost.id, metres: 0 }).ok).toBe(false)
    expect(makeOffcut(s, { fabricId: fabricWithCost.id, metres: 1, pieces: 1.5 }).ok).toBe(false)
    expect(offcutConfirmText(fabricWithCost, 0.6)).toBe('Takes 60 cm off Navy Cotton and adds 1 offcut.')
  })
})

describe('stock windows', () => {
  // 10 m left, selling 2 m a day over the last week
  const p = navyCotton({ stock: 10, price: 45 })
  const sales = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, at: NOW - i * DAY - 1000, lines: [{ productId: p.id, qty: 2, price: 45 }], total: 90 }))

  it('reads low under 14 days of cover for fabric, 4 for a spaza', () => {
    expect(healthOf(shop([p], { sales }), p, NOW)).toBe('low')
    expect(healthOf(shop([p], { sales, business: undefined }), p, NOW)).toBe('healthy')
  })

  it('restocks for 30 days in whole rolls', () => {
    // 2 m × 30 days − 10 m = 50 m → 2 rolls of 30 m
    const item = restockList(shop([p], { sales }), NOW).find((x) => x.product.id === p.id)!
    expect(item.packs).toBe(2)
    expect(packText(p, item.packs)).toBe('2 rolls')
  })
})

describe('what the SQLite store keeps', () => {
  it('length fields travel in product meta and loadShop reads them, the business and the offcuts back', async () => {
    const p = navyCotton({ widthCm: 150 })
    const meta = productMeta(p)
    expect(meta).toMatchObject({ soldBy: 'length', minCut: 0.5, cutStep: 0.1, widthCm: 150 })
    const offcut = { id: 'o1', at: NOW, fabricId: p.id, offcutId: 'x', metres: 0.6, pieces: 1, value: 18 }
    const empty = async () => []
    const loadShop = createLoadShopUseCase({
      shopReadRepository: {
        products: async () => [{
          id: p.id, name: p.name, unit: 'm', category: p.category, selling_price: p.price, pack_size: 30,
          quantity_on_hand: 12.5, is_composite: 0, sold_without_recipe: 0, meta: JSON.stringify(meta), created_at: new Date(NOW).toISOString(),
        }],
        recipeComponents: empty, suppliers: empty, supplierPrices: empty, sales: empty, voidedSales: empty, saleLines: empty,
        unsyncedOps: empty, lastSyncedAt: async () => null,
        settings: async () => ({ business: JSON.stringify('fabric'), offcuts: JSON.stringify([offcut]) }),
      },
      purchaseOrderRepository: { all: async () => ({ orders: [], lines: [] }) },
    })
    const loaded = await loadShop()
    expect(loaded.business).toBe('fabric')
    expect(loaded.offcuts).toEqual([offcut])
    expect(loaded.products[0]).toMatchObject({ soldBy: 'length', minCut: 0.5, cutStep: 0.1, widthCm: 150, stock: 12.5, family: 'fabric' })
  })

  it('a product sold by the piece keeps the meta it had', () => {
    expect(productMeta(byId(catalogue(), 'fabric-thread'))).not.toHaveProperty('soldBy')
  })

  it('the use cases save only well-formed values', async () => {
    const setJSON = vi.fn(async () => {})
    const repo = { deviceSettingsRepository: { setJSON } }
    expect(await createSetBusinessUseCase(repo)({ business: 'fabric' })).toMatchObject({ success: true })
    expect(await createSetBusinessUseCase(repo)({ business: 'drop table' })).toMatchObject({ success: false })
    const save = createSaveOffcutsUseCase(repo)
    const good = { id: 'o1', at: NOW, fabricId: 'f', offcutId: 'x', metres: 0.6, pieces: 1, value: 18 }
    expect(await save({ list: [good] })).toMatchObject({ success: true })
    expect(await save({ list: [{ ...good, pieces: 0 }] })).toMatchObject({ success: false })
    expect(setJSON).toHaveBeenCalledWith('business', 'fabric')
  })
})
