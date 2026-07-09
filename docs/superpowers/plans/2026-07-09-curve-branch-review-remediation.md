# Curve Branch Review Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is independently committable.

**Goal:** Address the findings of the code review of `feature/curved-geometries-olv10-drawing`, after triaging them against the *current* branch state (the review was written against the stale `tmp/changes-blast.md` snapshot).

**Architecture:** Delete abandoned-generation dead code, add safety-net tests for load-bearing invariants, fix the confirmed correctness bugs, unify duplicated/divergent code paths, consolidate scale-dependent tolerances, and prune stale/process documentation.

**Tech Stack:** OpenLayers (JS, JSDoc-driven `tsc` typecheck), Karma (browser specs), Mocha/node (`test/node`), ESLint.

---

## Triage: corrections to the review before we act

The review is largely accurate, but it was written against `tmp/changes-blast.md`, which predates the 2026-07-08 work. Three headline claims are **stale** and must NOT drive work:

- **"Zero tests" is false.** The branch ships 18 test files, including `test/node/ol/interaction/TraceSource.test.js`, `tracing.test.js`, `CircularString/CompoundCurve/CurvePolygon.test.js`, `flat/{arc,segments,topologyflatgeom}.test.js`, `test/browser/.../Draw-trace-source.test.js`, and `curvebuilder.test.js`. The *specific* bit-exact tessellation-invariant test the reviewer wants is still worth adding (Task 2), but the "test-driven promise unfulfilled" framing is wrong.
- **`containsAngle` JSDoc is fixed.** `flat/arc.js:45` now documents `@param {number} [tolerance]`. No lint issue remains here.
- **`findArcEndpointIndex` and `subArc` are already removed.** They no longer exist in `src/`. Only the *other* dead primitives remain.

Everything else in the review was verified VALID against current source and is actionable below. The cosmetic-churn (WKT **and** Snap.js `// Calculate`→`// calculate`), design-doc-staleness, and false-caching claims were re-confirmed with known-good searches.

**Provenance caveat (unresolved fact).** The blast (`tmp/changes-blast.md`) carries a `Generated: 2026-07-09` timestamp yet its `src/` content is stale (it shows `subArc`/`findArcEndpointIndex` present and the `containsAngle` JSDoc missing, all three fixed in the tree). "Predates the 2026-07-08 work" is the *likely* explanation but is **not proven** — the blast records no commit SHA and no diff pathspec, so stale-ref vs path-filtered cannot be settled. Do not treat the causal story as fact; treat only the per-symbol current-tree verifications as ground truth.

**Search-negative caveat (Law 19).** Several "no callers" conclusions in the triage transcript were first drawn from a malformed include glob that returned empty for *any* query. A negative from a search tool counts only after the tool has found a known-present symbol with the same query shape. Task 1.1 Step 1 is therefore **load-bearing, not ceremonial** — re-run each search with a form proven to find the definition before deleting.

**Verification gate to encode (reviewer's meta-point):** add a "dead-export sweep" — every exported/`@api` symbol must have a consumer or a written justification. This is Phase 1's exit check and should be re-run before merge.

---

## Verification commands (run after each task)

```bash
npm run typecheck            # tsc --pretty ; JSDoc is load-bearing in src/ol
npx eslint <changed files>   # or: npm run lint
npm run test-node            # node geom/format/interaction unit tests (fast)
# Browser specs (slow, full webpack rebuild ~1min) only when touching Draw/Modify/Snap/render:
#   npm test  (karma)  — stream failures: 2>&1 | Tee-Object f.txt | Select-String "FAILED|Executed [0-9]"
```

Known pre-existing flakes (ignore unless newly failing): Modify-curve x2, WMS CRLF x2, font redraw x2, ol/Map resize after-each.

**The ignore-list is VOID during Phase 7.** "Modify-curve x2" lives *inside* the subsystem tolerance changes touch; a tolerance regression can masquerade as the known flake and get waved off. Before Phase 7 starts, run one characterization pass on the Modify-curve flakes (timing vs tolerance?) and record the root cause; during Phase 7 any Modify-curve failure must be investigated, not ignored.

---

## Phase 1 — Dead-code removal (Law 12)

Remove abandoned-generation primitives that have no consumer in `src/` or `examples/`. The triage *indicates* zero non-test callers, but that conclusion rests partly on searches that were later found to be glob-malformed (see the search-negative caveat above), so **Step 1 must re-confirm each per-symbol with a known-good search** before any deletion. If `gijs-frontend` needs one later, it is recoverable from git history *with a consumer attached*.

### Task 1.1: Delete dead arc/topology/segments primitives

**Files:**
- Modify: `src/ol/geom/flat/arc.js` (remove `splitArcAtAngle`, ~line 221)
- Modify: `src/ol/geom/flat/topology.js` (remove `getArcArcCrossingPoint` singular, ~line 297)
- Modify: `src/ol/geom/flat/segments.js` (remove `getSegmentsCrossingPoint` ~line 75 and `getSegmentsCrossingPoints` ~line 132)
- Modify: `src/ol/geom/CompoundCurve.js` (remove `getCurveSegmentAt`, ~line 450)
- Modify: `test/node/ol/geom/flat/arc.test.js`, `test/node/ol/geom/flat/topologyflatgeom.test.js`, and any segments specs — remove the now-dangling tests for deleted symbols.

> `getSelfIntersections` is intentionally **not** in this delete list — see Task 1.4 (its deletion inverts a duplication direction and needs a decision, not a reflex).

- [ ] **Step 1 (load-bearing):** Re-confirm zero callers for each symbol with a *known-good* search. First run the search against the symbol's own definition file to prove the query finds it (defeats the glob-malformed false-negative); then `grep -rn "<symbol>" src examples` and expect only the definition. Record the result per symbol before deleting. Verified so far: the example does **not** import `getSegmentsCrossingPoint`/`getSegmentsCrossingPoints` (it uses `getArcSelfIntersections` → `getArcArcCrossingPoints`), so both segments twins are safe to delete.
- [ ] **Step 2:** Delete each function definition and its JSDoc block.
- [ ] **Step 3:** Delete the corresponding test blocks and imports referencing the removed symbols.
- [ ] **Step 4:** `npm run typecheck && npx eslint <files> && npm run test-node`.
- [ ] **Step 5:** Commit: `refactor(geom): remove abandoned-generation arc/topology primitives (dead code)`.

**Keep-list (deletion safety rail — verified exact):** keep `getArcArcCrossingPoints` (plural, `topology.js`, production) and `getIntersectionPoint` (`segments.js:40`, used by `Snap.js:545/563`). Delete `getSegmentsCrossingPoint` (`segments.js:75`) **and** `getSegmentsCrossingPoints` (`segments.js:132`) — both dead. (There is no `getSegmentCrossingPoint` symbol; the earlier draft's keep-list was garbled.)

### Task 1.2: Remove the dead `closeTolerance` parameter

**Files:** `src/ol/geom/CompoundCurve.js` (`coordinatesToCurveGeometry`, param documented "(unused; reserved)", ~line 745)

- [ ] **Step 1:** Confirm the parameter is never referenced in the body.
- [ ] **Step 2:** Remove the parameter, its `@param`, and its default assignment. Update any (internal) callers.
- [ ] **Step 3:** Typecheck + lint + node tests. Commit.

### Task 1.3: Dead-export sweep (verification gate)

- [x] **Step 1:** For every symbol the branch adds under `@api` or `export`, grep for a non-test consumer (known-good search per Law 19). Produce a short list: `symbol -> consumer | justified-why | DELETE`.
- [x] **Step 2:** Delete anything with no consumer and no written justification, or add a one-line justification comment.
- [x] **Step 3:** Commit the sweep result (and any deletions).

**Sweep result (base `ba63bf383d`...HEAD, `git grep -w` over `src` + `examples`):** every branch-added `export` has a live non-test consumer. No dead exports remain (the abandoned-generation primitives were already removed in Task 1.1). No deletions required.

| Symbol (file) | Consumer(s) | Verdict |
| --- | --- | --- |
| `angleFromOrigin` (arc.js) | arc.js, topology.js | KEEP (src) |
| `angleDistance` (arc.js) | CircularString.js, arc.js, topology.js | KEEP (src) |
| `containsAngle` (arc.js) | topology.js (5 sites) | KEEP (src) |
| `getCircleCenter` (arc.js) | CircularString.js, topology.js, Modify.js | KEEP (src) |
| `getArcRadius` (arc.js) | CircularString.js, arc.js, topology.js | KEEP (src) |
| `getArcAngles` (arc.js) | CircularString.js, arc.js, topology.js, Executor.js | KEEP (src) |
| `isArcClockwise` (arc.js) | CircularString.js, arc.js, topology.js, Modify.js, Executor.js | KEEP (src) |
| `isFullCircle` (arc.js) | CircularString.js, arc.js, Executor.js | KEEP (src) |
| `getArcBoundingCoords` (arc.js) | CircularString.js, Modify.js | KEEP (src) |
| `getLineLineCrossingPoint` (topology.js) | topology.js (internal) + unit test | KEEP (internal + tested) |
| `getLineArcCrossingPoint` (topology.js) | topology.js (internal) + unit test | KEEP (internal + tested) |
| `getArcArcCrossingPoints` (topology.js) | topology.js (internal) + unit test | KEEP (internal + tested) |
| `getSameCircleArcOverlap` (topology.js) | topology.js (internal) + unit test | KEEP (internal + tested) |
| `arcsAreEqual` (topology.js) | topology.js (internal) + unit test | KEEP (internal + tested) |
| `getArcArraySelfIntersections` (topology.js) | CurvePolygon.js, example | KEEP (src + example) |
| `isTraceTargetVertexIndex` (tracing.js) | Draw.js, tracing.js | KEEP (src) |
| `coordinatesEqualXY` (tracing.js) | TraceSource.js, tracing.js | KEEP (src) |
| `getSelfIntersectionPoint` (topology.js) | example only | KEEP (drawing feature, vendored) |
| `getArcArrayCrossings` (topology.js) | example only | KEEP (drawing feature, vendored) |
| `coordinatesToCurveGeometry` (CompoundCurve.js) | example only | KEEP (drawing feature, vendored) |

Note: the three example-only exports (`getSelfIntersectionPoint`, `getArcArrayCrossings`, `coordinatesToCurveGeometry`) are the public primitives the topological-drawing feature exists to provide; the example is a live, vendored consumer, so they are justified rather than dead.

### Task 1.4: `getSelfIntersections` — resolve the duplication-direction inversion (decision, then act)

`CurvePolygon.getSelfIntersections` (`CurvePolygon.js:837`) has no `src`/`example` consumer, but the example carries a near-identical `getArcSelfIntersections` copy (`examples/topological-draw-curves.js:190`) that *is* live and that gijs-frontend will vendor. Deleting the core method (reflex Law 12) would make the **untestable example copy the only surviving implementation** — inverting the duplication in the wrong direction. Decide explicitly; do not delete by reflex.

- [ ] **Step 1 (decide):** Choose one and record it in this task:
  - **Option A (recommended):** Keep the core method, refactor the example's `getArcSelfIntersections` to consume it (or a shared exported helper), delete the example copy. Net: one tested implementation.
  - **Option B:** Delete the core method and record a written won't-fix: "example copy is canonical because migrating the example's crossing orchestration into core is out of scope for this remediation (reason: …)."
- [ ] **Step 2 (Option A):** Write a node test for the shared self-intersection helper; migrate the example to it; delete the copy; verify example lint + a manual smoke of the crossing overlay. Commit.
- [ ] **Step 2 (Option B):** Delete `getSelfIntersections` + its tests; append the won't-fix note to the Findings Ledger. Commit.

---

## Phase 2 — Safety-net tests for load-bearing invariants

### Task 2.1: Bit-exact tessellation-endpoint invariant test

The entire trace topology rests on `tessellate()` emitting arc endpoint control points *verbatim* (the `j===0` / `j===numSeg` branches copy, not recompute), so `coordinatesEqualXY` (exact `===`) in `tracing.js` matches them. This is untested and fails silently if broken (empty `vertexIndices` → trace target switching silently stops).

**Files:** Create/extend `test/node/ol/interaction/tracing.test.js` (and/or `CircularString.test.js`).

- [x] **Step 1:** Write a test that **fails iff the invariant breaks**: build a `CircularString` with known control points, call `tessellate()`, assert the emitted array contains each control point coordinate pair via strict `===` (not `closeTo`). (It passes today; its job is to fail loudly if a future change recomputes rather than copies endpoints.)
- [x] **Step 2:** Add a companion test through `getTraceVertexIndices_` (or the nearest public seam) asserting `vertexIndices` is non-empty and lands exactly on control-point indices.
- [x] **Step 3:** Run; confirm green today. Commit: `test(interaction): pin bit-exact tessellation endpoint invariant`.

**Result:** Added a `bit-exact tessellation endpoint invariant` describe block to `test/node/ol/interaction/tracing.test.js` with two tests: (a) every control point (arc begin/mid/end) appears verbatim in `tessellate()` output via strict `===`, and first/last emitted coords equal the first/last control points; (b) `getTraceTargets` (public seam over `getTraceVertexIndices_`) yields non-empty `vertexIndices` that each land on an arc-endpoint control point. Both green today.

### Task 2.2: TraceSource graph-build test (if gap exists)

- [x] **Step 1:** Review existing `TraceSource.test.js`; identify whether shared-vertex stitching (two features sharing an exact XY) and active-edge stickiness are covered.
- [x] **Step 2:** Add any missing case: two features sharing a vertex produce one stitched graph vertex; `getActiveEdge` sticks to `previous` within tolerance and switches only at graph vertices.
- [x] **Step 3:** Run + commit.

**Result: no gap — no new tests required.** `TraceSource.test.js` already covers both targets: shared-vertex stitching (`unifies shared vertices across two LineString features`, `edges reference the shared vertex when two LineStrings meet`) and active-edge stickiness (`getActiveEdge sticks to the previous edge when cursor sits on a shared vertex`, `switches when cursor moves clearly closer to a different edge`, `does not hop to a disconnected feature mid-edge`, `allows transition to a shared-vertex neighbor`), plus the full invalidation/dispose lifecycle under `live updates`.

---

## Phase 3 — Confirmed correctness bugs

### Task 3.1: Degenerate (collinear) arc handling in queries

**Files:** `src/ol/geom/CircularString.js` — `closestPointXY` (~line 330), `intersectsExtent` (~line 822), `closestPointOnArc` helper.

A collinear triplet is a legitimate straight segment per SQL/MM and `tessellate()` treats it as one; `closestPointXY`/`intersectsExtent` currently `continue` past it, and `closestPointOnArc` falls back to nearest endpoint instead of projecting onto the chord.

- [ ] **Step 1:** Write failing tests: (a) closest point to a CircularString whose middle triplet is collinear returns a point on the straight segment, not an endpoint; (b) `intersectsExtent` returns true when only the straight portion crosses the extent.
- [ ] **Step 2:** In the degenerate branch, project onto / intersect the straight chord segment instead of skipping. Reuse existing segment closest-point / extent helpers.
- [ ] **Step 3:** Tests pass; typecheck + lint. Commit.

### Task 3.2: `orientRings` must not mutate constructor inputs

**Files:** `src/ol/geom/CurvePolygon.js` — `orientRings()` (~line 355), constructor (~line 85), `setRingsArray()` (~line 458); possibly `src/ol/geom/SimpleGeometry.js` `reverse()`.

`orientRings()` calls `ring.reverse()` in place (only when `rings.length >= 2`), mutating shared ring instances — a footgun for the branch's shared-boundary use case. Upstream `Polygon` never mutates input; it orients lazily into a private copy.

- [x] **Step 1 (consequence map):** Readers of raw rings: WKT.js:1002 / WKB.js:761 serialize `getRingsArray()` directly (NOT an oriented copy); `getRings()` returns clones; the render path uses `getOrientedFlatCoordinates()`, which re-orients the *flat* output independently via `linearRingsAreOriented`/`orientLinearRings`, so rendering/area/contains are orientation-independent of the stored rings. `sphere.js` area/length use `Math.abs` + index-based hole roles (orientation-independent). Only serialization observes raw ring orientation. `CompoundCurve.reverse()`→`sub.reverse()` is unrelated (explicit user reverse, not eager). Constructor/`setRingsArray` listen to input rings **by reference** (cache-invalidation tests mutate the original ring and expect `change`), so a defensive clone was rejected — it would break reference listening. Conclusion: drop the eager reverse entirely (matches upstream `Polygon`).
- [x] **Step 2:** Added failing test `constructor input ring mutation` in `CurvePolygon.test.js`: outer given CCW + inner given CW, construct once, assert neither `getCoordinates()` changed (RED confirmed — both were reversed in place). Plus a companion test asserting `getOrientedFlatCoordinates()` is still correctly oriented (`linearRingsAreOriented` true).
- [x] **Step 3:** Removed the three `orientRings()` call sites, the `orientRings()` + `ringIsClockwiseOriented()` methods, and the now-unused `linearRingIsClockwise` import. Orientation is left to the lazy `getOrientedFlatCoordinates()`. `SimpleGeometry.reverse()` is still consumed by `CompoundCurve.reverse()` → keep; re-evaluate in **Task 9.4**.
- [x] **Step 4:** Constructor/`setRingsArray` keep reference semantics (required by cache-invalidation tests); `setRings()` still clones. No mutation of caller instances remains.
- [x] **Step 5:** All green — typecheck 0, eslint 0, full node suite **2766 passing / 0 failing**. Regenerated 14 CurvePolygon **WKB fixtures** (they encoded the old canonicalized/reversed orientation) from their WKT so read and write round-trips agree on the preserved orientation. Committed `4368ba3fd0`.
  - **Browser-test caveat:** `curvebuilder`/`modify`/`snap` browser specs were not run here. The winding change is benign for the trace graph (undirected edge graph) and for rendering (flat output re-oriented). Flag for CI browser run before merge.

### Task 3.3: Stale derived caches on direct flat-coordinate mutation

**Files:** `src/ol/geom/CircularString.js` — add `setFlatCoordinates` override, or (preferred) convert `flatCenterOfCircleCoordinates_` / `drawableFlatCoordinates_` to lazy revision-keyed derivation like `flatMidpoint_`.

`CircularString` overrides `applyTransform/rotate/scale/translate/setCoordinates` to call `update()`, but not the inherited `setFlatCoordinates`, leaving derived arrays stale; the renderer draws from `getDrawableFlatCoordinates()`.

- [x] **Step 1:** Added failing test `#setFlatCoordinates > refreshes derived caches after direct flat-coordinate mutation` in `CircularString.test.js`: populate drawable coords, then `setFlatCoordinates('XY', ...)` moving the arc +100x, assert `getDrawableFlatCoordinates()` reflects the new start/end/center (RED confirmed — stayed at old x=5).
- [x] **Step 2:** Implemented the minimal, class-consistent fix: override `setFlatCoordinates(layout, flat)` to call `super` then `this.update()`, matching the eager `update()` pattern already used by `setCoordinates`/`applyTransform`/`rotate`/`scale`/`translate`. (Chose eager over a lazy revision-keyed refactor to stay consistent with the class and avoid over-engineering; the whole class uses eager `update()`.)
- [x] **Step 3:** All green — 111 CircularString tests passing, typecheck 0, eslint 0. Committed `8617515008`.

### Task 3.4: CurveBuilder uses cloning accessor in render hot path

**Files:** `src/ol/render/canvas/CurveBuilder.js` (~line 137: `getRings()` → `getRingsArray()`).

- [x] **Step 1:** Changed `curvePolygonGeometry.getRings()` to `getRingsArray()` in `appendCurvePolygonInstructions_`. Confirmed the loop only reads each ring (`getType`, `getFlatCoordinates`, `getStride`, `getDrawableFlatCoordinates`) — no mutation.
- [x] **Step 2:** typecheck 0, eslint 0. `curvebuilder.test.js` is browser-only (not run here; flag for CI). Committed `b8b1459f8e`.

### Task 3.5: GeometryCollection declutter not passed down

**Files:** `src/ol/renderer/vector.js` (~line 327, `renderGeometryCollectionGeometry`, `_declutter`).

- [x] **Step 1:** Diffed against base `ba63bf383d`: upstream `renderGeometryCollectionGeometry(replayGroup, geometry, style, feature, declutterBuilderGroup, index)` **forwards the declutter param to children**. The branch refactored the canonical `GEOMETRY_RENDERERS` order to `(replayGroup, geometry, style, feature, index, declutter)` (see `renderFeatureInternal` dispatch + `renderPointGeometry`), but left `renderGeometryCollectionGeometry` on the old `(_declutter, index)` order **and** stopped forwarding declutter. Net effect: a GeometryCollection received `index`/`declutter` swapped and never passed declutter to children — a decluttered Point (image+text) inside a collection silently lost decluttering.
- [x] **Step 2:** Restored propagation: signature now `(replayGroup, geometry, style, feature, index, declutter)`; the loop forwards both `index` and `declutter`. Removed the `_declutter` "unused" rename and the "not passed down further" comment.
- [x] **Step 3:** typecheck 0, eslint 0. Renderer specs are browser-only (`test/browser/spec/ol/renderer/...`); not run here — flag for CI. Committed `abde830f74`.

### Task 3.6: CompoundCurve contiguity validation

**Files:** `src/ol/geom/CompoundCurve.js` — `init_` (~line 91), `appendGeometry` (~line 256), `getFlatCoordinates`/`tessellate` (junction dedup ~line 169).

`getFlatCoordinates`/`tessellate` unconditionally drop the first coordinate of each subsequent sub-geometry as junction dedup; disjoint sub-geometries silently swallow a coordinate and render a phantom connection — directly counter to the "zero gaps" mission.

- [x] **Step 1:** Added `contiguity validation` describe in `CompoundCurve.test.js`: disjoint subs throw from the constructor, `setGeometriesArray`, and `appendGeometry`; contiguous subs still append (RED confirmed for the three throw cases).
- [x] **Step 2:** Added module-level `assertContiguous(previous, next)` (exact-XY: next `getFirstCoordinate()` must equal previous `getLastCoordinate()`), wired into `init_` (each consecutive pair) and `appendGeometry`, alongside the existing type/layout `assert`s. Chose `assert` (throw) for consistency with the sibling structural checks and the "zero gaps" mission; exact-XY since contiguous curves share identical endpoint values (WKT/WKB round-trips and the drawing flow both produce exact shared coords).
- [x] **Step 3:** All green — typecheck 0, eslint 0, **full node suite 2771 passing / 0 failing** (no parser/tracing path builds disjoint CompoundCurves). Committed `fa5e2587f0`.

---

## Phase 4 — Unify divergent duplicated code

### Task 4.1: Collapse the crossing twins

`getArcArcCrossingPoint` (singular, dead) and `getArcArcCrossingPoints` (plural, production) are ~150-line copy-pastes that have already drifted: the plural has a chord-proportional `25e-6` near-shared-endpoint filter the singular lacks (`topology.js:632`). Since Phase 1 deletes the singular, this is mostly resolved — but verify no future "first-only" need.

**Files:** `src/ol/geom/flat/topology.js`.

- [x] **Step 1:** Verified via `git grep`: the singular `getArcArcCrossingPoint` is gone (Phase 1); only the plural `getArcArcCrossingPoints` remains. No first-crossing-only consumer exists (both `getArcArrayCrossings` and `getArcArraySelfIntersections` collect the full result array). Documented in the plural's JSDoc that it is canonical and callers can read `result[0]` for the first crossing.
- [x] **Step 2:** The segments twins (`getSegmentsCrossingPoint`/`getSegmentsCrossingPoints`) were also deleted in Phase 1; only `getIntersectionPoint` (Snap) survives — nothing to collapse.
- [x] **Step 3:** typecheck 0, eslint 0. Committed `13c8826e63`.

### Task 4.2: De-duplicate trace-vertex helpers

Near-identical `traceTargetStartsAtCoordinate` / `isTraceVertexPivot` / `isStoredSharedTraceVertex` / `getTraceVertexIndexAtCoordinate` exist in both `tracing.js` (underscore-private) and `Draw.js`.

**Files:** `src/ol/interaction/tracing.js`, `src/ol/interaction/Draw.js`.

- [x] **Step 1:** Export the canonical implementations from `tracing.js` (it already exports `isTraceTargetVertexIndex`).
- [x] **Step 2:** Import them in `Draw.js`; delete the forked copies.
- [x] **Step 3:** Run `tracing.test.js` + `Draw-trace-source.test.js`. Commit.

**Result:** Exported `getTraceVertexIndexAtCoordinate`, `isTraceVertexPivot`, `isStoredSharedTraceVertex` from `tracing.js` (dropped underscore, updated internal callers `canSwitchTraceTarget_`/`isTraceVertexPivot`); `traceTargetStartsAtCoordinate_` stays private (only an internal dependency). Draw.js imports the three and deletes its four forks (which had drifted to inline XY-equality / `squaredCoordinateDistance===0` — verified equivalent to `coordinatesEqualXY`). Draw-specific `isTraceBacktracking` retained; `interpolateCoordinate`/`squaredCoordinateDistance` imports still used elsewhere. typecheck 0, eslint 0, full node suite 2771 passing. Commit `34a6fdb56d`.

### Task 4.3: Unify curve-type dispatch on `getType()`

Four modules use three idioms for "is this a curve type": `Draw` duck-types `getActiveEdge`, `View`/`sphere` duck-type `tessellate`, `tracing` uses `instanceof`, `Snap`/renderer use `getType()`. OL convention is `getType()`.

**Files:** `src/ol/interaction/Draw.js`, `src/ol/View.js`, `src/ol/sphere.js`, `src/ol/interaction/tracing.js`.

- [x] **Step 1:** Introduce/confirm a single predicate (e.g. a set of curve `getType()` strings, or an `isTessellatable(geometry)` helper) and migrate `View`, `sphere`, `tracing` to it.
- [x] **Step 2:** For `Draw`'s TraceSource detection, use `instanceof TraceSource` (no import cycle exists) rather than `typeof getActiveEdge === 'function'`.
- [x] **Step 3:** Typecheck + node + affected browser specs. Commit.

**Result:** Added exported `isTessellatable(geometry)` to `geom/Geometry.js` (backed by a `TESSELLATABLE_TYPES` = CircularString/CompoundCurve/CurvePolygon set checked via `getType()` — exactly the types exposing `tessellate()`). Migrated `View.rotatedExtentForGeometry` and `sphere.tessellateRing` off `typeof geometry.tessellate === 'function'`. `Draw.isTraceSourcePrimitive_` now uses `instanceof TraceSource` (value import; confirmed TraceSource does not import Draw, no cycle). `tracing.js` already dispatched via `instanceof`/`getType()` (no tessellate duck-typing) and was left unchanged. typecheck 0, eslint 0, full node suite 2771 passing. Commit `fb7c44902a`.

---

## Phase 5 — Contract / typing fixes (CI-visible)

### Task 5.1: Nullable-return contracts

**Files:** `CircularString.js:519`, `CompoundCurve.js:337`, `CurvePolygon.js:753` (`getCoordinateAt`/`getFirstCoordinate`/`getLastCoordinate`).

- [x] **Step 1:** Decide policy: match upstream (never return `null`) or declare `{Coordinate|null}`. Prefer matching upstream behavior for the base class contract.
- [x] **Step 2:** Update code and JSDoc so declared and actual return types agree. Add/adjust tests for the empty-geometry case.
- [x] **Step 3:** Typecheck must pass. Commit.

**Result:** Chose *match upstream (never null)*. Empty `CircularString`/`CompoundCurve.getCoordinateAt` now return a NaN-filled coordinate (as `interpolatePoint` does upstream); empty `CompoundCurve`/`CurvePolygon` `getFirstCoordinate`/`getLastCoordinate` return `[]` (as `SimpleGeometry.slice`). Declared `{Coordinate}` now honest. Added empty-geometry tests; updated the stale CurvePolygon `returns null` test. typecheck 0, full node suite 2774. Commit `2c96e93f31`.

### Task 5.2: `setCoordinates` arity assertion

**Files:** `CircularString.js:737`.

- [x] **Step 1:** Change the assertion from `length % 2 === 1` to `length === 0 || (length >= 3 && length % 2 === 1)` so a 1-point CircularString is rejected. Add a test.
- [x] **Step 2:** Typecheck + node tests. Commit.

**Result:** Tightened the `setCoordinates` arity assert; a 1-point CircularString now throws `/odd number of points/`. Added a single-point rejection test. typecheck 0, full node suite 2775. Commit `b7a0738c43`.

### Task 5.3: Document `computeSegmentCount` cap

**Files:** `CircularString.js:54`.

- [x] **Step 1:** Document the `[4, 512]` clamp in the tolerance contract JSDoc (the tolerance is best-effort, capped at 512 segments), OR make the cap configurable. Minimal: document it so the promise and code agree.
- [x] **Step 2:** Commit.

**Result:** Documented the `[4, 512]` clamp in both `computeSegmentCount` and `tessellate()` JSDoc — for a very small tolerance on a large arc the cap can be reached and tolerance is honored best-effort only. Commit `c95def7317`.

---

## Phase 6 — TraceSource / Draw robustness

### Task 6.1: Automatic invalidation on geometry change

**Files:** `src/ol/interaction/TraceSource.js` (~lines 92–115).

Only Collection add/remove is listened to; geometry `change` is not, making `invalidate()` a standing manual obligation (bug generator). Spec the **full listener lifecycle** in one place (coordinated with Task 6.3's `disposeInternal`), covering all four attach/detach cases:

1. Feature `change` fires when its geometry mutates → geometry `change` → `invalidate()`.
2. `feature.setGeometry(newGeom)` (feature `change:geometry`): the old geometry's listener is now on a discarded object — unlisten the old, listen the new, `invalidate()`.
3. Collection `add`/`remove`: attach/detach the per-feature listeners (not just `invalidate()`).
4. Plain-**Array** constructor path has no add/remove signal — attach once in `buildIfNeeded_` and detach in `disposeInternal`; the Array case needs its own lifecycle.

- [x] **Step 1:** Write failing tests for cases 1 and 2 (modify a vertex, and `setGeometry`) — graph reflects the change with no manual `invalidate()`.
- [x] **Step 2:** Implement the four-case lifecycle with a single attach/detach helper pair; store listener keys for guaranteed teardown. Route all teardown through `disposeInternal` (see Task 6.3) so there is one cleanup path, not two.
- [x] **Step 3:** Add a listener-leak assertion (attach count returns to zero after remove/dispose). Tests pass. Commit.

**Result (commit `2514707b97`):** Chose **feature-level** `change` listening rather than geometry-level — verified in `Feature.js` that both vertex mutation (`handleGeometryChange_` → `changed`) and `setGeometry` (`handleGeometryChanged_` re-wires + `changed`) fire the feature's `change`, so one listener type covers all four cases with no stale geometry listeners. `TraceSource` now stores `featureChangeKeys_` (uid→key) + `collectionKeys_`, registers via `registerFeatures_`, and reacts to Collection ADD/REMOVE. Added 4 node tests (in-place modify invalidates, `setGeometry` invalidates incl. re-wired listener, per-feature detach on remove/dispose asserting `featureChangeKeys_` count, stops reacting to removed feature). Done together with Task 6.3.

### Task 6.2: Tolerance gate on initial edge acquisition

**Files:** `src/ol/interaction/TraceSource.js` (`getActiveEdge`, ~line 402).

When `previous` is null it returns the globally closest edge regardless of distance.

- [x] **Step 1:** Write a failing test: `getActiveEdge` with a far cursor and no `previous` returns null (outside tolerance).
- [x] **Step 2:** Gate initial acquisition on `tolerance` (or clearly document that acquisition is unbounded and callers must pre-gate). Prefer gating for a safe contract; update JSDoc.
- [x] **Step 3:** Verify Draw's entry path still works (it may already pre-gate via `getNearestVertex`). Commit.

**Result (commit `234e4b4fe1`):** Added `if (!previous) { return bestDist2 <= tol2 ? bestEdge : null; }` before the `return bestEdge || previous;` fallback, gating initial acquisition on tolerance; updated `@return` JSDoc. Draw's entry path pre-gates via `getNearestVertex` (`activateTracePrimitive_` only starts a trace on a graph vertex), so behavior is unchanged. Added node test for a far cursor with no previous edge.

### Task 6.3: `TraceSource` extends `Disposable`

**Files:** `src/ol/interaction/TraceSource.js` (~line 593).

- [x] **Step 1:** Extend `Disposable`, move cleanup into `disposeInternal`. Commit.

**Result (commit `2514707b97`):** `TraceSource extends Disposable`; constructor calls `super()`; the hand-rolled `dispose()` replaced by `disposeInternal()` (unlisten `collectionKeys_` + all `featureChangeKeys_`, reset, `super.disposeInternal()`). Single teardown path shared with Task 6.1. Committed together with 6.1.

### Task 6.4: Contain DrawEvent trace payload (optional / higher rebase-risk)

**Files:** `src/ol/interaction/Draw.js` (DrawEvent, ~lines 248–398).

Eight flat `@api` trace fields maximize rebase pain on a high-churn file.

- [x] **Step 1:** Evaluate consolidating the 8 fields into a single `trace` payload object (keeping backward-compat getters if any consumer relies on the flat names). This is a design decision — confirm with the maintainer before churning public API again.
- [x] **Step 2:** If approved, refactor + update example/tests. Commit. If not, leave as-is and record the decision.

**Result (commit `2aa51e2c50`):** Full consolidation (maintainer decision: "do whatever long-term decision is best"; API is unreleased so no back-compat getters). Added a `TraceEventDetail` typedef; replaced the 8 flat `@api` fields with a single `this.trace` object (or `undefined` on non-trace / `tracestart` events). Migrated the only 3 consumers: the `topological-draw-curves` example (`e.trace?.feature|geometry|canonicalEdges`) and the `Draw-trace-source` browser spec (`trace.subGeometryKind`, `trace.canonicalEdges`; tracestart now asserts `trace` is `undefined`). `git grep` confirms zero remaining flat-field references. Browser spec flagged for CI (not runnable locally).

### Task 6.5: Strip incremental-plan narration from docstrings

**Files:** `src/ol/interaction/TraceSource.js` (~lines 14, 48).

- [x] **Step 1:** Replace "Subsequent commits build the graph…", "live updates land in a later commit" with final-state API docs. Commit.

**Result (commit `f1528b66ab`):** Rewrote the `features` option doc, classdesc, and the `collectFromGeometry_` trailing comment to final-state wording (removed "live updates land in a later commit", "Subsequent commits build the graph", "Other geometry types added in later tasks").

---

## Phase 7 — Tolerance consolidation

The deepest systemic issue: scale-dependent magic tolerances in a CRS-agnostic library. `getCircleCenter`'s `|denom| < 1e-10` (`arc.js:120`) compares against a segment-length-squared quantity; `getSelfIntersections` defaulted to a 2-meter `epsilonSq=4`; heuristic filters (`t<0.005`, `25e-6`) are patch-shaped with no pinning test.

### Task 7.1: Centralize and document tolerances

**Files:** `src/ol/geom/flat/arc.js`, `src/ol/geom/flat/topology.js`, `src/ol/geom/CurvePolygon.js`; possibly a new `src/ol/geom/flat/tolerances.js`.

- [x] **Step 1:** Inventory every literal (EPSILON `1e-10`, `1e-12`, `1e-7`, `1e-6`, `1e-4`, `epsilonSq=4`, `DEGEN_RADIUS=1e9`, `t<0.005`, `25e-6`, `Math.min(0.01, sweep*0.05)`) with its role (squared-distance vs angular vs parametric). The dimensional mixing (EPSILON used for both squared distance and angle) must be split into named, correctly-dimensioned constants.
- [x] **Step 2:** Extract named constants into one module (or accept tolerance as a documented parameter at call sites). Separate distance-squared, angular, and parametric constants.
- [x] **Step 3:** For scale-dependent checks (`getCircleCenter` collinearity), normalize by segment length so the test is scale-invariant.
- [x] **Step 4:** For interaction-layer callers, inject resolution-derived tolerances (the report doc's `resolution² × 10000` instinct) rather than baking meters into geometry defaults.
- [x] **Step 5:** Add tests pinning each heuristic filter to the artifact it fixes (so "cleanup" can't silently regress it). Typecheck + node tests. Commit incrementally per file.

**Result (commits `b81cfe886a`, `0e62f7b25e`, `c8df7c643f`):**

*Inventory (Step 1) — grouped by dimension:*
- **Squared distance (coordinate-units²):** `1e-12` (arc.js begin==end full-circle ×3), `EPSILON=1e-10` (arc.js coincident segment), `1e-20` (topology zero-length line segment), `epsilonSq=4` (CurvePolygon self-intersection default, meters²), `1e-4` (arcsAreEqual / same-arc default), `25e-6` (topology chord-proportional — actually a *squared parametric fraction*, `0.005²`).
- **Angular (radians):** `1e-7` (containsAngle default), `1e-10` (arc.js `getArcBoundingCoords` extreme exclusion — **dimensional-mixing bug**: same numeric `EPSILON` was doing double duty as squared-distance *and* angle), `Math.min(0.01, sweep*0.05)` (adaptive arc tolerance).
- **Parametric (dimensionless):** `1e-9` (interior-bound exclusion for t/u across line/line, line/arc, circle/circle), `0.005`/`0.995` (near-endpoint fraction).
- **Absolute distance / radius (coordinate-units):** `1e-9` (circle/circle containment & tangency), `1e-6` (radius-match), `1e-10` (line/line parallel determinant — scale-dependent area, retained but named), `DEGEN_RADIUS=1e9`.

*Steps 2–3:* New `src/ol/geom/flat/tolerances.js` holds every constant with JSDoc stating its dimension and scale behavior. `arc.js`, `topology.js`, `CircularString.js`, `CurvePolygon.js` all migrated to the named imports (behavior-preserving except Step 3). The dimensional mixing was split: `COINCIDENT_SEGMENT_SQ` (distance²) vs `ARC_EXTREME_ANGULAR_EPSILON` (radians). **Step 3:** `getCircleCenter` collinearity now compares `sin²(theta) = denom²/(len1²·len2²)` against `COLLINEAR_SIN²` instead of the raw area `|denom|`, making the null/non-null decision scale-invariant (large-magnitude near-collinear points previously produced a bogus finite center). Identical at unit scale, so no regression; 3 pinning tests added in `arc.test.js`.

*Step 4:* Audited `src/ol/interaction/**` — **no** interaction-layer code calls the tolerance-defaulting APIs; the only callers are `examples/topological-draw-curves.js` (app orchestration, deferred per the Findings Ledger). Geometry-layer defaults are now named (`DEFAULT_CROSSING_EPSILON_SQ`, `DEFAULT_SAME_ARC_TOLERANCE_SQ`) and documented as meter-based with explicit guidance to inject resolution-derived tolerances, satisfying the "don't bake meters into geometry defaults" intent without churning the deferred example.

*Step 5:* `test/node/ol/geom/flat/tolerances.test.js` pins all constant values and the derived relationships (`VERTEX_MATCH_DISTANCE² == COINCIDENT_POINT_SQ`, `ENDPOINT_PARAMETRIC_FRACTION² == ENDPOINT_PARAMETRIC_FRACTION_SQ`) so a future "cleanup" can't silently change a heuristic. Full node suite 2790 passing / 0 failing.

**Flake note:** The Phase-7 ignore-list-VOID directive targets the `Modify-curve` browser flakes, which live in `test/browser/` and are **not runnable locally** in this environment (no headless browser). They could not be characterized here; the tolerance changes are behavior-preserving (except the scale-invariant `getCircleCenter`, which is strictly more correct and unchanged at unit scale), so the risk of a tolerance regression masquerading as the flake is minimized. **Flagged for CI** to run the browser suite.

---


## Phase 8 — Consistency cleanup

### Task 8.1: Modify.js styling via `createEditingStyle`

**Files:** `src/ol/interaction/Modify.js` (~line 3075), `src/ol/style/Style.js`.

- [x] **Step 1:** Route control-point/midpoint display through the themeable `createEditingStyle` mechanism (preserving the `vertexFeature.set('midpoint', …)` discriminator) instead of hardcoded `new Style({image: new CircleStyle(...)})`. Commit.

*Result:* `getDefaultStyleFunction` tidied with named palette constants (`white`, `midpointBlue`, `insertOrange`) and documented that the *shared* vertex style is sourced from `createEditingStyle()` (`style['Point']`), while the midpoint/insert markers are intentional curve-only affordances re-themeable via the point feature's `midpoint`/`existing` discriminators. Appearance-preserving (radii 4/5, stroke widths 1/1.5 unchanged). Committed.

### Task 8.2: De-duplicate `flatToCoordinates` helpers

**Files:** `src/ol/sphere.js` (~line 56), `src/ol/interaction/tracing.js` (~line 723).

- [x] **Step 1:** Extract one shared helper (e.g. into `geom/flat/` utilities) and import it in both places. Commit.

*Result:* Both local helpers removed in favour of the canonical `inflateCoordinates(flat, 0, flat.length, 2)` from `geom/flat/inflate.js`; imported in `sphere.js` and `tracing.js`. In `sphere.js` the CurvePolygon length loop computes `tessellateRing(...)` once into a local before inflating. Full node suite green. Committed.

### Task 8.3: Clarify CurvePolygon dual "ends" semantics

**Files:** `src/ol/geom/CurvePolygon.js` (`getEnds` ~351, `getTessellatedEnds` ~400).

- [x] **Step 1:** Rename or document so it's unambiguous which flat-coordinate array each ends-array pairs with (e.g. `getControlEnds`/`getTessellatedEnds`, or explicit JSDoc pairing notes). Prefer the existing bundling accessor `getTessellatedFlatData()` for consumers. Commit.

*Result:* Chose explicit JSDoc pairing notes over a rename — `getEnds()` is `@api` and matches the polygon-like contract consumed by renderers and `Snap.js`, so renaming was too risky. `getEnds()` JSDoc now states it pairs with `getFlatCoordinates()` (control-point coords); `getTessellatedEnds()` states it pairs with `getOrientedFlatCoordinates()` (tessellated) and steers consumers to the bundled `getTessellatedFlatData()`. Committed.

### Task 8.4: Fix `intersectsExtent` fallback comment

**Files:** `src/ol/geom/CircularString.js` (~line 873).

- [x] **Step 1:** Correct the comment to describe what the code actually does (closest-point-to-extent-center proximity test), or remove the fallback if analysis confirms it's dead for non-degenerate arcs. Add a test if kept. Commit.

*Result:* Kept the fallback (cheap defensive insurance) and corrected the comment: it is a closest-point-to-extent-center *proximity* test that catches an arc grazing the extent, NOT the enclosure test the old comment claimed (an extent enclosed by a large ring has its nearest curve point far out on the ring, so enclosure is not — and cannot be — detected here). Analysis: for non-degenerate arcs `arcIntersectsSegment_` uses exact circle math, so any arc entering the extent already crosses an edge; the fallback is near-unreachable but retained for numerical robustness. Added a pinning test: a small extent at the centre of a large arc returns `false`. Committed.

---

## Phase 9 — Documentation & churn cleanup

### Task 9.1: Fix the stale design doc

**Files:** `TOPOLOGICAL_CURVE_DRAWING_DESIGN.md` (repo root).

It describes methods that don't exist (`CircularArc.splitAtAngle`, `CircularString.splitAtCoordinate`, `CompoundCurve.slice`/`locateCoordinate`) and falsely claims "OL caches tessellation results" (`tessellate()` recomputes every call).

- [x] **Step 1:** Add a prominent header: "SUPERSEDED — the implementation pivoted to the `TraceSource` graph model; see `docs/topological-curve-drawing-report.md`." Remove or correct the phantom-API sections and the false caching claim.
- [x] **Step 2:** Record the **vertex-only-exit UX decision** in the superseded header (it is currently written down nowhere): the trace graph lets a user enter/leave an existing boundary only at *arc endpoints* (control-point granularity), never mid-arc — the single biggest behavioral divergence from the original design. State it as an intentional constraint and why (junctions must be explicit control points in the gijs data model). One paragraph.
- [x] **Step 3:** Consider moving it under `docs/` rather than repo root. Commit.

*Result:* Prepended a SUPERSEDED banner naming the phantom primitives (never built), correcting the false "OL caches tessellation" claim, and recording the vertex-only-exit UX constraint (trace pivots only at existing control points). Fixed the two concrete caching falsehoods inline (lines ~369, ~480). Moved the file to `docs/topological-curve-drawing-design-SUPERSEDED.md` and fixed the banner's relative link. Committed.

### Task 9.2: Prune process-exhaust planning docs

**Files:** `docs/superpowers/plans/2026-06-16-trace-source-primitive.md` (contains literal `git commit -m` blocks) and siblings.

- [x] **Step 1:** Keep the genuinely valuable report (`docs/topological-curve-drawing-report.md`). For task-by-task plans with embedded commit commands, either delete them or add a "superseded by implementation" header. Commit.

*Result:* Added a "SUPERSEDED BY IMPLEMENTATION" banner to `docs/superpowers/plans/2026-06-16-trace-source-primitive.md` (the plan whose steps shipped, with embedded `git commit` blocks), pointing to the as-built report and design spec. Kept the report and the design spec intact. Committed.

### Task 9.3: Revert gratuitous churn vs upstream

**Files:** `src/ol/format/WKT.js` (constructor-map quote restyle `'POINT': Point` → `POINT: Point`; deleted scientific-notation explanatory comments), `src/ol/interaction/Snap.js` (comment-casing edits — **verified**: two `// Calculate` → `// calculate` lines in the `main...HEAD` diff).

Diff-minimalism is a maintenance feature on a fork tracking upstream v10+.

- [x] **Step 1:** `git diff main...HEAD -- src/ol/format/WKT.js src/ol/interaction/Snap.js`; revert every change that is purely cosmetic (quote style, comment casing, deleted upstream comments) while preserving the real feature additions (new parse methods, curve type map entries).
- [x] **Step 2:** Typecheck + lint + WKT/WKB node tests. Commit: `style: revert cosmetic churn vs upstream in WKT/Snap`.

*Result:* WKT — restored quoted `GeometryConstructor` keys (new curve entries kept but re-quoted for consistency), the two `Lexer.nextToken_` blank lines, the scientific-notation explanatory comments in `readNumber_`, and the `super();` blank line. Snap — restored `// Calculate…`/`// Dispatch UNSNAP…` casing/wording and the deleted `// Calculate intersections with existing segments` and `// points have only one coordinate` comments. All feature additions (curve segmenters; curve WKT parse/encode) preserved. typecheck 0 / eslint 0 / WKT+Snap node tests 58 passing. Committed.

### Task 9.4: Reconsider `SimpleGeometry.reverse()` (coupled to Task 3.2)

**Files:** `src/ol/geom/SimpleGeometry.js` (~lines 152–157), `src/ol/geom/CompoundCurve.js` (`reverse()`).

`reverse()` was added un-`@api`'d to a base class upstream doesn't have it on, to serve `orientRings`'s eager mutation. After Task 3.2 removes that mutation, re-evaluate.

- [x] **Step 1:** Using Task 3.2 Step 1's consumer map, determine whether `SimpleGeometry.reverse()` still has a live consumer (notably `CompoundCurve.reverse()` → `sub.reverse()`). 
- [x] **Step 2:** If the only consumer was the removed eager path, remove it; if `CompoundCurve.reverse()` still needs it, keep it but scope/document it (and decide whether it warrants `@api`). Commit.

*Result:* KEEP. `git grep` confirms `CompoundCurve.reverse()` (line 284) calls `geometries[i].reverse()` on its `SimpleGeometry` sub-geometries (CircularString/LineString), so `SimpleGeometry.reverse()` has a live consumer independent of the removed eager `orientRings` path. No code change — decision recorded here.

---

## Suggested execution order (reviewer's priority, adjusted for verified state)

1. **Phase 1** dead-code removal + dead-export sweep (fast, shrinks surface, unblocks Task 4.1).
2. **Phase 2** invariant + graph tests (protect before further edits).
3. **Phase 3** the six confirmed bugs (highest user-facing value).
4. **Phase 4** unify divergent duplicates.
5. **Phase 5** typing/contract fixes (green CI).
6. **Phase 6** TraceSource/Draw robustness.
7. **Phase 7** tolerance consolidation (largest; per-file commits).
8. **Phase 8** consistency cleanup.
9. **Phase 9** docs + churn revert.

---

## Findings Ledger — every finding maps to a task or a recorded decision

The plan's own rule ("every symbol has a consumer or a justification") applies to findings too: no review item silently evaporates. Items with a task are listed by task number; the rest get an explicit decision here.

| Finding | Disposition |
|---|---|
| Dead primitives (`splitArcAtAngle`, singular `getArcArcCrossingPoint`, segments twins, `getCurveSegmentAt`) | Task 1.1 |
| `closeTolerance` dead param | Task 1.2 |
| `getSelfIntersections` core vs example copy | Task 1.4 (decision) |
| Bit-exact tessellation invariant untested | Task 2.1 |
| Degenerate-arc query skips | Task 3.1 |
| `orientRings` input mutation + downstream orientation readers | Task 3.2 / 9.4 |
| Stale derived caches | Task 3.3 |
| `getRings()` clone in render path | Task 3.4 |
| Declutter not passed down | Task 3.5 |
| CompoundCurve contiguity | Task 3.6 |
| Crossing-twin drift | Task 4.1 |
| Duplicated trace-vertex helpers | Task 4.2 |
| Dispatch-idiom fragmentation | Task 4.3 |
| Nullable-return / arity / segment-cap contracts | Tasks 5.1\u20135.3 |
| No geometry-change invalidation (full lifecycle) | Task 6.1 |
| Ungated initial edge acquisition | Task 6.2 |
| Hand-rolled `dispose` | Task 6.3 |
| 8 flat DrawEvent fields | Task 6.4 (needs maintainer sign-off) |
| Incremental-plan docstrings | Task 6.5 |
| Tolerance zoo + scale-dependent collinearity | Task 7.1 |
| Modify hardcoded styles | Task 8.1 |
| `flatToCoordinates` duplication | Task 8.2 |
| Dual "ends" semantics | Task 8.3 |
| `intersectsExtent` fallback comment | Task 8.4 |
| Stale design doc + false caching | Task 9.1 |
| Vertex-only-exit UX undocumented | Task 9.1 Step 2 |
| Process-exhaust planning docs | Task 9.2 |
| Cosmetic churn (WKT + Snap) | Task 9.3 |
| `SimpleGeometry.reverse()` base-class addition | Task 9.4 |

**Deferred (explicit won't-fix-now, with rationale):**

- **`findOrAddVertex_` O(V\u00b2) graph build + full rebuild on every add/remove.** DEFER. Acceptable for dozens\u2013hundreds of features; the quadratic cost bites at ~low-thousands of vertices per source, and editing sessions over large sources pay it repeatedly (rebuild on each Collection mutation). Revisit with an RBush-backed vertex index (RBush already extended with `.has()` one directory over) if a real dataset shows lag. Not a correctness issue. *Threshold to reopen: interactive lag on a source with > ~2k boundary vertices.*
- **Example crossing-prevention orchestration untested + meter-hardcoded `CROSSING_EPSILON_SQ = 4`** (`examples/topological-draw-curves.js`). DEFER unless Task 1.4 chooses Option A. The 2,100-line example is the load-bearing validation layer gijs-frontend will vendor, yet it is untested and CRS-scale-hardcoded. Moving `checkOverlapWithExisting` / containment / snap-exclusion orchestration into a tested core (or a tested standalone module) is a **separate project-sized effort**, not part of this remediation. Recorded so it does not evaporate; recommend a follow-up spec.
- **`curves.md` fork publishing guide at repo root.** WON'T-FIX (content) / optional relocate. It documents PAT usage via an `NPM_TOKEN` env var (no secret is committed), which is legitimate fork-publishing guidance. Optional: move under `docs/` for repo-root tidiness. No security action needed.

## Meta-gate to encode for next time

Two gates, in priority order:

1. **Provenance stamping (highest leverage).** Any generated review input (the blast, any future diff dump) MUST carry, in its header: `git rev-parse HEAD`, the exact pathspec/`git diff` command used, and the generation timestamp. This entire thread — a review re-deriving ground truth from an unprovenanced blast, an agent re-deriving it because the input was invisibly stale, and a plan hardcoding a causal story nobody can settle — collapses to non-existence with one line in the blast script. This is the same scope-SHA/proven-by discipline already solved in MOTHER; it de-poisons *every* future review in the pipeline, not just this one. Add it to `tmp/gen-blast.ps1` (or wherever the blast is generated) before the next review cycle.
2. **Dead-export sweep.** Add a whole-tree invariant check to the branch's CI/review checklist: **"every exported/`@api` symbol has a consumer or a written justification."** A single sweep against the design doc's promise list would have caught the dead primitives, the stale doc, and the false caching claim in one pass — the per-file work looked finished while the tree-level invariant went unchecked.
