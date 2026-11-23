import type { AppState, Product, SupplierPrice } from './types'
import { metres, qty as fmtQty, rand } from '../lib/format'
import { bundleFor } from '../bundles'

export const DAY = 86_400_000
/** BR3 thresholds (days of stock left). LOW_DAYS and TARGET_DAYS are a spaza's; a shop reads its own from bundleFor(s).stock. */
export const CRITICAL_DAYS = 1
export const LOW_DAYS = 4
/** Restock plans aim to cover this many days of usage. */
export const TARGET_DAYS = 7
const USAGE_WINDOW_DAYS = 7

export type Health = 'setup' | 'out' | 'critical' | 'low' | 'healthy'

export const productById = (s: AppState, id: string) => s.products.find((p) => p.id === id)
/** Things with a count on the shelf: not composites (derived) and not untracked (airtime). */
export const stockItems = (s: AppState) => s.products.filter((p) => !p.composite && !p.untracked)

/** No product to sell yet (a shop that skipped setup): Home says "Add what you sell". */
export const nothingToSell = (s: AppState) => !s.products.some((p) => p.sellable)

/** Quantity with unit, showing small kg amounts in grams ("50 g"). */
export function unitQty(p: Product, n: number) {
  if (p.unit === 'kg' && n < 1) return `${Math.round(n * 1000)} g`
  if (p.unit === 'm') return metres(n)
  return `${fmtQty(n)} ${n === 1 ? p.unit : p.unitPlural}`
}

/**
 * What a recipe costs to make, from what its ingredients cost. A cost of 0 means
 * unknown, so one unknown ingredient makes the whole recipe unknown (0): adding
 * up only the known ones would look like a real cost and overstate the profit.
 */
export function recipeCost(recipe: { productId: string; qty: number }[], costOf: (productId: string) => number | undefined): number {
  if (!recipe.length) return 0
  let sum = 0
  for (const l of recipe) {
    const c = costOf(l.productId)
    if (!(c !== undefined && c > 0)) return 0
    sum += c * l.qty
  }
  return Math.round(sum * 100) / 100
}

/** BR1: deduction = sold quantity x quantity required, per recipe component. */
export function deductionsFor(s: AppState, lines: { productId: string; qty: number }[]) {
  const out = new Map<string, number>()
  for (const l of lines) {
    const p = productById(s, l.productId)
    // No product (the quick-amount line) or nothing to count (airtime)
    if (!p || p.untracked) continue
    if (p.composite) {
      for (const r of p.recipe ?? []) out.set(r.productId, (out.get(r.productId) ?? 0) + r.qty * l.qty)
    } else {
      out.set(p.id, (out.get(p.id) ?? 0) + l.qty)
    }
  }
  return out
}

/** How many of a product can be sold right now (composites are limited by their scarcest ingredient). */
export function available(s: AppState, p: Product): number {
  if (!p.composite) return p.stock
  if (!p.recipe?.length) return 0
  return Math.min(
    ...p.recipe.map((r) => {
      const c = productById(s, r.productId)
      return c ? Math.floor(c.stock / r.qty + 1e-9) : 0
    }),
  )
}

/** Average daily usage over the last week, including ingredient usage from composite sales. */
export function dailyUsage(s: AppState, productId: string, now = Date.now()) {
  const since = now - USAGE_WINDOW_DAYS * DAY
  let used = 0
  for (const sale of s.sales) {
    if (sale.at < since) continue
    for (const [id, n] of deductionsFor(s, sale.lines)) if (id === productId) used += n
    for (const l of sale.lines) if (l.productId === productId && productById(s, productId)?.composite) used += l.qty
  }
  return used / USAGE_WINDOW_DAYS
}

export function daysCover(s: AppState, p: Product, now = Date.now()) {
  const use = dailyUsage(s, p.id, now)
  return use > 0 ? available(s, p) / use : Infinity
}

/**
 * True while the shop has never counted its stock.
 *
 * A freshly seeded catalogue is every product at zero, which `healthOf` reads
 * as "out of stock" — correct in isolation, useless in aggregate: the owner
 * would open the Dashboard to forty alerts on their first morning and learn to
 * ignore all of them. While this is true the Dashboard hides the alerts and
 * asks for a count instead.
 *
 * Having sold anything ends it for good, even if the shop later runs the shelf
 * down to nothing: at that point the alerts are real and worth having.
 */
export const stockUncounted = (s: AppState) =>
  s.sales.length === 0 && stockItems(s).length > 0 && stockItems(s).every((p) => p.stock <= 0)

export function healthOf(s: AppState, p: Product, now = Date.now()): Health {
  // Airtime and the like never run low in any sense the app can measure
  if (p.untracked) return 'healthy'
  if (p.composite && !p.recipe?.length) return 'setup'
  if (available(s, p) <= 0) return 'out'
  const cover = daysCover(s, p, now)
  if (cover < CRITICAL_DAYS) return 'critical'
  if (cover < bundleFor(s).stock.lowDays) return 'low'
  return 'healthy'
}

export const needsAction = (h: Health) => h !== 'healthy'

export function coverLabel(s: AppState, p: Product, now = Date.now()) {
  if (p.composite && !p.recipe?.length) return 'Recipe missing'
  if (available(s, p) <= 0) return 'None left'
  const c = daysCover(s, p, now)
  if (!Number.isFinite(c)) return 'No recent sales'
  if (c < 1) return `About ${Math.max(1, Math.round(c * 24))} h left`
  return `About ${Math.round(c)} ${Math.round(c) === 1 ? 'day' : 'days'} left`
}

export function pricesFor(s: AppState, productId: string): SupplierPrice[] {
  return s.prices.filter((x) => x.productId === productId).sort((a, b) => a.unitPrice - b.unitPrice)
}

export const supplierName = (s: AppState, id: string) => s.suppliers.find((x) => x.id === id)?.name ?? 'Unknown supplier'

export function salesSince(s: AppState, since: number) {
  return s.sales.filter((x) => x.at >= since)
}

export function startOfToday(now = Date.now()) {
  return new Date(now).setHours(0, 0, 0, 0)
}

export function dashboardKpis(s: AppState, now = Date.now()) {
  const today = salesSince(s, startOfToday(now))
  const yesterdayStart = startOfToday(now) - DAY
  const yesterdaySameTime = s.sales.filter((x) => x.at >= yesterdayStart && x.at < now - DAY)
  const salesToday = today.reduce((t, x) => t + x.total, 0)
  const salesYesterday = yesterdaySameTime.reduce((t, x) => t + x.total, 0)
  const items = stockItems(s)
  // Nothing counted yet: every item would be "out", so there is nothing useful
  // to say. The Dashboard shows the count-your-stock banner instead.
  const uncounted = stockUncounted(s)
  const attention = uncounted ? [] : items.filter((p) => needsAction(healthOf(s, p, now)))
  const critical = uncounted ? [] : attention.filter((p) => ['out', 'critical'].includes(healthOf(s, p, now)))
  const stockValue = items.reduce((t, p) => t + p.stock * p.cost, 0)
  const soonest = Math.min(...items.map((p) => daysCover(s, p, now)))
  return { salesToday, salesYesterday, salesCount: today.length, attention, critical, stockValue, itemCount: items.length, soonest }
}

export type Recommendation = {
  product: Product
  health: Health
  qty: number
  supplierId: string
  unitPrice: number
  cost: number
  usage: number
  cover: number
  reasons: string[]
  options: { supplierId: string; unitPrice: number; delta: number }[]
}

/** FR6/FR9: rules-based, explainable restock suggestions for every stock item that needs action. */
export function recommendations(s: AppState, now = Date.now()): Recommendation[] {
  // Suggesting a restock of everything, from no usage data, is noise
  if (stockUncounted(s)) return []
  return stockItems(s)
    .map((p) => ({ p, h: healthOf(s, p, now) }))
    .filter(({ h }) => needsAction(h))
    .map(({ p, h }) => {
      const usage = dailyUsage(s, p.id, now)
      const cover = daysCover(s, p, now)
      const options = pricesFor(s, p.id)
      const cheapest = options[0]
      const chosen = options.find((o) => o.supplierId === s.preferred[p.id]) ?? cheapest
      const need = Math.max(p.packSize, bundleFor(s).stock.restockDays * usage - p.stock)
      const packs = Math.ceil(need / p.packSize - 1e-9)
      const qty = Math.max(chosen?.minOrder ?? 0, Math.round(packs * p.packSize * 100) / 100)
      const unitPrice = chosen?.unitPrice ?? p.cost
      const reasons = [
        `${unitQty(p, p.stock)} left, ${Number.isFinite(cover) ? `about ${cover < 1 ? `${Math.max(1, Math.round(cover * 24))} hours` : `${Math.round(cover)} days`} of stock` : 'no recent usage'}.`,
        `Uses about ${unitQty(p, Math.round(usage * 10) / 10)} a day (last 7 days).`,
        `Suggested ${unitQty(p, qty)} covers about ${bundleFor(s).stock.restockDays} days.`,
        cheapest && chosen
          ? chosen.supplierId === cheapest.supplierId
            ? `${supplierName(s, chosen.supplierId)} is the cheapest saved price (${rand(chosen.unitPrice)} per ${p.unit}).`
            : `${supplierName(s, chosen.supplierId)} chosen by you; ${rand(chosen.unitPrice - cheapest.unitPrice)} per ${p.unit} more than the cheapest.`
          : 'No supplier price saved yet; estimated from average cost.',
      ]
      return {
        product: p,
        health: h,
        qty,
        supplierId: chosen?.supplierId ?? '',
        unitPrice,
        cost: Math.round(qty * unitPrice * 100) / 100,
        usage,
        cover,
        reasons,
        options: options.map((o) => ({
          supplierId: o.supplierId,
          unitPrice: o.unitPrice,
          delta: o.unitPrice - (cheapest?.unitPrice ?? o.unitPrice),
        })),
      }
    })
    .sort((a, b) => a.cover - b.cover || b.usage - a.usage)
}

export const purchaseTotal = (p: { lines: { qty: number; unitPrice: number }[] }) => p.lines.reduce((t, l) => t + l.qty * l.unitPrice, 0)

/** Theft detection: flag when stock drops significantly without corresponding sales. */
export type TheftAlert = {
  productId: string
  productName: string
  expectedStock: number
  actualStock: number
  discrepancy: number
  severity: 'low' | 'medium' | 'high'
  at: number
}

/** Check for potential theft by comparing expected vs actual stock changes. */
export function detectTheft(s: AppState, now = Date.now()): TheftAlert[] {
  const alerts: TheftAlert[] = []
  const salesSince = (start: number) => s.sales.filter((x) => x.at >= start)

  // Look at each day in the last 7 days for suspicious stock drops
  const DAY = 86_400_000
  for (let i = 1; i <= 7; i++) {
    const dayStart = now - i * DAY
    const dayEnd = now - (i - 1) * DAY
    const daySales = salesSince(dayStart).filter((x) => x.at < dayEnd)

    // Calculate total qty sold per product this day
    const soldThisDay = new Map<string, number>()
    for (const sale of daySales) {
      for (const [id, n] of deductionsFor(s, sale.lines)) {
        soldThisDay.set(id, (soldThisDay.get(id) ?? 0) + n)
      }
    }

    // Check products that had stock changes (via purchases or sales)
    const allProductIds = new Set([...s.products.map((p) => p.id), ...s.purchases.flight?.((p) => p.lines?.flatMap((l) => l.productId)) ?? []])
    // Actually let's just check all products
    for (const p of s.products) {
      if (p.untracked || p.composite) continue

      // Expected stock change from sales only
      const expectedDeduction = soldThisDay.get(p.id) ?? 0

      // Check current stock vs what we'd expect
      const recentPurchases = s.purchases
        .filter((x) => x.at >= dayStart && x.at < dayEnd && x.status === 'delivered')
        .reduce((sum, p) => sum + p.lines.reduce((s, l) => s + l.qty, 0), 0)

      // If stock is significantly lower than expected (no recent full count)
      const lastCount = p.lastCountAt ?? s.onboardedAt ?? 0
      const daysSinceCount = lastCount ? (now - lastCount) / DAY : 999

      // Only flag if it's been a while since a count AND stock is low unexpectedly
      if (daysSinceCount > 1 && p.stock < expectedDeduction) {
              const discrepancy = expectedDeduction - p.stock
              let severity: 'low' | 'medium' | 'high' = 'low'
              if (discrepancy > 50) severity = 'high'
              else if (discrepancy > 20) severity = 'medium'

        alerts.push({
          productId: p.id,
          productName: p.name,
          expectedStock: expectedDeduction,
          actualStock: p.stock,
          discrepancy,
          severity,
          at: dayStart,
        })
      }
    }
  }

  // Sort by severity then discrepancy
  return alerts.sort((a, b) => {
    const order = { low: 1, medium: 2, high: 3 }
    return order[b.severity] - order[a.severity] || b.discrepancy - a.discrepancy
  })
}
