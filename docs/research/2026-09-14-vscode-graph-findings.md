# VS Code SCM history graph — implementation findings

Research note for Refyard `packages/git-graph` (lane layout) and `packages/git-ui` (SVG + virtualized list).
Scope: the Source Control Graph of VS Code (`contrib/scm`). The git extension itself only supplies
`parentIds` (`git log --parents`, first parent first) and ref decorations; no lane logic lives there.

## Status block

| Item                           | Value                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Repository                     | `/Volumes/Portable2TB/ExtDev/others/vscode` (symlinked as `references/open-source/vscode` in this workspace) |
| `git -C <repo> rev-parse HEAD` | `9f5fa1ea77f3b254c7c7fb4e4ebc5d7266561121`                                                                   |
| HEAD commit date / subject     | 2026-07-07 14:57:16 +0200 — "Merge pull request #324737 from microsoft/cherry-pick/324735"                   |
| License                        | MIT (`LICENSE.txt`)                                                                                          |
| Working tree                   | clean, no local modifications                                                                                |

Files inspected (line counts from `wc -l` unless marked):

| File                                                           | Lines                                                  | What it contains                                                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/vs/workbench/contrib/scm/browser/scmHistory.ts`           | 607                                                    | The whole graph: lane layout (`toISCMHistoryItemViewModelArray`), SVG rendering (`renderSCMHistoryItemGraph`, `renderSCMHistoryGraphPlaceholder`), ref ordering, palette, geometry constants |
| `src/vs/workbench/contrib/scm/browser/scmHistoryViewPane.ts`   | 2248                                                   | Tree/view model, renderers, virtualized list wiring, pagination (`loadMore`), color map                                                                                                      |
| `src/vs/workbench/contrib/scm/common/history.ts`               | 114                                                    | `ISCMHistoryItem`, `ISCMHistoryItemGraphNode`, `ISCMHistoryItemViewModel` types                                                                                                              |
| `src/vs/workbench/contrib/scm/test/browser/scmHistory.test.ts` | 963                                                    | The only tests for the layout (9 cases, lane ids + colors)                                                                                                                                   |
| `src/vs/workbench/contrib/scm/browser/media/scm.css`           | graph rules at lines 140–215, 745–790                  | Row/lane alignment and hover/selection circle styling                                                                                                                                        |
| `src/vs/workbench/contrib/scm/browser/scm.contribution.ts`     | `scm.graph.*` at lines 385–410                         | `pageOnScroll` (default `true`), `pageSize` (default `50`, min 1, max 1000), `badges`, incoming/outgoing toggles                                                                             |
| `src/vs/base/common/objects.ts`                                | `deepClone` at lines 8–22                              | Shallow-object recursive clone used per lane                                                                                                                                                 |
| `src/vs/base/common/numbers.ts`                                | `rot` at lines 28–30                                   | `(modulo + (index % modulo)) % modulo`                                                                                                                                                       |
| `src/vs/base/common/arraysFind.ts`                             | `findLastIdx` at lines 18–28                           | Last index match scan                                                                                                                                                                        |
| `extensions/git/src/git.ts`                                    | `log()` at lines ~1450–1505, `parseGitCommits` at 928+ | `--topo-order --decorate=full`, `%P` parents split on space → first parent first                                                                                                             |

Searches performed: `grep -rn "inputSwimlanes|swimlane|renderSCMHistoryItemGraph"` over `src/` and
`extensions/` — `scmHistory.ts` is the **only** swimlane implementation in the repository, and
`renderSCMHistoryItemGraph` has exactly one call site (`scmHistoryViewPane.ts:491`). No component
fixture, no e2e test, and no git-extension test covers the geometry.

---

## 1. The lane data structure

A "swimlane" is **not** a linked list and has no lane index field: it is an entry in a plain array,
and its **array index is the lane index**. There are exactly two lanes arrays per row:

- `inputSwimlanes` — the lanes as they arrive from the row above. It is a deep clone of the previous
  row's `outputSwimlanes` (`viewModels.at(-1)?.outputSwimlanes ?? []`).
- `outputSwimlanes` — the lanes as they leave this row toward the row below. It is the state that
  carries the whole graph forward; there is no other continuation object.

Each entry is a _pending parent_: an object-id that some lane is currently "waiting for", plus the
color that lane carries. The commit currently being laid out is located by searching for its **own
id** inside `inputSwimlanes` — the lane whose pending parent is this commit.

`src/vs/workbench/contrib/scm/common/history.ts:78-88` (verbatim):

```ts
export interface ISCMHistoryItemGraphNode {
  readonly id: string;
  readonly color: ColorIdentifier;
}

export interface ISCMHistoryItemViewModel {
  readonly historyItem: ISCMHistoryItem;
  readonly inputSwimlanes: ISCMHistoryItemGraphNode[];
  readonly outputSwimlanes: ISCMHistoryItemGraphNode[];
  readonly kind: "HEAD" | "node" | "incoming-changes" | "outgoing-changes";
}
```

Notes that matter for a reimplementation:

- Arrays are mutable in practice; the code uses `deepClone` when copying a lane into the next row, so
  each row owns its lane objects (`scmHistory.ts:310`, `:330`).
- A lane may repeat an id (`[d(color0), d(color1)]`) and may be dropped without any explicit close
  marker — sections 2 and 3 explain when.
- The rendered width is not stored; it is derived per row from `max(input.length, output.length, 1)`.

---

## 2. The layout algorithm

Two functions, cleanly separated:

- `toISCMHistoryItemViewModelArray(historyItems, ...)` (`scmHistory.ts:292-407`) is the **layout**: a
  pure left-to-right fold over the commit list that computes `inputSwimlanes`/`outputSwimlanes` per
  commit. This is the function to port.
- `renderSCMHistoryItemGraph(viewModel)` (`scmHistory.ts:124-275`) is a **stateless per-row renderer**
  (section 4). It never looks at other rows.

Core of the layout (`scmHistory.ts:302-356`, verbatim):

```ts
	let colorIndex = -1;
	const viewModels: ISCMHistoryItemViewModel[] = [];

	for (let index = 0; index < historyItems.length; index++) {
		const historyItem = historyItems[index];

		const kind = historyItem.id === currentHistoryItemRef?.revision ? 'HEAD' : 'node';
		const outputSwimlanesFromPreviousItem = viewModels.at(-1)?.outputSwimlanes ?? [];
		const inputSwimlanes = outputSwimlanesFromPreviousItem.map(i => deepClone(i));
		const outputSwimlanes: ISCMHistoryItemGraphNode[] = [];

		let firstParentAdded = false;

		// Add first parent to the output
		if (historyItem.parentIds.length > 0) {
			for (const node of inputSwimlanes) {
				if (node.id === historyItem.id) {
					if (!firstParentAdded) {
						outputSwimlanes.push({
							id: historyItem.parentIds[0],
							color: getLabelColorIdentifier(historyItem, colorMap) ?? node.color
						});
						firstParentAdded = true;
					}

					continue;
				}

				outputSwimlanes.push(deepClone(node));
			}
		}

		// Add unprocessed parent(s) to the output
		for (let i = firstParentAdded ? 1 : 0; i < historyItem.parentIds.length; i++) {
			// Color index (label -> next color)
			let colorIdentifier: string | undefined;

			if (i === 0) {
				colorIdentifier = getLabelColorIdentifier(historyItem, colorMap);
			} else {
				const historyItemParent = historyItems
					.find(h => h.id === historyItem.parentIds[i]);
				colorIdentifier = historyItemParent ? getLabelColorIdentifier(historyItemParent, colorMap) : undefined;
			}

			if (!colorIdentifier) {
				colorIndex = rot(colorIndex + 1, colorRegistry.length);
				colorIdentifier = colorRegistry[colorIndex];
			}

			outputSwimlanes.push({
				id: historyItem.parentIds[i],
				color: colorIdentifier
			});
		}
```

Rendering then asks (`scmHistory.ts:132-140`):

```ts
// Find the history item in the input swimlanes
const inputIndex = inputSwimlanes.findIndex(
  (node) => node.id === historyItem.id,
);

// Circle index - use the input swimlane index if present, otherwise add it to the end
const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length;

// Circle color - use the output swimlane color if present, otherwise the input swimlane color
const circleColor =
  circleIndex < outputSwimlanes.length
    ? outputSwimlanes[circleIndex].color
    : circleIndex < inputSwimlanes.length
      ? inputSwimlanes[circleIndex].color
      : historyItemRefColor;
```

### Case walk-through

**Root commit (`parentIds.length === 0`).** The `if (historyItem.parentIds.length > 0)` guard is
skipped, so `outputSwimlanes` stays empty: **all lanes close on the same row**, not just the lane the
commit occupied. This is a deliberate simplification that holds while history is fetched with
`--topo-order` from a connected ref set (all lanes converge on a root). Reimplementing it verbatim
means two unrelated roots (e.g. an orphan branch shown by an `--all` style filter) would silently drop
the other branch's lanes. Refyard should keep the same rule for fixture-compatibility but treat a
non-empty input with an empty output on a root as a case to watch.

**Commit not present in any input lane** (`inputIndex === -1`, e.g. the very first row, or the
synthetic incoming/outgoing rows). `circleIndex = inputSwimlanes.length` — the circle is drawn in a
new lane immediately right of the existing ones — and because `firstParentAdded` stays `false`, the
unprocessed-parent loop starts at `i = 0`, so the **first parent is appended at that same index**
(`outputSwimlanes.length` grew by exactly the number of lanes, so the appended parent lands at
`inputSwimlanes.length === circleIndex`). Circle lane and first-parent lane therefore always coincide.

**Linear continuation.** The commit is found at index `i`; the first-parent entry replaces it _in
place_, so the lane index and (unless the commit carries a colored ref) the lane color are stable down
the whole branch. All other lanes are copied through unchanged.

**Merge commit, second parent already known.** Same loop; the commit's lane becomes `parentIds[0]`,
and the unprocessed loop appends `parentIds[1..n]` **at the end** of `outputSwimlanes`, each with its
own color. Lane indices of existing lanes never shift inside a row; a lane only "moves" when a lane to
its left disappears, which is handled at draw time by the shift curve (section 4).

**Duplicate lanes converge.** If several input lanes hold the same id (a branch that was created from
and merges back into the same commit), only the **first** occurrence is replaced by the first parent;
later occurrences hit `continue` and are simply dropped from the output. That is lane closure #2. The
renderer draws a curve joining the dropped lane into the commit (the "base commit" branch, section 4).

**Octopus merge.** No special case and no lane cap: the unprocessed loop runs for `i = 1..n-1`
(after the first parent was placed) and appends one lane per remaining parent, so the row's width grows
by `n-1`. "Parent list longer than available lanes" simply means the SVG becomes wider; nothing is
clipped or reordered.

**Colors.** `getLabelColorIdentifier(historyItem, colorMap)` (`scmHistory.ts:53-68`) returns the color
of the commit's first reference that exists in `colorMap` (skipping refs not in the map, and using
special colors for the synthetic incoming/outgoing ids). For the first parent the color comes from the
**current** commit's refs; for parents 2..n it comes from the **parent's own** refs if that parent is
already loaded in `historyItems`, else `undefined`. Any `undefined` pulls the next color from the
5-entry palette registry via a function-scoped, monotonically rotating index
(`colorIndex = rot(colorIndex + 1, 5)`), so palette assignment is global to the whole layout run, not
per lane.

**References get their color back after layout** (`scmHistory.ts:358-379`): for each ref present in
`colorMap` with value `undefined`, the ref inherits the row's `circleColor` computation; then refs are
sorted by `compareHistoryItemRefs` (current ref > remote ref > base ref > any colored ref > rest).
Refs never influence lane indices.

---

## 3. Pagination / continuation

There is **no continuation object and no incremental lane state**. Pagination is: accumulate raw
`ISCMHistoryItem[]`, then re-run the entire layout from the first commit on every page load.

`scmHistoryViewPane.ts:1256-1276` (verbatim, abridged only where marked):

```ts
		if (!state || state.loadMore !== false) {
			const historyItems = state?.viewModels
				.filter(vm =>
					vm.historyItemViewModel.kind !== 'incoming-changes' &&
					vm.historyItemViewModel.kind !== 'outgoing-changes')
				.map(vm => vm.historyItemViewModel.historyItem) ?? [];
			...
			const limit = clamp(this._configurationService.getValue<number>('scm.graph.pageSize'), 1, 1000);
			const historyItemRefIds = historyItemRefs.map(ref => ref.revision ?? ref.id);

			do {
				// Fetch the next page of history items
				historyItems.push(...(await historyProvider.provideHistoryItems({
					historyItemRefs: historyItemRefIds, limit, skip: historyItems.length
				}) ?? []));
			} while (typeof state?.loadMore === 'string' && !historyItems.find(item => item.id === state?.loadMore));
```

and then a fresh `toISCMHistoryItemViewModelArray(historyItems, ...)` over the full array
(`scmHistoryViewPane.ts:1296-1311`). `loadMore()` (`:1230-1242`) only sets a `boolean | string` flag in
the per-repository state; the string form is a cursor commit id used to fetch pages until that commit is
present (revealing "my commit" that is far down the log). Config: `scm.graph.pageSize` default 50
(clamped 1..1000), `scm.graph.pageOnScroll` default `true`.

**Lanes whose parents have not been loaded yet.** They stay in `outputSwimlanes` as placeholder
entries (`{ id: <unloaded parent oid>, color: <rotated palette color> }`) and keep being carried
downwards; when the parent finally arrives in a later page, the id matches and the lane continues
normally. If the parent never arrives (end of history), the lane simply runs off the bottom of the last
row. The "Load More" row is built from the tail state
(`scmHistoryViewPane.ts:920-928`) and renders those pending lanes as full-height vertical lines
(`renderSCMHistoryGraphPlaceholder`), masked with a CSS gradient — so page boundaries look continuous.

Two consequences worth recording before porting:

1. **The layout is a pure fold over the loaded prefix, but not prefix-stable in color.** Appending a
   page re-runs everything; earlier rows keep their lane ids, but a lane whose _second parent_ color
   came from "parent not loaded yet → rotate palette" can silently change color once that parent shows
   up (the parent-ref lookahead at `scmHistory.ts:342-345` searches the whole loaded array). Refyard's
   fixtures should pin behavior for a fully-loaded list and treat partially-loaded color shifts as
   accepted (or re-assign only colors, never lane indices).
2. `provideHistoryItems` is called with `skip = historyItems.length`, so pages are positional prefixes
   of a `--topo-order` log; Refyard's `git log` equivalent must be stable between calls for the fold to
   be deterministic.

---

## 4. SVG geometry

Constants (`scmHistory.ts:20-24`, verbatim):

```ts
export const SWIMLANE_HEIGHT = 22;
export const SWIMLANE_WIDTH = 11;
const SWIMLANE_CURVE_RADIUS = 5;
const CIRCLE_RADIUS = 4;
const CIRCLE_STROKE_WIDTH = 2;
```

Conventions:

- One SVG per row, `height = 22`, `width = SWIMLANE_WIDTH * (max(inputSwimlanes.length, outputSwimlanes.length, 1) + 1)`.
- Lane `i` runs at `x = SWIMLANE_WIDTH * (i + 1)` — i.e. lane 0 is 11px from the left edge; there is no
  half-lane offset and no centering. All rows use the same mapping, which is what makes lanes line up
  vertically across independently rendered SVGs.
- Row-local y: `0` = top edge (commit of the row above / link from above), `SWIMLANE_HEIGHT / 2 = 11`
  = commit row center, `22` = bottom edge (link continuing to the row below).
- The commit circle: `cx = 11 * (i + 1)`, `cy = SWIMLANE_WIDTH = 11`, `r = 5` for a plain node
  (`CIRCLE_RADIUS + 1`), stroke-width 2, fill = row color. Variants: HEAD = filled `r=7` ring + `r=2`
  inner circle; multi-parent node = ring `r=6` + inner `r=3`; incoming/outgoing = `r=7` ring + `r=5`
  inner + dashed `r=5` circle.
- Straight lane: `M x 0 V 22` — one path per lane per row, so the "line" is just stacked segments.

Path helpers (`scmHistory.ts:70-112`, verbatim):

```ts
function createPath(colorIdentifier: string, strokeWidth = 1): SVGPathElement {
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('fill', 'none');
	path.setAttribute('stroke-width', `${strokeWidth}px`);
	path.setAttribute('stroke-linecap', 'round');
	path.style.stroke = asCssVariable(colorIdentifier);

	return path;
}

function drawCircle(index: number, radius: number, strokeWidth: number, colorIdentifier?: string): SVGCircleElement {
	const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	circle.setAttribute('cx', `${SWIMLANE_WIDTH * (index + 1)}`);
	circle.setAttribute('cy', `${SWIMLANE_WIDTH}`);
	circle.setAttribute('r', `${radius}`);

	circle.style.strokeWidth = `${strokeWidth}px`;
	if (colorIdentifier) {
		circle.style.fill = asCssVariable(colorIdentifier);
	}

	return circle;
}
...
function drawVerticalLine(x1: number, y1: number, y2: number, color: string, strokeWidth = 1): SVGPathElement {
	const path = createPath(color, strokeWidth);
	path.setAttribute('d', `M ${x1} ${y1} V ${y2}`);

	return path;
}
```

The main loop of `renderSCMHistoryItemGraph` (`scmHistory.ts:142-235`, verbatim — this is the part to
port; `outputSwimlaneIndex` is a cursor into `outputSwimlanes` that only advances when a lane is
consumed):

```ts
let outputSwimlaneIndex = 0;
for (let index = 0; index < inputSwimlanes.length; index++) {
  const color = inputSwimlanes[index].color;

  // Current commit
  if (inputSwimlanes[index].id === historyItem.id) {
    // Base commit
    if (index !== circleIndex) {
      const d: string[] = [];
      const path = createPath(color);

      // Draw /
      d.push(`M ${SWIMLANE_WIDTH * (index + 1)} 0`);
      d.push(
        `A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${SWIMLANE_WIDTH * index} ${SWIMLANE_WIDTH}`,
      );

      // Draw -
      d.push(`H ${SWIMLANE_WIDTH * (circleIndex + 1)}`);

      path.setAttribute("d", d.join(" "));
      svg.append(path);
    } else {
      outputSwimlaneIndex++;
    }
  } else {
    // Not the current commit
    if (
      outputSwimlaneIndex < outputSwimlanes.length &&
      inputSwimlanes[index].id === outputSwimlanes[outputSwimlaneIndex].id
    ) {
      if (index === outputSwimlaneIndex) {
        // Draw |
        const path = drawVerticalLine(
          SWIMLANE_WIDTH * (index + 1),
          0,
          SWIMLANE_HEIGHT,
          color,
        );
        svg.append(path);
      } else {
        const d: string[] = [];
        const path = createPath(color);

        // Draw |
        d.push(`M ${SWIMLANE_WIDTH * (index + 1)} 0`);
        d.push(`V 6`);

        // Draw /
        d.push(
          `A ${SWIMLANE_CURVE_RADIUS} ${SWIMLANE_CURVE_RADIUS} 0 0 1 ${SWIMLANE_WIDTH * (index + 1) - SWIMLANE_CURVE_RADIUS} ${SWIMLANE_HEIGHT / 2}`,
        );

        // Draw -
        d.push(
          `H ${SWIMLANE_WIDTH * (outputSwimlaneIndex + 1) + SWIMLANE_CURVE_RADIUS}`,
        );

        // Draw /
        d.push(
          `A ${SWIMLANE_CURVE_RADIUS} ${SWIMLANE_CURVE_RADIUS} 0 0 0 ${SWIMLANE_WIDTH * (outputSwimlaneIndex + 1)} ${SWIMLANE_HEIGHT / 2 + SWIMLANE_CURVE_RADIUS}`,
        );

        // Draw |
        d.push(`V ${SWIMLANE_HEIGHT}`);

        path.setAttribute("d", d.join(" "));
        svg.append(path);
      }

      outputSwimlaneIndex++;
    }
  }
}

// Add remaining parent(s)
for (let i = 1; i < historyItem.parentIds.length; i++) {
  const parentOutputIndex = findLastIndex(
    outputSwimlanes,
    historyItem.parentIds[i],
  );
  if (parentOutputIndex === -1) {
    continue;
  }

  // Draw -\
  const d: string[] = [];
  const path = createPath(outputSwimlanes[parentOutputIndex].color);

  // Draw \
  d.push(`M ${SWIMLANE_WIDTH * parentOutputIndex} ${SWIMLANE_HEIGHT / 2}`);
  d.push(
    `A ${SWIMLANE_WIDTH} ${SWIMLANE_WIDTH} 0 0 1 ${SWIMLANE_WIDTH * (parentOutputIndex + 1)} ${SWIMLANE_HEIGHT}`,
  );

  // Draw -
  d.push(`M ${SWIMLANE_WIDTH * parentOutputIndex} ${SWIMLANE_HEIGHT / 2}`);
  d.push(`H ${SWIMLANE_WIDTH * (circleIndex + 1)} `);

  path.setAttribute("d", d.join(" "));
  svg.append(path);
}

// Draw | to *
if (inputIndex !== -1) {
  const path = drawVerticalLine(
    SWIMLANE_WIDTH * (circleIndex + 1),
    0,
    SWIMLANE_HEIGHT / 2,
    inputSwimlanes[inputIndex].color,
  );
  svg.append(path);
}

// Draw | from *
if (historyItem.parentIds.length > 0) {
  const path = drawVerticalLine(
    SWIMLANE_WIDTH * (circleIndex + 1),
    SWIMLANE_HEIGHT / 2,
    SWIMLANE_HEIGHT,
    circleColor,
  );
  svg.append(path);
}
```

Geometry facts that fall out of this, worth encoding as invariants in `git-graph` fixtures:

- Four edge shapes exist: full-height vertical (`x = lane`), the **shift curve** for a lane that keeps
  its id but moves to a smaller index (`index > outputSwimlaneIndex`; since `outputSwimlaneIndex`
  increments only on matches, the shift is always to the **left**; horizontal jog happens between
  `y=6` and `y=16` with two radius-5 quarter arcs), the **merge-out curve** for parents 2..n (radius
  11 quarter arc from `(11*p, 11)` to `(11*(p+1), 22)` — it exits through the bottom edge between lane
  `p` and lane `p+1` — plus a horizontal stub from `(11*p, 11)` left to the commit's lane at `y=11`),
  and the **convergence curve** for a duplicate lane carrying the same commit (radius 11 arc from
  `(11*(i+1), 0)` down-left to `(11*i, 11)`, then horizontal to the commit lane).
- `findLastIndex` for the merge-out lane means that when the same parent id occupies several output
  lanes, the **last** one is used for the curve.
- Arcs use absolute coordinates with sweep-flag `1` for "down-left" merges and flag `0` for the second
  half of the shift curve; the shift curve's horizontal segment is `x_in` → `x_out` at `y=11`, which
  is only geometrically valid for `x_out < x_in` (guaranteed by the cursor logic).
- The row's SVG width is `max(input, output, 1) + 1` lanes, which can be one lane wider than both
  arrays when `parentIds.length > 1` and the last parent lane is already present.
- `renderSCMHistoryGraphPlaceholder(columns, highlightIndex?)` (`scmHistory.ts:277-290`) draws pure
  vertical lines for `outputSwimlanes`-shaped arrays; it is used for file-change child rows and for the
  load-more row, with `strokeWidth = 3` on `highlightIndex` (the lane of the parent commit, from
  `getHistoryItemIndex`, which is exactly the `inputIndex`/`circleIndex` computation of section 2).

---

## 5. Rendering the list (virtualization and alignment)

- The list is a `WorkbenchCompressibleAsyncDataTree` created at `scmHistoryViewPane.ts:1997-2024` with
  `horizontalScrolling: false`; rows are virtualized by the workbench tree.
- Row height is hard-coded to match the graph: `ListDelegate.getHeight()` returns `22`
  (`scmHistoryViewPane.ts:412-414`), and CSS pins `.graph-container` to `height: 22px`
  (`scm.css:160-165`).
- Commit index → row: each visible row renders `HistoryItemRenderer.renderElement`
  (`scmHistoryViewPane.ts:476-506`), which clears `.graph-container` and appends
  `renderSCMHistoryItemGraph(historyItemViewModel)`. There is **no** shared canvas and **no**
  coordinated scroll transform — alignment is an emergent property of "same row height, same
  index→x mapping, one SVG per row, graph pinned to the left of the flex row
  (`.history-item { display: flex; align-items: center; }`, `.graph-container { flex-shrink: 0; }`)".
  Re-rendering a row during scroll is therefore always correct; nothing needs to know about the
  scroll offset.
- Child rows under a commit (file changes, list and tree mode) do not draw a full graph. They draw
  `renderSCMHistoryGraphPlaceholder(outputSwimlanes, getHistoryItemIndex(parentViewModel))` in an
  absolutely positioned `.graph-placeholder`, and shift the row content right by
  `marginLeft = SWIMLANE_WIDTH * (graphColumns.length + 1) - 16` while offsetting the placeholder by
  `-marginLeft` (`scmHistoryViewPane.ts:736-745`). `16` is the `.monaco-tl-indent` width — a
  VS Code-layout constant that must not be copied verbatim.
- The load-more row renders the same placeholder from the last row's `outputSwimlanes`
  (`scmHistoryViewPane.ts:781-799`) and doubles as the scroll trigger when `scm.graph.pageOnScroll` is
  on.
- Circle stroke/fill for hover, focus and selection is done in CSS by `:hover`/`.selected` /
  `circle:first-of-type` / `circle:nth-of-type(2)` / `.current > .graph > circle:last-child` selectors
  (`scm.css:156-210`) — i.e. the renderer emits circles in a fixed order and CSS recolors them.

---

## 6. Colors and refs

- Reference labels do **not** participate in lane assignment. They only (a) influence lane **color**
  through `getLabelColorIdentifier`, and (b) get a color assigned back for their badge.
- `getLabelColorIdentifier(historyItem, colorMap)` (`scmHistory.ts:53-68`) returns, for the synthetic
  ids, the fixed incoming/outgoing colors, otherwise the first ref whose id is a key of `colorMap`.
- The color map is built in the view pane (`scmHistoryViewPane.ts:1361-1392`): local ref, remote ref
  and base ref map to their own `ISCMHistoryItemRef.color` (may be `undefined`); every other filtered
  ref maps to `undefined`, meaning "use the color of the row it points at" — that is exactly the
  `colorMap.has(ref.id) && color === undefined` branch in `toISCMHistoryItemViewModelArray:359-375`.
- Palette: five registered theme colors `scmGraph.foreground1..5` (`scmHistory.ts:45-51`, hex defaults
  `#FFB000 #DC267F #994F00 #40B0A6 #B66DFF`), plus `scmGraph.historyItemRefColor`,
  `historyItemRemoteRefColor`, `historyItemBaseRefColor` (`chartsBlue`/`chartsPurple`/`#EA5C00`).
- Ref order is defined by `compareHistoryItemRefs` (`scmHistory.ts:532-558`): current ref (1) >
  remote ref (2) > base ref (3) > colored (4) > uncolored (99).
- Badges (the colored pills on the right of the subject) are rendered by `_renderBadges`
  (`scmHistoryViewPane.ts:512-600`) by grouping `historyItem.references` by color, then by icon id;
  only the first colored ref gets a description. Config `scm.graph.badges: 'all' | 'filter'`.

---

## 7. Tests

- The only test file is `src/vs/workbench/contrib/scm/test/browser/scmHistory.test.ts` (963 lines,
  `suite('toISCMHistoryItemViewModelArray')`). It imports `colorRegistry`, `historyItemRefColor`,
  `historyItemRemoteRefColor`, `historyItemBaseRefColor` and `toISCMHistoryItemViewModelArray`.
- It tests **layout only** — no DOM, no SVG, no view pane. Each case builds an array of
  `toSCMHistoryItem(id, parentIds, references?)` and asserts, per row, the exact
  `inputSwimlanes.length` / `outputSwimlanes.length` and every `{ id, color }` pair, plus
  `viewModels.length` and (in the incoming/outgoing cases) `kind`.
- Cases (with their ASCII diagrams, which are excellent fixture sources):
  1. `empty graph`, 2. `single commit`, 3. `linear graph`, 4. `merge commit (single commit in topic
branch)` — expects the duplicate lane `[c(color0), c(color1)]` that section 2 describes,
  2. `merge commit (multiple commits in topic branch)` — expects the dropped duplicate lane
     (`outputSwimlanes = [g(color0)]` at the convergence row),
  3. `create brach from merge commit` [sic] — expects a new lane appended **after** an existing lane
     (`[d(color0), e(color2)]`),
  4. `create multiple branches from a commit` — three lanes converging on `g`
     (`[g(0), g(1), g(2)]` → `[h(0)]`),
  5. `graph with color map` — ref colors replace palette colors,
  6. `graph with incoming/outgoing changes (remote ref first)` and `(local ref first)` — synthetic
     nodes and `SCMIncomingHistoryItemId` lanes,
  7. `graph with merged incoming changes` — the "incoming already merged" edge case.

  (`grep -c '^\s*test('` = **11** `test(...)` calls; item 9 above covers two of them.)

- There are **no tests** for `renderSCMHistoryItemGraph`, `renderSCMHistoryGraphPlaceholder`, the
  geometry, or the pagination/`loadMore` path. Refyard will have to author those fixtures itself; the
  lane-level assertions above are directly reusable as expected `inputSwimlanes`/`outputSwimlanes`
  tables.

---

## Algorithm to reimplement in TypeScript

Host-free, pure fold over an ordered commit list. `ids` are opaque strings; `color` is any lane token.

```
Input:  items: Array<{ id: string, parentIds: string[] }>   // ordered as git log --topo-order, first parent first
        refColor: (commitId) => LaneColor | undefined        // color of the commit's ref(s); "undefined" = inherit
        palette: LaneColor[]                                 // 5 colors in VS Code; any N >= 1
Output: rows: Array<{
          id, parentIds,
          laneIndex: number,        // where the commit circle is drawn
          laneColor: LaneColor,     // circle fill
          inputLanes:  Array<{ id: string, color: LaneColor }>,   // array index == lane index; previous row's outputLanes
          outputLanes: Array<{ id: string, color: LaneColor }>
        }>

paletteCursor = -1                     // function-scoped, shared by all rows of one run
prevOut = []                           // outputLanes of the previous row

for item in items:
    in  = clone(prevOut)               // per-row copy, never mutate the previous row's array
    out = []
    firstParentPlaced = false

    // 1. replace the lane that was waiting for this commit with its first parent
    if item.parentIds.length > 0:
        for i, lane in enumerate(in):
            if lane.id == item.id:
                if not firstParentPlaced:
                    out.push({ id: item.parentIds[0],
                               color: refColor(item) ?? lane.color })
                    firstParentPlaced = true
                continue                // duplicates pointing at the same commit are dropped
            out.push(clone(lane))       // other lanes keep their index and color

    // 2. append the remaining parents (merge / octopus) — or the first parent if the
    //    commit was not in `in` (root of a new lane, or the first row)
    start = firstParentPlaced ? 1 : 0
    for i in start .. item.parentIds.length - 1:
        color = (i == 0)
                  ? refColor(item)
                  : refColor(parentItem(item.parentIds[i]))   // lookup in the loaded items; undefined if not loaded
        if color == undefined:
            paletteCursor = mod(paletteCursor + 1, palette.length)
            color = palette[paletteCursor]
        out.push({ id: item.parentIds[i], color })

    // 3. circle placement
    inIndex    = indexOfLaneWithId(in, item.id)          // first match, -1 if absent
    laneIndex  = inIndex != -1 ? inIndex : in.length     // absent => a new lane right of the last
    laneColor  = (laneIndex < out.length)     ? out[laneIndex].color
               : (laneIndex < in.length)      ? in[laneIndex].color
               : DEFAULT_REF_COLOR

    rows.push({ ...item, laneIndex, laneColor, inputLanes: in, outputLanes: out })
    prevOut = out

// Invariants that make rendering independent per row:
//  * lane indices in `out` are never reordered inside a row; they only shrink when a lane
//    to the left disappears (duplicate converge, or the commit absent from `in`).
//  * if item.parentIds.length > 0 then rows[k].laneIndex == the index in out of parentIds[0]
//    (either in-place, or appended at in.length).
//  * outputLanes entries may name a parent that has not been loaded yet; they stay as
//    placeholders until the parent appears as an item, and are never removed otherwise.
//  * item with no parents => out == [] (all lanes close on that row).
```

Per-row rendering (independent of VS Code types), with `W = 11`, `H = 22`, `R = 5`, arc radius `W`:

```
render(row):
    width  = W * (max(row.inputLanes.length, row.outputLanes.length, 1) + 1)
    for each lane i of row.inputLanes:
        if lane.id == row.id and i != row.laneIndex:      // duplicate converge: curve down-left into the circle
            path "M {W*(i+1)} 0  A {W} {W} 0 0 1 {W*i} {H/2}  H {W*(row.laneIndex+1)}"
        else if lane.id == row.id:                        // this row's own lane: handled by the | to/from * segments
            outCursor += 1
        else if outCursor < row.outputLanes.length and lane.id == row.outputLanes[outCursor].id:
            if i == outCursor: path "M {W*(i+1)} 0 V {H}"                       // straight
            else:              path "M {W*(i+1)} 0 V 6                          // shift left (outCursor < i always)
                                     A 5 5 0 0 1 {W*(i+1)-5} {H/2}
                                     H {W*(outCursor+1)+5}
                                     A 5 5 0 0 0 {W*(outCursor+1)} {H/2+5}
                                     V {H}"
            outCursor += 1
        // else: lane is dropped (no geometry)
    for i in 1 .. row.parentIds.length - 1:                // extra parents: curve out to their lane
        p = lastIndexOfLaneWithId(row.outputLanes, row.parentIds[i])
        if p < 0: continue
        path "M {W*p} {H/2} A {W} {W} 0 0 1 {W*(p+1)} {H}  M {W*p} {H/2} H {W*(row.laneIndex+1)}"
    if row.inputLanes.length > 0 (commit was in input):  path "M {W*(laneIndex+1)} 0  V {H/2}"   // into circle
    if row.parentIds.length > 0:                          path "M {W*(laneIndex+1)} {H/2} V {H}" // out of circle
    circle at cx = W*(laneIndex+1), cy = W, r = R+1, stroke-width 2, fill = row.laneColor
       (HEAD / multi-parent / synthetic rows use the larger double circles)
```

The final `outputLanes` of the last row is the continuation state: render it as full-height vertical
lines in a placeholder row (VS Code puts a "Load More" row there when more history may exist).

---

## What does NOT transfer to Refyard

- **VS Code APIs and framework.** `registerColor`/`asCssVariable`/`ColorIdentifier`, the global
  `document.createElementNS` helpers (`createPath`, `drawCircle`), `$`/`svgElem` DOM helpers,
  `DisposableStore`, `localize`/nls, `IMarkdownRendererService`, `IconLabel`, `WorkbenchToolBar`,
  `IHoverService`, `IListVirtualDelegate`, `WorkbenchCompressibleAsyncDataTree`, `ResourceTree`,
  `ICompressibleTreeRenderer`, `IConfigurationService`, `IStorageService`, `getProviderKey`. Refyard
  owns its own virtualization and SVG serialization; `git-graph` must stay host-free.
- **The observable/event architecture of the view model** (`observableValue`, `derived`, `autorun`,
  `latestChangedValue`, `_repositoryState` map, `loadMore: boolean | string` cursors, the
  `SEQUENCER`-guarded `_loadMore`). Refyard's layout should be a pure function; pagination state
  belongs in `packages/git-client`/host, not in `git-graph`.
- **The theme palette and its semantics.** The five `scmGraph.foreground*` hex values, the
  blue/purple/orange ref colors, and the CSS-driven hover/selection circle recoloring
  (`:first-of-type` / `:nth-of-type(2)` / `:last-child`) are presentation choices; Refyard needs its
  own token contract (still JSON-schema-friendly, no `ColorIdentifier` string union).
- **Fixed pixel coupling.** `SWIMLANE_HEIGHT = 22` is duplicated as the list row height
  (`ListDelegate.getHeight()`) and in CSS (`.graph-container { height: 22px }`), and the child-row
  indent subtracts `16` for `.monaco-tl-indent`. In Refyard the row height must be a single exported
  constant shared by the layout, the SVG geometry and the virtual list.
- **The synthetic "Incoming/Outgoing Changes" nodes** (`addIncomingOutgoingChangesHistoryItems`,
  `SCMIncomingHistoryItemId`, `resolveHistoryItemRefsCommonAncestor`, and the merged-incoming edge
  case) are a VS Code feature layered _on top of_ the lane algorithm by splicing view models after the
  fold. They are not needed for a plain commit graph and should not be ported into `git-graph`.
- **The git-extension log invocation** (`--topo-order --decorate=full --stdin`, `%P` parents,
  `maxParents`, `skip`) belongs to `git-core` planners, not to `git-graph`.
- **Cloning semantics.** VS Code relies on `deepClone` of plain objects; lane entries are value-like.
  In Refyard they should be plain immutable records (`type Swimlane = { readonly id: GitOid; readonly color: LaneColor }`)
  so no clone step is required at all.
- **Known determinism gaps to close, not copy.** (a) A root commit closes _all_ lanes, which is wrong
  for disjoint histories; (b) lane colors can be reassigned when a later page reveals a parent that
  carries a ref (parent-ref lookahead over the whole loaded array) — Refyard should either pin colors
  from the fully-loaded list or document the shift; (c) `document.createElementNS` + attribute strings
  produce one DOM node per segment per row, which is exactly the cost a virtualized SVG renderer must
  control.
