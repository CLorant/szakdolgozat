<script lang="ts">
	import { onMount } from 'svelte';

	let isDark = false;

	function apply(dark: boolean) {
		isDark = dark;
		document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
		try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
	}

	function toggle() {
		apply(!isDark);
	}

	onMount(() => {
		let saved: string | null = null;
		try { saved = localStorage.getItem('theme'); } catch {}

		if (saved === 'dark' || saved === 'light') {
			apply(saved === 'dark');
		} else {
			apply(window.matchMedia('(prefers-color-scheme: dark)').matches);
		}
	});
</script>

<button
	class="theme-toggle"
	on:click={toggle}
	title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
	aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
>
	{#if isDark}
		<img src="src/assets/icons/sun.svg" alt="Light mode" class="icon">
	{:else}
		<img src="src/assets/icons/moon.svg" alt="Dark mode" class="icon">
	{/if}
</button>

<style>
	.theme-toggle {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		cursor: pointer;
		font-size: 1rem;
		color: var(--text-color);
		margin-right: 0.5rem;
	}

	.theme-toggle:hover {
		background: var(--ruler-bg);
	}
</style>