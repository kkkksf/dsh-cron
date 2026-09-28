/**
 * The create/edit form component: typed serialization and client-side
 * pre-validation live in form-logic.js (host validation stays
 * authoritative); this module owns the React surface and the conflict
 * notice flow.
 */

import { createElement as h, useState } from 'react'
import { validateDraft, serializeForm, draftFromEntry, TIMEZONES, optionsWithCurrent } from './form-logic.js'

/** One labeled input row with its inline error. */
function Field({ label, error, children }) {
  return h('label', { className: 'dsh-cron-form-field' },
    h('span', { className: 'dsh-cron-field-label' }, label),
    children,
    error !== undefined && h('span', { className: 'dsh-cron-form-error' }, error),
  )
}

/**
 * The create/edit form component.
 * @param {object} props - mode ('create'|'edit'), entry (edit baseline), workspaces, defaults, callbacks.
 */
export function CronForm(props) {
  const t = props.t ?? (() => '')
  const entry = props.entry
  const [draft, setDraft] = useState(() => ({
    ...draftFromEntry(entry),
    model: entry?.model ?? props.defaultModel ?? '',
    workspaceId: entry?.workspaceId ?? props.defaultWorkspaceId ?? '',
    // The select always shows a concrete zone; create starts at the default.
    timeZone: entry?.schedule?.timeZone ?? props.defaultTimeZone ?? TIMEZONES[0],
  }))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const edit = (key, value) => { setDraft(current => ({ ...current, [key]: value })) }

  const submit = async () => {
    const errors = validateDraft(draft)
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return
    setBusy(true)
    setNotice(null)
    try {
      const outcome = await props.onSubmit(draft, serializeForm(draft))
      if (outcome === 'conflict') setNotice('form.conflict')
      else if (outcome !== true && typeof outcome === 'string') setNotice(outcome)
    } catch (error) {
      setNotice(String(error?.message ?? error))
    } finally {
      setBusy(false)
    }
  }

  const err = (key) => (fieldErrors[key] === undefined ? undefined : t(fieldErrors[key]))

  return h('div', { className: 'dsh-cron-detail dsh-cron-form' },
    h('div', { className: 'dsh-cron-detail-head' },
      h('h3', { className: 'dsh-cron-detail-title' }, t(props.mode === 'create' ? 'form.newTitle' : 'form.editTitle')),
      h('div', { className: 'dsh-cron-detail-actions' },
        h('button', { type: 'button', disabled: busy, onClick: submit }, busy ? t('form.saving') : t('form.save')),
        h('button', { type: 'button', disabled: busy, onClick: props.onCancel }, t('form.cancel')))),
    notice !== null && h('p', { className: 'dsh-cron-banner-error' }, notice === 'form.conflict' ? t('form.conflict') : notice),
    h(Field, { label: t('form.title'), error: err('title') },
      h('input', { type: 'text', value: draft.title, onChange: e => { edit('title', e.target.value) } })),
    h(Field, { label: t('form.workspace'), error: err('workspaceId') },
      h('select', {
        value: draft.workspaceId,
        onChange: e => { edit('workspaceId', e.target.value) },
      }, (props.workspaces ?? []).map(w =>
        h('option', { key: w.id, value: w.id }, w.name ?? w.id)))),
    h(Field, { label: t('form.model'), error: err('model') },
      h('select', {
        value: draft.model,
        onChange: e => { edit('model', e.target.value) },
      }, h('option', { value: '' }, t('form.modelPlaceholder')),
        optionsWithCurrent(props.models, draft.model).map(route =>
          h('option', { key: route, value: route }, route)))),
    h(Field, { label: t('form.scheduleKind'), error: undefined },
      h('select', { value: draft.kind, onChange: e => { edit('kind', e.target.value) } },
        h('option', { value: 'cron' }, t('form.kindCron')),
        h('option', { value: 'interval' }, t('form.kindInterval')),
        h('option', { value: 'once' }, t('form.kindOnce')))),
    draft.kind === 'cron' && h(Field, { label: t('form.cronExpression'), error: err('cronExpression') },
      h('input', { type: 'text', value: draft.cronExpression, placeholder: '0 9 * * 1-5',
        onChange: e => { edit('cronExpression', e.target.value) } }),
      h('select', { value: draft.timeZone, onChange: e => { edit('timeZone', e.target.value) } },
        optionsWithCurrent(TIMEZONES, draft.timeZone).map(zone =>
          h('option', { key: zone, value: zone }, zone))),
      err('cronExpression') === undefined && h('span', { className: 'dsh-cron-form-hint' }, t('form.cronHint'))),
    draft.kind === 'interval' && h(Field, { label: t('form.interval'), error: err('interval') },
      h('input', { type: 'number', min: '1', value: draft.interval,
        onChange: e => { edit('interval', e.target.value) } }),
      h('select', { value: draft.intervalUnit, onChange: e => { edit('intervalUnit', e.target.value) } },
        ['minute', 'hourly', 'daily', 'weekly'].map(unit =>
          h('option', { key: unit, value: unit }, unit)))),
    draft.kind === 'once' && h(Field, { label: t('form.delayMinutes'), error: err('delayMinutes') },
      h('input', { type: 'number', min: '1', value: draft.delayMinutes,
        onChange: e => { edit('delayMinutes', e.target.value) } })),
    h(Field, { label: t('form.maxRuns'), error: err('maxRuns') },
      h('input', { type: 'number', min: '1', value: draft.maxRuns,
        onChange: e => { edit('maxRuns', e.target.value) } })),
    h(Field, { label: t('form.prompt'), error: err('prompt') },
      h('textarea', { rows: 6, value: draft.prompt,
        onChange: e => { edit('prompt', e.target.value) } })),
  )
}
