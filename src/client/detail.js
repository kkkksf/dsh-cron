/**
 * The detail pane: one automation's fields, run history, and the action
 * buttons. Data arrives through the injected catalog entry and a history
 * source over the same `call` seam the catalog uses.
 */

import { createElement as h, useState, useEffect } from 'react'
import { scheduleSummary, relativeTime } from './list.js'
import { createHistorySource } from './detail-source.js'
import { createActionFeedback } from './actions.js'

/** One run-history row. */
function RunRow({ run, openSession, t }) {
  const status = run.status ?? 'unknown'
  const duration = typeof run.durationMs === 'number' ? `${Math.round(run.durationMs / 1000)}s` : ''
  return h('li', { className: 'dsh-cron-run' },
    h('span', { className: `dsh-cron-run-status dsh-cron-run-${status}`, 'aria-hidden': 'true' }),
    h('span', { className: 'dsh-cron-run-main' },
      h('span', null, `${run.startedAt ?? ''} · ${t(`run.${status}`)}`),
      h('span', { className: 'dsh-cron-run-sub' }, [
        duration,
        run.error ?? '',
      ].filter(part => part !== '').join(' · '))),
    run.sessionId != null && h('button', {
      type: 'button',
      className: 'dsh-cron-run-open',
      disabled: openSession === null,
      title: openSession === null ? t('detail.sessionUnavailable') : undefined,
      onClick: () => { if (openSession !== null) openSession(run.sessionId) },
    }, t('detail.openSession')),
  )
}

/** The detail pane for the selected automation. */
export function DetailPane({ entry, workspaces, call, openSession, offline = false, onEdit, onToggle, onDelete, t }) {
  const [historySource] = useState(() => createHistorySource({ call }))
  const [historyLimit, setHistoryLimit] = useState(10)
  const [snap, setSnap] = useState(() => historySource.hooks.history.getSnapshot())
  const [feedbackMachine] = useState(() => createActionFeedback())
  const [actionState, setActionState] = useState(() => feedbackMachine.snapshot())
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  useEffect(() => {
    setSnap(historySource.hooks.history.getSnapshot())
    return historySource.hooks.history.subscribe(() => setSnap(historySource.hooks.history.getSnapshot()))
  }, [historySource])
  useEffect(() => feedbackMachine.subscribe(() => setActionState(feedbackMachine.snapshot())), [feedbackMachine])
  useEffect(() => { setConfirmingDelete(false) }, [entry?.id])
  useEffect(() => {
    if (entry?.id !== undefined) void historySource.load(entry.id, historyLimit)
  }, [historySource, entry?.id, historyLimit])

  if (entry === null || entry === undefined) {
    return h('div', { className: 'dsh-cron-detail dsh-cron-detail-empty' },
      h('p', { className: 'dsh-cron-hint' }, t('detail.empty')))
  }

  const busy = actionState.phase === 'busy' || offline
  const runToggle = () => {
    void feedbackMachine.run('toggle', async () => onToggle())
  }
  const runDelete = () => {
    void feedbackMachine.run('delete', async () => onDelete())
  }

  const workspace = (workspaces ?? []).find(w => w.id === entry.workspaceId)
  const summary = scheduleSummary(entry.schedule, {
    cron: s => `${s.expression ?? ''} (${s.timeZone ?? 'UTC'})`,
    interval: s => t('schedule.interval', { seconds: s.everySeconds ?? 0 }),
    once: s => `${t('schedule.once')} ${s.runAt ?? ''}`,
  })
  const field = (label, value) => h('div', { className: 'dsh-cron-field' },
    h('span', { className: 'dsh-cron-field-label' }, label),
    h('span', { className: 'dsh-cron-field-value' }, value))

  return h('div', { className: 'dsh-cron-detail' },
    h('div', { className: 'dsh-cron-detail-head' },
      h('h3', { className: 'dsh-cron-detail-title' }, entry.title ?? t('list.untitled')),
      h('div', { className: 'dsh-cron-detail-actions' },
        h('button', { type: 'button', disabled: busy, onClick: onEdit }, t('detail.edit')),
        entry.status !== 'completed' && h('button', { type: 'button', disabled: busy, onClick: runToggle },
          entry.status === 'active' ? t('detail.pause') : t('detail.resume')),
        !confirmingDelete && h('button', {
          type: 'button', className: 'dsh-cron-danger', disabled: busy,
          onClick: () => { setConfirmingDelete(true) },
        }, t('detail.delete')),
        confirmingDelete && h('span', { className: 'dsh-cron-confirm' },
          h('span', null, t('detail.confirmDelete')),
          h('button', {
            type: 'button', className: 'dsh-cron-danger', disabled: busy,
            onClick: runDelete,
          }, t('detail.delete')),
          h('button', { type: 'button', disabled: busy, onClick: () => { setConfirmingDelete(false) } }, t('form.cancel'))))),
    actionState.phase === 'error' && h('p', { className: 'dsh-cron-banner-error' }, actionState.message ?? ''),
    field(t('detail.workspace'), workspace?.name ?? entry.workspaceId ?? ''),
    field(t('detail.model'), entry.model ?? ''),
    field(t('detail.schedule'), summary),
    field(t('detail.next'), entry.nextAt ?? t('list.noNext')),
    field(t('detail.last'),
      `${entry.lastRunAt ?? ''} ${entry.lastRunStatus ?? ''}`.trim() || t('list.noNext')),
    field(t('detail.runs'), `${entry.runCount ?? 0}${entry.maxRuns === null ? '' : ` / ${entry.maxRuns}`}`),
    h('h4', { className: 'dsh-cron-history-title' }, t('detail.history')),
    snap.phase === 'error' && h('p', { className: 'dsh-cron-banner-error' }, `${t('error')}: ${snap.error ?? ''}`),
    (snap.runs ?? []).length === 0 && snap.phase === 'ready' && h('p', { className: 'dsh-cron-hint' }, t('detail.noRuns')),
    h('ul', { className: 'dsh-cron-runs' },
      (snap.runs ?? []).map(run => h(RunRow, { key: run.id, run, openSession, t }))),
    (snap.runs ?? []).length >= historyLimit && h('button', {
      type: 'button', className: 'dsh-cron-more',
      onClick: () => { setHistoryLimit(Math.min(historyLimit + 20, 200)) },
    }, t('detail.more')),
  )
}
