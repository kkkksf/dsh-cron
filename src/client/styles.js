/**
 * Panel styles: one injected <style> element, class prefix dsh-cron-*, all
 * colors/fonts/radii through the shared --dsw-* theme tokens so dark mode
 * follows automatically. Injected once from the entry.
 */

/** Idempotently install the panel stylesheet. */
export function installStyles() {
  const id = 'dsh-cron-styles'
  if (document.getElementById(id) !== null) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = `
.dsh-cron-page { display: flex; height: 100%; min-height: 0; font-size: 13px;
  color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); }
.dsh-cron-master { display: flex; flex-direction: column; min-width: 320px; width: 38%;
  border-right: 1px solid var(--dsw-alias-border-inverted); padding: 16px 12px; gap: 8px; min-height: 0; }
.dsh-cron-page.dsh-cron-has-detail .dsh-cron-master { width: 34%; }
.dsh-cron-detail { flex: 1; overflow-y: auto; padding: 20px 24px; min-width: 0; }
.dsh-cron-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsh-cron-search { flex: 1; min-width: 120px; padding: 5px 10px; border-radius: var(--dsw-radius-sm);
  border: 1px solid var(--dsw-alias-border-inverted); background: transparent;
  color: var(--dsw-alias-label-primary); font-size: 13px; }
.dsh-cron-filters { display: flex; gap: 4px; }
.dsh-cron-chip { padding: 4px 10px; border-radius: 999px; border: 1px solid transparent;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; }
.dsh-cron-chip:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-cron-chip-active { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
.dsh-cron-new { padding: 4px 10px; border-radius: var(--dsw-radius-sm); cursor: pointer; font-size: 12px;
  border: 1px solid var(--dsw-alias-border-inverted); background: transparent; color: var(--dsw-alias-label-primary); }
.dsh-cron-new:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-cron-new:disabled { opacity: .5; cursor: not-allowed; }
.dsh-cron-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; min-height: 0; }
.dsh-cron-row { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  padding: 8px 10px; border-radius: var(--dsw-radius-sm); border: none; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; }
.dsh-cron-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-cron-row-selected { background: var(--dsw-alias-interactive-bg-active); }
.dsh-cron-row-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.dsh-cron-row-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-cron-row-sub { color: var(--dsw-alias-label-secondary); font-size: 12px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.dsh-cron-row-badge { font-size: 11px; color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-inverted); border-radius: 999px; padding: 1px 8px;
  max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-cron-dot, .dsh-cron-run-status { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dsh-cron-dot-active, .dsh-cron-run-succeeded, .dsh-cron-run-claimed, .dsh-cron-run-running { background: var(--dsw-alias-state-success-primary); }
.dsh-cron-run-running, .dsh-cron-run-claimed { background: var(--dsw-alias-state-warn-primary); }
.dsh-cron-dot-paused { background: var(--dsw-alias-label-secondary); }
.dsh-cron-dot-completed, .dsh-cron-run-failed { background: var(--dsw-alias-state-error-primary); }
.dsh-cron-run-skipped { background: var(--dsw-alias-state-warn-primary); }
.dsh-cron-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; margin: 8px 0; }
.dsh-cron-banner-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; margin: 0 0 8px; }
.dsh-cron-detail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.dsh-cron-detail-title { margin: 0; font-size: 16px; font-weight: 600; }
.dsh-cron-detail-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.dsh-cron-detail-actions button, .dsh-cron-confirm button { padding: 4px 10px; border-radius: var(--dsw-radius-sm);
  border: 1px solid var(--dsw-alias-border-inverted); background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-primary); font-size: 12px; }
.dsh-cron-detail-actions button:hover:not(:disabled), .dsh-cron-confirm button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-cron-detail-actions button:disabled, .dsh-cron-confirm button:disabled { opacity: .5; cursor: not-allowed; }
.dsh-cron-danger { color: var(--dsw-alias-state-error-primary) !important; }
.dsh-cron-confirm { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; color: var(--dsw-alias-state-warn-label); }
.dsh-cron-field { display: grid; grid-template-columns: 90px 1fr; gap: 8px; padding: 4px 0; align-items: baseline; }
.dsh-cron-field-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-cron-field-value { word-break: break-all; }
.dsh-cron-history-title { margin: 16px 0 8px; font-size: 13px; }
.dsh-cron-runs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.dsh-cron-run { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.dsh-cron-run-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.dsh-cron-run-sub { color: var(--dsw-alias-state-error-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-cron-run-open { padding: 2px 8px; border-radius: var(--dsw-radius-sm); border: 1px solid var(--dsw-alias-border-inverted);
  background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 11px; }
.dsh-cron-run-open:disabled { opacity: .5; cursor: not-allowed; }
.dsh-cron-more { margin-top: 8px; padding: 4px 10px; border-radius: var(--dsw-radius-sm);
  border: 1px solid var(--dsw-alias-border-inverted); background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-cron-form-field { display: grid; grid-template-columns: 120px 1fr; gap: 8px; padding: 6px 0;
  align-items: baseline; }
.dsh-cron-form-field input, .dsh-cron-form-field select, .dsh-cron-form-field textarea {
  padding: 5px 8px; border-radius: var(--dsw-radius-sm); border: 1px solid var(--dsw-alias-border-inverted);
  background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; width: 100%;
  box-sizing: border-box; }
.dsh-cron-form-field input:not(:last-child) { margin-bottom: 4px; }
.dsh-cron-form-error { grid-column: 2; color: var(--dsw-alias-state-error-primary); font-size: 11px; }
.dsh-cron-detail-empty { display: flex; align-items: center; justify-content: center; }
`
  document.head.appendChild(style)
}
