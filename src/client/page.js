/**
 * The cron panel main page: toolbar (search / status filter) + automation
 * list. Components receive all data through injected props (catalog snapshot
 * source + actions), never ctx.
 */

import { createElement as h, useState, useEffect } from 'react'
import { filterAutomations, scheduleSummary, relativeTime } from './list.js'
import { withDefaults } from './catalog.js'
import { DetailPane } from './detail.js'
import { CronForm } from './form.js'

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

/** The cron panel page: toolbar + list on the left, detail/form on the right. */
export function CronPage(props) {
  const source = props.catalogSource
  const rawSnapshot = source ? useSnapshot(source) : null
  const snapshot = withDefaults(rawSnapshot)
  const automations = snapshot.automations
  const workspaces = snapshot.workspaces
  const offline = snapshot.phase === 'error'
  const t = props.t ?? (() => '')
  const call = props.call
  const refresh = props.refresh ?? (() => {})
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [formMode, setFormMode] = useState('none') // 'none' | 'create' | 'edit'
  const visible = filterAutomations(automations, { query, status })
  const selected = selectedId === null
    ? null
    : (automations.find(entry => entry.id === selectedId) ?? null)

  /** Submit the form over create/update; returns the form's outcome token. */
  const submitForm = async (draft, wire) => {
    if (formMode === 'create') {
      const result = await call('create', wire)
      if (result.ok !== true) return String(result.error?.message ?? result.error)
      setFormMode('none')
      setSelectedId(result.value?.id ?? null)
      await refresh()
      return true
    }
    const result = await call('update', {
      id: selected?.id,
      expectedNextAt: selected?.nextAt ?? null,
      changes: {
        title: wire.title,
        prompt: wire.prompt,
        model: wire.model,
        ...(wire.max_runs === null ? {} : { max_runs: wire.max_runs }),
        selector: wire.selector,
      },
    })
    if (result.ok !== true) return String(result.error?.message ?? result.error)
    await refresh()
    if (result.value?.outcome === 'conflict') return 'conflict'
    setFormMode('none')
    return true
  }

  const detailOrForm = formMode === 'none'
    ? h(DetailPane, {
      entry: selected, workspaces,
      call,
      openSession: props.openSession ?? null,
      offline,
      onEdit: selected === null ? null : () => { setFormMode('edit') },
      onToggle: selected === null ? null : async () => {
        const result = await call('toggle', { id: selected.id, enabled: selected.status !== 'active' })
        if (result.ok === true) await refresh()
        return result
      },
      onDelete: selected === null ? null : async () => {
        const result = await call('delete', { id: selected.id })
        if (result.ok === true) { setSelectedId(null); await refresh() }
        return result
      },
      t,
    })
    : h(CronForm, {
      mode: formMode,
      entry: formMode === 'edit' ? selected : null,
      workspaces,
      defaultWorkspaceId: props.defaultWorkspaceId,
      defaultModel: props.defaultModel,
      defaultTimeZone: props.defaultTimeZone,
      onSubmit: submitForm,
      onCancel: () => { setFormMode('none') },
      t,
    })

  return h('div', { className: `dsh-cron-page${selected !== null || formMode !== 'none' ? ' dsh-cron-has-detail' : ''}` },
    offline && h('p', { className: 'dsh-cron-banner-error', role: 'alert' },
      `${t('banner.disconnected')}${snapshot.error ? `（${snapshot.error}）` : ''}`),
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
        h('button', {
          type: 'button', className: 'dsh-cron-new', disabled: offline,
          onClick: () => { setSelectedId(null); setFormMode('create') },
        }, t('form.new'))),
      snapshot.phase === 'loading' && h('p', { className: 'dsh-cron-hint' }, t('loading')),
      h('div', { className: 'dsh-cron-list', role: 'list' },
        visible.length === 0 && snapshot.phase === 'ready' && h('p', { className: 'dsh-cron-hint' }, t('list.empty')),
        visible.map(entry => h(AutomationRow, {
          key: entry.id, entry, workspaces, selected: entry.id === selectedId,
          onSelect: id => { setFormMode('none'); setSelectedId(id) },
          t,
        }))),
    ),
    detailOrForm,
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
