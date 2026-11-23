/**
 * The shop store behind `useStore()`, written once.
 *
 * Every action works the same way whatever the storage: run the pure function from actions.ts on the
 * latest state, show the result at once, then hand the before, the after and what happened to the
 * storage adapter. Where the shop is kept is the adapter's business:
 *
 *   src/data/localShop.ts    AsyncStorage + Supabase snapshot backup (EXPO_PUBLIC_STORE=local, default)
 *   src/data/sqliteStore.tsx SQLite through the use cases          (EXPO_PUBLIC_STORE=sqlite)
 *
 * Owner switching, the "latest state" ref, photos, the online flag and the sync timer live here, once.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import { actions as A, type AppState, type Product, type Purchase, type StoreApi } from './core'
import type { BackupStatus } from './lib/cloudBackup'
import { uuidify } from './data/sqlitePersist'
import { localShop } from './data/localShop'
import { logger } from './backend/Logging/Logger'

export const StoreContext = createContext<StoreApi | null>(null)

const SYNC_EVERY_MS = 60_000

type Arg<K extends keyof StoreApi, I extends number = 0> = StoreApi[K] extends (...a: infer P) => unknown ? P[I] : never

/** What an action did, for adapters that write it as a change rather than as the whole shop. */
export type Change =
  /** Product fields, recipes, portions or supplier prices: the adapter works out what differs. */
  | { type: 'edit' }
  /** Only product costs moved (an order came in, or the owner said what they paid). */
  | { type: 'costs' }
  | { type: 'recordSale'; lines: Arg<'recordSale'>; meta?: Arg<'recordSale', 1> }
  | { type: 'voidSale'; saleId: string }
  | { type: 'saveMenuItem'; product: Product; input: Arg<'saveMenuItem'> }
  | { type: 'removeMenuItem'; id: string }
  | { type: 'addIngredient'; product: Product }
  | { type: 'setStockCounts'; counts: Arg<'setStockCounts'>; at: number }
  | { type: 'finishOnboarding' }
  | { type: 'skipOnboarding' }
  | { type: 'createOrderList'; orders: Purchase[] }
  | { type: 'receivePurchase'; id: string }
  | { type: 'receiveRestock'; ids: string[] }
  | { type: 'undoRestock'; ids: string[] }
  | { type: 'cancelPurchase'; id: string }
  | { type: 'setRestockDay'; day: number }
  | { type: 'setPreferredSupplier'; productId: string; supplierId: string }
  | { type: 'setBudget' }
  | { type: 'updateProfile'; patch: Arg<'updateProfile'> }
  | { type: 'updateSellGrid'; patch: Arg<'updateSellGrid'> }
  | { type: 'resetDemoData' }
  /** Product barcodes (product meta) and/or the unlinked barcodes list moved. */
  | { type: 'barcodes' }

/** Where one owner's shop is kept. Made fresh for each owner who signs in. */
export type ShopStorage = {
  /** The owner's shop. `foreign`: this device held another account's data, so its photos go too. */
  load(): Promise<{ state: AppState; foreign: boolean }>
  /** Called after every action that changed something; `next` is already on screen. */
  save(prev: AppState, next: AppState, change: Change): void
  /** Send what is waiting. Called on reconnect and every minute (force = false) and by backUpNow (true). */
  sync(force: boolean): void
  /** What resetDemoData starts again from. */
  fresh(): AppState
  /** Ids for new products, when the storage needs its own (uuids). Absent keeps actions.ts's ids. */
  newId?: () => string
  /** The owner signed out or switched: stop timers. */
  dispose?(): void
}

/** What the store gives an adapter. All of it goes quiet once the owner switches. */
export type StorageContext = {
  owner: string
  /** The latest state (null while loading or after the owner switched). */
  get(): AppState | null
  /** Replaces what is on screen, for adapters that read the shop back (real ids, the sync queue). */
  commit(next: AppState): void
  online(): boolean
  setBackupStatus(s: BackupStatus | ((prev: BackupStatus) => BackupStatus)): void
}

export type MakeStorage = (ctx: StorageContext) => ShopStorage

type Props = { children: ReactNode; fallback: ReactNode; ownerId?: string | null }

/**
 * `ownerId` is the signed-in account, or null when nobody is. While it is null nothing is loaded and
 * children render straight away, because the auth screens do not use the store and must not wait.
 */
export function ShopStoreProvider({ children, fallback, ownerId = null, storage: make }: Props & { storage: MakeStorage }) {
  const [state, setState] = useState<AppState | null>(null)
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [online, setOnline] = useState(true)
  const [backupStatus, setBackupStatus] = useState<BackupStatus>('idle')
  // Whose shop `state` is, and its storage. Switching accounts shows the fallback until the new one loads.
  const [loaded, setLoaded] = useState<{ owner: string; storage: ShopStorage } | null>(null)

  // The newest state, readable right after an action. Set synchronously on every commit, so an action
  // always starts from the result of the last one, even two in one tap.
  const ref = useRef<AppState | null>(null)
  const photosRef = useRef(photos)
  const onlineRef = useRef(online)
  useEffect(() => {
    photosRef.current = photos
    onlineRef.current = online
  }, [photos, online])

  const commit = useCallback((next: AppState) => {
    ref.current = next
    setState(next)
  }, [])

  useEffect(() => {
    if (!ownerId) return
    let alive = true
    // Actions wait for the new shop; the screen waits on `loaded.owner` below
    ref.current = null
    const storage = make({
      owner: ownerId,
      get: () => (alive ? ref.current : null),
      commit: (next) => alive && commit(next),
      online: () => onlineRef.current,
      setBackupStatus: (s) => alive && setBackupStatus(s),
    })
    ;(async () => {
      const [{ state: shop, foreign }, rawPhotos] = await Promise.all([
        storage.load(),
        AsyncStorage.getItem(A.PHOTO_KEY).catch(() => null),
      ])
      if (!alive) return
      commit(shop)
      setLoaded({ owner: ownerId, storage })
      // Photos are device-only, so another account's never carry over
      if (foreign) AsyncStorage.removeItem(A.PHOTO_KEY).catch(() => {})
      try {
        setPhotos(!foreign && rawPhotos ? JSON.parse(rawPhotos) : {})
      } catch {
        setPhotos({})
      }
    })().catch((e) => logger.error('store', 'could not open the shop', { error: String(e?.message ?? e) }))
    return () => {
      alive = false
      storage.dispose?.()
    }
  }, [ownerId, make, commit])

  useEffect(() => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false)), [])

  // Only this owner's shop: during an account switch `state` still holds the last one
  const storage = loaded && loaded.owner === ownerId ? loaded.storage : null
  const shown = storage ? state : null

  // Send what is waiting when we come online, and every minute after
  useEffect(() => {
    if (!storage || !online) return
    storage.sync(false)
    const t = setInterval(() => storage.sync(false), SYNC_EVERY_MS)
    return () => clearInterval(t)
  }, [storage, online])

  const actions = useMemo(() => {
    // Only reachable through `value`, which exists once there is a storage
    const cur = () => ref.current!
    /** Runs a pure action on the latest state, shows it, and hands it to the storage. Unchanged = nothing to save. */
    const apply = (next: AppState, change: Change) => {
      const prev = cur()
      if (!storage || next === prev) return
      commit(next)
      storage.save(prev, next, change)
    }
    const newId = storage?.newId
    const withId = (p: Product) => (newId ? { ...p, id: newId() } : p)

    const api: Omit<StoreApi, 'state' | 'photos' | 'online' | 'pending' | 'backupStatus' | 'backUpNow' | 'setPhoto' | 'removePhoto'> = {
      recordSale: (lines, meta) => {
        const check = A.recordSale(cur(), lines, meta)
        if (!check.ok || !check.state) {
          logger.warn('recordSale', 'refused', { lines, meta, message: check.message })
          return { ok: false, message: check.message }
        }
        apply(check.state, { type: 'recordSale', lines, meta })
        logger.info('recordSale', 'saved', { lines, meta, message: check.message })
        return { ok: true, message: check.message }
      },
      voidSale: (saleId) => apply(A.voidSale(cur(), saleId), { type: 'voidSale', saleId }),

      addProduct: (input) => {
        const product = withId(A.createProduct(cur(), input))
        apply(A.addProduct(cur(), product), { type: 'edit' })
        return product
      },
      updateProduct: (id, input) => apply(A.updateProduct(cur(), id, input), { type: 'edit' }),
      upsertSupplierPrice: (input) => apply(A.upsertSupplierPrice(cur(), input), { type: 'edit' }),
      setPortion: (productId, portion) => apply(A.setPortion(cur(), productId, portion), { type: 'edit' }),
      applyKitchen: (kitchen) => apply(A.applyKitchen(cur(), kitchen, newId ? () => newId() : undefined), { type: 'edit' }),
      // Built once so the caller gets the exact product back. A new item gets a new id; an edit keeps its own
      saveMenuItem: (input, id) => {
        const built = A.buildMenuItem(cur(), input, id)
        const product = id && cur().products.some((p) => p.id === id) ? built : withId(built)
        apply(A.upsertProduct(cur(), product), { type: 'saveMenuItem', product, input })
        return product
      },
      removeMenuItem: (id) => apply(A.removeMenuItem(cur(), id), { type: 'removeMenuItem', id }),
      addIngredient: (input) => {
        const product = withId(A.buildIngredient(input))
        apply(A.upsertProduct(cur(), product), { type: 'addIngredient', product })
        return product
      },
      setStockCounts: (counts) => {
        const at = Date.now()
        apply(A.setStockCounts(cur(), counts, at), { type: 'setStockCounts', counts, at })
      },

      finishOnboarding: (sel, profile, counts) => {
        const started = A.applyStarterPacks(cur(), sel, profile, counts)
        if (!newId) return apply(started, { type: 'finishOnboarding' })
        const { products, prices, preferred } = uuidify(started, newId)
        apply({ ...started, products, prices, preferred }, { type: 'finishOnboarding' })
      },
      skipOnboarding: (profile) => apply(A.skipOnboarding(cur(), profile), { type: 'skipOnboarding' }),

      // Planned against the latest state (for the ids), then committed
      createOrderList: (lines) => {
        const orders = A.planOrders(cur(), lines)
        apply(A.addOrders(cur(), orders), { type: 'createOrderList', orders })
        return orders
      },
      receivePurchase: (id) => apply(A.receivePurchase(cur(), id), { type: 'receivePurchase', id }),
      // "Bought it": the purchases are recorded as delivered and the stock goes in
      receiveRestock: (lines) => {
        const clean = lines.filter((l) => l.qty > 0)
        if (!clean.length) return []
        const created = A.planOrders(cur(), clean)
        const ids = created.map((po) => po.id)
        apply(A.receivePlanned(cur(), created), { type: 'receiveRestock', ids })
        return ids
      },
      undoRestock: (ids) => apply(A.undoRestock(cur(), ids), { type: 'undoRestock', ids }),
      recordPaid: (ids, paid) => apply(A.recordPaid(cur(), ids, paid), { type: 'costs' }),
      cancelPurchase: (id) => apply(A.cancelPurchase(cur(), id), { type: 'cancelPurchase', id }),
      setRestockDay: (day) => apply(A.setRestockDay(cur(), day), { type: 'setRestockDay', day }),

      setPreferredSupplier: (productId, supplierId) =>
        apply(A.setPreferredSupplier(cur(), productId, supplierId), { type: 'setPreferredSupplier', productId, supplierId }),
      setBudget: (n) => apply(A.setBudget(cur(), n), { type: 'setBudget' }),
      updateProfile: (patch) => apply(A.updateProfile(cur(), patch), { type: 'updateProfile', patch }),
      updateSellGrid: (patch) => apply(A.updateSellGrid(cur(), patch), { type: 'updateSellGrid', patch }),

      resetDemoData: () => storage && apply(storage.fresh(), { type: 'resetDemoData' }),

      linkBarcode: (productId, code, pack) => {
        const r = A.linkBarcode(cur(), productId, code, pack)
        if (!r.ok || !r.state) return { ok: false, message: r.message }
        apply(r.state, { type: 'barcodes' })
        return { ok: true, message: r.message }
      },
      removeBarcode: (productId, code) => apply(A.removeBarcode(cur(), productId, code), { type: 'barcodes' }),
      noteUnlinkedBarcode: (code) => apply(A.noteUnlinkedBarcode(cur(), code), { type: 'barcodes' }),
      dismissUnlinkedBarcode: (code) => apply(A.dismissUnlinkedBarcode(cur(), code), { type: 'barcodes' }),
    }
    return api
  }, [storage, commit])

  const setPhoto = useCallback<StoreApi['setPhoto']>(async (productId, dataUrl) => {
    const next = { ...photosRef.current, [productId]: dataUrl }
    try {
      await AsyncStorage.setItem(A.PHOTO_KEY, JSON.stringify(next))
    } catch {
      return { ok: false, message: A.PHOTO_FULL_MESSAGE }
    }
    setPhotos(next)
    return { ok: true, message: A.PHOTO_SAVED_MESSAGE }
  }, [])

  const removePhoto = useCallback((productId: string) => {
    setPhotos((prev) => {
      const next = { ...prev }
      delete next[productId]
      AsyncStorage.setItem(A.PHOTO_KEY, JSON.stringify(next)).catch(() => {})
      return next
    })
  }, [])

  const value = useMemo<StoreApi | null>(
    () =>
      shown && storage
        ? {
            ...actions,
            state: shown,
            photos,
            online,
            pending: A.pendingCount(shown),
            backupStatus,
            backUpNow: () => storage.sync(true),
            setPhoto,
            removePhoto,
          }
        : null,
    [shown, actions, storage, photos, online, backupStatus, setPhoto, removePhoto],
  )

  // Nobody is signed in: the auth screens need no store and must not be blocked
  if (!ownerId) return <>{children}</>
  // `value` exists exactly when both do; testing the plain values keeps the ref-holding handlers out of render
  if (!shown || !storage) return <>{fallback}</>
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

/** The default store: the shop on this device in AsyncStorage, with a Supabase snapshot backup. */
export function StoreProvider(props: Props) {
  return <ShopStoreProvider {...props} storage={localShop} />
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}

/**
 * The store if there is one, null if nobody is signed in.
 *
 * Only the root navigator needs this: it renders on both sides of the auth
 * guard, and signed out there is deliberately no store to read.
 */
export function useStoreOptional() {
  return useContext(StoreContext)
}
