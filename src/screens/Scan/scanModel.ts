/**
 * Barcode scanning at the counter and in Stock came in, worked out with no React in it.
 *
 * Camera and handheld codes both go through `readScan`, so they behave the same everywhere.
 */
import { normalizeBarcode, type BarcodeHit } from '../../data/barcodes'
import { available, pricesFor, supplierName } from '../../data/inventory'
import { QUICK_AMOUNT_ID, type AppState, type Product } from '../../data/types'
import { addToDraft, type Draft } from '../Sell/sellModel'
import { packText, restockList } from '../Restock/restockModel'

/** The camera reads a held can many times a second: the same code again this soon is the same can. */
export const SAME_CODE_IGNORE_MS = 1500

/**
 * Barcode types to hand expo-camera (`barcodeScannerSettings.barcodeTypes`). Retail codes only:
 * fewer types is faster, and a QR code on a poster can't land in a sale.
 */
export const RETAIL_BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const

export type LastRead = { code: string; at: number }

export type ScanRead =
  | { kind: 'known'; code: string; hit: BarcodeHit }
  | { kind: 'unknown'; code: string }
  /** Same code still in front of the camera: do nothing, not even a beep. */
  | { kind: 'repeat' }
  /** Not a retail code (only from a handheld or typing; the camera is limited to retail types). */
  | { kind: 'invalid'; message: string }

/**
 * What one read is, and the `last` to keep for the next one. `last.at` moves on every read of the
 * same code, so a can held for five seconds counts once; take it away for 1.5 s to scan another.
 */
export function readScan(
  raw: string,
  index: Map<string, BarcodeHit>,
  last: LastRead | null,
  now = Date.now(),
): { read: ScanRead; last: LastRead | null } {
  const check = normalizeBarcode(raw)
  if (!check.ok) return { read: { kind: 'invalid', message: check.message }, last }
  const { code } = check
  const next = { code, at: now }
  if (last && last.code === code && now - last.at < SAME_CODE_IGNORE_MS) return { read: { kind: 'repeat' }, last: next }
  const hit = index.get(code)
  return { read: hit ? { kind: 'known', code, hit } : { kind: 'unknown', code }, last: next }
}

// ---------------------------------------------------------------------------
// Scan to sell
// ---------------------------------------------------------------------------

/**
 * One row of the running list. A product row is keyed by its id; a "Sell without saving" row by
 * its code, and carries the price typed on the quick amount keypad.
 */
export type ScanLine = { key: string; productId: string; qty: number; price?: number; label?: string; byLength?: boolean }

/** Newest first, as the list shows it. */
export type ScanSession = { lines: ScanLine[]; last: LastRead | null }

export const emptySession = (): ScanSession => ({ lines: [], last: null })

const toTop = (lines: ScanLine[], line: ScanLine) => [line, ...lines.filter((l) => l.key !== line.key)]

/**
 * A fabric roll's code: pause scanning and open the length pad for that colour, then addLength.
 * addHit leaves such a code alone, since a roll scanned is not "1 m".
 */
export const needsLength = (hit: BarcodeHit) => hit.product.soldBy === 'length'

/** The length pad's Add, from a scan: metres on that colour's line (merging, like tapping it twice). */
export function addLength(session: ScanSession, product: Product, metres: number): ScanSession {
  if (!(metres > 0)) return session
  const had = session.lines.find((l) => l.key === product.id)
  const qty = Math.round(((had?.qty ?? 0) + metres) * 1000) / 1000
  return { ...session, lines: toTop(session.lines, { key: product.id, productId: product.id, qty, byLength: true }) }
}

/** A known code: one unit, or a pack's worth for a pack code (a 6-pack adds 6). */
export function addHit(session: ScanSession, hit: BarcodeHit): ScanSession {
  if (needsLength(hit)) return session
  const add = hit.pack ? Math.max(1, hit.product.packSize) : 1
  const had = session.lines.find((l) => l.key === hit.product.id)
  return {
    ...session,
    lines: toTop(session.lines, { key: hit.product.id, productId: hit.product.id, qty: (had?.qty ?? 0) + add }),
  }
}

/** "Sell without saving": the code sold as a quick amount line at the price the owner typed. */
export function addUnlinked(session: ScanSession, code: string, price: number, label = 'Scanned item'): ScanSession {
  if (!(price > 0)) return session
  const key = `code:${code}:${price}`
  const had = session.lines.find((l) => l.key === key)
  return { ...session, lines: toTop(session.lines, { key, productId: QUICK_AMOUNT_ID, price, label, qty: (had?.qty ?? 0) + 1 }) }
}

/** The minus and plus buttons, or a swipe (qty 0). Zero or less removes the row. */
export function setLineQty(session: ScanSession, key: string, qty: number): ScanSession {
  const lines = qty > 0 ? session.lines.map((l) => (l.key === key ? { ...l, qty } : l)) : session.lines.filter((l) => l.key !== key)
  return { ...session, lines }
}

const linePrice = (l: ScanLine, products: Map<string, Product>) => l.price ?? products.get(l.productId)?.price ?? 0

export const lineTotal = (l: ScanLine, products: Map<string, Product>) => Math.round(l.qty * linePrice(l, products) * 100) / 100
export const sessionTotal = (s: ScanSession, products: Map<string, Product>) =>
  Math.round(s.lines.reduce((t, l) => t + l.qty * linePrice(l, products), 0) * 100) / 100
/** For the footer, and "Keep these 5 items in the sale?" on close. */
export const sessionCount = (s: ScanSession) => s.lines.reduce((n, l) => n + (l.byLength ? 1 : l.qty), 0)

/**
 * Complete: every scanned line into the sale on Sell, oldest scan first, merging with what was
 * already tapped in. The pay sheet then records it exactly as a tapped sale.
 */
export function sessionToDraft(d: Draft, session: ScanSession, products: Map<string, Product>): Draft {
  let out = d
  for (const l of [...session.lines].reverse()) {
    const item =
      l.productId === QUICK_AMOUNT_ID
        ? { productId: QUICK_AMOUNT_ID, price: l.price ?? 0, label: l.label, counterPriced: true }
        : { productId: l.productId, price: products.get(l.productId)?.price ?? 0, ...(l.byLength ? { byLength: true } : {}) }
    out = addToDraft(out, item, l.qty)
  }
  return out
}

// ---------------------------------------------------------------------------
// Scan to receive (Stock came in)
// ---------------------------------------------------------------------------

/** One Stock came in row: `steps` on the stepper, counted in packs, or in units once `loose`. */
export type ReceiveRow = { steps: number; loose: boolean }

/**
 * A scan on a Stock came in row. A pack code adds a pack (in units if the row is already loose);
 * a single code switches the row to loose, turning the packs already counted into units, and adds one.
 */
export function receiveScan(row: ReceiveRow, product: Product, pack: boolean): ReceiveRow {
  const size = Math.max(1, product.packSize)
  // Bought one at a time: there is no loose switch on the row
  if (size === 1) return { steps: row.steps + 1, loose: row.loose }
  if (pack) return row.loose ? { steps: row.steps + size, loose: true } : { steps: row.steps + 1, loose: false }
  return { steps: (row.loose ? row.steps : row.steps * size) + 1, loose: true }
}

/** "On your list: 2 crates": what the Restock list still suggests buying, by product id. */
export function onYourList(s: AppState, now = Date.now()): Map<string, string> {
  return new Map(restockList(s, now).map((it) => [it.product.id, packText(it.product, it.packs)]))
}

/**
 * How many items the stock about to be saved takes off the Restock list, worked out before saving
 * (so the screen needs no "after" state). Items that only drop to a smaller amount don't count.
 */
export function offRestockList(s: AppState, received: { productId: string; qty: number }[], now = Date.now()): number {
  const before = restockList(s, now)
  if (!before.length) return 0
  const add = new Map<string, number>()
  for (const r of received) add.set(r.productId, (add.get(r.productId) ?? 0) + r.qty)
  const after = new Set(
    restockList({ ...s, products: s.products.map((p) => (add.has(p.id) ? { ...p, stock: p.stock + add.get(p.id)! } : p)) }, now).map(
      (it) => it.product.id,
    ),
  )
  return before.filter((it) => add.has(it.product.id) && !after.has(it.product.id)).length
}

/** The toast after saving: "Stock saved. 4 items off your restock list." */
export const stockSavedMessage = (off: number) =>
  off === 0 ? 'Stock saved.' : `Stock saved. ${off} ${off === 1 ? 'item' : 'items'} off your restock list.`

// ---------------------------------------------------------------------------
// Product info on scan
// ---------------------------------------------------------------------------

export type ScanInfo = {
  stock: number
  price: number
  cost: number
  /** Per item sold: price − average cost. */
  profit: number
  /** The preferred supplier, or the cheapest saved one when none is chosen. */
  supplier: { name: string; price: number; at: number } | null
}

/** The info card from a scan list row. Only data the app already has. */
export function scanInfo(s: AppState, p: Product): ScanInfo {
  const prices = pricesFor(s, p.id)
  const sp = prices.find((x) => x.supplierId === s.preferred[p.id]) ?? prices[0]
  return {
    stock: available(s, p),
    price: p.price,
    cost: p.cost,
    profit: Math.round((p.price - p.cost) * 100) / 100,
    supplier: sp ? { name: supplierName(s, sp.supplierId), price: sp.unitPrice, at: sp.updatedAt } : null,
  }
}

// ---------------------------------------------------------------------------
// Handheld scanner
// ---------------------------------------------------------------------------

/** Scanners type a code in well under this per character; people don't. */
export const HANDHELD_MAX_MS_PER_CHAR = 50

/**
 * Whether text submitted with Enter into the hidden input came from a scanner: fast, and long
 * enough to be a code. `firstKeyAt` is when its first character arrived.
 */
export const isScannerInput = (text: string, firstKeyAt: number, submittedAt: number) =>
  text.trim().length >= 8 && submittedAt - firstKeyAt <= text.trim().length * HANDHELD_MAX_MS_PER_CHAR
