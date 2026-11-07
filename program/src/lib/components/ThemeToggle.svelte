<script lang="ts">
  /**
   * @file Light / dark theme switch. The saved theme is applied by the inline script in index.html before the first
   * paint (no flash); this component reads it and changes it.
   */
  import { onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';

  let isDark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';

  /**
   * The switch is instant for EVERYTHING. Buttons and inputs have a short background transition for
   * hover feedback; during a theme change that made only those controls fade while the rest of the UI
   * jumped, which looked inconsistent. A one-frame class turns every transition off, so all colors
   * change on the same frame, and hover transitions come back right after.
   */
  function apply(dark: boolean) {
    const root = document.documentElement;
    root.classList.add('theme-switching');
    isDark = dark;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* private mode */ }
    void root.offsetWidth;                                  // flush styles while transitions are off
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  }

  onMount(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') isDark = attr === 'dark';
    else apply(window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? false);
  });
</script>

<button
  class="theme-toggle"
  on:click={() => apply(!isDark)}
  title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
  aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
>
  <Icon name={isDark ? 'sun' : 'moon'} alt={isDark ? 'Light mode' : 'Dark mode'} />
</button>

<style>
	.theme-toggle {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-size: 1rem;
		color: var(--text-color);
		margin-right: 0.25rem;
	}

	.theme-toggle:hover {
		background: var(--ruler-bg);
	}
</style>
