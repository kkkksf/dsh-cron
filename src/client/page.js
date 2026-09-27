/**
 * The cron panel main page: toolbar (search / status filter) + automation
 * list. Components receive all data through injected props (catalog snapshot
 * source + actions), never ctx.
 */

import { createElement as h, useState, useEffect } from 'react'
import { filterAutomations, scheduleSummary, relativeTime } from './list.js'
import { DetailPane } from './detail.js'

/** Local subscription over one observable snapshot prop (dsh-memory pattern). */
function useSnapshot(source) {
  const [snap, setSnap] = useState(() => source.getSnapshot())
  useEffect(() => source.subscribe(() => setSnap(source.getSnapshot())), [source])
  return snap
}

/** One status bucket's filter chip. */
function FilterChip({ value, active, label, onSelect }) {
  return h('button', {
    type: 'button',
    className: `dsh-cron-chip${active ? ' dsh-cron-chip-active' : ''}`,
    'aria-pressed': active,
    onClick: () => { onSelect(value) },
  }, label)
}

/** One automation row. */
function AutomationRow({ entry, workspaces, selected, onSelect, t }) {
  const workspace = (workspaces ?? []).find(w => w.id === entry.workspaceId)
  const summary = scheduleSummary(entry.schedule, {
    cron: s => s.expression ?? '',
    interval: s => t('schedule.interval', { seconds: s.everySeconds ?? 0 }),
    once: s => t('schedule.once'),
  })
  const next = entry.nextAt === null
    ? t('list.noNext')
    : `${t('list.next')} ${relativeTime(entry.nextAt, Date.now())}`
  return h('button', {
    type: 'button',
    className: `dsh-cron-row${selected ? ' dsh-cron-row-selected' : ''}`,
    onClick: () => { onSelect(entry.id) },
  },
    h('span', { className: `dsh-cron-dot dsh-cron-dot-${entry.status ?? 'active'}`, 'aria-hidden': 'true' }),
    h('span', { className: 'dsh-cron-row-main' },
      h('span', { className: 'dsh-cron-row-title' }, entry.title ?? t('list.untitled')),
      h('span', { className: 'dsh-cron-row-sub' },
        `${summary} · ${next}`)),
    h('span', { className: 'dsh-cron-row-badge' }, workspace?.name ?? entry.workspaceId ?? ''),
  )
}

/** The cron panel page: toolbar + list on the left, detail on the right. */
export function CronPage(props) {
  const source = props.catalogSource
  const snapshot = source ? useSnapshot(source) : { phase: 'loading', automations: [] }
  const automations = snapshot.automations ?? []
  const workspaces = snapshot.workspaces ?? []
  const t = props.t ?? (() => '')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const visible = filterAutomations(automations, { query, status })
  const selected = selectedId === null
    ? null
    : (automations.find(entry => entry.id === selectedId) ?? null)

  return h('div', { className: `dsh-cron-page${selected !== null ? ' dsh-cron-has-detail' : ''}` },
    snapshot.phase === 'error' && h('p', { className: 'dsh-cron-banner-error' },
      `${t('error')}: ${snapshot.error ?? ''}`),
    h('div', { className: 'dsh-cron-master' },
      h('div', { className: 'dsh-cron-toolbar' },
        h('input', {
          type: 'search', className: 'dsh-cron-search',
          placeholder: t('search.placeholder'), value: query,
          onChange: event => { setQuery(event.target.value) },
          'aria-label': t('search.placeholder'),
        }),
        h('div', { className: 'dsh-cron-filters', role: 'group', 'aria-label': t('filter.group') },
          ['all', 'active', 'paused', 'completed'].map(value =>
            h(FilterChip, {
              key: value, value, active: status === value,
              label: t(`filter.${value}`), onSelect: setStatus,
            }))),
      ),
      snapshot.phase === 'loading' && h('p', { className: 'dsh-cron-hint' }, t('loading')),
      h('div', { className: 'dsh-cron-list', role: 'list' },
        visible.length === 0 && snapshot.phase === 'ready' && h('p', { className: 'dsh-cron-hint' }, t('list.empty')),
        visible.map(entry => h(AutomationRow, {
          key: entry.id, entry, workspaces, selected: entry.id === selectedId,
          onSelect: setSelectedId, t,
        }))),
    ),
    h(DetailPane, {
      entry: selected, workspaces,
      call: props.call ?? null,
      openSession: props.openSession ?? null,
      onEdit: props.onEdit ?? null, onToggle: props.onToggle ?? null, onDelete: props.onDelete ?? null,
      t,
    }),
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
