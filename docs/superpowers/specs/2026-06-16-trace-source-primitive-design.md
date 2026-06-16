# TraceSource primitive — design

**Status:** draft for review
**Date:** 2026-06-16
**Branch:** `feature/curved-geometries-olv10-drawing`
**Driving issue:** the topological-draw-curves example is doing trace-topology work that belongs in OL. Symptoms include incorrect ring selection at shared vertices, arcs rendered on linestring segments, and exit-validation rejections that are caused by application-side guesses about which ring is being traced. See [examples/topological-draw-curves.js](examples/topological-draw-curves.js).

## 1. Problem statement

OL's current trace primitive is "follow one ring, picked at click-time, with limited shared-vertex pivots between rings that happened to be at that click". The application we are building needs "follow the outer boundary of a designated set of features, hopping between features at shared vertices, with the active sub-geometry continuously knowable".

These are different primitives. The example today tries to retrofit the second on top of the first by reconstructing topology on every preview tick. The retrofit is fragile (it disambiguates shared vertices by guessing from `preferredType`) and the example carries hundreds of lines of trace-topology code that does not belong in application code.

The fix is to introduce a `TraceSource` primitive in OL that owns the topology, and to change `Draw`'s trace semantics for the opt-in case so termination is unambiguous.

## 2. Non-goals

- No curve-curve intersection math. Features only stitch at shared *vertices*; relying on existing snapping is sufficient.
- No Boolean union of feature areas. The "outer boundary" is the outer face of the planar graph built from shared vertices, not a Boolean union result.
- No change to default `Draw` trace behavior. `trace: true` and `trace: VectorSource` keep today's behavior; the new behavior is gated by `trace: TraceSource`.
- No mid-edge exit in V1. The "exit anywhere, downgrade arc to linestring" capability is deferred to a later version.

## 3. The `TraceSource` primitive

A new class at `src/ol/interaction/TraceSource.js` (companion to `tracing.js`).

### 3.1. Construction

```js
const traceSource = new TraceSource({
  features,           // Array | FeaturesCollection of source features
  exteriorOnly: true, // default; if false, interior rings (holes) participate as their own components
});
```

If `features` is a live `FeaturesCollection`, the source listens for `add`/`remove`/`change` and invalidates the graph cache. Plain arrays are static.

### 3.2. The graph

Built lazily on first query and cached until invalidated.

**Vertices** are exact-coordinate-equal positions of every *topology vertex* of every eligible ring. Topology vertices are the same set OL already identifies via `TraceTarget.vertexIndices` — for a `CircularString` the start/end of each arc-triplet (not the arc midpoint); for a `LineString` every coordinate; for a `CompoundCurve` the endpoints of every sub-component (which are the same set as the corresponding sub-types).

Vertex identity is exact-coordinate equality. (Snap tolerance is *not* applied here; OL snapping is expected to have made shared vertices exactly equal already. A tolerance option may be added later if real-world data demands it.)

**Edges** are sub-geometries:

- `CircularString` ring → one edge per arc-triplet (start, mid, end), connecting the start and end topology vertices.
- `LineString` ring → one edge per pair of consecutive coordinates.
- `CompoundCurve` ring → one edge per sub-component (`CircularString` → arc edges as above; `LineString` → segment edges as above). The endpoints of adjacent subs are the same vertex.

Each edge carries: the parent feature, the ring index (within its parent if a polygon), the sub-geometry instance, and its two endpoint vertices.

**Eligibility** is governed by `exteriorOnly`. With `exteriorOnly: true` (default), interior rings of `CurvePolygon` and `Polygon` are excluded. With `exteriorOnly: false`, interior rings participate but they form their own connected components (they do not share vertices with exterior rings in normal usage).

**Connected components** emerge naturally from the shared-vertex union-find. Features that share no vertex with any other feature are their own component.

### 3.3. Queries

Three public methods, used by `Draw` and available to other consumers:

```js
// All edges within snap tolerance of `coordinate`.
traceSource.getEdgesAt(coordinate, tolerance)
// → Array<TraceEdge>

// The nearest graph vertex (and its squared distance) within tolerance.
traceSource.getNearestVertex(coordinate, tolerance)
// → {vertex: TraceVertex, squaredDistance: number} | null

// The closest edge to `coordinate`, with sticky semantics: if `previous` is
// within `tolerance` of `coordinate` (i.e. a tie or near-tie), `previous` wins.
traceSource.getActiveEdge(coordinate, tolerance, previous)
// → TraceEdge | null
```

`TraceEdge` exposes (read-only): `kind` (string, `'CircularString'` or `'LineString'` — the canonical signal the application reads to stamp a segment break), `subGeometry` (the owning `CircularString` / `LineString` instance for whole-sub edges; for a `LineString`-segment edge this is the parent `LineString` plus `segmentIndex`), `startVertex`, `endVertex`, `feature`, `ringIndex`. Applications stamp segment breaks from `edge.kind`; they do not need to inspect geometry types themselves.

### 3.4. Disposal

`traceSource.dispose()` detaches the `FeaturesCollection` listeners.

## 4. Changes to `Draw`

### 4.1. Option shape

OL's `Draw` already has two trace-related options:

```ts
trace?: boolean | Condition       // when tracing engages (today)
traceSource?: VectorSource        // where features come from (today)
```

The new primitive is accepted by `traceSource`:

```ts
traceSource?: VectorSource | TraceSource
```

When `traceSource` is a `TraceSource` instance, `Draw` switches to the new lifecycle. When it is a `VectorSource` (or omitted), behavior is unchanged.

The `trace` option (boolean / Condition) is unchanged in both modes — it still controls when the trace condition is met.

### 4.2. Trace lifecycle under `TraceSource`

**Tracestart.** The user enters trace mode (today: by holding the trace condition and clicking near a feature). The click coordinate must be on or within snap tolerance of a graph vertex. If it is, the trace starts at that vertex (`activeEdge = null`, `entryVertex = vertex`). If it is not, the click falls through to ordinary draw-without-trace behavior.

`Draw` fires `tracestart` with `traceSourceFeature`, `traceSourceGeometry`, etc. left `undefined` (consistent with today's documented contract; the active edge is not committed yet).

**During trace.** On every cursor sample:

1. **Vertex snap.** Find the nearest graph vertex within snap tolerance. If found, the cursor is *snapped* to that vertex's coordinates. The snap is visualized using the existing snap-feedback machinery.
2. **Active edge resolution.** Compute `activeEdge = traceSource.getActiveEdge(cursor, tolerance, previousActiveEdge)`. Sticky semantics keep the previous edge at junction ties.
3. **Switch event.** If `activeEdge` changed, fire a new continuous `trace` event with `{coordinate, target, subGeometry}`. The application uses this to stamp the segment-type break for the new edge.
4. **Preview.** The sketch coordinates are updated to show the path from `entryVertex`, along every fully-traversed edge, to the current cursor (or snapped vertex). Fully-traversed edges contribute their full sub-geometry; the in-flight active edge contributes its portion from its start vertex up to the cursor.

**Crucially**, the trace does **not** auto-end when the cursor leaves a target's tolerance. If the cursor drifts far from the graph, the active edge remains the last known one and the preview stretches to that edge's nearest point. This matches the user model: the trace ends only on a click at a vertex.

**Exit.** The user clicks. Behavior:

- **Cursor snapped to a vertex** → trace ends at that vertex. All fully-traversed edges between `entryVertex` and the exit vertex are committed as sub-geometries of the resulting trace path. Fires `traceend` with the resolved `traceSourceGeometry`, `traceSourceRingIndex`, indices, etc.
- **Cursor not snapped to a vertex** → the click is ignored for trace-exit purposes (it does not commit a vertex into the sketch). The trace remains active. This is the V1 simplification; mid-edge exit is V2.

### 4.3. Geometric soundness guarantee

Because every exit is a graph vertex, every committed sub-geometry along the trace path is whole. An arc is committed if and only if the cursor has crossed both of its endpoints, never mid-arc. No CircularString is ever malformed by an early exit.

### 4.4. New event: `trace`

A continuous event on `Draw`, fired between `tracestart` and `traceend` whenever `activeEdge` changes. Payload:

- `coordinate` — current cursor coordinate (snapped if applicable).
- `traceSourceFeature` — the feature the new active edge belongs to.
- `traceSourceGeometry` — the smallest geometry instance owning the new active edge (consistent with today's `TraceTarget.geometry` contract).
- `traceSourceSubGeometryKind` — string, `'CircularString'` or `'LineString'`. **This is the new field**; it is the canonical, ambiguity-free signal applications use to stamp segment-type breaks.
- `traceSourceSubGeometry` — the owning sub instance (`CircularString` or `LineString`) when the active edge is a whole sub; for a `LineString`-segment edge, the parent `LineString` instance. Applications that only need the kind read `traceSourceSubGeometryKind` directly.
- `traceSourceRingIndex` — as today.

The event is purely informational; it fires only when the active edge changes, so application handlers see one event per edge transition during a trace, not one per cursor sample.

### 4.5. Backward compatibility

All existing trace behavior is preserved. The new lifecycle is taken only when `traceSource` is a `TraceSource` instance. Existing tests and examples that use `trace: true` / `trace: Condition` with or without a `traceSource: VectorSource` are unaffected.

## 5. What the example collapses to

The following code is deleted or replaced from [examples/topological-draw-curves.js](examples/topological-draw-curves.js):

- `findSourceRing` (~30 lines): replaced by `traceSource.getEdgesAt`.
- `resolveTraceStartSource` (~60 lines): no longer needed; the primitive handles ambiguity by deferring commit.
- `getSourceSegmentInfo` (~80 lines): no longer needed; `TraceEdge.subGeometry` *is* the segment info.
- `getSourceControlPointsAt` (~30 lines): replaced by `traceSource.getNearestVertex`.
- `coordIsOnRing` (~30 lines): replaced by `traceSource.getEdgesAt`.
- Ring-jump prevention block (~50 lines): no longer needed; the primitive's sticky-closest rule handles transitions correctly.
- `addPreviewSourceSegmentBreaks` (~120 lines): replaced by a small handler that listens to the new `trace` event and pushes a segment break with `subGeometry.getType()`.
- `activeTraceEntry` state and all its consumers (~80 lines): replaced by reading the live `trace` event payload.
- `tracedArcs` direction-hint guesswork (~40 lines): no longer needed; direction is a per-edge property the primitive tracks.
- Custom exit-vertex validation in `checkCrossingCondition` (~30 lines): no longer needed; the primitive guarantees exits are at vertices.

Replaced by:

- One `new TraceSource({features, exteriorOnly: true})` construction.
- One `draw.on('trace', e => segmentBreaks.push({..., type: e.traceSourceSubGeometryKind === 'CircularString' ? 'arc' : 'line'}))` subscription.
- The `traceend` handler reads `e.traceSourceGeometry` directly instead of consulting `activeTraceEntry`.

Net: ~550 lines deleted from the example, ~30 lines added.

## 6. Edge cases addressed

- **Tracestart on a junction vertex.** `activeEdge` starts `null`. The cursor sits on the vertex; all incident edges tie at distance 0; sticky rule keeps `activeEdge = null`. As soon as the cursor moves enough that one incident edge is closer, `activeEdge` resolves and the first `trace` event fires. No guess, no wrong commit.
- **Mid-trace junction crossing.** Same sticky-closest rule. Cursor moves from edge_a across junction toward edge_b; until cursor is geometrically closer to edge_b, `activeEdge = edge_a`. The switch fires exactly when the cursor commits to the new edge.
- **Cursor pauses at a junction.** Sticky rule keeps the incoming edge. Trace does not end.
- **Cursor drifts far from the graph.** `activeEdge` stays. Preview stretches to the nearest point of that edge. Trace continues. Ends only on click at a snapped vertex.
- **CompoundCurve sub-boundary.** Internal degree-2 vertex of the graph. Crossing it transparently transitions `activeEdge` from one sub to the next and fires `trace` with the new sub's type.
- **Hopping back to a previously visited edge.** Just another switch. No special case.
- **Reversal on the active edge.** Per-edge direction tracking (unchanged from today).
- **Disjoint features.** Their own connected components. Trace cannot hop between them (no shared vertex → no graph edge connecting them).
- **Holes.** Excluded by default. Opt-in via `exteriorOnly: false` adds them as their own components.

## 7. Edge cases deferred

- **Mid-edge exit (V2).** When desired, add a `traceExitMode: 'vertex' | 'anywhere'` option. `'anywhere'` allows clicks not snapped to a vertex; the in-flight active edge is downgraded — if it is a `CircularString` arc, it becomes a `LineString` from the arc start to the click point.
- **Snap-tolerance shared-vertex matching (V2).** If real data has near-coincident-but-not-equal vertices, add a `vertexMergeTolerance` option that union-finds vertices within tolerance.
- **Parallel edges between the same vertex pair (V2).** Rare; planar-embedding ambiguity. Document and warn; pick deterministically.
- **Curve-curve intersections without a shared vertex (V2 or never).** Requires real intersection math. Out of scope.

## 8. Testing

The primitive is testable in isolation without a map or Draw:

- Build a `TraceSource` from synthetic features.
- Assert connected components match expected.
- Assert `getEdgesAt` returns the right edges at known coordinates.
- Assert `getActiveEdge` sticky semantics at a junction.
- Assert `exteriorOnly: false` includes holes; default excludes.

`Draw` integration tests use the existing `Draw` test harness with a `TraceSource` instance and assert:

- Tracestart at a junction does not commit a target until cursor moves.
- The continuous `trace` event fires exactly when active edge changes.
- Clicking on a non-vertex coordinate during trace is ignored.
- Clicking on a vertex commits the trace ending at that vertex.

## 9. Out of scope for this spec

- A separate "snap to trace graph" interaction. The trace primitive integrates snap into Draw's trace mode; a generic standalone interaction is future work.
- UI affordances for visualizing graph vertices, the active edge, or the in-flight preview. The primitive exposes data; the application or a separate component renders it.
- Migration of the example. That is its own task tracked by the implementation plan.
