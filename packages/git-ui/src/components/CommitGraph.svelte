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
   *
   * A commit whose author maps to a GitHub photo draws that photo as the node —
   * ringed in the lane colour, GitKraken-style — instead of a plain dot. A photo
   * that fails to load falls back to the dot; an author without one never had it.
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
    /** GitHub avatar URL per commit oid; commits absent from it draw plain dots. */
    avatarByOid?: ReadonlyMap<string, string>;
    /** Widens strokes and dots for the selected row. */
    selectedOid?: string | null;
  }

  let {
    rows,
    startIndex,
    metrics = DEFAULT_METRICS,
    avatarByOid = undefined,
    selectedOid = null,
  }: Props = $props();

  const geometries = $derived(
    rows.map((row, offset) => ({
      row,
      index: startIndex + offset,
      geometry: rowGeometry(row, startIndex + offset, metrics),
    })),
  );

  // The avatar keeps a photo-sized node even when the lanes are squeezed; the
  // ring rides just outside it.
  const avatarRadius = $derived(
    Math.max(6, Math.min(9, metrics.rowHeight / 2 - 5)),
  );

  let failedAvatars = $state<ReadonlySet<string>>(new Set());
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
    {@const avatarUrl = avatarByOid?.get(entry.row.id)}
    {@const failed = failedAvatars.has(entry.row.id)}
    {@const nodeRadius =
      avatarUrl !== undefined && !failed ? avatarRadius : metrics.radius}
    {#if entry.row.id === selectedOid}
      <circle
        cx={entry.geometry.circle.cx}
        cy={entry.geometry.circle.cy}
        r={nodeRadius + 1.5}
        fill="none"
        stroke={entry.geometry.circle.paint}
        stroke-width="1.5"
      />
    {/if}
    {#if avatarUrl !== undefined && !failed}
      <circle
        cx={entry.geometry.circle.cx}
        cy={entry.geometry.circle.cy}
        r={avatarRadius + 1}
        fill="var(--color-panel, currentColor)"
        stroke={entry.geometry.circle.paint}
        stroke-width="1.5"
      />
      <clipPath id={`graph-avatar-${entry.row.id}`}>
        <circle
          cx={entry.geometry.circle.cx}
          cy={entry.geometry.circle.cy}
          r={avatarRadius}
        ></circle>
      </clipPath>
      <image
        href={avatarUrl}
        x={entry.geometry.circle.cx - avatarRadius}
        y={entry.geometry.circle.cy - avatarRadius}
        width={avatarRadius * 2}
        height={avatarRadius * 2}
        clip-path="url(#graph-avatar-{entry.row.id})"
        preserveAspectRatio="xMidYMid slice"
        onerror={() => {
          failedAvatars = new Set(failedAvatars).add(entry.row.id);
        }}
      ></image>
    {:else}
      <circle
        cx={entry.geometry.circle.cx}
        cy={entry.geometry.circle.cy}
        r={metrics.radius}
        fill={entry.geometry.circle.paint}
        stroke="var(--color-panel, currentColor)"
        stroke-width="1"
      />
    {/if}
  {/each}
</g>
