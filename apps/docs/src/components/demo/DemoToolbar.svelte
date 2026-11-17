<script lang="ts">
  /** Navigation and reset actions around the isolated static Git sandbox. */
  import { RefyardLogo } from "@refyard/git-ui";

  interface Props {
    onReset: () => void;
    revision: number;
  }

  let { onReset, revision }: Props = $props();
</script>

<header class="demo-toolbar">
  <a class="demo-brand" href="/showcase/" aria-label="Refyard showcase">
    <RefyardLogo variant="mark" size={35} />
    <span>refyard<span class="demo-brand-dot">.</span></span>
  </a>
  <div class="demo-toolbar-center">
    <span class="demo-live-dot" aria-hidden="true"></span>
    <span>LOCAL SANDBOX</span>
    <span class="demo-toolbar-divider"></span>
    <span class="demo-revision">{revision === 0 ? "PRESET DATA" : `${revision} SIMULATED COMMIT${revision === 1 ? "" : "S"}`}</span>
  </div>
  <nav class="demo-toolbar-actions" aria-label="Demo navigation">
    <button type="button" class="demo-reset" onclick={onReset} data-testid="demo-reset">Reset demo <span>↺</span></button>
    <a class="demo-text-link" href="/">Docs</a>
    <a class="demo-text-link" href="https://github.com/HuakunShen/refyard" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
  </nav>
</header>
