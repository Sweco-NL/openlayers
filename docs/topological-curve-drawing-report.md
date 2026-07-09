# Topological Curve Drawing: Technical Report

## 1. Introduction & Problem Statement

**Topological curve drawing** means drawing features that *share boundary segments* with existing curved features. The user traces along a source circle's boundary, and the drawn feature's ring includes that exact arc segment — not a tessellated approximation, but the actual `CircularString` sub-geometry with shared control points.

### The Goal

Given pre-populated `CurvePolygon` features (circles defined by `CircularString` rings), a user should be able to:

1. Draw a new `CurvePolygon` whose ring partially overlaps an existing circle's boundary
2. Have the overlapping portion be the *exact same arc* (shared control points)
3. Modify drawn features with topological validation (no self-intersection, no overlap)

The final drawn geometry is a `CurvePolygon` with a `CompoundCurve` ring containing a mix of:
- **User-drawn segments** (`LineString` or `CircularString`)
- **Traced arc segments** (`CircularString` extracted from source features)

### Why Curves Make This Hard

For straight-line polygons, topological drawing is well-understood: shared edges are sequences of `[x,y]` vertices connected by straight segments. Inserting a vertex on a LineString is a simple `splice()`. Moving a vertex only affects its two adjacent segments.

For curved geometries, every aspect becomes nonlinear:
- Control points have *semantic meaning* (start/mid/end triplets define arcs)
- Moving one control point changes the *entire arc's shape* (radius, center, curvature)
- Inserting a point requires splitting an arc into two sub-arcs with correct midpoints
- A closed ring has *two possible arcs* between any two points (direction ambiguity)
- Spatial indexing must cover full arc extents, not just control-point chords

---

## 2. Geometry Model

### CircularString

A curve defined by consecutive 3-point arcs: `[start₁, mid₁, end₁, mid₂, end₂, ...]`

```javascript
// Arc count from point count
arcCount() {
  const numPoints = this.flatCoordinates.length / this.stride;
  return Math.floor((numPoints - 1) / 2);
}

// Extract arc i as a CircularArc object (begin, middle, end vectors)
arc(index) {
  const startX = this.stride * 2 * index;
  const middleX = startX + this.stride;
  const endX = startX + this.stride * 2;
  return new CircularArc(
    new Vector2(this.flatCoordinates[startX], this.flatCoordinates[startX + 1]),
    new Vector2(this.flatCoordinates[middleX], this.flatCoordinates[middleX + 1]),
    new Vector2(this.flatCoordinates[endX], this.flatCoordinates[endX + 1]),
  );
}
```

**Critical property:** Moving ANY single control point changes the arc it belongs to — and if it's a shared endpoint, it changes BOTH adjacent arcs. This is fundamentally different from `LineString` where each segment is independent.

### CompoundCurve

An ordered sequence of sub-geometries (`CircularString | LineString`) with a strict **junction constraint**: the last coordinate of `sub[i]` must exactly equal the first coordinate of `sub[i+1]`.

### CurvePolygon

A polygon whose rings are `CompoundCurve` or `CircularString` (not `LinearRing`).

---

## 3. The Drawing Pipeline

### Interaction Setup

The Draw interaction uses OpenLayers' built-in trace mode to follow source feature boundaries:

```javascript
draw = new Draw({
  source,
  type: 'LineString',
  trace: true,
  traceSource: source,
  geometryFunction(coordinates, geometry) { /* ... */ },
});
```

### The segmentBreaks State Machine

During drawing, the system tracks transitions between user-drawn segments and traced arcs in real-time:

```javascript
// State tracked per drawing session
let segmentBreaks = [{index: 0, type: 'arc'}];  // Break points between segment types
let tracedArcs = [];                             // Metadata for each traced arc

// Inside geometryFunction — fires on every new point:
const tracing = draw.traceState_ && draw.traceState_.active;
if (tracing && !wasTracing) {
  // Tracing just STARTED — record entry point and source ring
  segmentBreaks.push({ index: coordinates.length - 2, type: 'line' });
  const found = findSourceRing(traceStartCoord);
  tracedArcs.push({
    entryCoord: traceStartCoord.slice(),
    exitCoord: null,
    ring: found ? found.ring : null,
    sourceFeature: found ? found.feature : null,
    entryBreakIndex: breakIndex,
    traceStartIdx: coordinates.length - 2,
    traceEndIdx: -1,
  });
  wasTracing = true;
} else if (!tracing && wasTracing) {
  // Tracing just ENDED — record exit point
  tracedArcs[tracedArcs.length - 1].exitCoord = exitCoord.slice();
  tracedArcs[tracedArcs.length - 1].traceEndIdx = exitIdx;
  segmentBreaks.push({ index: coordinates.length - 2, type: currentSegType });
  wasTracing = false;
}
```

This metadata — `entryCoord`, `exitCoord`, source `ring` reference, coordinate indices — is consumed later by `buildFinalGeometries()` to compose the final geometry.

### Auto-Close Detection

For `CurvePolygon` mode, the system detects when the user snaps back to the start coordinate and automatically finishes the drawing:

```javascript
if (isCurvePolygon && isNewPoint && !closing && startCoord && coordinates.length >= 4) {
  const pt = coordinates[coordinates.length - 2];
  const tol = map.getView().getResolution() * 0.5;
  if (Math.abs(pt[0] - startCoord[0]) < tol && Math.abs(pt[1] - startCoord[1]) < tol) {
    closing = true;
    setTimeout(() => draw.finishDrawing(), 0);
  }
}
```

---

## 4. Arc Extraction from Source Rings

### Difficulty: Direction Ambiguity

**Problem:** A closed circular ring always has *two* arcs between any entry/exit pair — the arc the user traced, and its complement spanning the rest of the ring.

**Why curves make it harder:** With a straight-line polygon boundary, you can "walk the vertices" from entry to exit in the traced direction. With a continuous circular arc, there are no intermediate vertices to walk — just two parametric arcs of different angular extent.

**Solution:** Sample a midpoint from the sketch coordinates *during* tracing, then compare both candidate arcs' midpoints to determine which one was traced:

```javascript
function extractSubArc(ring, entryCoord, exitCoord, traceMidpoint) {
  const projEntry = [0, 0], projExit = [0, 0];
  ring.closestPointXY(entryCoord[0], entryCoord[1], projEntry, Infinity);
  ring.closestPointXY(exitCoord[0], exitCoord[1], projExit, Infinity);

  let sub = ring.getSubCurve(projEntry, projExit);
  let geoms = sub.getGeometriesArray();

  // Direction validation via trace midpoint
  if (traceMidpoint && geoms.length > 0) {
    const arcMid = getArcMidpoint(sub);
    const distToTrace = squaredDist(arcMid, traceMidpoint);
    const threshold = resolution * resolution * 10000;
    if (distToTrace > threshold) {
      // Wrong arc — try the complement (reverse direction)
      const reverseSub = ring.getSubCurve(projExit, projEntry);
      const revMid = getArcMidpoint(reverseSub);
      if (squaredDist(revMid, traceMidpoint) < distToTrace) {
        // Reverse is closer — flip geometry order and coordinates
        geoms = reverseSub.getGeometriesArray();
        geoms.reverse();
        geoms.forEach(g => { const c = g.getCoordinates(); c.reverse(); g.setCoordinates(c); });
      }
    }
  }
  return geoms.map(g => g.clone());
}
```

**Limitation:** The threshold is resolution-dependent (`resolution² × 10000`). Extremely short traces where both arcs are similar length could fail.

### Difficulty: Junction Continuity

**Problem:** `closestPointXY` projects the snapped sketch coordinate onto the exact arc mathematically. Due to floating-point arithmetic, the projected point differs from the original sketch coordinate by a small epsilon (e.g., `1e-12`).

**Impact:** If the extracted arc's endpoints don't *exactly* match the adjacent sub-geometry's endpoints in the `CompoundCurve`, junction continuity breaks — causing rendering gaps and topology validation false positives.

**Solution:** After extraction, forcibly snap arc endpoints to the exact sketch coordinates:

```javascript
if (arcGeoms.length > 0) {
  // Snap first arc's start to sketch entry coordinate
  const firstCoords = arcGeoms[0].getCoordinates();
  firstCoords[0] = coords[entryIdx];
  arcGeoms[0].setCoordinates(firstCoords);

  // Snap last arc's end to sketch exit coordinate
  const lastCoords = arcGeoms[arcGeoms.length - 1].getCoordinates();
  lastCoords[lastCoords.length - 1] = coords[exitIdx];
  arcGeoms[arcGeoms.length - 1].setCoordinates(lastCoords);
}
```

**Tradeoff:** This distorts the arc's start/end by epsilon (the control point no longer lies exactly on the original circle). Junction continuity is prioritized over geometric perfection — the distortion is sub-pixel.

---

## 5. Source Ring Splitting

### Difficulty: Inserting Control Points on a CircularString

**Problem:** To share vertices between drawn and source features, the entry/exit points of the traced arc must become *explicit control points* on the source ring. This enables the Modify interaction's RBush to find them as vertices.

**Why it's hard:** You cannot simply "insert a point" into a `CircularString` like you would with a `LineString`. A CircularString's coordinates are triplets `[start, mid, end]` that define arcs. Inserting a point at an arbitrary position on an arc requires *splitting* that arc into two sub-arcs — each with its own correct midpoint lying on the original circle.

**Algorithm:**

```javascript
function splitSourceRingAtPoints(ring, points) {
  let current = ring;
  for (const pt of points) {
    const [before, after] = current.splitAtCoordinate(pt);
    if (before && after) {
      const beforeCoords = before.getCoordinates();
      const afterCoords = after.getCoordinates();
      // Concatenate: skip first of 'after' (duplicate junction point)
      const newCoords = beforeCoords.concat(afterCoords.slice(1));
      current = new CircularString(newCoords);
    }
  }
  return current;
}
```

**What `splitAtCoordinate` does internally:**
1. Determine which arc contains the coordinate (check angle within arc's angular range)
2. Compute the split angle: `angle = atan2(cy - center.y, cx - center.x)`
3. Call `arc.splitAtAngle(angle, center)` → produces two `CircularArc` objects
4. Each sub-arc has a midpoint computed as the angular midpoint on the circle

**Why in-place modification:**

```javascript
// Modify the existing ring in place
ta.ring.setCoordinates(newCoords);
```

Replacing the ring object would break the `CurvePolygon` parent's reference and its event listener chain. `setCoordinates` preserves the object identity while updating its geometry.

**Result:** A source ring with 5 control points (2 arcs forming a full circle) gains 4 additional control points after splitting at entry+exit → 9 control points (4 arcs), with entry and exit as explicit arc boundaries.

---

## 6. The Modify Problem — Co-Grab & Topological Coupling

### The Original Approach (Tried and Failed)

Initially, `Modify` was configured with the full `source` — all features (source + drawn) indexed in its RBush:

```javascript
// ORIGINAL (failed) approach:
const modify = new Modify({ source: source });
```

When source rings are split at trace points, source and drawn features share vertex coordinates at the junctions. The Modify interaction's RBush indexes vertices from *all* features. Clicking near a shared vertex **grabs it in both features simultaneously** — this is "co-grab."

### Why Co-Grab Is Catastrophic for Curves

| Aspect | LineString (manageable) | CircularString (catastrophic) |
|--------|------------------------|-------------------------------|
| **Locality** | Moving vertex V affects only segments V-1→V and V→V+1 | Moving control point P changes entire arc `floor(P/2)` |
| **Cascade** | 2 segments affected per feature | Potentially 2 adjacent arcs per feature (shared endpoint = junction) |
| **Source impact** | Source polygon slightly deformed at one edge | Source circle completely reshaped (5 points define the entire geometry) |
| **Predictability** | User can predict the local deformation | Arc radius/center change is non-intuitive |

### The Five Co-Grab Problems

1. **Source deformation:** Moving a shared vertex changes the source circle's radius and center. The source feature was *pre-populated* — the user never intends to modify it.

2. **Cascading validation:** Must validate ALL features that share the moved vertex. With N features sharing a boundary, this is O(N) validations per drag frame.

3. **Rollback complexity:** If validation fails, ALL affected features must be atomically reverted to their pre-modify state. With curved geometries, "revert" means restoring entire coordinate arrays.

4. **Junction drift:** After rollback, floating-point accumulation causes restored coordinates to diverge slightly from the snapshot. Over multiple modify→revert cycles, shared vertices drift apart.

5. **Arc sensitivity:** A `CircularString` circle with 5 control points is *fully determined* by those 5 points. Moving ANY one point changes the circle's center, radius, and all arc midpoints. There is no "local" modification — every change is global.

---

## 7. The Simplification — Approach A

### Decision: Eliminate Co-Grab Entirely

```javascript
// Only drawn features are modifiable. Source features stay inert (no co-grab).
const modifyCollection = new Collection();
const modify = new Modify({features: modifyCollection});
const snap = new Snap({ source, vertex: true, edge: true });
```

Source features are **never** added to `modifyCollection`. Only drawn features (tagged with `_drawn`) are pushed after finalization:

```javascript
draw.on('drawend', (e) => {
  finalizeGeometry(e.feature);
  splitSourceRingsAtTracePoints();
  e.feature.set('_drawn', true);
  modifyCollection.push(e.feature);  // Only drawn features are modifiable
});
```

### What This Achieves

| Problem | Resolution |
|---------|-----------|
| Source deformation | Impossible — source not in Modify's RBush |
| Cascading validation | Only drawn features validated |
| Rollback complexity | Single feature revert via `WeakMap` snapshot |
| Junction drift | No multi-feature rollback → no drift |
| Arc sensitivity | Source arcs never touched |

### What This Sacrifices

Shared vertices *exist* (from splitting) but evolve independently after drawing. If the user modifies a drawn feature's shared vertex, it no longer coincides with the source boundary. This is acceptable because:

1. **Snap still works** — the Snap interaction uses `source`, so the user sees snap indicators at the source boundary
2. **Validation catches violations** — the `modifyend` handler detects if the drawn feature now overlaps or crosses the source
3. **True co-editing is out of scope** — a full topological data model (shared half-edges, face/edge/vertex tables) is beyond what a drawing example should implement

### The Rollback Mechanism

```javascript
modify.on('modifystart', (event) => {
  geometrySnapshots = new WeakMap();
  event.features.forEach(f => geometrySnapshots.set(f, f.getGeometry().clone()));
});

modify.on('modifyend', (event) => {
  // ... validate ...
  if (revertReason) {
    event.features.forEach(f => {
      if (snapshots.has(f)) f.setGeometry(snapshots.get(f));
    });
  }
});
```

`WeakMap` ensures no memory leaks — if a feature is removed from the map, its snapshot is garbage-collected.

---

## 8. RBush Spatial Indexing for Arcs

### Difficulty: The Segment Model

The Modify interaction's RBush stores `SegmentData` entries — each representing a pair of adjacent coordinates. For a `CircularString` with coordinates `[P₀, P₁, P₂, P₃, P₄]`:

- Segment 0: `[P₀, P₁]` (chord of first half of arc 0)
- Segment 1: `[P₁, P₂]` (chord of second half of arc 0)
- Segment 2: `[P₂, P₃]` (chord of first half of arc 1)
- Segment 3: `[P₃, P₄]` (chord of second half of arc 1)

Each segment is a straight-line chord — it does NOT represent the curved arc. The RBush extent must cover the **full arc curve**, not just the chord.

### Difficulty: Floating-Point Extent Miss

**Problem:** `geometry.getExtent()` computes arc extrema analytically (center ± radius at cardinal angles). Due to floating-point arithmetic:

```
Analytical maxY = center.y + radius = 2.9999999999999996
Actual control point Y = 3.0
```

The control point at `y=3.0` falls **outside** the RBush extent → the vertex-grab query never finds it → the user cannot select that vertex.

**Solution:** After computing the analytical extent, explicitly expand to include every control point:

```javascript
writeCircularStringGeometry_(feature, geometry) {
  const coordinates = geometry.getCoordinates();
  const extent = geometry.getExtent().slice();
  // Explicitly include every control point (prevents FP epsilon miss)
  for (let j = 0; j < coordinates.length; ++j) {
    extent[0] = Math.min(extent[0], coordinates[j][0]);
    extent[1] = Math.min(extent[1], coordinates[j][1]);
    extent[2] = Math.max(extent[2], coordinates[j][0]);
    extent[3] = Math.max(extent[3], coordinates[j][1]);
  }
  const featureSegments = [];
  for (let i = 0, ii = coordinates.length - 1; i < ii; ++i) {
    const segmentData = {
      feature, geometry, index: i,
      segment: coordinates.slice(i, i + 2),
      featureSegments: featureSegments,
    };
    featureSegments.push(segmentData);
    this.rBush_.insert(extent, segmentData);
  }
}
```

### Difficulty: Bulk Extent Updates on Drag

**Problem:** Moving any control point of a `CircularString` changes the entire arc (new radius, new center, new extent). ALL segments' RBush extents must be updated — not just the neighbors like with `LineString`.

**Solution:** The `featureSegments` shared array. All segments belonging to one `CircularString` reference the same array. On mouse-up after a drag, iterate ALL segments and update their RBush extents:

```javascript
// handleUpEvent — CircularString case
} else if (geometry.getType() === 'CircularString') {
  const csExtent = geometry.getExtent().slice();
  const csCoords = geometry.getCoordinates();
  for (let j = 0; j < csCoords.length; ++j) {
    csExtent[0] = Math.min(csExtent[0], csCoords[j][0]);
    csExtent[1] = Math.min(csExtent[1], csCoords[j][1]);
    csExtent[2] = Math.max(csExtent[2], csCoords[j][0]);
    csExtent[3] = Math.max(csExtent[3], csCoords[j][1]);
  }
  // Update ALL segments (not just dragged one)
  if (segmentData.featureSegments) {
    for (const sd of segmentData.featureSegments) {
      this.rBush_.update(csExtent, sd);
    }
  }
}
```

### The `changingFeature_` Guard

During coordinate updates, `geometry.setCoordinates()` fires `changed()` → feature fires `changed()` → `handleFeatureChange_` would remove and re-add ALL segments. The `changingFeature_` flag prevents this cascade:

```javascript
setGeometryCoordinates_(geometry, coordinates) {
  this.changingFeature_ = true;   // Suppress handleFeatureChange_
  geometry.setCoordinates(coordinates);
  this.changingFeature_ = false;
}

handleFeatureChange_(evt) {
  if (!this.changingFeature_) {  // Only process external changes
    const feature = evt.target;
    this.removeFeature_(feature);
    this.filter_(feature) && this.addFeature_(feature);
  }
}
```

Without this guard, every drag frame would trigger a full re-index — O(n) RBush remove + re-insert operations per frame.

---

## 9. Vertex Insertion on Arcs

### Difficulty: Non-Linear Insertion

**Problem:** On a `LineString`, inserting a vertex is trivial: `coordinates.splice(index + 1, 0, vertex)`. On a `CircularString`, the inserted vertex must lie ON the original arc, and two new sub-arcs must be created — each with a geometrically correct midpoint.

**Algorithm** (in `Modify.insertVertex_`, CircularString case):

```javascript
case 'CircularString': {
  coordinates = geometry.getCoordinates();
  const arcIndex = Math.floor(index / 2);
  if (arcIndex * 2 + 2 >= coordinates.length) return false;  // bounds guard

  const circGeom = geometry;
  const centerCoord = circGeom.flatCenterOfCircle(arcIndex);
  const cx = centerCoord[0], cy = centerCoord[1];
  const arcStart = coordinates[arcIndex * 2];
  const arcEnd = coordinates[arcIndex * 2 + 2];

  const radius = Math.sqrt(
    (arcStart[0] - cx) ** 2 + (arcStart[1] - cy) ** 2
  );

  // Determine CW/CCW from control point positions
  // ... (angle normalization, sweep computation) ...

  // Compute angular midpoint of the sub-arc being split
  // For first-half click: sub-arc is (arcStart → vertex)
  // For second-half click: sub-arc is (vertex → arcEnd)
  const midAngle = cw
    ? startAngle - sweep / 2
    : startAngle + sweep / 2;

  const newMidpoint = [
    cx + radius * Math.cos(midAngle),
    cy + radius * Math.sin(midAngle),
  ];

  if (isFirstHalf) {
    coordinates.splice(arcIndex * 2 + 1, 0, newMidpoint, vertex);
  } else {
    coordinates.splice(arcIndex * 2 + 2, 0, vertex, newMidpoint);
  }
  // Result: 1 arc (3 points) → 2 arcs (5 points), +2 coordinates inserted
}
```

**Key insight:** The new midpoint is computed as the *angular* midpoint on the circle — not a linear interpolation. This ensures both new sub-arcs lie exactly on the original circle with correct curvature.

**RBush updates after insertion:**
1. Remove 2 old segments (the original arc's two chords)
2. Shift all segment indices above the insertion point by +2
3. Create 4 new segments (two arcs × two chords each)

**Degenerate arc handling:** If the three control points are collinear (degenerate/straight arc), fall through to simple `splice` — there's no circle to preserve.

**Bounds guard:** `if (arcIndex * 2 + 2 >= coordinates.length) return false` — prevents crashes from stale RBush segment data where `index` refers to a position that no longer exists in the coordinate array.

---

## 10. Topology Validation

### Self-Intersection Check

Curved geometries must be **tessellated** (approximated as dense point sequences) before topology checks:

```javascript
const data = getTessellatedFlatCoords(geom);
const selfInt = getSelfIntersectionPoint(data.coords, 0, data.ends[0], 2, isRing);
```

**Limitation:** Tessellation is an approximation. Very tight curves with high curvature might produce false positives (tessellation chords cross when arcs don't) or false negatives (arcs cross between tessellation points).

### Overlap Detection (Two-Part)

```javascript
function checkOverlapWithExisting(sketchCoords, sketchEnd, sourceFeatures) {
  for (const feat of sourceFeatures) {
    // Part 1: Edge crossing
    const crossing = getSegmentsCrossingPoint(
      sketchCoords, 0, sketchEnd,
      existing.coords, 0, existing.ends[0], 2
    );
    if (crossing) return 'edges cross';

    // Part 2: Containment (with boundary-point guard)
    if (existingGeom.containsXY) {
      const testPt = [sketchCoords[0], sketchCoords[1]];
      if (!isVertexInFlat(testPt, existing.coords, existing.ends[0])
          && existingGeom.containsXY(testPt[0], testPt[1])) {
        return 'contained';
      }
    }
  }
}
```

### The Boundary-Point Guard

**Problem:** Shared junction vertices lie exactly ON the boundary of both features. The `containsXY` method uses winding number, which is *mathematically indeterminate* for points on the boundary (can return either true or false depending on floating-point rounding).

**Solution:** Before calling `containsXY`, check if the test point is a vertex of the existing feature. If so, skip the containment test — the point is on the boundary, not inside:

```javascript
if (!isVertexInFlat(testPt, existing.coords, existing.ends[0])
    && existingGeom.containsXY(testPt[0], testPt[1]))
```

### Validation Timing

| Phase | Behavior | Rationale |
|-------|----------|-----------|
| During draw | **Skip** when tracing | Chord tessellation of partial traces creates false crossings |
| On `drawend` | Advisory warning | Feature is kept; user is informed |
| On `modifyend` | Strict with rollback | Geometry reverted to snapshot if invalid |

---

## 11. Summary of Key Architectural Decisions

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| Separate `modifyCollection` (Approach A) | Eliminates all co-grab complexity | Shared vertices don't co-move |
| In-place `ring.setCoordinates()` for splitting | Preserves CurvePolygon parent's listener chain | Mutates source feature in-place |
| `featureSegments` shared array | Enables O(n) bulk RBush extent updates | All segments share one bounding box |
| Explicit extent expansion in writer | Fixes FP epsilon vertex-grab failures | Slightly larger extents than necessary |
| Angular midpoint for vertex insertion | Preserves arc geometry exactly | Complex trigonometric computation |
| `traceMidpoint` for direction resolution | Resolves closed-ring ambiguity automatically | Threshold-dependent; short traces may fail |
| Arc endpoint snapping post-extraction | Ensures CompoundCurve junction continuity | Sub-pixel arc distortion |
| Tessellation for topology checks | Pragmatic (exact curved intersection is research-grade) | Approximation at validation boundary |
| Skip validation during trace | Avoids chord-approximation false positives | No live feedback during tracing |
| Bounds guard in `insertVertex_` | Defensive against stale RBush segment data | Silently skips invalid insertions |

---

## 12. Narrative Summary

The **ideal** system would have full topological co-editing: shared arc segments that move together, validate together, and maintain exact geometric continuity at all times.

This is **impossibly hard** for curved geometries because:
- Non-linear control-point dependencies cause global shape changes from local edits
- Source features (circles) are fully determined by 5 control points — any modification is destructive
- Floating-point instability in rollback causes junction drift over repeated cycles
- Exact curve intersection detection is an unsolved research problem for general cases

The **pragmatic simplification** (Approach A) is:
- Source features are inert during modify — no co-grab, no deformation, no cascading
- Snap provides visual guidance to source boundaries
- Validation (on modify-end) catches topology violations and reverts
- Shared vertices exist structurally (from ring splitting) even though they evolve independently

**What we achieve:**
- Drawing features with exact arc segments traced from source features
- Source rings gain explicit control points at junction vertices
- Drawn features are independently modifiable with topology validation
- Vertex insertion on arcs preserves exact circular geometry
- The system degrades gracefully (snap guidance + validation) rather than catastrophically (source destruction + drift)
