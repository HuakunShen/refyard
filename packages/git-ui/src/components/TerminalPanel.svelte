<!--
	The bottom terminal dock: one tab per shell, a `+` for another, and the
	panel's close. Everything transport-specific stays outside — this component
	receives the session's `TerminalService` and stays honest when it is null:
	"no terminal here" is a message, never a button that can only fail.
-->
<script lang="ts">
	import Plus from "@lucide/svelte/icons/plus";
	import X from "@lucide/svelte/icons/x";
	import TerminalSquare from "@lucide/svelte/icons/square-terminal";
	import type { TerminalOpenResponse } from "@refyard/git-contract";
	import type { TerminalService } from "@refyard/git-service";
	import { m } from "../i18n.js";
	import TerminalTabView from "./TerminalTabView.svelte";

	let {
		terminal,
		repositoryId,
		onClose,
	}: {
		terminal: TerminalService | null;
		repositoryId: string | null;
		onClose: () => void;
	} = $props();

	interface TerminalTab {
		key: string;
		view: TerminalTabView | null;
		title: string;
		status: "starting" | "live" | "exited";
		exitCode: number | null;
	}

	let tabs = $state<TerminalTab[]>([]);
	let activeKey = $state<string | null>(null);
	let nextKey = 1;

	const active = $derived(tabs.find((tab) => tab.key === activeKey) ?? null);
	const usable = $derived(terminal !== null && repositoryId !== null);

	function createTab(): void {
		if (!usable) {
			return;
		}
		const key = `terminal-${nextKey}`;
		nextKey += 1;
		tabs = [
			...tabs,
			{
				key,
				view: null,
				title: "…",
				status: "starting",
				exitCode: null,
			},
		];
		activeKey = key;
	}

	function closeTab(tab: TerminalTab): void {
		void tab.view?.destroy();
		const index = tabs.findIndex((entry) => entry.key === tab.key);
		tabs = tabs.filter((entry) => entry.key !== tab.key);
		if (activeKey === tab.key) {
			activeKey = tabs[Math.min(index, tabs.length - 1)]?.key ?? null;
		}
	}

	async function closePanel(): Promise<void> {
		for (const tab of tabs) {
			await tab.view?.destroy();
		}
		tabs = [];
		activeKey = null;
		onClose();
	}

	function onReady(tab: TerminalTab, info: TerminalOpenResponse): void {
		tab.title = info.shell;
		tab.status = "live";
		tabs = [...tabs];
	}

	function onExit(tab: TerminalTab, exitCode: number | null): void {
		tab.status = "exited";
		tab.exitCode = exitCode;
		tabs = [...tabs];
	}
</script>

<section
	class="relative flex min-h-0 flex-col border-t border-border bg-background"
	data-testid="terminal-panel"
>
	<header
		class="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2"
	>
		<TerminalSquare class="mr-1 size-3.5 opacity-60" aria-hidden="true" />
		{#each tabs as tab (tab.key)}
			<button
				type="button"
				class="group flex h-7 items-center gap-1.5 rounded px-2 text-xs
					{tab.key === activeKey
					? 'bg-accent text-accent-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (activeKey = tab.key)}
				data-testid="terminal-tab"
			>
				<span class="font-mono">{tab.title}</span>
				{#if tab.status === "exited"}
					<span class="text-[10px] opacity-60">
						{tab.exitCode === null
							? m.terminal_exit_unknown()
							: m.terminal_exited({ code: tab.exitCode })}
					</span>
				{/if}
				<span
					role="button"
					tabindex="-1"
					class="rounded p-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100"
					aria-label={m.terminal_close_tab()}
					onclick={(event) => {
						event.stopPropagation();
						closeTab(tab);
					}}
					onkeydown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.stopPropagation();
							closeTab(tab);
						}
					}}
				>
					<X class="size-3" />
				</span>
			</button>
		{/each}
		<button
			type="button"
			class="flex h-7 items-center rounded px-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
			aria-label={m.terminal_new()}
			title={m.terminal_new()}
			onclick={createTab}
			disabled={!usable}
			data-testid="terminal-new"
		>
			<Plus class="size-3.5" />
		</button>
		<span class="flex-1"></span>
		{#if active?.status === "live"}
			<span class="truncate font-mono text-[10px] text-muted-foreground">
				{active.title}
			</span>
		{/if}
		<button
			type="button"
			class="flex h-7 items-center rounded px-1.5 text-muted-foreground hover:text-foreground"
			aria-label={m.terminal_close_panel()}
			title={m.terminal_close_panel()}
			onclick={() => void closePanel()}
			data-testid="terminal-close"
		>
			<X class="size-3.5" />
		</button>
	</header>

	<div class="relative min-h-0 flex-1">
		{#if terminal !== null && repositoryId !== null}
			{#each tabs as tab (tab.key)}
				<TerminalTabView
					bind:this={tab.view}
					terminal={terminal}
					repositoryId={repositoryId}
					active={tab.key === activeKey}
					onReady={(info) => onReady(tab, info)}
					onExit={(code) => onExit(tab, code)}
				/>
			{/each}
			{#if tabs.length === 0}
				<div
					class="flex h-full items-center justify-center text-sm text-muted-foreground"
				>
					{m.terminal_new_hint()}
				</div>
			{/if}
		{:else}
			<div
				class="flex h-full items-center justify-center text-sm text-muted-foreground"
			>
				{m.terminal_unavailable()}
			</div>
		{/if}
	</div>
</section>
