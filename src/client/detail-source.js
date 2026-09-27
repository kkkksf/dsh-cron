/**
 * Run-history source: loads `history` calls with last-request-wins
 * serialization, keeping stale runs visible on failure. Pure logic — no
 * React, no window — so node tests exercise it directly.
 */

/**
 * @param {{ call: (method: string, request: object) => Promise<{ok: boolean, value?: object, error?: {message?: string}}> }} options - remote seam.
 * @returns {{ hooks: { history: object }, load: (id: string, limit?: number) => Promise<void> }} the source handle.
 */
export function createHistorySource({ call }) {
  const listeners = new Set()
  let snapshot = { phase: 'idle', runs: [], error: null }
  let latestKey = 0

  const publish = (next) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const load = async (id, limit = 10) => {
    const key = ++latestKey
    try {
      const result = await call('history', { id, limit })
      if (key !== latestKey) return
      if (result.ok !== true) {
        throw new Error(String(result.error?.message ?? result.error))
      }
      publish({ phase: 'ready', runs: result.value?.runs ?? [], error: null })
    } catch (error) {
      if (key !== latestKey) return
      publish({ ...snapshot, phase: 'error', error: String(error?.message ?? error) })
    }
  }

  return {
    hooks: {
      history: {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    },
    load,
  }
}
