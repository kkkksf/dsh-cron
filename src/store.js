/**
 * Durable JSON-file store for automations and runs. One file
 * (`$DSH_HOME/cron/store.json`) holds `{ version, automations, runs }`;
 * every mutation updates the in-memory model first, then persists
 * atomically (tmp file + rename). Mutations are synchronous, which keeps
 * the scheduler's claim/advance transitions single-threaded per process.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** On-disk schema version; a mismatch fails loud instead of guessing. */
const STORE_VERSION = 1

/**
 * Build one key-space table face over a backing Map plus a persist hook.
 * Method names mirror the dsh storage-domain KvTable the scheduler and
 * runner were written against: get/put/update/delete/entries.
 * @param {Map<string, object>} map - backing records.
 * @param {() => void} persist - durability hook invoked after every mutation.
 * @returns {object} the table face.
 */
function jsonTable(map, persist) {
  return {
    /**
     * Read one record.
     * @param {string} id - record id.
     * @returns {object | undefined} the record, or undefined when absent.
     */
    get(id) {
      return map.get(id)
    },
    /**
     * Insert or replace one record and persist.
     * @param {string} id - record id.
     * @param {object} record - the record.
     * @returns {object} the stored record.
     */
    put(id, record) {
      map.set(id, record)
      persist()
      return record
    },
    /**
     * Read-modify-write one record and persist. Mirrors KvTable: updating a
     * missing record throws instead of creating one.
     * @param {string} id - record id.
     * @param {(current: object) => object} fn - pure transition.
     * @returns {object} the next record.
     */
    update(id, fn) {
      const current = map.get(id)
      if (current === undefined) {
        throw new Error(`cron store has no record '${id}' to update`)
      }
      const next = fn(current)
      map.set(id, next)
      persist()
      return next
    },
    /**
     * Remove one record and persist.
     * @param {string} id - record id.
     */
    delete(id) {
      map.delete(id)
      persist()
    },
    /**
     * Every [id, record] pair.
     * @returns {[string, object][]} entries.
     */
    entries() {
      return [...map.entries()]
    },
  }
}

/**
 * The cron store: loads (or initializes) the JSON file, exposes the
 * `automations` and `runs` table faces, and persists on every mutation.
 */
export class CronStore {
  /**
   * @param {string} file - absolute store file path.
   */
  constructor(file) {
    this.#file = file
    this.#automations = new Map()
    this.#runs = new Map()
    this.automations = jsonTable(this.#automations, () => this.#persist())
    this.runs = jsonTable(this.#runs, () => this.#persist())
  }

  #file
  #automations
  #runs

  /**
   * Load the file, or initialize it when absent. A corrupt file or version
   * mismatch throws: the scheduler must never silently run over a store it
   * cannot understand.
   */
  load() {
    let text
    try {
      text = readFileSync(this.#file, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.#persist()
        return
      }
      throw error
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new Error(`dsh-cron: store file is not valid JSON (${this.#file}): ${error.message}`)
    }
    if (parsed.version !== STORE_VERSION) {
      throw new Error(`dsh-cron: store version ${JSON.stringify(parsed.version)} is not supported (expected ${STORE_VERSION})`)
    }
    for (const [id, record] of Object.entries(parsed.automations ?? {})) this.#automations.set(id, record)
    for (const [id, record] of Object.entries(parsed.runs ?? {})) this.#runs.set(id, record)
  }

  /**
   * Serialize the in-memory model and replace the file atomically.
   */
  #persist() {
    mkdirSync(dirname(this.#file), { recursive: true })
    const tmp = `${this.#file}.tmp`
    writeFileSync(tmp, JSON.stringify({
      version: STORE_VERSION,
      automations: Object.fromEntries(this.#automations),
      runs: Object.fromEntries(this.#runs),
    }))
    renameSync(tmp, this.#file)
  }
}
