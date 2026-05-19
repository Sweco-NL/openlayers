# Topological Curve Drawing — Full Design Spec

## Goal

Enable drawing CurvePolygon features that share boundaries via **exact arc sub-geometries** (not tessellated approximations). Prevent edge crossings entirely — clicks that would create a crossing are rejected. The output must be database-quality: zero gaps, zero crossings, true CircularString/CompoundCurve arc data.

---

## Constraint Summary

1. **No JSTS** — all topology logic stays in OL core utilities or example-level code.
2. **Cannot place a crossing point** — `Draw.condition` rejects clicks that would cause edge crossings.
3. **Shared boundaries = shared arc sub-geometries** — when tracing along an existing CurvePolygon boundary, the new feature gets cloned arc sub-geometries (CircularString instances) from the source feature, not tessellated polylines.
4. **Arc reconstruction is non-negotiable** — the database requires CurvePolygon/CircularString data. Tessellated LineString segments are not acceptable for shared boundaries.
5. **Drawing UX matches `draw-curves.js`** — same geometryFunction, buildSubGeometries, T-to-toggle, snap-to-start-to-close behaviour.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Example: topological-draw-curves.js                │
│                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Draw.trace + │  │ condition    │  │ geometryFn │ │
│  │ traceSource  │  │ callback     │  │ + finalize │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
│         │                 │                │        │
│     tessellated      check crossing    integrate   │
│     edge detection   via flat coords   traced arcs │
│         │                 │                │        │
└─────────┼─────────────────┼────────────────┼────────┘
          │                 │                │
          ▼                 ▼                ▼
┌─────────────────────────────────────────────────────┐
│  OL Core Changes                                    │
│                                                     │
│  1. tracing.js        — curve geometry support      │
│  2. CompoundCurve     — .slice(startCoord, endCoord)│
│  3. CircularString    — .splitAtCoordinate(coord)   │
│  4. CircularArc       — .splitAtAngle(angle)        │
└─────────────────────────────────────────────────────┘
```

---

## OL Core Changes (4 primitives)

### Primitive 1: `CircularArc.splitAtAngle(angle)` → `[CircularArc, CircularArc]`

**File:** `src/ol/geom/flat/CircularArc.js`
**Method:** New instance method on `CircularArc`

**Purpose:** Split one arc into two at a given angle (measured from center).

**Algorithm:**
```
Given: arc(begin, middle, end), center, radius
Input: splitAngle (radians, 0–2π)

1. Compute splitPoint = center + radius * (cos(splitAngle), sin(splitAngle))
2. Compute midAngle1 = midpoint angle between begin and splitPoint
   - Account for CW/CCW direction
   - midAngle1 = startAngle + sweep1/2  (where sweep1 = angular distance from start to split)
3. midPoint1 = center + radius * (cos(midAngle1), sin(midAngle1))
4. Compute midAngle2 = midpoint angle between splitPoint and end
   - midAngle2 = splitAngle + sweep2/2
5. midPoint2 = center + radius * (cos(midAngle2), sin(midAngle2))
6. Return [
     new CircularArc(begin, midPoint1, splitPoint),
     new CircularArc(splitPoint, midPoint2, end)
   ]
```

**Edge cases:**
- `splitAngle ≈ startAngle` → return `[null, originalArc]` (split at start)
- `splitAngle ≈ endAngle` → return `[originalArc, null]` (split at end)
- `splitAngle ≈ middleAngle` → exact split, both sub-arcs well-defined
- Full circle: sweep direction determined by original CW/CCW

**Tests:**
- Split a CCW quarter-arc at the midpoint → two equal eighth-arcs
- Split a CW semicircle at 1/3 → verify both sub-arcs share the split point
- Split at start/end → one null result
- Verify begin/end coordinates are exact (no floating-point drift)
- Verify both sub-arcs have the same center and radius as the original

---

### Primitive 2: `CircularString.splitAtCoordinate(coordinate)` → `[CircularString|null, CircularString|null]`

**File:** `src/ol/geom/CircularString.js`
**Method:** New instance method on `CircularString`

**Purpose:** Split a CircularString at an arbitrary point on the curve. Returns two CircularStrings: `[before, after]`.

**Algorithm:**
```
Input: coordinate [x, y] — must lie on the curve (snapped via Snap interaction)

1. Find which arc index the coordinate falls on:
   - For each arc i (0..arcCount-1):
     a. Compute center = arc(i).centerOfCircle()
     b. If degenerate (center=null), check if point is on the line segment
     c. Else check: |distance(coord, center) - radius| < epsilon
        AND angle of coord is within arc's angular range
     d. If match found → arcIndex = i, done

2. If coordinate equals an arc boundary (start or end of arc i):
   - Split between arcs: before = arcs[0..i-1], after = arcs[i..n-1]
   - If i=0: before = null
   - If i=arcCount: after = null

3. Else coordinate is interior to arc i:
   a. Compute splitAngle = atan2(y - center.y, x - center.x)
   b. [arcBefore, arcAfter] = arc(i).splitAtAngle(splitAngle)
   c. before = CircularString from:
      - arcs[0..i-1] control points + arcBefore control points
   d. after = CircularString from:
      - arcAfter control points + arcs[i+1..n-1] control points

4. Return [before, after]
```

**Key detail:** A CircularString with N arcs has (2N+1) control points. When we split at arc i:
- "before" gets control points: [p0, p1, ..., p_{2i}] + [splitPoint_mid, splitPoint] = 2i+3 points = i+1 arcs + splitArc_before
- "after" gets control points: [splitPoint, splitPoint_mid2, p_{2i+2}, ..., p_{2N}] = (2(N-i)-1)+2 = arcs from i+1..N-1 + splitArc_after

**Tests:**
- Single-arc CircularString split at midpoint → two single-arc CircularStrings
- Three-arc CircularString split at arc 1 midpoint → [2-arc, 2-arc]
- Split at control point (arc boundary) → clean cut, no arc splitting needed
- Split at start → [null, original]
- Split at end → [original, null]
- Verify concatenating before.tessellate() + after.tessellate() ≈ original.tessellate()

---

### Primitive 3: `CompoundCurve.slice(startCoord, endCoord)` → `CompoundCurve`

**File:** `src/ol/geom/CompoundCurve.js`
**Method:** New instance method on `CompoundCurve`

**Purpose:** Extract a portion of a CompoundCurve between two points as a new CompoundCurve (preserving arc sub-geometries).

**Algorithm:**
```
Input: startCoord, endCoord — both must lie on the curve

1. Locate startCoord on the curve:
   a. locatePoint(startCoord) → {subGeomIndex, isOnBoundary, arcIndex (if CircularString)}
   - Check each sub-geometry's boundary points first (exact match)
   - Then check interior: for LineString, closest-point-on-segment; for CircularString, point-on-arc check

2. Locate endCoord similarly.

3. If startIndex == endIndex (same sub-geometry):
   a. If CircularString: split at startCoord, then split the "after" at endCoord → middle piece
   b. If LineString: simple coordinate slice

4. If startIndex < endIndex:
   a. Split sub-geometry[startIndex] at startCoord → take the "after" part
   b. Clone whole sub-geometries[startIndex+1 .. endIndex-1]
   c. Split sub-geometry[endIndex] at endCoord → take the "before" part
   d. Assemble into CompoundCurve

5. If startIndex > endIndex (wrapping for rings):
   a. Same logic but wrap: [startIndex..end] + [0..endIndex]
   b. This handles CurvePolygon rings where trace direction goes past the ring closure

6. Return new CompoundCurve(resultSubGeometries)
```

**Helper needed:** `CompoundCurve.locateCoordinate(coord)` → `{subGeomIndex, position}` where position describes where on the sub-geometry the coord falls.

**Tests:**
- CompoundCurve([CircularString, LineString, CircularString]) — slice from middle of first arc to middle of last arc
- Slice that starts/ends at sub-geometry boundaries (no splitting needed)
- Slice within a single sub-geometry
- Ring wrapping: startCoord is "after" endCoord in the geometry order
- Verify the result's first coordinate matches startCoord, last matches endCoord

---

### Primitive 4: `tracing.js` — Curve geometry support

**File:** `src/ol/interaction/tracing.js`
**Function:** Modify `appendGeometryTraceTargets()`

**Purpose:** Allow `Draw.trace` to detect CurvePolygon/CompoundCurve/CircularString edges.

**Approach:** Tessellate curve geometries for edge detection (the existing trace system works on coordinate arrays and handles edge proximity correctly). The arc reconstruction happens later in `CompoundCurve.slice()`, not in the trace system.

**Changes:**
```javascript
// In appendGeometryTraceTargets:

import CircularString from '../geom/CircularString.js';
import CompoundCurve from '../geom/CompoundCurve.js';
import CurvePolygon from '../geom/CurvePolygon.js';

// ... existing LineString, Polygon, etc. handlers ...

if (geometry instanceof CurvePolygon) {
  const rings = geometry.getRingsArray();
  for (let i = 0, ii = rings.length; i < ii; ++i) {
    const ring = rings[i];
    const tessellated = ring.tessellate ? ring.tessellate() : ring.getFlatCoordinates();
    // Convert flat coords (stride 2) to Array<Coordinate>
    const coords = [];
    for (let j = 0; j < tessellated.length; j += 2) {
      coords.push([tessellated[j], tessellated[j + 1]]);
    }
    appendTraceTarget(coordinate, coords, true, targets);
  }
  return;
}

if (geometry instanceof CompoundCurve) {
  const tessellated = geometry.tessellate();
  const coords = [];
  for (let j = 0; j < tessellated.length; j += 2) {
    coords.push([tessellated[j], tessellated[j + 1]]);
  }
  appendTraceTarget(coordinate, coords, false, targets);
  return;
}

if (geometry instanceof CircularString) {
  const tessellated = geometry.tessellate();
  const coords = [];
  for (let j = 0; j < tessellated.length; j += 2) {
    coords.push([tessellated[j], tessellated[j + 1]]);
  }
  appendTraceTarget(coordinate, coords, false, targets);
  return;
}
```

**Note:** This is ~25 lines of code. The tessellated coordinates are used only for edge proximity detection. The actual arc sub-geometries are extracted by `CompoundCurve.slice()` in the example code.

**Tests:**
- Verify CurvePolygon features appear as trace targets
- Verify trace activates when clicking on a circular arc edge
- Verify trace coordinates follow the tessellated boundary

---

## Example Architecture: `topological-draw-curves.js`

### Component 1: Crossing Prevention (`Draw.condition`)

```javascript
const draw = new Draw({
  source,
  type: 'LineString',
  condition: function(event) {
    // Get the candidate coordinate
    const coord = event.coordinate;

    // Get current sketch coordinates
    const sketchFeature = draw.getOverlay().getSource().getFeatures()[0];
    if (!sketchFeature) return true; // first point always OK

    const sketchGeom = sketchFeature.getGeometry();
    const sketchCoords = sketchGeom.getCoordinates();

    // Simulate adding this point
    const testCoords = [...sketchCoords.slice(0, -1), coord]; // replace cursor follower

    // Tessellate the simulated sketch
    const testGeom = buildTestGeometry(testCoords); // uses buildSubGeometries
    const tessellated = testGeom.tessellate();

    // Check 1: Self-intersection of the new segment
    const selfInt = getSelfIntersectionPoint(tessellated, 0, tessellated.length, 2, false);
    if (selfInt) return false; // reject click

    // Check 2: Crossing with all existing features
    for (const feature of source.getFeatures()) {
      if (feature.get('_snapPoint')) continue;
      const existing = getTessellatedFlatCoords(feature.getGeometry());
      if (!existing) continue;
      const crossing = getSegmentsCrossingPoint(
        tessellated, 0, tessellated.length,
        existing.coords, 0, existing.ends[0], 2
      );
      if (crossing) return false; // reject click
    }

    return true; // allow click
  },
  // ... geometryFunction, etc.
});
```

### Component 2: Boundary Tracing (`Draw.trace`)

```javascript
const draw = new Draw({
  source,
  type: 'LineString',
  trace: true,        // enable tracing
  traceSource: source, // trace against existing features
  // ... condition, geometryFunction, etc.
});
```

When the user clicks on an existing CurvePolygon boundary edge, the trace system activates (thanks to Primitive 4). As the user moves the cursor along the boundary, OL's trace system adds tessellated coordinates to the sketch coordinate array. The user clicks again to end tracing.

**Key insight:** The tessellated trace coordinates are **markers** — they tell us "the user traced from point A to point B along feature X's boundary." We don't use them directly as geometry. Instead, in `finalizeGeometry`, we reconstruct the actual arc sub-geometries.

### Component 3: Arc Reconstruction in `finalizeGeometry`

After drawing completes, the sketch has a mix of:
- User-drawn coordinates (from direct clicking — these go through buildSubGeometries as today)
- Traced coordinates (from Draw.trace — these are tessellated approximations of existing arcs)

We need to identify which portions were traced and replace them with actual arc sub-geometries from the source features.

**Approach: Coordinate matching**

When the trace system adds coordinates from a feature's tessellated boundary, those coordinates are exact values from `feature.tessellate()`. We can match them back to the source feature.

```javascript
function finalizeGeometry(feature) {
  const geom = feature.getGeometry();
  const coords = geom.getCoordinates();

  // Step 1: Identify traced segments
  // For each consecutive sequence of coordinates that lies on an existing
  // feature's tessellated boundary, record {startCoord, endCoord, sourceFeature}
  const tracedSegments = identifyTracedSegments(coords, source.getFeatures());

  // Step 2: For non-traced segments, build sub-geometries using segmentBreaks
  // (same as current buildSubGeometries logic)

  // Step 3: For traced segments, use CompoundCurve.slice(startCoord, endCoord)
  // on the source feature's ring to get the actual arc sub-geometries

  // Step 4: Assemble all sub-geometries into the final CompoundCurve/CurvePolygon

  // Example:
  // coords = [userPt1, userPt2, tracedPt1, tracedPt2, ..., tracedPtN, userPt3, userPt4]
  //           ←── user-drawn ──→ ←──── traced from featureA ────→ ←── user-drawn ──→
  //
  // Result: CompoundCurve([
  //   CircularString([userPt1, mid, userPt2]),        // from buildSubGeometries
  //   LineString([userPt2, tracedPt1]),                // connector (if needed)
  //   CircularString([tracedPt1, ..., tracedPtN]),     // from featureA.slice()
  //   LineString([tracedPtN, userPt3]),                // connector (if needed)
  //   CircularString([userPt3, mid, userPt4]),         // from buildSubGeometries
  // ])
}
```

**`identifyTracedSegments(coords, features)`:**
```
For each feature with a CurvePolygon geometry:
  tessellate the ring → tessCoords[]
  For each coordinate in the sketch:
    if coordinate matches a tessCoord (floating-point equality):
      extend or start a traced segment
  For each traced segment:
    Record {startCoord, endCoord, sourceRing: feature's CompoundCurve ring}
```

The coordinate matching works because `tessellate()` produces deterministic, cached coordinates, and the trace system copies these exact values.

**`CompoundCurve.slice()` usage:**
```javascript
for (const traced of tracedSegments) {
  // Convert tessellated start/end back to actual curve coordinates
  // The tessellated start/end may not be arc control points — they're
  // interpolated points on the arc. So we need to snap them to the
  // nearest point on the actual curve.
  const sourceRing = traced.sourceRing; // CompoundCurve
  const arcSubGeoms = sourceRing.slice(traced.startCoord, traced.endCoord);
  // arcSubGeoms is a CompoundCurve with the actual arc data
}
```

### Component 4: Drawing UX (unchanged from draw-curves.js)

- `buildSubGeometries()` — same as current
- `segmentBreaks` + `currentSegType` — same
- `T` key toggle — same
- `geometryFunction` — same CompoundCurve construction
- `snapFeature` for closing CurvePolygon — same
- Only addition: the `condition` callback and `trace: true` option

---

## Coordinate Matching Detail

### Why it works

OL's trace system in `appendTraceTarget()` calls `getPointSegmentRelationship()` which checks if the click coordinate has `squaredDistance === 0` to a segment. When it matches, it records the index and "along" fraction.

Then in `getTraceTargetUpdate()`, as the cursor moves, it computes `endIndex` (fractional) and `interpolateCoordinate()` produces coordinates that are interpolations of the tessellated coordinate array.

When these interpolated coordinates are spliced into the sketch coordinate array, they come from `interpolateCoordinate(target.coordinates, index)`. For integer indices, this returns `target.coordinates[index]` exactly. For fractional indices, it interpolates between two tessellated vertices.

**For arc reconstruction, we need the start/end of the trace to snap to arc control points or exact tessellation vertices.** Since the Snap interaction is active, the click coordinates that start/end tracing will snap to:
- Exact control points (begin, middle, end of arcs) — these ARE tessellation vertices because `tessellate()` emits control points exactly
- Tessellation vertices — these have known positions on the arc (at angle = startAngle + (j/numSeg) * sweep)

Given a tessellation vertex, we can compute which arc it falls on and its exact angle, then use `CircularArc.splitAtAngle()` to get exact sub-arcs.

### Matching algorithm

```javascript
function findOnCurve(coord, compoundCurve) {
  const EPSILON = 1e-6;
  const geoms = compoundCurve.getGeometriesArray();

  for (let gi = 0; gi < geoms.length; gi++) {
    const geom = geoms[gi];

    if (geom.getType() === 'CircularString') {
      for (let ai = 0; ai < geom.arcCount(); ai++) {
        const arc = geom.arc(ai);
        const center = arc.centerOfCircle();
        if (!center) continue;

        const dx = coord[0] - center.x;
        const dy = coord[1] - center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = arc.radius(center);

        if (Math.abs(dist - radius) < EPSILON) {
          // Point is on the circle — check if it's within the arc's angular range
          let angle = Math.atan2(dy, dx);
          if (angle < 0) angle += 2 * Math.PI;

          if (geom.angleWithinArc_(angle, ...)) {
            return {subGeomIndex: gi, arcIndex: ai, angle: angle, type: 'arc'};
          }
        }
      }
    } else {
      // LineString — check segments
      // ...
    }
  }
  return null;
}
```

---

## Implementation Order

### Phase 1: OL Core Primitives (test-driven)
1. **`CircularArc.splitAtAngle()`** — pure math, easiest to test
2. **`CircularString.splitAtCoordinate()`** — uses #1
3. **`CompoundCurve.slice()`** — uses #2, most complex
4. **`tracing.js` curve support** — small change, enables Draw.trace for curves

### Phase 2: Example Rework
5. **Add `trace: true` + `traceSource`** to Draw interaction setup
6. **Add `condition` callback** for crossing prevention
7. **Implement `identifyTracedSegments()`** — coordinate matching
8. **Implement `finalizeGeometry()` with arc reconstruction** — uses CompoundCurve.slice()
9. **Integration testing** — draw a CurvePolygon adjacent to existing ones, verify shared arcs

### Phase 3: Edge Cases & Polish
10. Reverse tracing (trace in opposite direction along boundary)
11. Partial arc tracing (trace part of an arc, not full boundary)
12. Multiple traced segments in one drawing session
13. Modify interaction: revert if modification breaks shared boundaries

---

## Risk Analysis

### Risk 1: Floating-point coordinate matching
**Concern:** Tessellated coordinates might not match exactly when compared between trace output and source feature.
**Mitigation:** Both come from the same `tessellate()` call on the same geometry object with the same revision. OL caches tessellation results. Use epsilon-based comparison (1e-6) for safety.

### Risk 2: Trace system's fractional indices
**Concern:** The trace system may produce coordinates that are interpolated between tessellation vertices (fractional indices), not exact vertices.
**Mitigation:** The Snap interaction snaps click coordinates to feature edges/vertices. The trace START and END points are click coordinates, so they snap to exact positions. Interior trace coordinates are determined by `getTraceTargetUpdate()` which uses the cursor position — these may be fractional but we only need the trace start/end for `CompoundCurve.slice()`, not the interior points.

### Risk 3: Arc splitting numerical precision
**Concern:** Computing new midpoints for split arcs may introduce floating-point error.
**Mitigation:** The split point itself is exact (snapped). The new midpoints are computed from center + radius * cos/sin, which has the same precision as the original tessellation. The resulting arcs will have center/radius matching the original within floating-point precision.

### Risk 4: Trace direction ambiguity
**Concern:** For a ring, tracing from A to B could go clockwise or counter-clockwise.
**Mitigation:** OL's trace system already handles this — `getTraceTargetUpdate()` computes cumulative distances for both directions and picks the shorter one. `CompoundCurve.slice()` will need to handle both orderings.

---

## Files Modified

### OL Core (4 files)
- `src/ol/geom/flat/CircularArc.js` — add `splitAtAngle()` method
- `src/ol/geom/CircularString.js` — add `splitAtCoordinate()` method
- `src/ol/geom/CompoundCurve.js` — add `slice()` and `locateCoordinate()` methods
- `src/ol/interaction/tracing.js` — add CurvePolygon/CompoundCurve/CircularString handlers

### Tests (3-4 files)
- `test/node/ol/geom/flat/CircularArc.test.js` — new or extended
- `test/node/ol/geom/CircularString.test.js` — extended
- `test/node/ol/geom/CompoundCurve.test.js` — extended
- `test/node/ol/interaction/tracing.test.js` — new or extended

### Example (2 files)
- `examples/topological-draw-curves.js` — fundamental rework
- `examples/topological-draw-curves.html` — minor UI updates if needed

---

## Open Questions

1. **Should `CompoundCurve.slice()` handle LineString sub-geometries too?** — Yes, a CompoundCurve can have LineString segments. The slice needs to handle splitting LineStrings at a coordinate (trivial: interpolate along the segment).

2. **Should the trace system store metadata about which feature was traced?** — The current OL trace system doesn't expose this. We may need to add a hook or inspect the trace state to know which feature's boundary was traced. Alternative: coordinate matching against all features in `finalizeGeometry`.

3. **How to handle the connector between user-drawn and traced segments?** — When the user draws freely, then starts tracing, there's a gap between the last user-drawn coordinate and the trace start coordinate. If they're the same (snapped), no connector needed. If different, we need a LineString connector segment in the CompoundCurve.

4. **Should `CircularArc.splitAtAngle()` be a static method or instance method?** — Instance method is cleaner since it operates on the arc's own begin/middle/end/center.
