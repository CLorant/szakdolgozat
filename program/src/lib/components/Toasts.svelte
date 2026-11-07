<script lang="ts">
  /**
   * @file Bottom-centre notifications (see stores/notify.ts).
   */
  import { toasts, dismiss } from '../stores/notify';
</script>

<div class="toasts" aria-live="polite">
  {#each $toasts as t (t.id)}
    <div class="toast {t.kind}" role={t.kind === 'error' ? 'alert' : 'status'}>
      <span class="msg">{t.message}</span>
      <button class="x" on:click={() => dismiss(t.id)} aria-label="Dismiss">✕</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
    display: flex; flex-direction: column; gap: 6px; z-index: 5000; pointer-events: none;
    max-width: min(560px, 92vw);
  }
  .toast {
    pointer-events: auto; display: flex; align-items: flex-start; gap: 10px;
    padding: 8px 10px 8px 14px; border-radius: 6px; font-size: 0.85rem;
    background: var(--bg-color); color: var(--text-color);
    border: 1px solid var(--border-color); border-left: 4px solid var(--accent-color);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
  }
  .toast.warn  { border-left-color: #e67e22; }
  .toast.error { border-left-color: #e74c3c; }
  .msg { flex: 1; white-space: pre-line; }
  .x { background: transparent; border: none; color: inherit; opacity: 0.5; cursor: pointer; padding: 0 2px; font-size: 0.8rem; }
  .x:hover { opacity: 1; }
</style>
