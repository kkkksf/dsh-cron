/**
 * Polling catalog source over the mounted cron remote namespace. Pure logic:
 * no React, no window — the browser entry injects the remote `call` function,
 * node tests inject fakes. Envelope discipline: every `result.ok` is checked
 * before reading `value` (destructured reads of an envelope silently yield
 * undefined and crash far from the cause).
 */

/** Client-side descriptors of the host `cron` namespace (see plan Task 4).
 * Parameter lists must mirror the host methods' real parameter names (the
 * gateway derives wire fields from them): list() takes none, the rest take
 * one `request`. Parameter codecs must be strict — the gate checks the mode,
 * and nothing client-side executes `create`, so a permissive schema stub is
 * the honest hand-written equivalent of a generated one. */
const STRICT_REQUEST_CODEC = (method) => Object.freeze({
  mode: 'strict',
  typeSymbol: `dsh-cron/${method}.request`,
  create: () => ({
    parse: value => value,
    safeParse: value => ({ success: true, value }),
  }),
})
const RESULT_CODEC = Object.freeze({ mode: 'src-json' })
const NO_PARAMS = Object.freeze([])
const REQUEST_PARAMS = (method) => Object.freeze([
  Object.freeze({
    name: 'request', wire: 'request', source: 'json',
    codec: STRICT_REQUEST_CODEC(method),
  }),
])

export const CRON_DESCRIPTORS = Object.freeze(['list', 'create', 'update', 'toggle', 'delete', 'history']
  .map(method => Object.freeze({
    id: `dsh-cron/${method}`,
    service: 'cron',
    namespace: 'cron',
    method,
    invocation: Object.freeze({ kind: 'direct' }),
    parameters: method === 'list' ? NO_PARAMS : REQUEST_PARAMS(method),
    result: RESULT_CODEC,
  })))

/**
 * Defensive projection of one catalog snapshot: a crashed or stale read
 * must never take the whole panel down (a slot contribution that throws is
 * silently unmounted), so missing containers become empty arrays and a
 * missing snapshot reads as loading.
 * @param {object | null | undefined} snapshot - raw snapshot.
 * @returns {{ phase: string, workspaces: Array, automations: Array, models: Array, error: string | null }} guarded snapshot.
 */
export function withDefaults(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') {
    return { phase: 'loading', workspaces: [], automations: [], models: [], error: null }
  }
  return {
    phase: typeof snapshot.phase === 'string' ? snapshot.phase : 'loading',
    workspaces: Array.isArray(snapshot.workspaces) ? snapshot.workspaces : [],
    automations: Array.isArray(snapshot.automations) ? snapshot.automations : [],
    models: Array.isArray(snapshot.models) ? snapshot.models : [],
    error: snapshot.error ?? null,
  }
}

/**
 * One catalog source: a loading/ready/error snapshot store refreshed by
 * polling, by post-mutation refetch, and by connection reset.
 * @param {{ call: (method: string, request?: object) => Promise<{ok: boolean, value?: object, error?: {message?: string}}>,
 *           intervalMs?: number }} options - remote call seam and poll cadence (0 = no timer).
 * @returns {{ hooks: { catalog: object }, refresh: () => Promise<void>, start: () => Promise<void>, stop: () => void }} the source handle.
 */
export function createCatalogSource({ call, intervalMs = 5000 }) {
  const listeners = new Set()
  let snapshot = { phase: 'loading', workspaces: [], automations: [], models: [], error: null }
  let timer = null
  let inflight = Promise.resolve()

  const publish = (next) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const refresh = () => {
    inflight = inflight.then(async () => {
      try {
        const result = await call('list')
        if (result.ok !== true) {
          throw new Error(String(result.error?.message ?? result.error))
        }
        publish({
          phase: 'ready',
          workspaces: result.value?.workspaces ?? [],
          automations: result.value?.automations ?? [],
          models: result.value?.models ?? [],
          error: null,
        })
      } catch (error) {
        publish({ ...snapshot, phase: 'error', error: String(error?.message ?? error) })
      }
    })
    return inflight
  }

  return {
    hooks: {
      catalog: {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    },
    refresh,
    start() {
      const first = refresh()
      if (intervalMs > 0) timer = setInterval(() => { void refresh() }, intervalMs)
      return first
    },
    stop() {
      if (timer !== null) clearInterval(timer)
      timer = null
    },
  }
}
