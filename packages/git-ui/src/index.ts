/**
 * `@refyard/git-ui` — the workbench components.
 *
 * Everything here is driven by props and an injected `GitService`, and nothing imports
 * `$app/*`, so the same components can be mounted by the SvelteKit app, by a future
 * Kunkun plugin, or by a test harness. Routing and connection configuration are the
 * app's job; this package renders Git data and the states around it.
 */

export { default as Badge } from "./ui/Badge.svelte";
export { default as Button } from "./ui/Button.svelte";
export { default as Input } from "./ui/Input.svelte";

export { default as CommitDetailPanel } from "./components/CommitDetailPanel.svelte";
export { default as CommitGraph } from "./components/CommitGraph.svelte";
export { default as CommitList } from "./components/CommitList.svelte";
export { default as ConnectionPanel } from "./components/ConnectionPanel.svelte";
export { default as DiffPanel } from "./components/DiffPanel.svelte";
export { default as RefsPanel } from "./components/RefsPanel.svelte";
export { default as RepositoryList } from "./components/RepositoryList.svelte";
export {
  default as StateBanner,
  type BannerState,
} from "./components/StateBanner.svelte";
export { default as StatusList } from "./components/StatusList.svelte";

export * from "./lib/format.js";
export * from "./lib/geometry.js";
export { cn } from "./lib/utils.js";
