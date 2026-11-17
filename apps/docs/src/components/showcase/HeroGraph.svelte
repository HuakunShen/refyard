<script lang="ts">
  /** The same production SVG graph renderer used by the full Refyard workbench. */
  import { CommitGraph } from "@refyard/git-ui";
  import { layoutGraph } from "@refyard/git-graph";
  import { makeDemoFixture } from "../../lib/demo/fixtures.js";

  const commits = makeDemoFixture().commits.slice(0, 12);
  const graph = layoutGraph(commits.map((commit) => ({
    id: commit.oid, parentIds: commit.parents, refNames: commit.refNames,
  })));
  let active = $state(0);

  function navigate(event: KeyboardEvent): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = Math.min(commits.length - 1, Math.max(0, active + (event.key === "ArrowDown" ? 1 : -1)));
      if (event.currentTarget instanceof HTMLButtonElement) {
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[active]?.focus();
      }
    }
  }
</script>

<div class="hero-graph" role="region" aria-label="Interactive real Git graph preview" data-testid="hero-graph">
  <div class="hero-window-top">
    <div class="hero-window-dots"><i></i><i></i><i></i></div>
    <span>refyard — commit history</span>
    <span class="hero-window-branch">⑂ main</span>
  </div>
  <div class="hero-graph-toolbar">
    <span>BRANCH / TAG</span><span>GRAPH</span><span>COMMIT MESSAGE</span><span>SHA</span>
  </div>
  <div class="hero-graph-body">
    <svg aria-hidden="true" class="hero-graph-svg" width="92" height={commits.length * 28} viewBox={`0 0 92 ${commits.length * 28}`}>
      <CommitGraph rows={graph.rows} startIndex={0} selectedOid={commits[active]?.oid ?? null} />
    </svg>
    <div class="hero-graph-rows">
      {#each commits as commit, index (commit.oid)}
        <button
          type="button"
          class:chosen={active === index}
          onfocus={() => active = index}
          onkeydown={navigate}
          onclick={() => active = index}
          aria-pressed={active === index}
          data-testid={`hero-commit-${index}`}
        >
          <span class="hero-commit-tags">{index === 0 ? "main" : index === 4 ? "feature/graph" : index === 7 ? "merge" : ""}</span>
          <span class="hero-commit-subject">{commit.subject}</span>
          <span class="hero-commit-sha">{commit.oid.slice(-7)}</span>
        </button>
      {/each}
    </div>
  </div>
  <div class="hero-window-bottom">
    <span><b class="hero-accent-dot"></b> LOCAL REPOSITORY</span>
    <span>{commits[active]?.authorName} · {commits[active]?.oid.slice(-8)}</span>
    <span>↑ ↓ NAVIGATE</span>
  </div>
</div>
