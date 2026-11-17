<script lang="ts">
  /** A genuine DiffPanel over a synthetic, contract-validated text patch. */
  import { DiffPanel } from "@refyard/git-ui";
  import { makeDemoFixture } from "../../lib/demo/fixtures.js";

  const fixture = makeDemoFixture();
  const firstCommit = fixture.commits[2];
  const diff = firstCommit ? fixture.diffsByOid[firstCommit.oid] ?? null : null;
  let pathId = $state<string | null>(diff?.files[0]?.pathId ?? null);
</script>

<div class="showcase-real-diff" data-testid="showcase-real-diff">
  <div class="showcase-real-diff-head"><span>PATCH REVIEW</span><span>src / components / CommitGraph.svelte</span><span>+1 −1</span></div>
  <DiffPanel {diff} selectedPathId={pathId} onSelectPath={(file) => pathId = file.pathId} />
</div>
