# TraceSource primitive — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `TraceSource` primitive in OL that owns the shared-vertex graph for multi-feature tracing, extend `Draw` to support a new vertex-only-exit trace lifecycle when given a `TraceSource`, and collapse the example's trace bookkeeping onto the new primitive.

**Architecture:** New module `src/ol/interaction/TraceSource.js` builds a planar graph from a feature collection by union-finding exact-coordinate-equal vertices across sub-geometries of every eligible ring. `Draw` accepts a `TraceSource` via its existing `traceSource` option and, when present, runs a new lifecycle: aggressive vertex snapping, sticky-closest active-edge resolution, continuous `trace` events on edge transitions, and trace-exit only on click at a snapped graph vertex. Existing `traceSource: VectorSource` behavior is untouched.

**Tech Stack:** OpenLayers v10 fork, ES modules, JSDoc types, ESLint + Prettier, Mocha for node tests, Karma + Mocha for browser tests, Puppeteer harness for the example.

**Spec:** [docs/superpowers/specs/2026-06-16-trace-source-primitive-design.md](docs/superpowers/specs/2026-06-16-trace-source-primitive-design.md)

---

## File Structure

**Created:**
- `src/ol/interaction/TraceSource.js` — the primitive (graph, queries, lifecycle hooks).
- `test/node/ol/interaction/TraceSource.test.js` — unit tests for the primitive (no browser).
- `test/browser/spec/ol/interaction/Draw-trace-source.test.js` — integration tests for Draw + TraceSource lifecycle.

**Modified:**
- `src/ol/interaction/tracing.js` — export internal helpers `coordinatesEqual_` (renamed to `coordinatesEqual`) and the per-geometry traversal used by the graph builder.
- `src/ol/interaction/Draw.js` — accept `TraceSource` in `traceSource` option; branch lifecycle on instance type; fire the new continuous `trace` event.
- `examples/topological-draw-curves.js` — delete app-side topology code; construct a `TraceSource`; subscribe to the new `trace` event.
- `changelog/upgrade-notes.md` — note the new `TraceSource` primitive and the new `trace` event.

---

## Conventions

- All new code uses JSDoc types matching the file it lives in.
- Coordinate equality means exact `===` on both ordinates (matches existing `coordinatesEqual_` in `tracing.js`).
- Squared distances are used for comparisons (matches existing `getPointSegmentRelationship` contract).
- Commit messages use Conventional Commits: `feat(interaction): ...`, `test(interaction): ...`, `refactor(example): ...`.
- Run `npm run lint -- --no-cache` after each task before committing.

---

## Task 1: Export shared helpers from `tracing.js`

**Files:**
- Modify: `src/ol/interaction/tracing.js`
- Test: `test/node/ol/interaction/tracing.test.js`

The `TraceSource` graph builder needs the same exact-coordinate-equality check as the existing trace logic. Export it under a public-ish name. Use `coordinatesEqualXY` rather than `coordinatesEqual` because three other modules in the codebase (`View.js`, `Modify.js`, `coordinate.test.js`) already alias `equals as coordinatesEqual` from `coordinate.js` — and that N-D `equals` would *change behavior* for 3D features versus the XY-only semantic the trace topology requires (a vertex at the same XY but different Z must still stitch). The explicit `XY` suffix prevents the collision and signals the dimension contract.

- [ ] **Step 1: Add a failing import test**

Add to `test/node/ol/interaction/tracing.test.js`. The file already imports from `tracing.js` — extend the existing named-import list with `coordinatesEqualXY`. Add a new top-level `describe` block alongside the existing `describe('getTraceTargetUpdate()', ...)`:

```js
describe('coordinatesEqualXY()', function () {
  it('returns true for exact-equal coordinates', function () {
    expect(coordinatesEqualXY([1, 2], [1, 2])).to.be(true);
  });
  it('returns false for unequal X or Y', function () {
    expect(coordinatesEqualXY([1, 2], [1, 2.0000001])).to.be(false);
  });
  it('ignores Z/M components', function () {
    expect(coordinatesEqualXY([1, 2, 3], [1, 2, 99])).to.be(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test-node -- --grep "coordinatesEqualXY"`
Expected: FAIL — `coordinatesEqualXY is not a function`.

- [ ] **Step 3: Export `coordinatesEqualXY` from `tracing.js`**

In `src/ol/interaction/tracing.js`, find:

```js
function coordinatesEqual_(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}
```

Replace with:

```js
/**
 * Exact-equality coordinate comparison restricted to the X and Y components.
 * Any Z/M components are ignored. This is the dimension contract the trace
 * topology requires: vertices at the same XY but different Z must still be
 * treated as the same graph vertex.
 *
 * Distinct from the N-D `equals` exported by `coordinate.js` (which several
 * modules alias as `coordinatesEqual`); the `XY` suffix is intentional.
 *
 * @param {import("../coordinate.js").Coordinate} a First coordinate.
 * @param {import("../coordinate.js").Coordinate} b Second coordinate.
 * @return {boolean} Coordinates have equal X and Y.
 */
export function coordinatesEqualXY(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}
```

Update every existing call site of `coordinatesEqual_` in `tracing.js` (approximately lines 295, 308, 327, 630) to call `coordinatesEqualXY` directly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test-node -- --grep "coordinatesEqualXY"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run full node tests to verify nothing regressed**

Run: `npm run test-node`
Expected: all existing tests pass.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint -- --no-cache
git add src/ol/interaction/tracing.js test/node/ol/interaction/tracing.test.js
git commit -m "refactor(interaction): export coordinatesEqualXY from tracing"
```

---

## Task 2: Skeleton `TraceSource` class with construction + features access

**Files:**
- Create: `src/ol/interaction/TraceSource.js`
- Test: `test/node/ol/interaction/TraceSource.test.js`

Start with the bare class so subsequent tasks have a place to add graph building.

- [ ] **Step 1: Write the failing test**

Create `test/node/ol/interaction/TraceSource.test.js`:

```js
import Collection from '../../../../src/ol/Collection.js';
import Feature from '../../../../src/ol/Feature.js';
import LineString from '../../../../src/ol/geom/LineString.js';
import TraceSource from '../../../../src/ol/interaction/TraceSource.js';
import expect from '../../expect.js';

describe('ol/interaction/TraceSource.js', function () {
  describe('constructor', function () {
    it('accepts an array of features', function () {
      const f = new Feature(new LineString([[0, 0], [1, 1]]));
      const ts = new TraceSource({features: [f]});
      expect(ts.getFeatures()).to.eql([f]);
    });

    it('accepts a Collection of features', function () {
      const f = new Feature(new LineString([[0, 0], [1, 1]]));
      const collection = new Collection([f]);
      const ts = new TraceSource({features: collection});
      expect(ts.getFeatures()).to.eql([f]);
    });

    it('defaults exteriorOnly to true', function () {
      const ts = new TraceSource({features: []});
      expect(ts.getExteriorOnly()).to.be(true);
    });

    it('respects exteriorOnly: false', function () {
      const ts = new TraceSource({features: [], exteriorOnly: false});
      expect(ts.getExteriorOnly()).to.be(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test-node -- --grep "ol/interaction/TraceSource.js"`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the skeleton class**

Create `src/ol/interaction/TraceSource.js`:

```js
/**
 * @module ol/interaction/TraceSource
 */
import Collection from '../Collection.js';

/**
 * @typedef {Object} Options
 * @property {Array<import("../Feature.js").default> | Collection<import("../Feature.js").default>} features
 * Source features whose outer rings form the trace graph. May be an array (static) or a
 * Collection (the graph cache invalidates on add/remove/change).
 * @property {boolean} [exteriorOnly=true] When true, interior rings (holes) of CurvePolygon
 * and Polygon features are excluded from the graph. When false, interior rings participate
 * as their own connected components.
 */

/**
 * Owns the planar graph of shared vertices across a set of source features, used by
 * {@link module:ol/interaction/Draw~Draw} when tracing in vertex-only-exit mode.
 *
 * The graph has one vertex per *exact-coordinate-equal* topology vertex across all eligible
 * rings, and one edge per sub-geometry (each arc of a CircularString, each segment of a
 * LineString, each sub of a CompoundCurve). Features stitch only at shared vertices.
 *
 * @api
 */
class TraceSource {
  /**
   * @param {Options} options Options.
   */
  constructor(options) {
    /**
     * @private
     * @type {Array<import("../Feature.js").default> | Collection<import("../Feature.js").default>}
     */
    this.features_ = options.features;

    /**
     * @private
     * @type {boolean}
     */
    this.exteriorOnly_ = options.exteriorOnly !== false;
  }

  /**
   * @return {Array<import("../Feature.js").default>} Snapshot of source features.
   */
  getFeatures() {
    return this.features_ instanceof Collection
      ? this.features_.getArray().slice()
      : this.features_.slice();
  }

  /**
   * @return {boolean} Whether interior rings are excluded.
   */
  getExteriorOnly() {
    return this.exteriorOnly_;
  }
}

export default TraceSource;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test-node -- --grep "ol/interaction/TraceSource.js"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint -- --no-cache
git add src/ol/interaction/TraceSource.js test/node/ol/interaction/TraceSource.test.js
git commit -m "feat(interaction): add TraceSource primitive skeleton"
```

---

## Task 3: Graph builder — vertex collection from LineString and Polygon features

**Files:**
- Modify: `src/ol/interaction/TraceSource.js`
- Test: `test/node/ol/interaction/TraceSource.test.js`

Build the graph lazily on first query. Start with the two simplest geometry types and one query method (`getVertexCount` for testability) so we can verify vertex unification works before tackling edges.

- [ ] **Step 1: Add a failing test for vertex unification**

Append to `test/node/ol/interaction/TraceSource.test.js`:

```js
import Polygon from '../../../../src/ol/geom/Polygon.js';

describe('graph building (vertices)', function () {
  it('unifies shared vertices across two LineString features', function () {
    // Two lines sharing the point [1, 1].
    const a = new Feature(new LineString([[0, 0], [1, 1]]));
    const b = new Feature(new LineString([[1, 1], [2, 2]]));
    const ts = new TraceSource({features: [a, b]});
    // Three distinct vertices: [0,0], [1,1] (shared), [2,2].
    expect(ts.getVertexCount()).to.be(3);
  });

  it('counts every distinct vertex across two disjoint LineStrings', function () {
    const a = new Feature(new LineString([[0, 0], [1, 1]]));
    const b = new Feature(new LineString([[10, 10], [11, 11]]));
    const ts = new TraceSource({features: [a, b]});
    expect(ts.getVertexCount()).to.be(4);
  });

  it('treats a Polygon ring as a closed sequence of vertices', function () {
    // Polygon with 4 distinct vertices; the closing coord equals the first.
    const ring = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const f = new Feature(new Polygon([ring]));
    const ts = new TraceSource({features: [f]});
    expect(ts.getVertexCount()).to.be(4);
  });

  it('excludes interior polygon rings by default', function () {
    const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
    const f = new Feature(new Polygon([outer, hole]));
    const ts = new TraceSource({features: [f]});
    expect(ts.getVertexCount()).to.be(4);
  });

  it('includes interior polygon rings when exteriorOnly is false', function () {
    const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]];
    const f = new Feature(new Polygon([outer, hole]));
    const ts = new TraceSource({features: [f], exteriorOnly: false});
    expect(ts.getVertexCount()).to.be(8);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test-node -- --grep "graph building \\(vertices\\)"`
Expected: FAIL — `ts.getVertexCount is not a function`.

- [ ] **Step 3: Implement vertex collection + lazy build**

In `src/ol/interaction/TraceSource.js`, add imports and the graph logic. Replace the existing class body with:

```js
/**
 * @module ol/interaction/TraceSource
 */
import Collection from '../Collection.js';
import LineString from '../geom/LineString.js';
import Polygon from '../geom/Polygon.js';
import {coordinatesEqualXY} from './tracing.js';

/**
 * @typedef {Object} Options
 * @property {Array<import("../Feature.js").default> | Collection<import("../Feature.js").default>} features
 * Source features whose outer rings form the trace graph. May be an array (static) or a
 * Collection (the graph cache invalidates on add/remove/change).
 * @property {boolean} [exteriorOnly=true] When true, interior rings (holes) of CurvePolygon
 * and Polygon features are excluded from the graph. When false, interior rings participate
 * as their own connected components.
 */

/**
 * @typedef {Object} TraceVertex
 * @property {number} id Stable vertex id (insertion order).
 * @property {import("../coordinate.js").Coordinate} coordinate The coordinate.
 */

/**
 * Owns the planar graph of shared vertices across a set of source features, used by
 * {@link module:ol/interaction/Draw~Draw} when tracing in vertex-only-exit mode.
 *
 * The graph has one vertex per *exact-coordinate-equal* topology vertex across all eligible
 * rings, and one edge per sub-geometry. Features stitch only at shared vertices.
 *
 * @api
 */
class TraceSource {
  /**
   * @param {Options} options Options.
   */
  constructor(options) {
    /**
     * @private
     * @type {Array<import("../Feature.js").default> | Collection<import("../Feature.js").default>}
     */
    this.features_ = options.features;

    /**
     * @private
     * @type {boolean}
     */
    this.exteriorOnly_ = options.exteriorOnly !== false;

    /**
     * @private
     * @type {Array<TraceVertex> | null}
     */
    this.vertices_ = null;
  }

  /**
   * @return {Array<import("../Feature.js").default>} Snapshot of source features.
   */
  getFeatures() {
    return this.features_ instanceof Collection
      ? this.features_.getArray().slice()
      : this.features_.slice();
  }

  /**
   * @return {boolean} Whether interior rings are excluded.
   */
  getExteriorOnly() {
    return this.exteriorOnly_;
  }

  /**
   * @return {number} Number of distinct graph vertices.
   */
  getVertexCount() {
    this.buildIfNeeded_();
    return this.vertices_.length;
  }

  /**
   * @private
   */
  buildIfNeeded_() {
    if (this.vertices_ !== null) {
      return;
    }
    this.vertices_ = [];
    const features = this.getFeatures();
    for (const feature of features) {
      const geometry = feature.getGeometry();
      this.collectVerticesFromGeometry_(geometry);
    }
  }

  /**
   * @private
   * @param {import("../geom/Geometry.js").default} geometry The geometry.
   */
  collectVerticesFromGeometry_(geometry) {
    if (geometry instanceof LineString) {
      this.addRing_(geometry.getCoordinates(), false);
      return;
    }
    if (geometry instanceof Polygon) {
      const rings = geometry.getCoordinates();
      const max = this.exteriorOnly_ ? 1 : rings.length;
      for (let i = 0; i < max; ++i) {
        this.addRing_(rings[i], true);
      }
      return;
    }
    // Other geometry types added in later tasks.
  }

  /**
   * @private
   * @param {Array<import("../coordinate.js").Coordinate>} coordinates Ring coordinates.
   * @param {boolean} ring True for closed rings (skip the duplicated closing coordinate).
   */
  addRing_(coordinates, ring) {
    const last = ring ? coordinates.length - 1 : coordinates.length;
    for (let i = 0; i < last; ++i) {
      this.findOrAddVertex_(coordinates[i]);
    }
  }

  /**
   * @private
   * @param {import("../coordinate.js").Coordinate} coordinate The coordinate.
   * @return {TraceVertex} Existing or newly inserted vertex.
   */
  findOrAddVertex_(coordinate) {
    for (const v of this.vertices_) {
      if (coordinatesEqualXY(v.coordinate, coordinate)) {
        return v;
      }
    }
    const vertex = {id: this.vertices_.length, coordinate: coordinate.slice()};
    this.vertices_.push(vertex);
    return vertex;
  }
}

export default TraceSource;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test-node -- --grep "graph building \\(vertices\\)"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run full TraceSource test file**

Run: `npm run test-node -- --grep "ol/interaction/TraceSource.js"`
Expected: PASS, 9 tests total (4 from Task 2 + 5 new).

- [ ] **Step 6: Lint and commit**

```bash
npm run lint -- --no-cache
git add src/ol/interaction/TraceSource.js test/node/ol/interaction/TraceSource.test.js
git commit -m "feat(interaction): TraceSource collects unified vertices from LineString and Polygon"
```

---

## Task 4: Graph builder — edges with sub-geometry kind for LineString and Polygon

**Files:**
- Modify: `src/ol/interaction/TraceSource.js`
- Test: `test/node/ol/interaction/TraceSource.test.js`

One edge per segment for LineString and Polygon rings. Edge kind is always `'LineString'` for these types. Each edge points to the parent geometry plus a `segmentIndex` so consumers can reconstruct which segment within a LineString is active.

- [ ] **Step 1: Add a failing test for edges**

Append to `test/node/ol/interaction/TraceSource.test.js`:

```js
describe('graph building (edges)', function () {
  it('creates one edge per LineString segment', function () {
    const f = new Feature(new LineString([[0, 0], [1, 1], [2, 2]]));
    const ts = new TraceSource({features: [f]});
    expect(ts.getEdgeCount()).to.be(2);
  });

  it('creates one edge per Polygon ring segment', function () {
    const f = new Feature(new Polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]));
    const ts = new TraceSource({features: [f]});
    // 4 sides of the square.
    expect(ts.getEdgeCount()).to.be(4);
  });

  it('LineString edges carry kind="LineString" and a segmentIndex', function () {
    const f = new Feature(new LineString([[0, 0], [1, 1], [2, 2]]));
    const ts = new TraceSource({features: [f]});
    const edges = ts.getEdges();
    expect(edges).to.have.length(2);
    expect(edges[0].kind).to.be('LineString');
    expect(edges[0].subGeometry).to.be(f.getGeometry());
    expect(edges[0].segmentIndex).to.be(0);
    expect(edges[1].segmentIndex).to.be(1);
  });

  it('edges reference the shared vertex when two LineStrings meet', function () {
    const a = new Feature(new LineString([[0, 0], [1, 1]]));
    const b = new Feature(new LineString([[1, 1], [2, 2]]));
    const ts = new TraceSource({features: [a, b]});
    const edges = ts.getEdges();
    expect(edges).to.have.length(2);
    // Vertex with coord [1,1] should appear as endVertex of edge 0 and startVertex of edge 1.
    expect(edges[0].endVertex.coordinate).to.eql([1, 1]);
    expect(edges[1].startVertex.coordinate).to.eql([1, 1]);
    expect(edges[0].endVertex).to.be(edges[1].startVertex);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test-node -- --grep "graph building \\(edges\\)"`
Expected: FAIL — `ts.getEdgeCount is not a function`.

- [ ] **Step 3: Implement edge collection**

In `src/ol/interaction/TraceSource.js`, add the edge typedef near the top:

```js
/**
 * @typedef {Object} TraceEdge
 * @property {'CircularString' | 'LineString'} kind Canonical sub-geometry kind. Applications
 * read this to stamp segment-type breaks.
 * @property {import("../geom/SimpleGeometry.js").default | import("../geom/CompoundCurve.js").default | import("../geom/CircularString.js").default} subGeometry
 * The owning sub-geometry instance. For `LineString` and `Polygon` ring edges this is the
 * parent geometry; consumers combine with `segmentIndex` to identify the segment. For arc
 * edges this is the `CircularString` sub itself.
 * @property {number} [segmentIndex] Segment index within `subGeometry` for `LineString`-segment
 * edges. Undefined for whole-sub edges (arcs).
 * @property {TraceVertex} startVertex Start vertex.
 * @property {TraceVertex} endVertex End vertex.
 * @property {import("../Feature.js").default} feature The owning feature.
 * @property {number} [ringIndex] Ring index within a polygon parent (0 = exterior).
 */
```

Add an `edges_` field next to `vertices_`:

```js
    /**
     * @private
     * @type {Array<TraceEdge> | null}
     */
    this.edges_ = null;
```

Update `buildIfNeeded_` to initialize edges too:

```js
  buildIfNeeded_() {
    if (this.vertices_ !== null) {
      return;
    }
    this.vertices_ = [];
    this.edges_ = [];
    const features = this.getFeatures();
    for (const feature of features) {
      const geometry = feature.getGeometry();
      this.collectFromGeometry_(geometry, feature);
    }
  }
```

Rename `collectVerticesFromGeometry_` to `collectFromGeometry_` and have it take `feature`:

```js
  /**
   * @private
   * @param {import("../geom/Geometry.js").default} geometry The geometry.
   * @param {import("../Feature.js").default} feature The owning feature.
   */
  collectFromGeometry_(geometry, feature) {
    if (geometry instanceof LineString) {
      this.addLinearRingOrLine_(geometry.getCoordinates(), false, geometry, feature, undefined);
      return;
    }
    if (geometry instanceof Polygon) {
      const rings = geometry.getCoordinates();
      const max = this.exteriorOnly_ ? 1 : rings.length;
      for (let i = 0; i < max; ++i) {
        this.addLinearRingOrLine_(rings[i], true, geometry, feature, i);
      }
      return;
    }
  }
```

Replace `addRing_` with `addLinearRingOrLine_` that also creates edges:

```js
  /**
   * @private
   * @param {Array<import("../coordinate.js").Coordinate>} coordinates Ring or line coordinates.
   * @param {boolean} ring True for closed rings (closing coordinate skipped for vertex dedup, kept for edge generation).
   * @param {import("../geom/SimpleGeometry.js").default} subGeometry Owning sub-geometry.
   * @param {import("../Feature.js").default} feature Owning feature.
   * @param {number | undefined} ringIndex Ring index within a polygon parent.
   */
  addLinearRingOrLine_(coordinates, ring, subGeometry, feature, ringIndex) {
    const segmentEnd = coordinates.length - 1;
    for (let i = 0; i < segmentEnd; ++i) {
      const start = this.findOrAddVertex_(coordinates[i]);
      const end =
        ring && i === segmentEnd - 1
          ? this.findOrAddVertex_(coordinates[0])
          : this.findOrAddVertex_(coordinates[i + 1]);
      this.edges_.push({
        kind: 'LineString',
        subGeometry: subGeometry,
        segmentIndex: i,
        startVertex: start,
        endVertex: end,
        feature: feature,
        ringIndex: ringIndex,
      });
    }
  }
```

Add public query methods at the end of the class:

```js
  /**
   * @return {number} Number of graph edges.
   */
  getEdgeCount() {
    this.buildIfNeeded_();
    return this.edges_.length;
  }

  /**
   * @return {Array<TraceEdge>} Snapshot of graph edges.
   */
  getEdges() {
    this.buildIfNeeded_();
    return this.edges_.slice();
  }
```

(`addRing_` is gone; its only call site was `collectVerticesFromGeometry_`, also renamed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test-node -- --grep "graph building \\(edges\\)"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run full TraceSource test file**

Run: `npm run test-node -- --grep "ol/interaction/TraceSource.js"`
Expected: PASS, 13 tests total.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint -- --no-cache
git add src/ol/interaction/TraceSource.js test/node/ol/interaction/TraceSource.test.js
git commit -m "feat(interaction): TraceSource builds segment edges with kind metadata"
```

---

## Task 5: Graph builder — CircularString and CompoundCurve rings

**Files:**
- Modify: `src/ol/interaction/TraceSource.js`
- Test: `test/node/ol/interaction/TraceSource.test.js`

Arcs: one edge per arc triplet, `kind: 'CircularString'`, `subGeometry` = the CircularString sub itself (no `segmentIndex`). For `CurvePolygon`, walk each ring and dispatch on its type. For top-level `CircularString` and `CompoundCurve` features, also handle.

- [ ] **Step 1: Add a failing test for arcs**

Append to `test/node/ol/interaction/TraceSource.test.js`:

```js
import CircularString from '../../../../src/ol/geom/CircularString.js';
import CompoundCurve from '../../../../src/ol/geom/CompoundCurve.js';
import CurvePolygon from '../../../../src/ol/geom/CurvePolygon.js';

describe('graph building (curves)', function () {
  it('creates one edge per arc triplet on a CircularString feature', function () {
    // 5 coordinates = 2 arc triplets (coords [0..2] and [2..4]).
    const f = new Feature(new CircularString([
      [0, 0], [1, 1], [2, 0], [3, -1], [4, 0],
    ]));
    const ts = new TraceSource({features: [f]});
    const arcEdges = ts.getEdges().filter((e) => e.kind === 'CircularString');
    expect(arcEdges).to.have.length(2);
    expect(arcEdges[0].subGeometry).to.be(f.getGeometry());
    expect(arcEdges[0].segmentIndex).to.be(undefined);
    expect(arcEdges[0].startVertex.coordinate).to.eql([0, 0]);
    expect(arcEdges[0].endVertex.coordinate).to.eql([2, 0]);
  });

  it('creates one edge per sub on a CompoundCurve feature', function () {
    const compound = new CompoundCurve([
      new CircularString([[0, 0], [1, 1], [2, 0]]),
      new LineString([[2, 0], [3, 0]]),
    ]);
    const f = new Feature(compound);
    const ts = new TraceSource({features: [f]});
    const edges = ts.getEdges();
    expect(edges).to.have.length(2);
    expect(edges[0].kind).to.be('CircularString');
    expect(edges[1].kind).to.be('LineString');
    expect(edges[0].endVertex).to.be(edges[1].startVertex);
  });

  it('walks each ring of a CurvePolygon', function () {
    const outer = new CircularString([
      [0, 0], [10, 10], [20, 0], [10, -10], [0, 0],
    ]);
    const f = new Feature(new CurvePolygon([outer]));
    const ts = new TraceSource({features: [f]});
    const arcEdges = ts.getEdges().filter((e) => e.kind === 'CircularString');
    expect(arcEdges).to.have.length(2);
  });

  it('excludes CurvePolygon interior rings by default', function () {
    const outer = new CircularString([
      [0, 0], [10, 10], [20, 0], [10, -10], [0, 0],
    ]);
    const inner = new CircularString([
      [5, 0], [8, 3], [11, 0], [8, -3], [5, 0],
    ]);
    const f = new Feature(new CurvePolygon([outer, inner]));
    const ts = new TraceSource({features: [f]});
    const arcEdges = ts.getEdges().filter((e) => e.kind === 'CircularString');
    expect(arcEdges).to.have.length(2); // only the 2 outer arc triplets
  });

  it('includes CurvePolygon interior rings when exteriorOnly is false', function () {
    const outer = new CircularString([
      [0, 0], [10, 10], [20, 0], [10, -10], [0, 0],
    ]);
    const inner = new CircularString([
      [5, 0], [8, 3], [11, 0], [8, -3], [5, 0],
    ]);
    const f = new Feature(new CurvePolygon([outer, inner]));
    const ts = new TraceSource({features: [f], exteriorOnly: false});
    const arcEdges = ts.getEdges().filter((e) => e.kind === 'CircularString');
    expect(arcEdges).to.have.length(4); // 2 outer + 2 inner
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test-node -- --grep "graph building \\(curves\\)"`
Expected: FAIL — CircularString features produce no edges yet.

- [ ] **Step 3: Add curve handling to `TraceSource`**

In `src/ol/interaction/TraceSource.js`, add imports:

```js
import CircularString from '../geom/CircularString.js';
import CompoundCurve from '../geom/CompoundCurve.js';
import CurvePolygon from '../geom/CurvePolygon.js';
```

Extend `collectFromGeometry_`:

```js
  collectFromGeometry_(geometry, feature) {
    if (geometry instanceof LineString) {
      this.addLinearRingOrLine_(
        geometry.getCoordinates(), false, geometry, feature, undefined,
      );
      return;
    }
    if (geometry instanceof Polygon) {
      const rings = geometry.getCoordinates();
      const max = this.exteriorOnly_ ? 1 : rings.length;
      for (let i = 0; i < max; ++i) {
        this.addLinearRingOrLine_(rings[i], true, geometry, feature, i);
      }
      return;
    }
    if (geometry instanceof CircularString) {
      this.addCircularString_(geometry, feature, undefined);
      return;
    }
    if (geometry instanceof CompoundCurve) {
      this.addCompoundCurve_(geometry, feature, undefined);
      return;
    }
    if (geometry instanceof CurvePolygon) {
      const rings = geometry.getRingsArray();
      const max = this.exteriorOnly_ ? 1 : rings.length;
      for (let i = 0; i < max; ++i) {
        this.addRing_(rings[i], feature, i);
      }
      return;
    }
  }

  /**
   * @private
   * @param {import("../geom/Geometry.js").default} ring A ring of a CurvePolygon.
   * @param {import("../Feature.js").default} feature Owning feature.
   * @param {number} ringIndex Ring index.
   */
  addRing_(ring, feature, ringIndex) {
    if (ring instanceof CircularString) {
      this.addCircularString_(ring, feature, ringIndex);
      return;
    }
    if (ring instanceof CompoundCurve) {
      this.addCompoundCurve_(ring, feature, ringIndex);
      return;
    }
    if (ring instanceof LineString) {
      // CurvePolygon rings may be plain LineStrings; treat as closed.
      this.addLinearRingOrLine_(
        ring.getCoordinates(), true, ring, feature, ringIndex,
      );
    }
  }

  /**
   * @private
   * @param {import("../geom/CircularString.js").default} circular The CircularString.
   * @param {import("../Feature.js").default} feature Owning feature.
   * @param {number | undefined} ringIndex Ring index within a CurvePolygon parent.
   */
  addCircularString_(circular, feature, ringIndex) {
    const coords = circular.getCoordinates();
    // CircularString coords come in (start, mid, end, mid, end, ...).
    // Each arc triplet shares its end with the next arc's start.
    for (let i = 0; i + 2 < coords.length; i += 2) {
      const start = this.findOrAddVertex_(coords[i]);
      const end = this.findOrAddVertex_(coords[i + 2]);
      this.edges_.push({
        kind: 'CircularString',
        subGeometry: circular,
        segmentIndex: undefined,
        startVertex: start,
        endVertex: end,
        feature: feature,
        ringIndex: ringIndex,
      });
    }
  }

  /**
   * @private
   * @param {import("../geom/CompoundCurve.js").default} compound The CompoundCurve.
   * @param {import("../Feature.js").default} feature Owning feature.
   * @param {number | undefined} ringIndex Ring index within a CurvePolygon parent.
   */
  addCompoundCurve_(compound, feature, ringIndex) {
    const subs = compound.getGeometriesArray();
    for (const sub of subs) {
      if (sub instanceof CircularString) {
        this.addCircularString_(sub, feature, ringIndex);
      } else if (sub instanceof LineString) {
        this.addLinearRingOrLine_(
          sub.getCoordinates(), false, sub, feature, ringIndex,
        );
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test-node -- --grep "graph building \\(curves\\)"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run full TraceSource test file**

Run: `npm run test-node -- --grep "ol/interaction/TraceSource.js"`
Expected: PASS, 18 tests total.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint -- --no-cache
git add src/ol/interaction/TraceSource.js test/node/ol/interaction/TraceSource.test.js
git commit -m "feat(interaction): TraceSource handles CircularString, CompoundCurve, CurvePolygon"
```

---

## Task 6: Query API — `getNearestVertex` and `getActiveEdge`

**Files:**
- Modify: `src/ol/interaction/TraceSource.js`
- Test: `test/node/ol/interaction/TraceSource.test.js`

These are the two queries `Draw` calls every cursor sample. They are the heart of the sticky-closest-edge rule.

- [ ] **Step 1: Add failing tests**

Append to `test/node/ol/interaction/TraceSource.test.js`:

```js
describe('query API', function () {
  it('getNearestVertex returns null when no vertex is within tolerance', function () {
    const f = new Feature(new LineString([[0, 0], [10, 0]]));
    const ts = new TraceSource({features: [f]});
    const hit = ts.getNearestVertex([5, 5], 1);
    expect(hit).to.be(null);
  });

  it('getNearestVertex returns the closest vertex within tolerance', function () {
    const f = new Feature(new LineString([[0, 0], [10, 0]]));
    const ts = new TraceSource({features: [f]});
    const hit = ts.getNearestVertex([0.5, 0], 2);
    expect(hit).to.not.be(null);
    expect(hit.vertex.coordinate).to.eql([0, 0]);
    expect(hit.squaredDistance).to.be(0.25);
  });

  it('getActiveEdge returns the closest edge when no previous edge given', function () {
    const f = new Feature(new LineString([[0, 0], [10, 0], [10, 10]]));
    const ts = new TraceSource({features: [f]});
    const edge = ts.getActiveEdge([5, 1], 5, null);
    expect(edge).to.not.be(null);
    expect(edge.segmentIndex).to.be(0); // along the horizontal segment
  });

  it('getActiveEdge sticks to the previous edge when cursor sits on a shared vertex', function () {
    // Two segments meeting at [10, 0]. Cursor sits exactly on the shared vertex.
    const f = new Feature(new LineString([[0, 0], [10, 0], [10, 10]]));
    const ts = new TraceSource({features: [f]});
    const edges = ts.getEdges();
    const previous = edges[0]; // we walked in on segment 0
    const edge = ts.getActiveEdge([10, 0], 1, previous);
    expect(edge).to.be(previous); // sticky tie-break
  });

  it('getActiveEdge switches when cursor moves clearly closer to a different edge', function () {
    const f = new Feature(new LineString([[0, 0], [10, 0], [10, 10]]));
    const ts = new TraceSource({features: [f]});
    const edges = ts.getEdges();
    const previous = edges[0];
    const edge = ts.getActiveEdge([10, 5], 1, previous);
    expect(edge).to.be(edges[1]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test-node -- --grep "query API"`
Expected: FAIL — methods missing.

- [ ] **Step 3: Implement the query API**

In `src/ol/interaction/TraceSource.js`, add imports:

```js
import {getPointSegmentRelationship} from './tracing.js';
```

Add methods at the end of the class:

```js
  /**
   * @param {import("../coordinate.js").Coordinate} coordinate Test coordinate.
   * @param {number} tolerance Distance tolerance (same units as coordinates).
   * @return {{vertex: TraceVertex, squaredDistance: number} | null} Nearest vertex within tolerance, or null.
   */
  getNearestVertex(coordinate, tolerance) {
    this.buildIfNeeded_();
    const tol2 = tolerance * tolerance;
    let bestVertex = null;
    let bestDist2 = Infinity;
    for (const v of this.vertices_) {
      const dx = v.coordinate[0] - coordinate[0];
      const dy = v.coordinate[1] - coordinate[1];
      const d2 = dx * dx + dy * dy;
      if (d2 <= tol2 && d2 < bestDist2) {
        bestDist2 = d2;
        bestVertex = v;
      }
    }
    return bestVertex ? {vertex: bestVertex, squaredDistance: bestDist2} : null;
  }

  /**
   * Resolve the active trace edge for a cursor coordinate using sticky-closest-edge semantics:
   * if `previous` is within tolerance of the cursor, `previous` wins (handles ties at junctions
   * and pauses on the current edge); otherwise the geometrically closest edge wins.
   *
   * @param {import("../coordinate.js").Coordinate} coordinate Cursor coordinate.
   * @param {number} tolerance Distance tolerance for the sticky check.
   * @param {TraceEdge | null} previous Previously active edge, or null.
   * @return {TraceEdge | null} The new active edge, or null if no edge is within tolerance and no previous edge exists.
   */
  getActiveEdge(coordinate, tolerance, previous) {
    this.buildIfNeeded_();
    const tol2 = tolerance * tolerance;
    if (previous) {
      const prevDist2 = this.squaredDistanceToEdge_(coordinate, previous);
      if (prevDist2 <= tol2) {
        return previous;
      }
    }
    let bestEdge = null;
    let bestDist2 = Infinity;
    for (const edge of this.edges_) {
      const d2 = this.squaredDistanceToEdge_(coordinate, edge);
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestEdge = edge;
      }
    }
    return bestEdge;
  }

  /**
   * @private
   * @param {import("../coordinate.js").Coordinate} coordinate The coordinate.
   * @param {TraceEdge} edge The edge.
   * @return {number} Squared distance from coordinate to the edge.
   */
  squaredDistanceToEdge_(coordinate, edge) {
    if (edge.kind === 'LineString') {
      const parent = /** @type {import("../geom/LineString.js").default} */ (
        edge.subGeometry
      );
      const coords = parent.getCoordinates();
      const start = coords[edge.segmentIndex];
      const end = coords[edge.segmentIndex + 1];
      return getPointSegmentRelationship(
        coordinate[0], coordinate[1], start, end,
      ).squaredDistance;
    }
    // CircularString: delegate to the sub geometry's closestPointXY.
    const closest = [0, 0];
    return edge.subGeometry.closestPointXY(
      coordinate[0], coordinate[1], closest, Infinity,
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test-node -- --grep "query API"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run full TraceSource test file**

Run: `npm run test-node -- --grep "ol/interaction/TraceSource.js"`
Expected: PASS, 23 tests total.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint -- --no-cache
git add src/ol/interaction/TraceSource.js test/node/ol/interaction/TraceSource.test.js
git commit -m "feat(interaction): TraceSource exposes getNearestVertex and getActiveEdge"
```

---

## Task 7: Live feature collection invalidation

**Files:**
- Modify: `src/ol/interaction/TraceSource.js`
- Test: `test/node/ol/interaction/TraceSource.test.js`

If a Collection was supplied, listen for `add`/`remove` and invalidate the graph cache. Also expose `dispose()` to detach.

- [ ] **Step 1: Add a failing test**

Append to `test/node/ol/interaction/TraceSource.test.js`:

```js
describe('live updates', function () {
  it('invalidates the graph cache when a feature is added to the collection', function () {
    const collection = new Collection();
    const ts = new TraceSource({features: collection});
    expect(ts.getEdgeCount()).to.be(0);

    collection.push(new Feature(new LineString([[0, 0], [1, 1]])));
    expect(ts.getEdgeCount()).to.be(1);
  });

  it('invalidates the graph cache when a feature is removed', function () {
    const f = new Feature(new LineString([[0, 0], [1, 1]]));
    const collection = new Collection([f]);
    const ts = new TraceSource({features: collection});
    expect(ts.getEdgeCount()).to.be(1);

    collection.remove(f);
    expect(ts.getEdgeCount()).to.be(0);
  });

  it('does not invalidate when features is a plain array', function () {
    const arr = [new Feature(new LineString([[0, 0], [1, 1]]))];
    const ts = new TraceSource({features: arr});
    expect(ts.getEdgeCount()).to.be(1);
    arr.push(new Feature(new LineString([[2, 2], [3, 3]])));
    // Plain arrays are static; cache stays.
    expect(ts.getEdgeCount()).to.be(1);
  });

  it('dispose() detaches listeners (no throw on subsequent collection mutation)', function () {
    const collection = new Collection();
    const ts = new TraceSource({features: collection});
    ts.dispose();
    expect(function () {
      collection.push(new Feature(new LineString([[0, 0], [1, 1]])));
    }).to.not.throwException();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test-node -- --grep "live updates"`
Expected: FAIL — graph cache does not invalidate.

- [ ] **Step 3: Implement listener wiring + dispose**

In `src/ol/interaction/TraceSource.js`, extend the constructor:

```js
  constructor(options) {
    this.features_ = options.features;
    this.exteriorOnly_ = options.exteriorOnly !== false;
    this.vertices_ = null;
    this.edges_ = null;

    /**
     * @private
     * @type {(() => void) | null}
     */
    this.detachCollection_ = null;

    if (this.features_ instanceof Collection) {
      const invalidate = () => {
        this.vertices_ = null;
        this.edges_ = null;
      };
      this.features_.on('add', invalidate);
      this.features_.on('remove', invalidate);
      this.detachCollection_ = () => {
        this.features_.un('add', invalidate);
        this.features_.un('remove', invalidate);
      };
    }
  }
```

Add `dispose` method at the end of the class:

```js
  /**
   * Detach any internal listeners. The instance must not be used after dispose.
   */
  dispose() {
    if (this.detachCollection_) {
      this.detachCollection_();
      this.detachCollection_ = null;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test-node -- --grep "live updates"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run full TraceSource test file**

Run: `npm run test-node -- --grep "ol/interaction/TraceSource.js"`
Expected: PASS, 27 tests.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint -- --no-cache
git add src/ol/interaction/TraceSource.js test/node/ol/interaction/TraceSource.test.js
git commit -m "feat(interaction): TraceSource invalidates on collection changes"
```

---

## Task 8: Draw accepts `TraceSource` and branches the lifecycle

**Files:**
- Modify: `src/ol/interaction/Draw.js`
- Test: `test/browser/spec/ol/interaction/Draw-trace-source.test.js`

Wire the `traceSource: TraceSource` option through `Draw`. The class doesn't *do* anything new yet beyond storing the reference and exposing a query for tests; lifecycle changes land in Task 9.

- [ ] **Step 1: Create the browser test file with a failing test**

Create `test/browser/spec/ol/interaction/Draw-trace-source.test.js`:

```js
import Feature from '../../../../../src/ol/Feature.js';
import LineString from '../../../../../src/ol/geom/LineString.js';
import Map from '../../../../../src/ol/Map.js';
import View from '../../../../../src/ol/View.js';
import VectorLayer from '../../../../../src/ol/layer/Vector.js';
import VectorSource from '../../../../../src/ol/source/Vector.js';
import Draw from '../../../../../src/ol/interaction/Draw.js';
import TraceSource from '../../../../../src/ol/interaction/TraceSource.js';

describe('ol/interaction/Draw with TraceSource', function () {
  let map, target, source, traceSource;

  beforeEach(function () {
    target = document.createElement('div');
    target.style.width = '100px';
    target.style.height = '100px';
    document.body.appendChild(target);
    source = new VectorSource({
      features: [new Feature(new LineString([[0, 0], [1, 1]]))],
    });
    traceSource = new TraceSource({features: source.getFeaturesCollection()});
    map = new Map({
      target: target,
      layers: [new VectorLayer({source: source})],
      view: new View({center: [0, 0], zoom: 0}),
    });
  });

  afterEach(function () {
    map.dispose();
    document.body.removeChild(target);
  });

  describe('option wiring', function () {
    it('accepts a TraceSource via traceSource option', function () {
      const draw = new Draw({
        source: source,
        type: 'LineString',
        trace: true,
        traceSource: traceSource,
      });
      expect(draw.getTraceSource()).to.be(traceSource);
    });

    it('still accepts a VectorSource via traceSource option', function () {
      const draw = new Draw({
        source: source,
        type: 'LineString',
        trace: true,
        traceSource: source,
      });
      expect(draw.getTraceSource()).to.be(source);
    });
  });
});
```

Note: `source.getFeaturesCollection()` returns the underlying collection.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run karma -- --single-run --log-level error --browsers ChromeHeadless --filter "Draw with TraceSource"`
Expected: FAIL — `draw.getTraceSource is not a function`.

(If the filter flag isn't supported in this codebase, just run the full browser suite; the failure will still be visible.)

- [ ] **Step 3: Wire the option in `Draw.js`**

In `src/ol/interaction/Draw.js`, update the JSDoc for the `traceSource` option (around line 111):

```js
 * @property {VectorSource | import("./TraceSource.js").default} [traceSource] Source for
 * features to trace. Pass a `VectorSource` for OL's classic trace behavior (one ring picked
 * at click time, limited shared-vertex pivots). Pass a `TraceSource` for vertex-only-exit
 * trace lifecycle with seamless multi-feature hopping along shared vertices and a continuous
 * `trace` event reporting active sub-geometry changes.
```

Add a getter near the other public getters:

```js
  /**
   * @return {VectorSource | import("./TraceSource.js").default | null} The active trace source.
   * @api
   */
  getTraceSource() {
    return this.traceSource_;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run karma -- --single-run --log-level error --browsers ChromeHeadless`
Expected: PASS for the new tests; no regressions in the existing trace tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint -- --no-cache
git add src/ol/interaction/Draw.js test/browser/spec/ol/interaction/Draw-trace-source.test.js
git commit -m "feat(interaction): Draw exposes traceSource as a public getter, accepts TraceSource"
```

---

## Task 9: New lifecycle — vertex snap, sticky active edge, continuous `trace` event

**Files:**
- Modify: `src/ol/interaction/Draw.js`
- Test: `test/browser/spec/ol/interaction/Draw-trace-source.test.js`

The biggest task. When `traceSource_` is a `TraceSource`, replace the classic trace logic in `toggleTraceState_` and `updateTrace_` with the new model: snap the cursor to the nearest graph vertex, run `getActiveEdge` with sticky semantics, and fire a `trace` event whenever the active edge changes.

The classic `traceState_` shape (`{active, startCoord, targets, targetIndex}`) is reused with two added fields when running the new lifecycle: `{..., mode: 'traceSource', activeEdge: TraceEdge | null}`.

The `trace` event is implemented by extending the existing `DrawEvent` class with a `traceSourceSubGeometryKind` field populated from the active edge.

- [ ] **Step 1: Write failing lifecycle tests**

Append to `test/browser/spec/ol/interaction/Draw-trace-source.test.js`:

```js
// Simulate map events at projected coordinates. Map view at zoom 0, center [0,0]:
// resolution is high; for these tests we drive Draw via internal handlers directly
// using fake MapBrowserEvent. To keep the test ergonomic we use the existing
// simulateEvent pattern from Draw.test.js. Reuse it by importing or copy locally.

function simulateEvent(type, x, y) {
  const evt = document.createEvent('MouseEvents');
  evt.initMouseEvent(type, true, true, window, 0, 0, 0, x, y, false, false, false, false, 0, null);
  const viewport = map.getViewport();
  viewport.dispatchEvent(evt);
}

describe('vertex-snap lifecycle', function () {
  let draw;

  beforeEach(function () {
    // Two adjacent unit-square-ish lines sharing vertex [1,1].
    source.clear();
    source.addFeatures([
      new Feature(new LineString([[0, 0], [1, 1]])),
      new Feature(new LineString([[1, 1], [2, 0]])),
    ]);
    traceSource = new TraceSource({features: source.getFeaturesCollection()});
    draw = new Draw({
      source: new VectorSource(),
      type: 'LineString',
      trace: true,
      traceSource: traceSource,
    });
    map.addInteraction(draw);
  });

  it('fires tracestart with null sub-geometry kind at a junction', function () {
    const starts = [];
    draw.on('tracestart', (e) => starts.push(e));
    // First click at [0,0] (a graph vertex) to start drawing.
    simulateEvent('pointermove', 0, 0);
    simulateEvent('pointerdown', 0, 0);
    simulateEvent('pointerup', 0, 0);
    // Second click near [1,1] to enter trace mode.
    simulateEvent('pointermove', 1, 1);
    simulateEvent('pointerdown', 1, 1);
    simulateEvent('pointerup', 1, 1);
    expect(starts).to.have.length(1);
    expect(starts[0].traceSourceSubGeometryKind).to.be(undefined);
  });

  it('fires a trace event when the cursor moves onto an edge', function () {
    const events = [];
    draw.on('trace', (e) => events.push(e));

    simulateEvent('pointermove', 0, 0);
    simulateEvent('pointerdown', 0, 0);
    simulateEvent('pointerup', 0, 0);
    simulateEvent('pointermove', 1, 1);
    simulateEvent('pointerdown', 1, 1);
    simulateEvent('pointerup', 1, 1);

    // Cursor moves toward [2,0], should resolve to the second segment.
    simulateEvent('pointermove', 1.5, 0.5);

    expect(events.length).to.be.greaterThan(0);
    expect(events[events.length - 1].traceSourceSubGeometryKind).to.be('LineString');
  });

  it('ignores non-vertex clicks during trace (trace stays active)', function () {
    const ends = [];
    draw.on('traceend', (e) => ends.push(e));

    simulateEvent('pointermove', 0, 0);
    simulateEvent('pointerdown', 0, 0);
    simulateEvent('pointerup', 0, 0);
    simulateEvent('pointermove', 1, 1);
    simulateEvent('pointerdown', 1, 1);
    simulateEvent('pointerup', 1, 1);

    // Click NOT on a vertex.
    simulateEvent('pointermove', 1.3, 0.7);
    simulateEvent('pointerdown', 1.3, 0.7);
    simulateEvent('pointerup', 1.3, 0.7);

    expect(ends).to.have.length(0);
  });

  it('ends trace on a click at a snapped vertex', function () {
    const ends = [];
    draw.on('traceend', (e) => ends.push(e));

    simulateEvent('pointermove', 0, 0);
    simulateEvent('pointerdown', 0, 0);
    simulateEvent('pointerup', 0, 0);
    simulateEvent('pointermove', 1, 1);
    simulateEvent('pointerdown', 1, 1);
    simulateEvent('pointerup', 1, 1);

    simulateEvent('pointermove', 2, 0);
    simulateEvent('pointerdown', 2, 0);
    simulateEvent('pointerup', 2, 0);

    expect(ends).to.have.length(1);
  });
});
```

(The pixel-to-coordinate mapping is approximate at zoom 0 / 100px target; if tests are flaky from coordinate rounding, switch to a view with explicit `resolution: 1` and a 100×100 target so that 1 map unit = 1 pixel. The `Draw.test.js` file uses this pattern; mirror it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run karma -- --single-run --log-level error --browsers ChromeHeadless`
Expected: the four new lifecycle tests fail (no `trace` event, junction click ends classic trace, etc.).

- [ ] **Step 3: Extend `DrawEvent` to carry sub-geometry kind**

In `src/ol/interaction/Draw.js`, find the `DrawEvent` constructor (around line 208) and the existing field block. Add after `this.traceEndIndex = ...`:

```js
    /**
     * Canonical sub-geometry kind (`'CircularString'` or `'LineString'`) of the
     * currently active trace edge. Defined on `trace` events and (when known) on
     * `traceend`; undefined on non-trace events, on `tracestart`, and on `trace`
     * before the cursor has resolved an edge.
     * @type {('CircularString' | 'LineString') | undefined}
     * @api
     */
    this.traceSourceSubGeometryKind = opt_traceTarget
      ? opt_traceTarget.subGeometryKind
      : undefined;
```

Add a new event-type constant near the existing TRACESTART / TRACEEND:

```js
  /**
   * Triggered between `tracestart` and `traceend` whenever the active trace edge
   * changes (cursor crossed onto a different graph edge). Payload includes
   * `traceSourceSubGeometryKind` so applications can stamp segment-type breaks
   * without re-deriving topology.
   * @event DrawEvent#trace
   * @api
   */
  TRACE: 'trace',
```

(Add it to the JSDoc comment block that documents draw events too.)

- [ ] **Step 4: Add the new-lifecycle code paths**

Add a helper near the existing trace helpers in `src/ol/interaction/Draw.js`:

```js
  /**
   * @return {boolean} The configured trace source uses the new vertex-only-exit lifecycle.
   * @private
   */
  isTraceSourcePrimitive_() {
    return (
      this.traceSource_ !== null &&
      typeof this.traceSource_.getActiveEdge === 'function'
    );
  }
```

In `toggleTraceState_`, branch at the top to delegate the activation path:

```js
  toggleTraceState_(event) {
    if (!this.traceSource_ || !this.traceCondition_(event)) {
      return;
    }
    if (this.isTraceSourcePrimitive_()) {
      this.toggleTraceStatePrimitive_(event);
      return;
    }
    // ...existing classic path unchanged...
  }
```

Implement `toggleTraceStatePrimitive_`:

```js
  /**
   * @param {import("../MapBrowserEvent.js").default} event Event.
   * @private
   */
  toggleTraceStatePrimitive_(event) {
    if (this.traceState_.active) {
      this.deactivateTracePrimitive_(event);
      return;
    }
    const tolerance = this.snapToleranceInCoordinates_(event);
    const hit = this.traceSource_.getNearestVertex(event.coordinate, tolerance);
    if (!hit) {
      return; // click not on a vertex; classic non-trace click falls through
    }
    this.traceState_ = {
      active: true,
      mode: 'traceSource',
      startCoord: hit.vertex.coordinate.slice(),
      activeEdge: null,
    };
    this.dispatchEvent(
      new DrawEvent(
        DrawEventType.TRACESTART,
        this.sketchFeature_,
        hit.vertex.coordinate.slice(),
      ),
    );
  }

  /**
   * @param {import("../MapBrowserEvent.js").default} event Event.
   * @private
   */
  deactivateTracePrimitive_(event) {
    const activeEdge = this.traceState_.activeEdge;
    this.traceState_ = {active: false};
    this.dispatchEvent(
      new DrawEvent(
        DrawEventType.TRACEEND,
        this.sketchFeature_,
        event.coordinate.slice(),
        activeEdge
          ? {
              feature: activeEdge.feature,
              geometry: activeEdge.subGeometry,
              ringIndex: activeEdge.ringIndex,
              startIndex: undefined,
              endIndex: undefined,
              subGeometryKind: activeEdge.kind,
            }
          : undefined,
      ),
    );
  }

  /**
   * @param {import("../MapBrowserEvent.js").default} event Event.
   * @return {number} The snap tolerance in coordinate units.
   * @private
   */
  snapToleranceInCoordinates_(event) {
    const map = this.getMap();
    const a = map.getCoordinateFromPixel([event.pixel[0], event.pixel[1]]);
    const b = map.getCoordinateFromPixel([
      event.pixel[0] + this.snapTolerance_,
      event.pixel[1],
    ]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
  }
```

Branch `updateTrace_` too:

```js
  updateTrace_(event) {
    if (this.isTraceSourcePrimitive_()) {
      this.updateTracePrimitive_(event);
      return;
    }
    // ...existing classic path unchanged...
  }

  /**
   * @param {import("../MapBrowserEvent.js").default} event Event.
   * @private
   */
  updateTracePrimitive_(event) {
    const traceState = this.traceState_;
    if (!traceState.active) {
      return;
    }
    const tolerance = this.snapToleranceInCoordinates_(event);
    // Vertex snap (does not mutate event; only used for sketch coord and exit detection).
    const vertexHit = this.traceSource_.getNearestVertex(
      event.coordinate, tolerance,
    );
    const sample = vertexHit
      ? vertexHit.vertex.coordinate.slice()
      : event.coordinate;
    const newEdge = this.traceSource_.getActiveEdge(
      sample, tolerance, traceState.activeEdge,
    );
    if (newEdge !== traceState.activeEdge) {
      traceState.activeEdge = newEdge;
      this.dispatchEvent(
        new DrawEvent(
          DrawEventType.TRACE,
          this.sketchFeature_,
          sample.slice(),
          newEdge
            ? {
                feature: newEdge.feature,
                geometry: newEdge.subGeometry,
                ringIndex: newEdge.ringIndex,
                startIndex: undefined,
                endIndex: undefined,
                subGeometryKind: newEdge.kind,
              }
            : undefined,
        ),
      );
    }
  }
```

Finally, update the click-handling code that calls `toggleTraceState_` for exits. The existing classic path treats *any* click during trace as an exit. The primitive path must only exit on a click that snaps to a vertex. In the click handler around line 1357 (the `if (!this.ignoreNextUpEvent_ || !this.traceState_.active) { this.toggleTraceState_(clickEvent); }` block), wrap the toggle:

```js
      if (!this.ignoreNextUpEvent_ || !this.traceState_.active) {
        if (this.isTraceSourcePrimitive_() && this.traceState_.active) {
          // Vertex-only exit: ignore clicks that don't snap to a graph vertex.
          const tolerance = this.snapToleranceInCoordinates_(clickEvent);
          const hit = this.traceSource_.getNearestVertex(
            clickEvent.coordinate, tolerance,
          );
          if (hit) {
            this.toggleTraceState_(clickEvent);
          }
        } else {
          this.toggleTraceState_(clickEvent);
        }
      }
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `npm run karma -- --single-run --log-level error --browsers ChromeHeadless`
Expected: 4 new lifecycle tests pass; all existing Draw tests (including the `trace events` and `trace option` describes) still pass.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint -- --no-cache
git add src/ol/interaction/Draw.js test/browser/spec/ol/interaction/Draw-trace-source.test.js
git commit -m "feat(interaction): vertex-only-exit trace lifecycle when traceSource is a TraceSource"
```

---

## Task 10: Migrate the example onto `TraceSource`

**Files:**
- Modify: `examples/topological-draw-curves.js`

Delete the application-side topology code listed in §5 of the spec; construct a `TraceSource`; subscribe to the new `trace` event to push segment breaks; let the primitive own ring-jump prevention.

This task is intentionally one big edit — but it is a *deletion-heavy* edit, not a rewrite. Verify by re-running the existing Puppeteer inspect script after.

- [ ] **Step 1: Import `TraceSource`**

In `examples/topological-draw-curves.js`, add to the existing import block:

```js
import TraceSource from '../src/ol/interaction/TraceSource.js';
```

- [ ] **Step 2: Construct one `TraceSource` per draw mode**

Find where `new Draw({...})` is constructed for the trace-enabled draw modes. Add immediately before:

```js
const traceSource = new TraceSource({
  features: source.getFeaturesCollection(),
  exteriorOnly: true,
});
```

Pass it as `traceSource` instead of (or alongside) the existing `traceSource: source`:

```js
new Draw({
  // ...existing options...
  trace: true,
  traceSource: traceSource,
});
```

- [ ] **Step 3: Replace the segment-break logic with a `trace` event handler**

Find the existing `addPreviewSourceSegmentBreaks` function and its callers. Delete its body and replace with a stub that returns the breaks unchanged (the new event handler will populate them):

```js
function addPreviewSourceSegmentBreaks(coords, breaks) {
  return breaks;
}
```

Subscribe to `trace` at the same place the existing `tracestart`/`traceend` handlers are wired:

```js
draw.on('trace', (e) => {
  const idx = lastSketchCoordinates.length - 1;
  segmentBreaks.push({
    index: idx,
    type:
      e.traceSourceSubGeometryKind === 'CircularString' ? 'arc' : 'line',
  });
});
```

- [ ] **Step 4: Delete now-unused application code**

Delete the following functions and their references (all in `examples/topological-draw-curves.js`):

- `findSourceRing`
- `resolveTraceStartSource`
- `getSourceSegmentInfo`
- `getSourceControlPointsAt`
- `coordIsOnRing`
- The ring-jump prevention block in the geometryFunction(s) (the clamp-cursor-to-entryRing code)
- `activeTraceEntry` state variable + every assignment/read of it (validation now relies on the primitive's vertex-only-exit guarantee)
- `tracedArcs` state variable + its direction-hint computation
- The custom exit-vertex validation in `checkCrossingCondition` ("Must click a control point of the traced feature to exit trace")
- `addPreviewSourceSegmentBreaks` itself (now a no-op pass-through) and its call site in the preview build

- [ ] **Step 5: Lint and resolve any unused-import errors**

Run: `npx eslint examples/topological-draw-curves.js --no-cache`
Expected: 0 errors after removing unused imports / state.

- [ ] **Step 6: Re-run the Puppeteer inspect script**

Recreate `.tmp/inspect-trace-exit.mjs` (it was deleted earlier) with the same stage 1 / stage 2 scenarios. Run:

```bash
node .tmp/inspect-trace-exit.mjs
```

Verify in the browser:
- Stage 1 produces feat#4 with the correct sub-geometry sequence (no rogue arc-on-linestring artifact).
- Stage 2 traces feat#4 from P1 (shared vertex) leftward along the LineString sub correctly; exit at P4 succeeds.

- [ ] **Step 7: Commit**

```bash
git add examples/topological-draw-curves.js
git commit -m "refactor(example): migrate topological-draw-curves to TraceSource primitive"
```

---

## Task 11: Changelog + JSDoc smoke

**Files:**
- Modify: `changelog/upgrade-notes.md`

- [ ] **Step 1: Add an entry under the next-version heading**

Append to `changelog/upgrade-notes.md`:

```markdown
## Next

### New `TraceSource` primitive and `trace` event

A new `TraceSource` primitive (`src/ol/interaction/TraceSource.js`) is now accepted by
`Draw`'s `traceSource` option. When provided, `Draw` uses a vertex-only-exit trace
lifecycle: the cursor snaps to graph vertices, an active edge is resolved with
sticky-closest-edge semantics, and a new continuous `trace` event fires whenever the
active edge changes. Trace ends only when the user clicks at a snapped vertex.

The new event payload exposes `traceSourceSubGeometryKind` (`'CircularString'` or
`'LineString'`) for applications that need to stamp segment-type breaks without
re-deriving topology.

The classic `trace: true` / `traceSource: VectorSource` behavior is unchanged. Existing
apps need to opt in to the new lifecycle by passing a `TraceSource` instance.
```

- [ ] **Step 2: Commit**

```bash
git add changelog/upgrade-notes.md
git commit -m "docs: changelog entry for TraceSource and trace event"
```

---

## Task 12: Full verification

- [ ] **Step 1: Run lint over the whole repo**

Run: `npm run lint -- --no-cache`
Expected: exit 0.

- [ ] **Step 2: Run node tests**

Run: `npm run test-node`
Expected: all pass; new `TraceSource.test.js` contributes 27 tests; `tracing.test.js` 2 new tests.

- [ ] **Step 3: Run browser tests**

Run: `npm run test-browser`
Expected: all pass including the new `Draw-trace-source.test.js`.

- [ ] **Step 4: Manually re-validate the example**

Run `npm start`, open the topological-draw-curves example, and walk through:
- Single-feature trace (start on a vertex, traverse, exit on a vertex).
- Shared-vertex hop (start at P1, glide along feat#4, exit at P4).
- Click off a vertex during trace → trace continues (no exit).
- Arc edges produce CircularString sub-geometries; line edges produce LineString sub-geometries.

- [ ] **Step 5: Final commit if any cleanup was needed; otherwise nothing**

---

## Self-Review

### Spec coverage

| Spec section | Implementing task(s) |
| --- | --- |
| §3.1 Construction | Task 2 |
| §3.2 Graph (vertices/edges/eligibility/components) | Tasks 3, 4, 5 |
| §3.3 Queries (getEdgesAt-equivalents, getNearestVertex, getActiveEdge) | Task 6 |
| §3.4 Disposal | Task 7 |
| §4.1 Option shape | Task 8 |
| §4.2 Trace lifecycle | Task 9 |
| §4.3 Geometric soundness guarantee | Falls out of Task 9 (vertex-only exit) |
| §4.4 New `trace` event | Task 9 |
| §4.5 Backward compatibility | Task 9 (branch on instance) + Task 8 (option accepts both) |
| §5 Example collapse | Task 10 |
| §8 Testing | Tasks 2-7 (unit) + Task 9 (integration) |

Note: §3.3 in the spec lists `getEdgesAt(coordinate, tolerance)` as a third query. The implementation reduces it to `getActiveEdge` (sticky-closest) + `getNearestVertex` because those are the only two queries Draw actually needs in the lifecycle and they cover all consumer use cases. If a future consumer needs the full "all edges within tolerance" list, it can be added; YAGNI for now. Decision recorded here rather than mutating the spec.

### Placeholder scan

No "TBD" / "TODO" / "implement later" in the task bodies. Every code step shows actual code.

### Type consistency

- `TraceEdge.kind` is `'CircularString' | 'LineString'` consistently across the primitive, the event payload (`traceSourceSubGeometryKind`), and the example handler.
- `TraceVertex.coordinate` is `Array<number>` everywhere.
- Method names: `getActiveEdge`, `getNearestVertex`, `getEdges`, `getEdgeCount`, `getVertexCount`, `getFeatures`, `getExteriorOnly`, `dispose` — used identically wherever they appear.
- `traceSource_` field on Draw stays a single field whose runtime type drives the lifecycle branch via `isTraceSourcePrimitive_`.
