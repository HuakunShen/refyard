<script lang="ts">
  /**
   * The lane lines and circles for a slice of rows.
   *
   * This component draws only what it is given — the caller passes the rows that are
   * actually visible — and it is positioned by the caller, so it can live inside a
   * virtualized list without knowing about scrolling, or inside a test without a browser.
   *
   * Two properties are load-bearing and come from the metrics rather than from CSS:
   * the row height is the list's row height (so a circle is never off its text), and the
   * lane colours are CSS variables (so a theme change never touches this file).
   */
  import type { GraphRow } from "@refyard/git-graph";
  import {
    DEFAULT_METRICS,
    rowGeometry,
    type GraphMetrics,
  } from "../lib/geometry.js";

  interface Props {
    /** Visible rows only, starting at `startIndex`. */
    rows: readonly GraphRow[];
    /** Absolute index of `rows[0]`, which is what turns an index into a y position. */
    startIndex: number;
    metrics?: GraphMetrics;
    /** Widens strokes and dots for the selected row. */
    selectedOid?: string | null;
  }

  let {
    rows,
    startIndex,
    metrics = DEFAULT_METRICS,
    selectedOid = null,
  }: Props = $props();

  const geometries = $derived(
    rows.map((row, offset) => ({
      row,
      index: startIndex + offset,
      geometry: rowGeometry(row, startIndex + offset, metrics),
    })),
  );
</script>

<g>
  {#each geometries as entry (entry.row.id + ":" + entry.index)}
    {#each entry.geometry.segments as segment, segmentIndex (segmentIndex)}
      <path
        d={segment.path}
        fill="none"
        stroke={segment.paint}
        stroke-width="2"
        stroke-linecap="round"
      />
    {/each}
    {#if entry.row.id === selectedOid}
      <circle
        cx={entry.geometry.circle.cx}
        cy={entry.geometry.circle.cy}
        r={metrics.radius + 1.5}
        fill="none"
        stroke={entry.geometry.circle.paint}
        stroke-width="1.5"
      />
    {/if}
    <circle
      cx={entry.geometry.circle.cx}
      cy={entry.geometry.circle.cy}
      r={metrics.radius}
      fill={entry.geometry.circle.paint}
      stroke="var(--color-panel, currentColor)"
      stroke-width="1"
    />
  {/each}
</g>
