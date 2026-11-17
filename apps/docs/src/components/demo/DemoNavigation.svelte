<script lang="ts">
  interface RepoSummary {
    readonly id: string;
    readonly name: string;
    readonly branch: string;
    readonly path: string;
  }

  interface Props {
    activeRepositoryId: string;
    repositories: readonly RepoSummary[];
    changedCount: number;
    commitCount: number;
    onSelect: (id: string) => void;
    onFocusHistory: () => void;
    onFocusChanges: () => void;
  }
  let { activeRepositoryId, repositories, changedCount, commitCount, onSelect, onFocusHistory, onFocusChanges }: Props = $props();
</script>

<aside class="full-demo-navigation" aria-label="Repository navigation" data-testid="demo-navigation">
  <p class="full-demo-sidebar-title">WORKSPACE <span>DEMO</span></p>
  <div class="full-demo-nav-group" aria-label="Views">
    <button type="button" onclick={onFocusHistory}><span>⑂</span> History <small>{commitCount}</small></button>
    <button type="button" onclick={onFocusChanges}><span>◫</span> Working copy <small>{changedCount}</small></button>
    <div class="full-demo-nav-muted" title="Branch operations need a connected Git host"><span>⌥</span> Branches <small>preview</small></div>
    <div class="full-demo-nav-muted" title="Network operations are disabled in the offline demo"><span>◎</span> Remotes <small>offline</small></div>
    <div class="full-demo-nav-muted" title="Repository tags are not editable in the demo"><span>◇</span> Tags</div>
    <div class="full-demo-nav-muted" title="Worktree creation requires a local Git host"><span>⊞</span> Worktrees</div>
  </div>
  <div class="full-demo-sidebar-rule"></div>
  <p class="full-demo-sidebar-title">REPOSITORIES <span>{repositories.length}</span></p>
  <div class="full-demo-repository-list">
    {#each repositories as repo (repo.id)}
      <button
        type="button"
        aria-pressed={repo.id === activeRepositoryId}
        class:active={repo.id === activeRepositoryId}
        onclick={() => onSelect(repo.id)}
        data-testid={`demo-repo-card-${repo.id}`}
      >
        <strong><span>▣</span>{repo.name}</strong>
        <small>⑂ {repo.branch} <span>·</span> local preset</small>
        <span class="full-demo-repo-path">{repo.path}</span>
      </button>
    {/each}
  </div>
  <div class="full-demo-sidebar-foot">
    <span class="demo-status-led"></span> NO LIVE GIT CONNECTION
    <p>Sample repositories stay in browser memory. Nothing is fetched or uploaded.</p>
  </div>
</aside>
