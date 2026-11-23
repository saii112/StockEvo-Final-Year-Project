/**
 * Storage adapter: the whole shop as one AsyncStorage value, with a debounced Supabase snapshot
 * backup (EXPO_PUBLIC_STORE=local, and always on web).
 *
 * Local-first (BR8): every change is written to this device before anything else.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { actions as A, createSeedState, type AppState } from '../core'
import { fetchBackup, pushBackup } from '../lib/cloudBackup'
import type { MakeStorage } from '../store'

async function read<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

const write = (s: AppState) => AsyncStorage.setItem(A.STATE_KEY, JSON.stringify(s)).catch(() => {})

export const localShop: MakeStorage = (ctx) => {
  // Changed since the last upload that worked
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pushing = false

  const push = async () => {
    clearTimeout(timer)
    timer = undefined
    const snapshot = ctx.get()
    if (!snapshot || pushing) return
    pushing = true
    dirty = false
    ctx.setBackupStatus('pushing')
    const ok = await pushBackup(snapshot, ctx.owner)
    pushing = false
    ctx.setBackupStatus(ok ? 'backed-up' : 'error')
    // Only acknowledge the queue once the upload actually succeeded. A failure leaves it dirty, so the
    // next change or the next minute retries; nothing claims to be backed up in the meantime.
    const latest = ctx.get()
    if (!ok) dirty = true
    else if (latest) {
      const acked = A.markBackedUp(latest)
      ctx.commit(acked)
      void write(acked)
    }
  }

  return {
    async load() {
      const [saved, savedOwner] = await Promise.all([
        read<unknown>(A.STATE_KEY),
        // Stored as the bare id, not JSON: reading it through read() would always give null and
        // every account would count as the owner.
        AsyncStorage.getItem(A.OWNER_KEY).catch(() => null),
      ])
      // State left by a different account must never be adopted by this one
      const mine = savedOwner === null || savedOwner === ctx.owner
      // Saved before onboarding existed? migrateState decides once, here. Restore has to be awaited
      // before seeding, otherwise a returning owner is handed demo data that then overwrites their backup.
      const restored = A.isValidState(saved) && mine ? saved : await fetchBackup()
      const state = restored ? A.migrateState(restored) : createSeedState()
      // The state on disk must belong to the owner it is stamped with, before the stamp changes
      await write(state)
      await AsyncStorage.setItem(A.OWNER_KEY, ctx.owner).catch(() => {})
      return { state, foreign: !mine }
    },

    save(_prev, next) {
      void write(next)
      dirty = true
      ctx.setBackupStatus((s) => (s === 'backed-up' ? 'idle' : s))
      // Debounced upload; offline, the reconnect sync sends it
      clearTimeout(timer)
      timer = ctx.online() ? setTimeout(() => void push(), A.BACKUP_DEBOUNCE_MS) : undefined
    },

    sync(force) {
      // A debounced upload is already on its way
      if (force || (dirty && !timer)) void push()
    },

    fresh: createSeedState,

    dispose() {
      clearTimeout(timer)
    },
  }
}
