/**
 * Barcode scanning rules, tested with real South African retail codes (from Open Food Facts,
 * Nov 2026) so the check-digit and reader-format rules are proven on codes a spaza really stocks.
 */
import { describe, expect, it, vi } from 'vitest'
import { dismissUnlinkedBarcode, linkBarcode, noteUnlinkedBarcode, removeBarcode, UNLINKED_BARCODES_MAX } from '../src/data/actions'
import { barcodeIndex, BAD_CHECK_MESSAGE, normalizeBarcode, NOT_NUMBERS_MESSAGE, WRONG_LENGTH_MESSAGE } from '../src/data/barcodes'
import { productMeta } from '../src/data/sqlitePersist'
import { QUICK_AMOUNT_ID, type AppState, type Product } from '../src/data/types'
import { createLoadShopUseCase } from '../src/backend/useCases/loadShop'
import { createSaveUnlinkedBarcodesUseCase } from '../src/backend/useCases/settings'
import { addToDraft, emptyDraft } from '../src/screens/Sell/sellModel'
import {
  addHit, addUnlinked, emptySession, isScannerInput, offRestockList, onYourList, readScan, receiveScan,
  sessionCount, sessionToDraft, sessionTotal, setLineQty, stockSavedMessage, type LastRead,
} from '../src/screens/Scan/scanModel'

// Hoisted above the imports by vitest.
// settings.js reads its keys from the repo module, which opens the native database
vi.mock('../src/backend/Repositories/DeviceSettingsRepo', () => ({
  SETTINGS_KEYS: { unlinkedBarcodes: 'unlinkedBarcodes' },
  DEFAULT_SELL_GRID: {},
}))
// sellModel formats money through the theme, which loads React Native
vi.mock('../src/theme/tokens', () => ({ money: (n: number) => `R${n}` }))

const REAL = {
  coke2l: '5449000009067', // Coca-Cola 2L
  nola: '6001069020446', // Nola mayonnaise 750 g
  weetbix: '6001052001049', // Bokomo Weet-Bix 900 g
  castleLite: '11176723', // Castle Lite (EAN-8)
  bovril: '60050151', // Bovril 125 g (EAN-8, South African 600 prefix)
  prime: '0810116121045', // PRIME (a UPC-A, written as EAN-13)
}

const NOW = Date.UTC(2026, 10, 23, 10)

/** A valid EAN-8 from 7 digits. */
function ean8(body: string) {
  let sum = 0
  for (let i = body.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += Number(body[i]) * w
  return body + ((10 - (sum % 10)) % 10)
}

function shop(products: Product[], extra: Partial<AppState> = {}): AppState {
  return {
    version: 1, products, suppliers: [], prices: [], sales: [], purchases: [], preferred: {}, budget: 0,
    profile: { ownerName: 'T', storeName: 'T', role: 'Owner', memberSince: 0 }, queue: [], lastSyncedAt: 0, onboardedAt: 0,
    ...extra,
  }
}

const item = (id: string, extra: Partial<Product> = {}): Product => ({
  id, name: id, detail: '', category: 'beverages', icon: 'local_bar', sellable: true, price: 25, cost: 18,
  unit: 'bottle', unitPlural: 'bottles', stock: 10, packSize: 6, packLabel: 'pack of 6', ...extra,
})

describe('normalizeBarcode', () => {
  it('accepts real EAN-13 and EAN-8 codes as they are', () => {
    for (const c of Object.values(REAL)) expect(normalizeBarcode(c)).toEqual({ ok: true, code: c })
  })

  it('stores a UPC-A the same however it was read: Android 12 digits, iOS 13, a handheld with spaces', () => {
    const want = { ok: true, code: REAL.prime }
    expect(normalizeBarcode('810116121045')).toEqual(want)
    expect(normalizeBarcode(REAL.prime)).toEqual(want)
    expect(normalizeBarcode(' 8 101161 21045\n')).toEqual(want)
  })

  it('reads a carton GTIN-14 starting with 0 as the EAN-13 inside it', () => {
    expect(normalizeBarcode(`0${REAL.coke2l}`)).toEqual({ ok: true, code: REAL.coke2l })
  })

  it('accepts UPC-E by its own check digit', () => {
    expect(normalizeBarcode('01234565')).toEqual({ ok: true, code: '01234565' })
  })

  it('refuses a typo, letters and wrong lengths with a reason', () => {
    expect(normalizeBarcode('6001069020447')).toEqual({ ok: false, message: BAD_CHECK_MESSAGE })
    // A real entry in Open Food Facts with a wrong check digit
    expect(normalizeBarcode('300120400888')).toEqual({ ok: false, message: BAD_CHECK_MESSAGE })
    expect(normalizeBarcode('https://qr.example')).toEqual({ ok: false, message: NOT_NUMBERS_MESSAGE })
    expect(normalizeBarcode('12345')).toEqual({ ok: false, message: WRONG_LENGTH_MESSAGE })
  })
})

describe('linking codes to products', () => {
  const coke = item('coke-2l', { name: 'Coke 2L' })
  const coke15 = item('coke-1-5l', { name: 'Coke 1.5L' })

  it('saves a code, single or pack, and finds it', () => {
    const r = linkBarcode(shop([coke]), coke.id, REAL.coke2l, false)
    expect(r).toMatchObject({ ok: true, message: 'Barcode saved on Coke 2L.' })
    // The same code from a carton (GTIN-14) only switches it to pack
    const s = linkBarcode(r.state!, coke.id, `0${REAL.coke2l}`, true).state!
    expect(s.products[0].barcodes).toEqual([{ code: REAL.coke2l, pack: true }])
    expect(barcodeIndex(s.products).get(REAL.coke2l)).toMatchObject({ product: { id: coke.id }, pack: true })
  })

  it('moves a code that is on another product, so one code is on one product', () => {
    const s = linkBarcode(shop([coke, coke15]), coke.id, REAL.coke2l, false).state!
    const r = linkBarcode(s, coke15.id, REAL.coke2l, false)
    expect(r.message).toBe('Barcode moved from Coke 2L to Coke 1.5L.')
    expect(r.state!.products[0].barcodes).toBeUndefined()
    expect(r.state!.products[1].barcodes).toEqual([{ code: REAL.coke2l, pack: false }])
  })

  it('refuses a bad code or a missing product, and changes nothing', () => {
    const s = shop([coke])
    expect(linkBarcode(s, coke.id, '6001069020447', false)).toEqual({ ok: false, message: BAD_CHECK_MESSAGE })
    expect(linkBarcode(s, 'gone', REAL.nola, false).ok).toBe(false)
  })

  it('takes a code off, and the field goes with the last one', () => {
    const s = linkBarcode(shop([coke]), coke.id, REAL.coke2l, false).state!
    expect(removeBarcode(s, coke.id, REAL.coke2l).products[0]).not.toHaveProperty('barcodes')
    expect(removeBarcode(s, coke.id, REAL.nola)).toBe(s)
  })

  it('keeps several codes on one product: single and pack', () => {
    let s = linkBarcode(shop([coke]), coke.id, REAL.coke2l, false).state!
    s = linkBarcode(s, coke.id, REAL.weetbix, true).state!
    expect(s.products[0].barcodes).toHaveLength(2)
  })
})

describe('unlinked barcodes', () => {
  const coke = item('coke-2l')

  it('keeps codes sold without a product, newest first, until linked or dismissed', () => {
    let s = noteUnlinkedBarcode(shop([coke]), REAL.nola, 1)
    s = noteUnlinkedBarcode(s, REAL.weetbix, 2)
    s = noteUnlinkedBarcode(s, REAL.nola, 3)
    expect(s.unlinkedBarcodes).toEqual([{ code: REAL.nola, at: 3 }, { code: REAL.weetbix, at: 2 }])
    s = linkBarcode(s, coke.id, REAL.nola, false).state!
    expect(s.unlinkedBarcodes).toEqual([{ code: REAL.weetbix, at: 2 }])
    expect(dismissUnlinkedBarcode(s, REAL.weetbix).unlinkedBarcodes).toEqual([])
  })

  it('ignores a code that is already linked, and caps the list', () => {
    const s = linkBarcode(shop([coke]), coke.id, REAL.coke2l, false).state!
    expect(noteUnlinkedBarcode(s, REAL.coke2l)).toBe(s)
    let big = shop([])
    for (let i = 0; i < UNLINKED_BARCODES_MAX + 5; i++) big = noteUnlinkedBarcode(big, ean8(String(6000000 + i)), i)
    expect(big.unlinkedBarcodes).toHaveLength(UNLINKED_BARCODES_MAX)
    expect(big.unlinkedBarcodes![0].at).toBe(UNLINKED_BARCODES_MAX + 4)
  })
})

describe('reading scans', () => {
  const coke = item('coke-2l', { barcodes: [{ code: REAL.coke2l, pack: false }] })
  const index = barcodeIndex([coke])

  it('counts a held can once, and again after it was taken away for 1.5 s', () => {
    let last: LastRead | null = null
    const reads = [0, 200, 900, 1600, 3200].map((t) => {
      const r = readScan(REAL.coke2l, index, last, t)
      last = r.last
      return r.read.kind
    })
    // Every read within 1.5 s of the one before is the same can, even 1.6 s after the first
    expect(reads).toEqual(['known', 'repeat', 'repeat', 'repeat', 'known'])
  })

  it('tells known, unknown and not-a-barcode apart', () => {
    expect(readScan(REAL.coke2l, index, null).read).toMatchObject({ kind: 'known', hit: { product: { id: coke.id } } })
    expect(readScan(REAL.nola, index, null).read).toEqual({ kind: 'unknown', code: REAL.nola })
    expect(readScan('abc', index, null).read.kind).toBe('invalid')
  })

  it('tells a handheld scanner from a person typing', () => {
    expect(isScannerInput(REAL.coke2l, 0, 120)).toBe(true)
    expect(isScannerInput(REAL.coke2l, 0, 4000)).toBe(false)
    expect(isScannerInput('12', 0, 5)).toBe(false)
  })
})

describe('scan to sell', () => {
  const coke = item('coke-2l', { price: 25, packSize: 6 })
  const nola = item('nola', { price: 40, packSize: 1 })
  const products = new Map([coke, nola].map((p) => [p.id, p]))

  it('adds one per scan, a pack for a pack code, newest first', () => {
    let s = addHit(emptySession(), { product: coke, pack: false })
    s = addHit(s, { product: nola, pack: false })
    s = addHit(s, { product: coke, pack: true })
    expect(s.lines.map((l) => [l.productId, l.qty])).toEqual([['coke-2l', 7], ['nola', 1]])
    expect(sessionCount(s)).toBe(8)
    expect(sessionTotal(s, products)).toBe(7 * 25 + 40)
  })

  it('minus to zero removes a row', () => {
    const s = setLineQty(addHit(emptySession(), { product: nola, pack: false }), 'nola', 0)
    expect(s.lines).toEqual([])
  })

  it('Complete merges into the sale already tapped in, with sell-without-saving lines as quick amounts', () => {
    const tapped = addToDraft(emptyDraft(1), { productId: coke.id, price: 25 }, 2)
    let s = addHit(emptySession(), { product: coke, pack: false })
    s = addUnlinked(s, REAL.weetbix, 55)
    const d = sessionToDraft(tapped, s, products)
    expect(d.lines).toEqual([
      expect.objectContaining({ productId: coke.id, qty: 3, price: 25 }),
      expect.objectContaining({ productId: QUICK_AMOUNT_ID, qty: 1, price: 55, label: 'Scanned item', counterPriced: true }),
    ])
  })
})

describe('scan to receive', () => {
  const crate = item('coke', { packSize: 24, packLabel: 'crate of 24' })

  it('a pack code adds a pack; a single code switches to loose and keeps what was counted', () => {
    expect(receiveScan({ steps: 2, loose: false }, crate, true)).toEqual({ steps: 3, loose: false })
    expect(receiveScan({ steps: 2, loose: false }, crate, false)).toEqual({ steps: 49, loose: true })
    expect(receiveScan({ steps: 49, loose: true }, crate, true)).toEqual({ steps: 73, loose: true })
    expect(receiveScan({ steps: 0, loose: false }, item('one', { packSize: 1 }), true)).toEqual({ steps: 1, loose: false })
  })

  it('shows what is on the Restock list, and how many items the save takes off it', () => {
    const out = item('coke', { stock: 0, packSize: 24, packLabel: 'crate of 24' })
    const low = item('fanta', { stock: 0, packSize: 24, packLabel: 'crate of 24' })
    const fine = item('sprite', { stock: 500 })
    const s = shop([out, low, fine], { sales: [{ id: 'x', at: NOW - 1000, lines: [], total: 0 }] })
    expect(onYourList(s, NOW).get('coke')).toBe('1 crate')
    expect(onYourList(s, NOW).has('sprite')).toBe(false)
    expect(offRestockList(s, [{ productId: 'coke', qty: 24 }, { productId: 'sprite', qty: 6 }], NOW)).toBe(1)
    expect(stockSavedMessage(1)).toBe('Stock saved. 1 item off your restock list.')
    expect(stockSavedMessage(0)).toBe('Stock saved.')
  })
})

describe('storage: what the current database setup keeps', () => {
  const linked = linkBarcode(shop([item('coke-2l')]), 'coke-2l', REAL.coke2l, true).state!.products[0]

  it('travels in product meta, and loadShop reads it back from the SQLite row', async () => {
    const meta = productMeta(linked)
    expect(meta.barcodes).toEqual([{ code: REAL.coke2l, pack: true }])
    const row = {
      id: linked.id, name: linked.name, unit: linked.unit, category: linked.category, selling_price: linked.price,
      pack_size: linked.packSize, quantity_on_hand: linked.stock, is_composite: 0, sold_without_recipe: 0,
      // SQLite keeps meta as JSON text; Supabase gets the same object as jsonb
      meta: JSON.stringify(meta), created_at: new Date(NOW).toISOString(),
    }
    const empty = async () => []
    const loadShop = createLoadShopUseCase({
      shopReadRepository: {
        products: async () => [row], recipeComponents: empty, suppliers: empty, supplierPrices: empty, sales: empty,
        voidedSales: empty, saleLines: empty, unsyncedOps: empty, lastSyncedAt: async () => null,
        settings: async () => ({ unlinkedBarcodes: JSON.stringify([{ code: REAL.nola, at: NOW }]) }),
      },
      purchaseOrderRepository: { all: async () => ({ orders: [], lines: [] }) },
    })
    const loaded = await loadShop()
    expect(loaded.products[0].barcodes).toEqual([{ code: REAL.coke2l, pack: true }])
    expect(loaded.unlinkedBarcodes).toEqual([{ code: REAL.nola, at: NOW }])
  })

  it('a product with no codes keeps the meta it had before barcodes existed', () => {
    expect(productMeta(item('plain'))).not.toHaveProperty('barcodes')
  })

  it('the unlinked list use case saves only well-formed codes', async () => {
    const setJSON = vi.fn(async () => {})
    const save = createSaveUnlinkedBarcodesUseCase({ deviceSettingsRepository: { setJSON } })
    expect(await save({ list: [{ code: REAL.nola, at: NOW }] })).toMatchObject({ success: true })
    expect(setJSON).toHaveBeenCalledWith('unlinkedBarcodes', [{ code: REAL.nola, at: NOW }])
    expect(await save({ list: [{ code: 'drop table', at: NOW }] })).toMatchObject({ success: false })
    expect(await save({})).toMatchObject({ success: false })
  })
})
