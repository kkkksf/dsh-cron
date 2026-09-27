/**
 * The cron panel main page (Task 4 minimal: real catalog data as a plain
 * list). Later tasks grow the master-detail UI here; components receive all
 * data through injected props (catalog snapshot + actions), never ctx.
 */

import { createElement as h, useState, useEffect } from 'react'

/** Local subscription over one observable snapshot prop (dsh-memory pattern). */
function useSnapshot(source) {
  const [snap, setSnap] = useState(() => source.getSnapshot())
  useEffect(() => source.subscribe(() => setSnap(source.getSnapshot())), [source])
  return snap
}

/** Minimal panel page: catalog phase + automation titles. */
export function CronPage(props) {
  const source = props.catalogSource
  const snapshot = source ? useSnapshot(source) : { phase: 'loading', automations: [] }
  const automations = snapshot.automations ?? []
  const t = props.t ?? (() => '')
  return h('div', { style: { padding: '24px', fontSize: '14px' } },
    h('h2', { style: { margin: '0 0 12px', fontSize: '16px' } }, t('panel')),
    snapshot.phase === 'error' && h('p', { style: { color: 'var(--dsw-color-danger, #d33)' } },
      `${t('error')}: ${snapshot.error ?? ''}`),
    snapshot.phase === 'loading' && h('p', null, t('loading')),
    h('ul', null, automations.map(entry =>
      h('li', { key: entry.id }, `${entry.title ?? entry.id} [${entry.status ?? '?'}]`))),
  )
}

/** Sidebar panel icon: clock glyph, sized by the shell. */
export function CronIcon({ size }) {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    'aria-hidden': 'true', stroke: 'currentColor', 'stroke-width': '1.8',
  },
    h('circle', { cx: '12', cy: '12', r: '9' }),
    h('path', { d: 'M12 7v5l3.5 2', 'stroke-linecap': 'round' }),
  )
}
