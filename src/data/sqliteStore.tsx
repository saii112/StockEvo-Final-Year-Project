/**
 * Storage adapter: the shop kept in SQLite through the use cases (EXPO_PUBLIC_STORE=sqlite).
 *
 * The screens get the same useStore() (src/store.tsx); this file only says where the data goes:
 *
 *   an action   -> the store shows A.<action>(state) at once (the counter must not wait for a database)
 *               -> save() writes it to SQLite through the use cases, one change after another
 *               -> then loadShop reads the shop back, which swaps in real ids, stock and the sync queue
 *   syncing     -> useCases.syncNow() sends the queued rows to Supabase while online
 *
 * Everything the screens show comes back from loadShop. Only product photos stay in AsyncStorage
 * (handled by the store).
 */
import type { ReactNode } from 'react'
import * as A from './actions'
import type { AppState } from './types'
import { ShopStoreProvider, type Change, type MakeStorage } from '../store'
import { useCases } from '../backend/useCases/container'
import { emptyShop, failed, newId, persistChange, persistCosts, persistSale, persistVoid } from './sqlitePersist'

type Result = Promise<{ success?: boolean; errors?: string[] } | undefined>

export const sqliteShop: MakeStorage = (ctx) => {
  let jobs = 0
  let chain: Promise<unknown> = Promise.resolve()
  let syncing = false
  // The screen's copy of a new sale has a placeholder id until the next refresh; this maps it to the real one
  const saleIds = new Map<string, string>()

  // Re-reads the shop from SQLite. Skipped while a write is still waiting, because what is on
  // screen is then newer than the database; the last write triggers another refresh.
  const refresh = async () => {
    if (jobs > 0) return
    try {
      const shop = await useCases.loadShop()
      if (jobs > 0 || !ctx.get()) return
      ctx.commit(shop)
    } catch (e) {
      console.warn('[sqliteStore] loadShop failed', e)
    }
  }

  const sync = async (force: boolean) => {
    const current = ctx.get()
    if (syncing || !current) return
    if (!force && A.pendingCount(current) === 0) return
    syncing = true
    ctx.setBackupStatus('pushing')
    try {
      await useCases.syncNow({ retryFailed: force })
    } catch (e) {
      console.warn('[sqliteStore] sync failed', e)
    } finally {
      syncing = false
    }
    await refresh()
    const after = ctx.get()
    ctx.setBackupStatus(after && A.pendingCount(after) === 0 ? 'backed-up' : 'error')
  }

  // Writes to SQLite in the order the owner made the changes
  const enqueue = (job: () => Promise<string[]>) => {
    jobs++
    chain = chain
      .then(job)
      .catch((e) => [String(e?.message ?? e)])
      .then(async (errors) => {
        jobs--
        if (errors.length) console.warn('[sqliteStore] not saved:', errors.join(' | '))
        if (jobs === 0) {
          await refresh()
          if (ctx.online()) void sync(false)
        }
      })
  }

  const one = async (what: string, call: () => Result) => failed(await call(), what)

  /** Whatever differs is written; a supplier typed on screen gets its real id, and the saved choices follow it. */
  const edit = async (prev: AppState, next: AppState) => {
    const { errors, supplierIds } = await persistChange(useCases, prev, next)
    const latest = ctx.get()
    if (supplierIds.size && latest) {
      const before = latest.preferred
      const preferred = Object.fromEntries(Object.entries(before).map(([p, s]) => [p, supplierIds.get(s) ?? s]))
      ctx.commit({ ...latest, preferred })
      for (const [productId, supplierId] of Object.entries(preferred)) {
        if (before[productId] === supplierId) continue
        errors.push(...(await one('setPreferredSupplier', () => useCases.setPreferredSupplier({ productId, supplierId }))))
      }
    }
    return errors
  }

  /** An order change: the order use case first, then the costs that came with it. */
  const order = async (prev: AppState, next: AppState, what: string, call: () => Result) => [
    ...(await one(what, call)),
    ...(await persistCosts(useCases, prev, next)),
  ]

  const write = (prev: AppState, next: AppState, c: Change): Promise<string[]> => {
    switch (c.type) {
      case 'edit':
        return edit(prev, next)
      // The new costs go into product meta. The purchase lines' prices are only on screen: no use case
      // updates a received order's lines, so after the next reload they read 0 again (nothing shows them)
      case 'costs':
        return persistCosts(useCases, prev, next)
      // Lenient: the counter never refuses a sale over stock
      case 'recordSale': {
        const placeholder = next.sales[next.sales.length - 1].id
        return persistSale(useCases, ctx.owner, c.lines, c.meta, (realId) => saleIds.set(placeholder, realId))
      }
      // Its stock returns and it moves to voidedSales
      case 'voidSale':
        return persistVoid(useCases, saleIds.get(c.saleId) ?? c.saleId)
      case 'saveMenuItem': {
        const { product: p, input } = c
        return one('saveMenuItem', () => useCases.saveMenuItem({ id: p.id, name: input.name, price: input.price, menu: input.menu, recipe: input.recipe }))
      }
      case 'removeMenuItem':
        return one('removeMenuItem', () => useCases.removeMenuItem({ id: c.id }))
      case 'addIngredient': {
        const p = c.product
        return one('addIngredient', () =>
          useCases.addIngredient({
            id: p.id,
            name: p.name,
            unit: p.unit,
            unitPlural: p.unitPlural,
            packSize: p.packSize,
            packLabel: p.packLabel,
            cost: p.cost,
            portion: p.portion,
          }),
        )
      }
      case 'setStockCounts':
        return one('setStockCounts', () => useCases.setStockCounts({ counts: c.counts, at: c.at }))
      // The store has already given every product a uuid
      case 'finishOnboarding': {
        const { products, profile } = next
        const recipes = Object.fromEntries(products.filter((p) => p.composite && p.recipe?.length).map((p) => [p.id, p.recipe]))
        const counts = Object.fromEntries(products.filter((p) => !p.composite).map((p) => [p.id, p.stock]))
        return one('applyStarterPacks', () => useCases.applyStarterPacks({ products, recipes, counts, profile }))
      }
      // A new shop stays empty; one that already has products keeps them. Then the flag and profile
      case 'skipOnboarding':
        return edit(prev, next).then(async (errors) => [
          ...errors,
          ...(await one('markOnboarded', () => useCases.markOnboarded({ profile: next.profile, at: next.onboardedAt ?? Date.now() }))),
        ])
      // Orders live in SQLite. Receiving one adds its stock in the same write; undoing takes it back out
      case 'createOrderList':
        return one('savePurchaseOrders', () => useCases.savePurchaseOrders({ orders: c.orders }))
      case 'receivePurchase':
        return order(prev, next, 'receivePurchaseOrder', () => useCases.receivePurchaseOrder({ id: c.id, receivedAt: Date.now() }))
      case 'receiveRestock': {
        const delivered = next.purchases.filter((p) => c.ids.includes(p.id))
        return order(prev, next, 'savePurchaseOrders', () => useCases.savePurchaseOrders({ orders: delivered }))
      }
      // The trip's lines say how much comes back out; the count may end up below zero
      case 'undoRestock': {
        const gone = prev.purchases.filter((p) => c.ids.includes(p.id)).map((p) => p.id)
        return order(prev, next, 'undoPurchaseOrders', () => useCases.undoPurchaseOrders({ ids: gone }))
      }
      case 'cancelPurchase':
        return one('cancelPurchaseOrder', () => useCases.cancelPurchaseOrder({ id: c.id }))
      case 'setRestockDay':
        return one('setRestockDay', () => useCases.setRestockDay({ day: c.day }))
      case 'setPreferredSupplier':
        return one('setPreferredSupplier', () => useCases.setPreferredSupplier({ productId: c.productId, supplierId: c.supplierId }))
      case 'setBudget':
        return one('setBudget', () => useCases.setBudget({ amount: next.budget }))
      case 'updateProfile':
        return one('updateProfile', () => useCases.updateProfile(c.patch))
      case 'updateSellGrid':
        return one('saveSellGrid', () => useCases.saveSellGrid({ patch: c.patch }))
      // Product codes are product meta, which edit() diffs; the unlinked list is a device setting
      case 'barcodes':
        return edit(prev, next).then(async (errors) =>
          prev.unlinkedBarcodes === next.unlinkedBarcodes
            ? errors
            : [...errors, ...(await one('saveUnlinkedBarcodes', () => useCases.saveUnlinkedBarcodes({ list: next.unlinkedBarcodes ?? [] })))],
        )
      case 'resetDemoData':
        return useCases.claimDevice({ ownerID: ctx.owner, reset: true }).then((r: { success?: boolean; errors?: string[] }) =>
          r.success ? [] : (r.errors ?? ['claimDevice failed']),
        )
    }
  }

  return {
    // claimDevice clears the phone first if it holds someone else's shop
    async load() {
      try {
        const claim = await useCases.claimDevice({ ownerID: ctx.owner })
        if (!claim.success) throw new Error(claim.errors?.join(', '))
        return { state: await useCases.loadShop(), foreign: !!claim.cleared }
      } catch (e) {
        console.error('[sqliteStore] could not open the shop', e)
        return { state: emptyShop(), foreign: false }
      }
    },
    save: (prev, next, change) => enqueue(() => write(prev, next, change)),
    sync: (force) => void sync(force),
    fresh: () => emptyShop(),
    // Supabase ids are uuids; the screens' own ids ("white-bread", "menu-x7k2") are not
    newId,
  }
}

export function SqliteStoreProvider(props: { children: ReactNode; fallback: ReactNode; ownerId?: string | null }) {
  return <ShopStoreProvider {...props} storage={sqliteShop} />
}
