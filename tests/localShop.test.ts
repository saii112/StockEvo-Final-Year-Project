/**
 * The AsyncStorage adapter: another account's shop is never adopted, and the queue is only
 * acknowledged after an upload that worked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const disk = new Map<string, string>()
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => disk.get(k) ?? null,
    setItem: async (k: string, v: string) => void disk.set(k, v),
    removeItem: async (k: string) => void disk.delete(k),
  },
}))
const backup = { fetch: vi.fn(), push: vi.fn() }
vi.mock('../src/lib/cloudBackup', () => ({
  fetchBackup: () => backup.fetch(),
  pushBackup: (s: unknown, o: string) => backup.push(s, o),
}))

const { localShop } = await import('../src/data/localShop')
const { actions: A, createSeedState } = await import('../src/core')

type State = ReturnType<typeof createSeedState>
function harness(owner: string) {
  let state: State | null = null
  const statuses: string[] = []
  const storage = localShop({
    owner,
    get: () => state,
    commit: (s) => void (state = s),
    online: () => true,
    setBackupStatus: (s) => void statuses.push(typeof s === 'function' ? s(statuses.at(-1) as never) : s),
  })
  return { storage, statuses, get: () => state!, set: (s: State) => void (state = s) }
}

beforeEach(() => {
  disk.clear()
  backup.fetch.mockReset().mockResolvedValue(null)
  backup.push.mockReset().mockResolvedValue(true)
})

describe('localShop', () => {
  it('does not hand one account the shop another left on this device', async () => {
    const theirs = { ...createSeedState(), budget: 999 }
    disk.set(A.STATE_KEY, JSON.stringify(theirs))
    disk.set(A.OWNER_KEY, 'alice')

    const { state, foreign } = await harness('bob').storage.load()

    expect(foreign).toBe(true)
    expect(state.budget).not.toBe(999)
    // What is on disk now is bob's, stamped bob
    expect(disk.get(A.OWNER_KEY)).toBe('bob')
    expect(JSON.parse(disk.get(A.STATE_KEY)!).budget).toBe(state.budget)
  })

  it('keeps the shop of the owner it belongs to', async () => {
    const mine = { ...createSeedState(), budget: 123 }
    disk.set(A.STATE_KEY, JSON.stringify(mine))
    disk.set(A.OWNER_KEY, 'bob')

    const { state, foreign } = await harness('bob').storage.load()

    expect(foreign).toBe(false)
    expect(state.budget).toBe(123)
    expect(backup.fetch).not.toHaveBeenCalled()
  })

  it('writes every change at once and backs it up after the debounce', async () => {
    vi.useFakeTimers()
    const h = harness('bob')
    const prev = createSeedState()
    const next = A.setBudget(prev, 500)
    h.set(next)

    h.storage.save(prev, next, { type: 'setBudget' })
    expect(JSON.parse(disk.get(A.STATE_KEY)!).budget).toBe(500)
    expect(backup.push).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(A.BACKUP_DEBOUNCE_MS)
    expect(backup.push).toHaveBeenCalledWith(next, 'bob')
    expect(h.statuses.at(-1)).toBe('backed-up')
    expect(h.get().queue).toEqual([])
    vi.useRealTimers()
  })

  it('a failed upload stays waiting and the next sync retries it', async () => {
    const h = harness('bob')
    const prev = createSeedState()
    const next = A.setBudget(prev, 500)
    h.set(next)
    backup.push.mockResolvedValueOnce(false)

    h.storage.save(prev, next, { type: 'setBudget' })
    h.storage.sync(true)
    await vi.waitFor(() => expect(h.statuses.at(-1)).toBe('error'))
    expect(h.get().queue).toEqual(next.queue)

    h.storage.sync(false)
    await vi.waitFor(() => expect(h.statuses.at(-1)).toBe('backed-up'))
    expect(backup.push).toHaveBeenCalledTimes(2)
    h.storage.dispose?.()
  })
})
