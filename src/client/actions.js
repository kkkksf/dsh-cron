/**
 * Shared action feedback state machine for the detail pane's operations
 * (toggle / delete): one busy window, failures surface their message,
 * success clears it. Pure logic — React wiring lives in detail.js.
 */

/**
 * @returns {{ snapshot: () => { phase: 'idle'|'busy'|'error', message: string | null },
 *            subscribe: (listener: () => void) => () => void,
 *            run: (tag: string, op: () => Promise<{ ok: boolean, error?: { message?: string } }>) => Promise<boolean> }} the machine.
 */
export function createActionFeedback() {
  const listeners = new Set()
  let state = { phase: 'idle', message: null }

  const publish = (next) => {
    state = next
    for (const listener of listeners) listener()
  }

  const run = async (tag, op) => {
    if (state.phase === 'busy') return false
    publish({ phase: 'busy', message: null })
    const result = await op()
    if (result.ok !== true) {
      publish({ phase: 'error', message: String(result.error?.message ?? result.error ?? 'operation failed') })
      return false
    }
    publish({ phase: 'idle', message: null })
    return true
  }

  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    run,
  }
}
