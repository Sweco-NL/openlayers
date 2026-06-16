import Feature from '../src/ol/Feature.js';
import Map from '../src/ol/Map.js';
import {unByKey} from '../src/ol/Observable.js';
import View from '../src/ol/View.js';
import {equals as coordinateEquals} from '../src/ol/coordinate.js';
import {noModifierKeys} from '../src/ol/events/condition.js';
import CircularString from '../src/ol/geom/CircularString.js';
import CompoundCurve, {
  coordinatesToCurveGeometry,
} from '../src/ol/geom/CompoundCurve.js';
import CurvePolygon from '../src/ol/geom/CurvePolygon.js';
import LineString from '../src/ol/geom/LineString.js';
import Point from '../src/ol/geom/Point.js';
import {getSegmentsCrossingPoint} from '../src/ol/geom/flat/segments.js';
import {
  getArcArrayCrossings,
  getSelfIntersectionPoint,
} from '../src/ol/geom/flat/topology.js';
import Draw from '../src/ol/interaction/Draw.js';
import Modify from '../src/ol/interaction/Modify.js';
import Snap from '../src/ol/interaction/Snap.js';
import TileLayer from '../src/ol/layer/Tile.js';
import VectorLayer from '../src/ol/layer/Vector.js';
import OSM from '../src/ol/source/OSM.js';
import VectorSource from '../src/ol/source/Vector.js';
import CircleStyle from '../src/ol/style/Circle.js';
import Fill from '../src/ol/style/Fill.js';
import Stroke from '../src/ol/style/Stroke.js';
import Style from '../src/ol/style/Style.js';

/**
 * Collect all curve segments from a geometry as flat coordinate arrays.
 * @param {import('../src/ol/geom/Geometry.js').default} geom The geometry.
 * @return {Array<Array<number>>} Array of [bx, by, mx, my, ex, ey].
 */
function collectCurveSegments(geom) {
  const result = [];
  geom.forEachCurveSegment(function (bx, by, mx, my, ex, ey) {
    result.push([bx, by, mx, my, ex, ey]);
  });
  return result;
}

// ── UI elements ──────────────────────────────────────────────
const statusEl = document.getElementById('status');
const modeEl = document.getElementById('segment-mode');
const topoStatusEl = document.getElementById('topology-status');
const typeSelect = document.getElementById('type');

/**
 * Squared distance threshold for filtering arc crossing points near endpoints.
 * Suitable for projected CRS with meter units (Web Mercator, UTM, etc).
 * @type {number}
 */
const CROSSING_EPSILON_SQ = 4;

/**
 * Squared tolerance for arc coordinate comparison.
 * After co-modify operations, coordinates may drift by a few ULPs.
 * 1e-4 map-units² ≈ 0.01 m² in Web Mercator — well below visible precision.
 * @type {number}
 */
const SAME_ARC_TOLERANCE_SQ = 1e-4;

// ── Validation state (read by style functions) ───────────────
const validationState = {
  isValid: true,
  /** @type {Array<Array<number>>} crossing points [x, y] shown during drag */
  crossingPoints: [],
  /**
   * Polyline of the offending sketch sub-geometry (whole arc or whole line
   * segment), used to overlay just that piece in red while the rest of the
   * sketch stays green.
   * @type {Array<Array<number>>|null}
   */
  errorSegment: null,
  /**
   * Features that were part of the last crossing error. Included in every
   * subsequent validateFeatures call so errors are never silently cleared
   * when an unrelated feature is modified.
   * @type {Set<import('../src/ol/Feature.js').default>}
   */
  errorFeatures: new Set(),
};

function setTopoStatus(valid, reason) {
  validationState.isValid = valid;
  if (valid) {
    validationState.crossingPoints = [];
    validationState.errorSegment = null;
    topoStatusEl.textContent = '✓ Valid';
    topoStatusEl.style.background = '#28a745';
  } else {
    topoStatusEl.textContent = '✗ ' + reason;
    topoStatusEl.style.background = '#dc3545';
  }
}

// ── State: drawing session ───────────────────────────────────
let draw = null;
let drawing = false;
let currentSegType = 'arc';
let postTraceAutoLine = false;
let segmentBreaks = [{index: 0, type: 'arc'}];
let wasTracing = false;
let traceActive = false;
let traceStartCoord = null;
/**
 * Source ring captured at `tracestart` so the ring-jump guard has data
 * before the first vertex commit (handleTraceTransitions only runs on
 * `isNewPoint`).
 * @type {{ring: import('../src/ol/geom/Geometry.js').default, feature: import('../src/ol/Feature.js').default}|null}
 */
let activeTraceEntry = null;
let suppressTraceUntilEnd = false;
let pendingFullRingClose = false;
let userClickedDuringTrace = false;
/**
 * The user's actual click coordinate captured at `checkCrossingCondition`
 * (i.e. `event.coordinate` from `handleDownEvent`'s condition check) — used
 * to recover the trace-exit index when OL's `updateTrace_` snaps the cursor
 * to an interpolated tessellation coord that differs from the click coord.
 * Without this, `coordinates.length - 2` at trace-end can point at the
 * snapped interpolated cursor instead of the user's intended click vertex,
 * making the post-trace slice include a stray tessellation sample.
 * @type {Array<number>|null}
 */
let userClickedExitCoord = null;
let maxTracedCount = 0;
let snapFeature = null;
let startCoord = null;
let lastSketchCoordinates = [];
/** @type {Array<{entryCoord: Array<number>, exitCoord: Array<number>|null, ring: object, sourceFeature: import('../src/ol/Feature.js').default|null, entryBreakIndex: number, traceStartIdx: number, traceEndIdx: number, traceMidpoint: Array<number>|null, chordFallback: boolean, forceLineTrace?: boolean}>} */
let tracedArcs = [];
const debugEvents = [];

// ── State: modify session ────────────────────────────────────
let modifyActive = false;
let geometrySnapshots = null;
let modifyChangeKeys = [];
let currentlyModifiedFeatures = new Set();
let actuallyChangedFeatures = new Set();

function status(msg) {
  statusEl.textContent = msg;
}

function roundCoord(coord) {
  return coord ? coord.map((value) => Math.round(value * 1000) / 1000) : null;
}

function recordDebugEvent(type, data = {}) {
  debugEvents.push({
    n: debugEvents.length,
    type,
    drawing,
    wasTracing,
    traceActive,
    currentSegType,
    ...data,
  });
  if (debugEvents.length > 300) {
    debugEvents.splice(0, debugEvents.length - 300);
  }
}

// ── Diagnostic: trap every write to currentSegType ──────────
// Read-only instrumentation. Each setSegType() call records the
// transition (from→to), the call-site tag, and the surrounding flag
// state at the moment of write. Dumped via window.__dump.segTypeWrites.
// Remove after the post-trace-auto-line regression is root-caused.
const segTypeWrites = [];
function setSegType(to, where) {
  segTypeWrites.push({
    n: debugEvents.length,
    from: currentSegType,
    to,
    where,
    postTraceAutoLine,
    wasTracing,
    traceActive,
    drawing,
    suppressTraceUntilEnd,
    pendingFullRingClose,
    userClickedDuringTrace,
  });
  if (segTypeWrites.length > 300) {
    segTypeWrites.splice(0, segTypeWrites.length - 300);
  }
  currentSegType = to;
}

// ── Modify diagnostics ───────────────────────────────────────
// Snapshot of every source feature's full coordinate tree, taken at
// modifystart so that modifyend / change events can diff against it and
// report the exact (feature, ring, sub, vertex) cell that mutated.
let modifySnapshotByUid = null;

/* eslint-disable no-use-before-define -- `source` is defined later in the
   module but these helpers are only invoked from Modify event handlers that
   run after module evaluation. */

/**
 * Build a normalized JSON tree of a geometry's coordinates with stable
 * cell paths: [ringIdx, subIdx (or -1), coordIdx, axis].
 * @param {import('../src/ol/geom/Geometry.js').default} geom Geometry.
 * @return {Array<Array<Array<Array<number>>>>} ring → sub → coord → [x,y]
 */
function geomCoordsTree(geom) {
  if (!geom) {
    return [];
  }
  const type = geom.getType();
  if (type === 'CurvePolygon') {
    return geom.getRingsArray().map((ring) => ringCoordsTree(ring));
  }
  if (type === 'CompoundCurve') {
    return [ringCoordsTree(geom)];
  }
  // CircularString / LineString / Point
  const coords = geom.getCoordinates();
  return [[Array.isArray(coords[0]) ? coords : [coords]]];
}
function ringCoordsTree(ring) {
  const t = ring.getType();
  if (t === 'CompoundCurve') {
    return ring
      .getGeometriesArray()
      .map((sub) => sub.getCoordinates().map((c) => c.slice()));
  }
  return [ring.getCoordinates().map((c) => c.slice())];
}

function snapshotAllFeatures() {
  // NOTE: `Map` is shadowed at module top by `import Map from '../src/ol/Map.js'`,
  // so we use a plain object keyed by ol_uid instead of a JS Map.
  const snap = Object.create(null);
  for (const f of source.getFeatures()) {
    if (f.get('_snapPoint') || f.get('_controlPoint')) {
      continue;
    }
    snap[f.ol_uid] = {
      featureIndex: source.getFeatures().indexOf(f),
      tree: geomCoordsTree(f.getGeometry()),
    };
  }
  return snap;
}

/**
 * Diff the current source against a prior snapshot. Reports per-cell deltas
 * with stable paths so a single Space dump tells us exactly which vertex
 * Modify touched and what it was before.
 * @param {Object<string,{featureIndex:number,tree:Array}>|null} prev Snapshot.
 * @return {Array<Object>} Delta records (move/insert/delete/added/removed).
 */
function diffAgainstSnapshot(prev) {
  const deltas = [];
  if (!prev) {
    return deltas;
  }
  const seenUids = Object.create(null);
  for (const f of source.getFeatures()) {
    if (f.get('_snapPoint') || f.get('_controlPoint')) {
      continue;
    }
    seenUids[f.ol_uid] = true;
    const before = prev[f.ol_uid];
    const after = geomCoordsTree(f.getGeometry());
    if (!before) {
      deltas.push({
        kind: 'added',
        featureUid: f.ol_uid,
        featureIndex: source.getFeatures().indexOf(f),
      });
      continue;
    }
    const beforeTree = before.tree;
    // Walk: ring -> sub -> coord
    const maxRings = Math.max(beforeTree.length, after.length);
    for (let ri = 0; ri < maxRings; ri++) {
      const beforeSubs = beforeTree[ri] || [];
      const afterSubs = after[ri] || [];
      const maxSubs = Math.max(beforeSubs.length, afterSubs.length);
      for (let si = 0; si < maxSubs; si++) {
        const beforeCoords = beforeSubs[si] || [];
        const afterCoords = afterSubs[si] || [];
        const maxC = Math.max(beforeCoords.length, afterCoords.length);
        for (let ci = 0; ci < maxC; ci++) {
          const b = beforeCoords[ci];
          const a = afterCoords[ci];
          if (!b && a) {
            deltas.push({
              kind: 'insert',
              featureUid: f.ol_uid,
              featureIndex: before.featureIndex,
              ring: ri,
              sub: si,
              coordIdx: ci,
              to: roundCoord(a),
            });
          } else if (b && !a) {
            deltas.push({
              kind: 'delete',
              featureUid: f.ol_uid,
              featureIndex: before.featureIndex,
              ring: ri,
              sub: si,
              coordIdx: ci,
              from: roundCoord(b),
            });
          } else if (b && a && (b[0] !== a[0] || b[1] !== a[1])) {
            deltas.push({
              kind: 'move',
              featureUid: f.ol_uid,
              featureIndex: before.featureIndex,
              ring: ri,
              sub: si,
              coordIdx: ci,
              from: roundCoord(b),
              to: roundCoord(a),
            });
          }
        }
      }
    }
  }
  const prevUids = Object.keys(prev);
  for (const uid of prevUids) {
    if (seenUids[uid]) {
      continue;
    }
    const before = prev[uid];
    deltas.push({
      kind: 'removed',
      featureUid: uid,
      featureIndex: before.featureIndex,
    });
  }
  return deltas;
}

/* eslint-enable no-use-before-define */

function updateMode() {
  const m = typeSelect.value;
  if ((m === 'CompoundCurve' || m === 'CurvePolygon') && drawing) {
    modeEl.textContent =
      '[' + (currentSegType === 'arc' ? 'ARC' : 'LINE') + '] T=toggle';
  } else {
    modeEl.textContent = '';
  }
}

// ── Topology helpers ─────────────────────────────────────────

function getTessellatedFlatCoords(geometry) {
  const type = geometry.getType();
  if (
    type === 'CurvePolygon' ||
    type === 'CircularString' ||
    type === 'CompoundCurve'
  ) {
    const data = geometry.getTessellatedFlatData();
    return {
      coords: data.flatCoordinates,
      ends: data.ends,
      stride: data.stride,
    };
  }
  if (type === 'Polygon') {
    return {
      coords: geometry.getFlatCoordinates(),
      ends: geometry.getEnds(),
      stride: geometry.getStride(),
    };
  }
  if (type === 'LineString' || type === 'LinearRing') {
    const fc = geometry.getFlatCoordinates();
    return {coords: fc, ends: [fc.length], stride: geometry.getStride()};
  }
  return null;
}

/**
 * Find the sub-geometry of the sketch tessellation that contains the segment
 * closest to `point`, and return its full polyline as `[[x,y], ...]`.
 * The whole sub-arc/sub-segment is highlighted instead of a tiny tessellation
 * fragment — visually clearer for arcs.
 * @param {Array<number>} coords Tessellated sketch coordinates.
 * @param {Array<number>} ends Per-sub-geometry end offsets.
 * @param {Array<number>} point [x, y] of the crossing/error point.
 * @return {Array<Array<number>>|null} Polyline coords or null.
 */
function findSketchSubGeomNear(coords, ends, point) {
  if (!point || !ends || ends.length === 0) {
    return null;
  }
  let bestD2 = Infinity;
  let bestSub = -1;
  let prevEnd = 0;
  for (let s = 0; s < ends.length; s++) {
    const end = ends[s];
    for (let i = prevEnd + 2; i < end; i += 2) {
      const ax = coords[i - 2];
      const ay = coords[i - 1];
      const bx = coords[i];
      const by = coords[i + 1];
      const vx = bx - ax;
      const vy = by - ay;
      const len2 = vx * vx + vy * vy;
      let t = 0;
      if (len2 > 0) {
        t = ((point[0] - ax) * vx + (point[1] - ay) * vy) / len2;
        if (t < 0) {
          t = 0;
        } else if (t > 1) {
          t = 1;
        }
      }
      const px = ax + t * vx;
      const py = ay + t * vy;
      const dx = point[0] - px;
      const dy = point[1] - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestSub = s;
      }
    }
    prevEnd = end;
  }
  if (bestSub < 0) {
    return null;
  }
  const subStart = bestSub === 0 ? 0 : ends[bestSub - 1];
  const subEnd = ends[bestSub];
  const out = [];
  for (let i = subStart; i < subEnd; i += 2) {
    out.push([coords[i], coords[i + 1]]);
  }
  return out.length >= 2 ? out : null;
}

/**
 * @param {Array<number>} point Coordinate to test.
 * @param {number} ax First endpoint x.
 * @param {number} ay First endpoint y.
 * @param {number} bx Second endpoint x.
 * @param {number} by Second endpoint y.
 * @return {boolean} Whether the point is within crossing tolerance of an endpoint.
 */
function isNearSegmentEndpoint(point, ax, ay, bx, by) {
  const dax = point[0] - ax;
  const day = point[1] - ay;
  const dbx = point[0] - bx;
  const dby = point[1] - by;
  return (
    dax * dax + day * day <= CROSSING_EPSILON_SQ ||
    dbx * dbx + dby * dby <= CROSSING_EPSILON_SQ
  );
}

/**
 * Find the first crossing that is not a near-endpoint touch. Draw/tracing
 * tessellation can place a shared vertex a few ULPs inside a segment, which
 * passes strict 0<t<1 checks and causes false "edges cross" warnings while
 * hugging existing boundaries.
 * @param {Array<number>} flatCoordinates1 First flat coordinates.
 * @param {number} offset1 First offset.
 * @param {number} end1 First end.
 * @param {Array<number>} flatCoordinates2 Second flat coordinates.
 * @param {number} offset2 Second offset.
 * @param {number} end2 Second end.
 * @param {number} stride Coordinate stride.
 * @return {Array<number>|undefined} Proper crossing point, if any.
 */
function getInteriorSegmentsCrossingPoint(
  flatCoordinates1,
  offset1,
  end1,
  flatCoordinates2,
  offset2,
  end2,
  stride,
) {
  for (let i = offset1 + stride; i < end1; i += stride) {
    const ax = flatCoordinates1[i - stride];
    const ay = flatCoordinates1[i - stride + 1];
    const bx = flatCoordinates1[i];
    const by = flatCoordinates1[i + 1];

    for (let j = offset2 + stride; j < end2; j += stride) {
      const cx = flatCoordinates2[j - stride];
      const cy = flatCoordinates2[j - stride + 1];
      const dx = flatCoordinates2[j];
      const dy = flatCoordinates2[j + 1];

      const denom = (ax - bx) * (cy - dy) - (ay - by) * (cx - dx);
      if (denom === 0) {
        continue;
      }

      const t = ((ax - cx) * (cy - dy) - (ay - cy) * (cx - dx)) / denom;
      const u = ((ax - cx) * (ay - by) - (ay - cy) * (ax - bx)) / denom;
      if (t <= 0 || t >= 1 || u <= 0 || u >= 1) {
        continue;
      }

      const point = [ax + t * (bx - ax), ay + t * (by - ay)];
      if (
        isNearSegmentEndpoint(point, ax, ay, bx, by) ||
        isNearSegmentEndpoint(point, cx, cy, dx, dy)
      ) {
        continue;
      }
      return point;
    }
  }
  return undefined;
}

function checkOverlapWithExisting(
  sketchCoords,
  sketchEnd,
  sourceFeatures,
  containmentExcludedFeatures,
  skipContainment,
  traceBoundaryRings = null,
) {
  const boundaryRings =
    traceBoundaryRings && traceBoundaryRings.length ? traceBoundaryRings : null;
  const onAnyBoundary = (point) => {
    if (!boundaryRings) {
      return false;
    }
    for (const r of boundaryRings) {
      if (coordIsOnRing(r, point)) {
        return true;
      }
    }
    return false;
  };
  for (const feat of sourceFeatures) {
    if (feat.get('_snapPoint')) {
      continue;
    }
    const existingGeom = feat.getGeometry();
    if (!existingGeom) {
      continue;
    }
    // Always recompute tessellation per call: it is cheap (a few features
    // per mousemove) and guarantees the data matches the geometry's current
    // revision rather than a stale snapshot from drawstart.
    const existing = getTessellatedFlatCoords(existingGeom);
    if (!existing) {
      continue;
    }
    const crossing = getInteriorSegmentsCrossingPoint(
      sketchCoords,
      0,
      sketchEnd,
      existing.coords,
      0,
      existing.ends[0],
      2,
    );
    if (crossing) {
      if (containmentExcludedFeatures.has(feat) && onAnyBoundary(crossing)) {
        continue;
      }
      return {
        reason: 'Overlaps existing feature (edges cross)',
        feature: feat,
        point: crossing,
      };
    }
    if (!skipContainment && existingGeom.containsXY) {
      // Walk every sketch segment and test its midpoint for containment.
      // Segments that lie along the existing feature's boundary (e.g. when
      // tracing along it) produce midpoints that fall ON the boundary —
      // those are filtered out by the on-boundary check below. Segments
      // that traverse the interior produce midpoints strictly inside, which
      // we want to flag as overlap (this catches the "vertex-touch entry
      // and exit through the polygon interior" case that strict edge-crossing
      // bounds reject).
      // Tolerance for "on boundary" is scaled to the existing feature's
      // tessellation density so it works at any zoom / coordinate scale.
      // We test perpendicular distance to each tessellation SEGMENT (not
      // just vertices) — when tracing hugs the boundary, midpoints land
      // between vertices and a vertex-only test would miss them, then
      // containsXY returns true for boundary points and we'd false-flag.
      const ext = existingGeom.getExtent();
      const span = Math.max(ext[2] - ext[0], ext[3] - ext[1]);
      const onBoundaryTol2 = Math.pow(span * 1e-4, 2); // (0.01% of extent)^2
      const ec = existing.coords;
      const eend = existing.ends[0];
      for (let ti = 0; ti < sketchEnd - 2; ti += 2) {
        const mx = (sketchCoords[ti] + sketchCoords[ti + 2]) / 2;
        const my = (sketchCoords[ti + 1] + sketchCoords[ti + 3]) / 2;
        let onBoundary = false;
        for (let ei = 2; ei < eend; ei += 2) {
          const ax = ec[ei - 2];
          const ay = ec[ei - 1];
          const bx = ec[ei];
          const by = ec[ei + 1];
          const vx = bx - ax;
          const vy = by - ay;
          const len2 = vx * vx + vy * vy;
          let t = 0;
          if (len2 > 0) {
            t = ((mx - ax) * vx + (my - ay) * vy) / len2;
            if (t < 0) {
              t = 0;
            } else if (t > 1) {
              t = 1;
            }
          }
          const px = ax + t * vx;
          const py = ay + t * vy;
          const dx = mx - px;
          const dy = my - py;
          if (dx * dx + dy * dy < onBoundaryTol2) {
            onBoundary = true;
            break;
          }
        }
        if (!onBoundary && existingGeom.containsXY(mx, my)) {
          if (
            containmentExcludedFeatures.has(feat) &&
            onAnyBoundary([mx, my])
          ) {
            continue;
          }

          // console.log('[COW] containment HIT', {featIdx, ti, mx, my});
          return {
            reason: 'Overlaps existing feature (contained)',
            feature: feat,
            point: [mx, my],
          };
        }
      }
    }
  }
  return null;
}

function isVertexInFlat(coord, flat, end) {
  const x = coord[0];
  const y = coord[1];
  for (let i = 0; i < end; i += 2) {
    if (flat[i] === x && flat[i + 1] === y) {
      return true;
    }
  }
  return false;
}

// ── Styles ───────────────────────────────────────────────────

function featureStyle(feature) {
  if (feature.get('_snapPoint')) {
    return null;
  }
  const geom = feature.getGeometry();
  const styles = [];

  // Base stroke + fill
  styles.push(
    new Style({
      stroke: new Stroke({color: '#0064c8', width: 3}),
      fill: new Fill({color: 'rgba(0, 100, 200, 0.12)'}),
    }),
  );

  // Control point dots
  if (geom.getType() === 'CurvePolygon') {
    const rings = geom.getRingsArray();
    for (const ring of rings) {
      const ringType = ring.getType();
      if (ringType === 'CompoundCurve') {
        // Iterate sub-geometries to correctly identify endpoints
        for (const sub of ring.getGeometriesArray()) {
          const subType = sub.getType();
          const coords = sub.getCoordinates();
          for (let i = 0; i < coords.length; i++) {
            const isEndpoint = subType === 'LineString' || i % 2 === 0;
            styles.push(
              new Style({
                geometry: new Point(coords[i]),
                image: new CircleStyle({
                  radius: isEndpoint ? 6 : 3,
                  fill: new Fill({
                    color: isEndpoint ? '#0064c8' : 'rgba(0, 100, 200, 0.3)',
                  }),
                  stroke: new Stroke({
                    color: isEndpoint ? '#fff' : '#0064c8',
                    width: isEndpoint ? 2 : 1,
                  }),
                }),
              }),
            );
          }
        }
      } else {
        const coords = ring.getCoordinates();
        const isCircular = ringType === 'CircularString';
        for (let i = 0; i < coords.length; i++) {
          const isEndpoint = !isCircular || i % 2 === 0;
          styles.push(
            new Style({
              geometry: new Point(coords[i]),
              image: new CircleStyle({
                radius: isEndpoint ? 6 : 3,
                fill: new Fill({
                  color: isEndpoint ? '#0064c8' : 'rgba(0, 100, 200, 0.3)',
                }),
                stroke: new Stroke({
                  color: isEndpoint ? '#fff' : '#0064c8',
                  width: isEndpoint ? 2 : 1,
                }),
              }),
            }),
          );
        }
      }
    }
  } else {
    const coords = geom.getCoordinates ? geom.getCoordinates() : [];
    const flat = Array.isArray(coords[0]?.[0]) ? coords.flat() : coords;
    for (const c of flat) {
      if (Array.isArray(c) && c.length >= 2) {
        styles.push(
          new Style({
            geometry: new Point(c),
            image: new CircleStyle({
              radius: 4,
              fill: new Fill({color: '#0064c8'}),
              stroke: new Stroke({color: '#fff', width: 1.5}),
            }),
          }),
        );
      }
    }
  }

  // Crossing point markers (red dots at intersections during drag)
  for (const cp of validationState.crossingPoints) {
    styles.push(
      new Style({
        geometry: new Point(cp),
        image: new CircleStyle({
          radius: 10,
          fill: new Fill({color: 'rgba(220, 53, 69, 0.4)'}),
          stroke: new Stroke({color: '#dc3545', width: 3}),
        }),
      }),
    );
  }

  return styles;
}

function sketchStyle(feature) {
  const geom = feature.getGeometry();
  const valid = validationState.isValid;
  const errSeg = validationState.errorSegment;
  // Default stroke: green when valid; if invalid, keep the main sketch green
  // when we know which segment is offending (we'll overlay that in red);
  // otherwise fall back to colouring everything red dashed.
  const mainColor = valid || errSeg ? '#28a745' : '#dc3545';

  if (geom.getType() === 'Point') {
    return new Style({
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({color: valid ? '#28a745' : '#dc3545'}),
      }),
    });
  }
  const styles = [
    new Style({
      stroke: new Stroke({
        color: mainColor,
        width: 2,
        lineDash: valid || errSeg ? undefined : [6, 4],
      }),
    }),
  ];
  if (!valid && errSeg) {
    styles.push(
      new Style({
        geometry: new LineString(errSeg),
        stroke: new Stroke({
          color: '#dc3545',
          width: 4,
          lineDash: [6, 4],
        }),
      }),
    );
  }
  return styles;
}

// ── Map setup ────────────────────────────────────────────────

const source = new VectorSource();

// Hard-prevent cross-feature trace hops EXCEPT at shared vertices.
// OL's Draw interaction calls `traceSource.getFeaturesInExtent(extent)`
// on every pointer move while a trace is active (see
// `addTraceTargetsAtCoordinate_` in Draw.js) and adds any feature found
// under the cursor as a new trace target. That's what enables it to
// silently switch from the entry feature to a neighbour whose outline
// passes near the cursor. We wrap the source's extent-query so that
// during an active trace we return:
//   - only the entry feature when the cursor is on its boundary at a
//     non-shared point (no hop possible), OR
//   - the entry feature plus any other feature that shares a control
//     point with the entry feature within the queried extent (hop
//     allowed at shared nodes).
const __sourceGetFeaturesInExtent = source.getFeaturesInExtent.bind(source);
source.getFeaturesInExtent = function (extent, projection) {
  const all = __sourceGetFeaturesInExtent(extent, projection);
  if (!traceActive || !activeTraceEntry || !activeTraceEntry.feature) {
    return all;
  }
  const entryFeature = activeTraceEntry.feature;
  if (!all.includes(entryFeature)) {
    return [];
  }
  // Find entry-feature control points that lie inside the queried extent.
  const entryGeom = entryFeature.getGeometry();
  if (!entryGeom) {
    return [entryFeature];
  }
  const inExtent = (c) =>
    c[0] >= extent[0] &&
    c[0] <= extent[2] &&
    c[1] >= extent[1] &&
    c[1] <= extent[3];
  const entryCps = getControlPoints(entryGeom, {skipArcMidpoints: true})
    .filter((p) => inExtent(p.coord))
    .map((p) => p.coord);
  if (entryCps.length === 0) {
    return [entryFeature];
  }
  // Allow other features through only if they share a control point
  // (exact coord match) with the entry feature within this extent.
  const allowed = [entryFeature];
  for (const f of all) {
    if (f === entryFeature || f.get('_snapPoint')) {
      continue;
    }
    const g = f.getGeometry();
    if (!g) {
      continue;
    }
    const cps = getControlPoints(g, {skipArcMidpoints: true});
    const shares = cps.some((p) =>
      entryCps.some((e) => p.coord[0] === e[0] && p.coord[1] === e[1]),
    );
    if (shares) {
      allowed.push(f);
    }
  }
  return allowed;
};

const preFeatureA = new Feature({
  geometry: new CurvePolygon([
    new CircularString([
      [-3000000, 1000000],
      [-1500000, 2500000],
      [0, 1000000],
      [-1500000, -500000],
      [-3000000, 1000000],
    ]),
    // Interior ring (hole): 4-arc asymmetric "squished kite"
    // Endpoints at indices 0,2,4,6 are valid trace entry/exit points
    new CircularString([
      [-1500000, 1600000],
      [-1050000, 1450000],
      [-900000, 1000000],
      [-1100000, 500000],
      [-1500000, 300000],
      [-2150000, 550000],
      [-2100000, 1200000],
      [-1900000, 1550000],
      [-1500000, 1600000],
    ]),
  ]),
});

const preFeatureB = new Feature({
  geometry: new CurvePolygon([
    new CompoundCurve([
      new CircularString([
        [2000000, 1000000],
        [2750000, 2100000],
        [3500000, 2500000],
        [4250000, 2100000],
        [5000000, 1000000],
      ]),
      new LineString([
        [5000000, 1000000],
        [5000000, -500000],
        [2000000, -500000],
        [2000000, 1000000],
      ]),
    ]),
  ]),
});

// Pre-loaded feature with CompoundCurve ring (CircularString + LineString)
const preFeatureC = new Feature({
  geometry: new CurvePolygon([
    new CompoundCurve([
      new CircularString([
        [-3000000, -2000000],
        [-1500000, -500000],
        [0, -2000000],
      ]),
      new LineString([
        [0, -2000000],
        [0, -4000000],
        [-3000000, -4000000],
        [-3000000, -2000000],
      ]),
    ]),
  ]),
});

source.addFeature(preFeatureA);
source.addFeature(preFeatureB);
source.addFeature(preFeatureC);

const map = new Map({
  layers: [
    new TileLayer({source: new OSM()}),
    new VectorLayer({source, style: featureStyle}),
  ],
  target: 'map',
  view: new View({center: [1000000, 1000000], zoom: 3}),
});

// Expose map for puppeteer/devtools inspection scripts.
/** @type {any} */ (window).__map = map;

// ── Interactions ─────────────────────────────────────────────

// All source features are modifiable (enables co-grab at shared vertices).
// Filter excludes helper snap-point features from modification.
const modify = new Modify({
  source,
  filter: (feature) => !feature.get('_snapPoint'),
});
const snap = new Snap({
  source,
  vertex: true,
  edge: true,
});

// Control-point snap: always active with generous tolerance.
// Added AFTER main snap so it overrides tessellation vertices
// when the pointer is near an arc endpoint. This ensures both
// trace entry and exit land on exact control-point values.
const controlPointSource = new VectorSource();

/**
 * Extract all control points from a geometry.
 * @param {import('../src/ol/geom/Geometry.js').default} geom The geometry.
 * @param {Object} [options] Options.
 * @param {boolean} [options.skipArcMidpoints] Skip odd-indexed CircularString coords.
 * @return {Array<{coord: Array<number>, ring: import('../src/ol/geom/SimpleGeometry.js').default|null, index: number, isArcMidpoint: boolean}>} Control points.
 */
function getControlPoints(geom, options) {
  const skipMid = options && options.skipArcMidpoints;
  const results = [];

  function fromSimple(simpleGeom, ring) {
    const coords = simpleGeom.getCoordinates();
    const isCirc = simpleGeom.getType() === 'CircularString';
    for (let idx = 0; idx < coords.length; idx++) {
      const isMid = isCirc && idx % 2 === 1;
      if (skipMid && isMid) {
        continue;
      }
      results.push({
        coord: coords[idx],
        ring: ring,
        index: idx,
        isArcMidpoint: isMid,
      });
    }
  }

  function fromRing(ring) {
    const type = ring.getType();
    if (type === 'CompoundCurve') {
      let globalIdx = 0;
      for (const sub of ring.getGeometriesArray()) {
        const coords = sub.getCoordinates();
        const isCirc = sub.getType() === 'CircularString';
        for (let i = 0; i < coords.length; i++) {
          const isMid = isCirc && i % 2 === 1;
          if (skipMid && isMid) {
            continue;
          }
          results.push({
            coord: coords[i],
            ring: ring,
            index: globalIdx + i,
            isArcMidpoint: isMid,
          });
        }
        globalIdx += coords.length - 1; // shared junction
      }
    } else {
      fromSimple(ring, ring);
    }
  }

  const geomType = geom.getType();
  if (geomType === 'CurvePolygon') {
    for (const ring of geom.getRingsArray()) {
      fromRing(ring);
    }
  } else if (geomType === 'CompoundCurve') {
    fromRing(geom);
  } else if (geomType === 'CircularString' || geomType === 'LineString') {
    fromSimple(geom, geom);
  }
  return results;
}

/**
 * Add all control points from a feature to the given source.
 * @param {import('../src/ol/Feature.js').default} feat The feature.
 * @param {import('../src/ol/source/Vector.js').default} targetSource The source to add points to.
 * @param {boolean} [endpointsOnly] If true, skip arc midpoints.
 */
function addControlPointsForFeature(feat, targetSource, endpointsOnly) {
  const geom = feat.getGeometry();
  if (!geom) {
    return;
  }
  const pts = getControlPoints(geom, {skipArcMidpoints: endpointsOnly});
  for (const pt of pts) {
    targetSource.addFeature(
      new Feature({geometry: new Point(pt.coord), _controlPoint: true}),
    );
  }
}

function rebuildControlPointSource() {
  controlPointSource.clear();
  for (const feat of source.getFeatures()) {
    if (feat.get('_snapPoint')) {
      continue;
    }
    addControlPointsForFeature(feat, controlPointSource);
  }
}
rebuildControlPointSource();
source.on(['addfeature', 'removefeature', 'changefeature'], () => {
  if (!modifyActive) {
    rebuildControlPointSource();
  }
});

const traceSnap = new Snap({
  source: controlPointSource,
  vertex: true,
  edge: false,
  pixelTolerance: 25,
});
traceSnap.setActive(false); // Only active during modify drag or drawing

map.addInteraction(modify);
map.addInteraction(snap);
map.addInteraction(traceSnap);

/**
 * Smart multi-feature validation. Checks:
 * 1. Self-intersections for each target feature.
 * 2. Each unique (target × target) pair exactly once.
 * 3. Each (target × bystander) pair exactly once.
 * Short-circuits as soon as the first crossing is found.
 * @param {Set<import('../src/ol/Feature.js').default>} targets Features to validate.
 */
function validateFeatures(targets) {
  // If there were previous crossing errors, always re-validate those features
  // too. Without this, modifying an unrelated feature produces zero crossings
  // and Phase 4 would silently wipe the existing error markers.
  const effectiveTargets =
    validationState.errorFeatures.size > 0
      ? new Set([...targets, ...validationState.errorFeatures])
      : targets;

  const allCrossings = [];
  const targetArray = [];
  const targetArcsById = Object.create(null);
  let hasSelfIntersection = false;

  // Phase 1: Collect arcs and check self-intersections for all targets.
  for (const feature of effectiveTargets) {
    const geom = feature.getGeometry();
    if (!geom) {
      continue;
    }
    targetArray.push(feature);
    const arcs = collectCurveSegments(geom);
    targetArcsById[feature.ol_uid] = arcs;

    if (geom.getType() === 'CurvePolygon') {
      const selfX = geom.getSelfIntersections(
        CROSSING_EPSILON_SQ,
        SAME_ARC_TOLERANCE_SQ,
      );
      allCrossings.push(...selfX);
      if (selfX.length > 0) {
        hasSelfIntersection = true;
      }
    }
  }

  // Phase 2: Check each unique (target × target) pair once.
  for (let i = 0; i < targetArray.length - 1; i++) {
    for (let j = i + 1; j < targetArray.length; j++) {
      const arcsI = targetArcsById[targetArray[i].ol_uid];
      const arcsJ = targetArcsById[targetArray[j].ol_uid];
      const ttCrossings = getArcArrayCrossings(
        arcsI,
        arcsJ,
        CROSSING_EPSILON_SQ,
        true,
        SAME_ARC_TOLERANCE_SQ,
      );
      allCrossings.push(...ttCrossings);
    }
  }

  // Phase 3: Check each target against bystander (non-target) features.
  const bystanders = source
    .getFeatures()
    .filter((o) => !effectiveTargets.has(o) && !o.get('_snapPoint'));

  for (const feature of targetArray) {
    const geom = feature.getGeometry();
    const myArcs = targetArcsById[feature.ol_uid];

    for (const other of bystanders) {
      const otherGeom = other.getGeometry();
      if (!otherGeom) {
        continue;
      }

      if (
        geom.getType() === 'CurvePolygon' &&
        otherGeom.getType() === 'CurvePolygon'
      ) {
        const otherArcs = collectCurveSegments(otherGeom);
        const byCrossings = getArcArrayCrossings(
          myArcs,
          otherArcs,
          CROSSING_EPSILON_SQ,
          true,
          SAME_ARC_TOLERANCE_SQ,
        );
        allCrossings.push(...byCrossings);
      } else {
        const data = getTessellatedFlatCoords(geom);
        const otherData = getTessellatedFlatCoords(otherGeom);
        if (!data || !otherData) {
          continue;
        }
        const crossing = getSegmentsCrossingPoint(
          data.coords,
          0,
          data.ends[0],
          otherData.coords,
          0,
          otherData.ends[0],
          2,
        );
        if (crossing) {
          allCrossings.push(crossing);
        }
      }
    }
  }

  // Phase 4: Update validation state.
  if (allCrossings.length > 0) {
    validationState.crossingPoints = allCrossings;
    validationState.errorFeatures = new Set(effectiveTargets);
    setTopoStatus(
      false,
      hasSelfIntersection ? 'Self-intersecting' : 'Overlaps',
    );
  } else if (validationState.crossingPoints.length > 0) {
    validationState.crossingPoints = [];
    validationState.errorFeatures.clear();
    setTopoStatus(true, '');
  }
}

modify.on('modifystart', (event) => {
  modifyActive = true;
  snap.setActive(false);
  traceSnap.setActive(true);
  // Diagnostic: snapshot every source feature so modifyend can diff and
  // report exactly which (feature, ring, sub, vertex) was touched.
  modifySnapshotByUid = snapshotAllFeatures();
  const modifyTargets = event.features.getArray().map((f) => ({
    featureUid: f.ol_uid,
    featureIndex: source.getFeatures().indexOf(f),
    geometryType: f.getGeometry() ? f.getGeometry().getType() : null,
  }));
  recordDebugEvent('modifystart', {
    targets: modifyTargets,
    targetCount: modifyTargets.length,
  });
  // During modify, snap to OTHER features' control points (not the feature
  // being dragged — prevents self-snap). Include all geometry types.
  const modifiedFeats = new Set(event.features.getArray());

  controlPointSource.clear(); // must NOT use fast mode — Snap listens for removefeature events
  for (const feat of source.getFeatures()) {
    if (feat.get('_snapPoint') || modifiedFeats.has(feat)) {
      continue;
    }
    addControlPointsForFeature(feat, controlPointSource, true);
  }

  // For co-grabbed features (shared vertex topology), add back their control
  // points so the user can still snap to adjacent features' other vertices.
  const primary = event.features.item(0);
  for (const feat of modifiedFeats) {
    if (feat === primary) {
      continue;
    }
    addControlPointsForFeature(feat, controlPointSource, true);
  }

  // Collect ALL vertex positions of the PRIMARY modified feature so we can
  // exclude coincident snap targets. This prevents:
  // (a) self-snap: other features sharing a vertex with the modified feature
  //     cause snap targets at the same positions as the modified feature's
  //     own vertices.
  // (b) snap-to-origin: another feature's vertex at the drag-start location
  //     pulls the dragged vertex back to its original position.
  const modifiedCoords = new Set();
  const primaryPts = getControlPoints(primary.getGeometry(), {
    skipArcMidpoints: true,
  });
  for (const pt of primaryPts) {
    modifiedCoords.add(pt.coord[0] + ',' + pt.coord[1]);
  }
  const toRemove = [];
  for (const cpFeat of controlPointSource.getFeatures()) {
    const c = cpFeat.getGeometry().getCoordinates();
    if (modifiedCoords.has(c[0] + ',' + c[1])) {
      toRemove.push(cpFeat);
    }
  }
  for (const f of toRemove) {
    controlPointSource.removeFeature(f);
  }

  geometrySnapshots = new WeakMap();
  currentlyModifiedFeatures = new Set();

  // Debounced validation: Modify updates co-grabbed geometries sequentially,
  // firing 'change' after each one. We must wait until ALL geometries in the
  // current drag frame have been updated before validating crossings.
  let validationPending = false;
  actuallyChangedFeatures = new Set();
  function scheduleValidation(changedFeature) {
    actuallyChangedFeatures.add(changedFeature);
    if (!validationPending) {
      validationPending = true;
      queueMicrotask(() => {
        validationPending = false;
        validateFeatures(actuallyChangedFeatures);
      });
    }
  }

  event.features.forEach((f) => {
    geometrySnapshots.set(f, f.getGeometry().clone());
    currentlyModifiedFeatures.add(f);
    const key = f.getGeometry().on('change', () => scheduleValidation(f));
    modifyChangeKeys.push(key);
  });
});

modify.on('modifyend', () => {
  modifyActive = false;
  modifyChangeKeys.forEach((key) => unByKey(key));
  modifyChangeKeys = [];

  // Diagnostic: report exact per-cell deltas from modifystart snapshot.
  const deltas = diffAgainstSnapshot(modifySnapshotByUid);
  recordDebugEvent('modifyend', {
    deltaCount: deltas.length,
    deltas: deltas.slice(0, 40),
  });
  modifySnapshotByUid = null;

  // Run final validation synchronously before checking result.
  // The last geometry 'change' microtask may not have fired yet.
  validateFeatures(actuallyChangedFeatures);

  currentlyModifiedFeatures.clear();
  actuallyChangedFeatures.clear();

  rebuildControlPointSource();
  source.changed();
  // Only re-enable snap if a draw interaction is active (not in edit-only mode)
  snap.setActive(!!draw);
  traceSnap.setActive(false);

  if (!(geometrySnapshots instanceof WeakMap)) {
    if (validationState.isValid) {
      setTopoStatus(true, '');
    }
    return;
  }
  geometrySnapshots = null;

  // Only clear status if validation passed
  if (validationState.isValid) {
    setTopoStatus(true, '');
  }
});

// ── Drawing helpers ──────────────────────────────────────────

function committedInSegment(totalCoords) {
  return totalCoords - 1 - segmentBreaks[segmentBreaks.length - 1].index;
}

function resetState() {
  segmentBreaks = [{index: 0, type: 'arc'}];
  setSegType('arc', 'resetState');
  postTraceAutoLine = false;
  drawing = false;
  wasTracing = false;
  traceActive = false;
  traceStartCoord = null;
  activeTraceEntry = null;
  suppressTraceUntilEnd = false;
  pendingFullRingClose = false;
  userClickedDuringTrace = false;
  userClickedExitCoord = null;
  maxTracedCount = 0;
  tracedArcs = [];
  startCoord = null;
  lastSketchCoordinates = [];
  if (snapFeature) {
    source.removeFeature(snapFeature);
    snapFeature = null;
  }
  updateMode();
  setTopoStatus(true, '');
}

// ── Find source ring at a coordinate ─────────────────────────

/**
 * Find the CurvePolygon ring closest to a given coordinate.
 * Returns the ring geometry and owning feature, or null.
 * @param {Array<number>} coord The coordinate to search near.
 * @return {{ring: import('../src/ol/geom/SimpleGeometry.js').default, feature: import('../src/ol/Feature.js').default}|null} The ring and feature.
 */
function findSourceRing(coord) {
  const features = source.getFeatures().filter((f) => !f.get('_snapPoint'));
  let bestRing = null;
  let bestFeature = null;
  let bestDist = Infinity;
  for (const feat of features) {
    const geom = feat.getGeometry();
    if (!geom || geom.getType() !== 'CurvePolygon') {
      continue;
    }
    const rings = geom.getRingsArray();
    for (const ring of rings) {
      let dist2;
      if (ring.getType() === 'CompoundCurve') {
        dist2 = Infinity;
        for (const sub of ring.getGeometriesArray()) {
          const closest = [0, 0];
          dist2 = Math.min(
            dist2,
            sub.closestPointXY(coord[0], coord[1], closest, Infinity),
          );
        }
      } else {
        const closest = [0, 0];
        dist2 = ring.closestPointXY(coord[0], coord[1], closest, Infinity);
      }
      if (dist2 < bestDist) {
        bestDist = dist2;
        bestRing = ring;
        bestFeature = feat;
      }
    }
  }
  // Accept if within ~30px at current resolution
  const resolution = map.getView().getResolution();
  const tolerance = resolution * resolution * 900;
  return bestDist < tolerance ? {ring: bestRing, feature: bestFeature} : null;
}

// ── Control point validation (arc endpoints + line vertices) ─

/**
 * Check if a coordinate is a control point on any source CurvePolygon ring.
 * Control points are: even-indexed coords on CircularStrings (arc endpoints),
 * or ANY vertex on LineStrings. For CompoundCurve rings, sub-geometries are
 * iterated. Uses bitwise equality (no epsilon).
 * @param {Array<number>} coord The coordinate to check.
 * @return {{ring: import('../src/ol/geom/Geometry.js').default, feature: import('../src/ol/Feature.js').default, index: number}|null} The ring, feature, and index, or null.
 */
function isSourceControlPoint(coord) {
  const matches = getSourceControlPointsAt(coord);
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Get all source control points at a coordinate.  Shared vertices can belong
 * to multiple feature rings, and cross-feature tracing needs both sides.
 * @param {Array<number>} coord The coordinate to check.
 * @return {Array<{ring: import('../src/ol/geom/Geometry.js').default, feature: import('../src/ol/Feature.js').default, index: number}>} Matching control points.
 */
function getSourceControlPointsAt(coord) {
  const features = source.getFeatures().filter((f) => !f.get('_snapPoint'));
  const matches = [];
  for (const feat of features) {
    const geom = feat.getGeometry();
    if (!geom) {
      continue;
    }
    const pts = getControlPoints(geom, {skipArcMidpoints: true});
    for (const pt of pts) {
      if (pt.coord[0] === coord[0] && pt.coord[1] === coord[1]) {
        matches.push({ring: pt.ring, feature: feat, index: pt.index});
      }
    }
  }
  return matches;
}

/**
 * Pick the source ring/segment for a trace start at a shared control point.
 * Several rings can touch at the same coordinate; source order alone is not
 * meaningful there. Use the outgoing trace hint and the requested segment
 * type as tie-breakers.
 * @param {Array<number>} coord Trace entry coordinate.
 * @param {Array<number>|undefined} hintCoord Coordinate in the outgoing trace direction.
 * @param {string} preferredType Preferred segment type ('arc' or 'line').
 * @return {{found: {ring: import('../src/ol/geom/Geometry.js').default, feature: import('../src/ol/Feature.js').default}|null, segmentInfo: {type: string, geometry: import('../src/ol/geom/Geometry.js').default|null}}}
 *   Chosen ring and segment info.
 */
function resolveTraceStartSource(coord, hintCoord, preferredType) {
  const matches = getSourceControlPointsAt(coord);
  let candidates = matches.map((match) => {
    const found = {ring: match.ring, feature: match.feature};
    const segmentInfo = getSourceSegmentInfo(found, coord, hintCoord);
    let hintDist = Infinity;
    if (hintCoord && segmentInfo.geometry) {
      const closest = [0, 0];
      hintDist = segmentInfo.geometry.closestPointXY(
        hintCoord[0],
        hintCoord[1],
        closest,
        Infinity,
      );
    }
    return {found, segmentInfo, hintDist};
  });

  if (candidates.length === 0) {
    const found = findSourceRing(coord);
    return {
      found,
      segmentInfo: getSourceSegmentInfo(found, coord, hintCoord),
    };
  }

  if (hintCoord) {
    const bestHintDist = Math.min(...candidates.map((c) => c.hintDist));
    candidates = candidates.filter((c) => c.hintDist <= bestHintDist + 1);
  }

  const preferred = candidates.find(
    (c) => c.segmentInfo.type === preferredType,
  );
  const chosen = preferred || candidates[0];
  return {found: chosen.found, segmentInfo: chosen.segmentInfo};
}

// ── Trace helpers ────────────────────────────────────────────

/**
 * Cache the tessellation midpoint for a traced arc (used for direction
 * disambiguation in extractSubArcByIndex). Must be called while sketch
 * coordinates are still valid (before closing point is appended).
 * @param {Object} tracedArc The traced arc metadata object.
 * @param {Array<Array<number>>} coords The current sketch coordinates.
 */
function cacheMidpoint(tracedArc, coords) {
  const start = tracedArc.traceStartIdx;
  const end = tracedArc.traceEndIdx;
  if (end > start + 1) {
    const mid = Math.floor((start + end) / 2);
    if (mid < coords.length) {
      tracedArc.traceMidpoint = coords[mid].slice();
    }
  }
}

/**
 * Find the source feature that owns a ring geometry.
 * @param {import('../src/ol/geom/Geometry.js').default} ring Source ring.
 * @return {import('../src/ol/Feature.js').default|null} Owning feature.
 */
function findFeatureForRing(ring) {
  const features = source.getFeatures().filter((f) => !f.get('_snapPoint'));
  for (const feature of features) {
    const geometry = feature.getGeometry();
    if (!geometry) {
      continue;
    }
    if (geometry === ring) {
      return feature;
    }
    if (geometry.getRingsArray && geometry.getRingsArray().includes(ring)) {
      return feature;
    }
  }
  return null;
}

/**
 * Validate a traced arc's entry/exit and populate ring metadata.
 * If entry and exit are on the same ring, sets ring/feature/indices directly.
 * If they are on different rings (cross-feature trace), splits the traced arc
 * into segments at shared vertices so each segment spans a single ring.
 * Sets chordFallback=true only if no valid ring mapping can be found.
 * @param {Object} tracedArc The traced arc metadata object.
 * @param {Array<Array<number>>} coords The full sketch coordinate array.
 */
function validateTraceExit(tracedArc, coords) {
  // Already handled as full-ring trace (set in handleTraceTransitions)
  if (tracedArc.fullRing) {
    return;
  }
  const entryMatches = getSourceControlPointsAt(tracedArc.entryCoord);
  const exitMatches = getSourceControlPointsAt(tracedArc.exitCoord);
  const entryResult =
    entryMatches.find((match) => match.ring === tracedArc.ring) ||
    entryMatches[0];
  const exitResult = exitMatches[0];
  if (!entryResult || !exitResult) {
    tracedArc.chordFallback = true;
    return;
  }

  const startIdx = tracedArc.traceStartIdx;
  const endIdx = tracedArc.traceEndIdx;
  if (startIdx < 0 || endIdx < 0 || !coords) {
    tracedArc.chordFallback = true;
    return;
  }

  function chooseNextMatch(matches, activeRing, fromIdx) {
    const candidates = matches.filter((match) => match.ring !== activeRing);
    if (candidates.length === 0) {
      return null;
    }
    for (const candidate of candidates) {
      for (let i = fromIdx + 1; i <= endIdx; i++) {
        const futureMatches = getSourceControlPointsAt(coords[i]);
        if (futureMatches.some((match) => match.ring === candidate.ring)) {
          return candidate;
        }
      }
    }
    return candidates[0];
  }

  const segments = [];
  let activeMatch = entryResult;
  let segmentStart = {
    coord: tracedArc.entryCoord,
    match: activeMatch,
    idx: startIdx,
  };

  for (let i = startIdx + 1; i < endIdx; i++) {
    const c = coords[i];
    const matches = getSourceControlPointsAt(c);
    const activeAtPoint = matches.find(
      (match) => match.ring === activeMatch.ring,
    );
    if (!activeAtPoint) {
      continue;
    }
    const nextMatch = chooseNextMatch(matches, activeMatch.ring, i);
    if (nextMatch) {
      segments.push({
        entryCoord: segmentStart.coord,
        exitCoord: c.slice(),
        ring: activeMatch.ring,
        sourceFeature: activeMatch.feature,
        entryRingIdx: segmentStart.match.index,
        exitRingIdx: activeAtPoint.index,
        traceStartIdx: segmentStart.idx,
        traceEndIdx: i,
      });
      activeMatch = nextMatch;
      segmentStart = {coord: c.slice(), match: nextMatch, idx: i};
    }
  }

  const exitMatch =
    exitMatches.find((match) => match.ring === activeMatch.ring) ||
    (segments.length === 0
      ? exitMatches.find((match) => match.ring === entryResult.ring)
      : null);
  if (!exitMatch) {
    tracedArc.chordFallback = true;
    return;
  }

  if (
    segments.length === 0 &&
    coordinateEquals(tracedArc.entryCoord, tracedArc.exitCoord)
  ) {
    tracedArc.chordFallback = true;
    return;
  }

  segments.push({
    entryCoord: segmentStart.coord,
    exitCoord: tracedArc.exitCoord,
    ring: activeMatch.ring,
    sourceFeature: activeMatch.feature,
    entryRingIdx: segmentStart.match.index,
    exitRingIdx: exitMatch.index,
    traceStartIdx: segmentStart.idx,
    traceEndIdx: endIdx,
  });

  const first = segments[0];
  tracedArc.entryCoord = first.entryCoord;
  tracedArc.exitCoord = first.exitCoord;
  tracedArc.ring = first.ring;
  tracedArc.sourceFeature = first.sourceFeature;
  tracedArc.entryRingIdx = first.entryRingIdx;
  tracedArc.exitRingIdx = first.exitRingIdx;
  tracedArc.traceStartIdx = first.traceStartIdx;
  tracedArc.traceEndIdx = first.traceEndIdx;
  tracedArc.chordFallback = false;
  cacheMidpoint(tracedArc, coords);

  const insertIdx = tracedArcs.indexOf(tracedArc);
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    const newArc = {
      entryCoord: segment.entryCoord,
      exitCoord: segment.exitCoord,
      ring: segment.ring,
      sourceFeature: segment.sourceFeature,
      entryRingIdx: segment.entryRingIdx,
      exitRingIdx: segment.exitRingIdx,
      entryBreakIndex: tracedArc.entryBreakIndex,
      traceStartIdx: segment.traceStartIdx,
      traceEndIdx: segment.traceEndIdx,
      traceMidpoint: null,
      chordFallback: false,
      forceLineTrace: !!tracedArc.forceLineTrace,
      fullRing: false,
    };
    cacheMidpoint(newArc, coords);
    tracedArcs.splice(insertIdx + i, 0, newArc);
  }
}

// ── Build sub-geometries from segment breaks ─────────────────

/**
 * Trim duplicate ring laps that have accumulated in the sketch coordinates.
 *
 * When tracing a closed ring, OL's `Draw` interaction faithfully appends
 * every coordinate the cursor traverses — so a cursor that wraps around
 * the ring 1.5 times produces a coordinate sequence containing the start
 * vertex twice with a full lap of tessellation in between. This is correct
 * Draw behavior, but topological polygons can only contain each ring vertex
 * once, so this example collapses the extra lap before building the preview.
 *
 * Walk the coordinate list, and whenever we encounter a coordinate that
 * exactly matches an earlier coordinate with more than one entry in
 * between, drop the intermediate copies. Adjust `segmentBreaks`
 * accordingly so `buildFromBreaks` stays consistent.
 *
 * @param {Array<Array<number>>} coords Sketch coordinates.
 * @param {Array<{index: number, type: string}>} breaks Segment breaks.
 * @return {{coords: Array<Array<number>>, breaks: Array<{index: number, type: string}>}}
 *     Trimmed coords and remapped breaks.
 */
function trimLapRepetitions(coords, breaks) {
  if (coords.length < 4) {
    return {coords, breaks};
  }
  // Lap collapse must only fire within the currently active traced arc.
  // Otherwise the live cursor (last coord, which follows the mouse) brushing
  // over any earlier vertex — or a free-draw point happening to coincide
  // with a committed trace vertex — looks like a "lap" and erases everything
  // between, even though the user is no longer tracing. Outside the active
  // arc we leave coordinates alone.
  const activeArc =
    traceActive &&
    wasTracing &&
    tracedArcs.length > 0 &&
    !tracedArcs[tracedArcs.length - 1].exitCoord
      ? tracedArcs[tracedArcs.length - 1]
      : null;
  const lapFloor = activeArc ? activeArc.traceStartIdx : Infinity;
  const indexMap = new Array(coords.length);
  const result = [];
  /** @type {Object<string, number>} */
  let seen = Object.create(null);
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i];
    const key = c[0] + ',' + c[1];
    const prev = seen[key];
    if (prev !== undefined && result.length - prev > 2 && prev >= lapFloor) {
      // The cursor (last coord) follows the mouse and naturally brushes the
      // trace-entry vertex once when the trace is about to close. That is a
      // single-lap closure, not a lap repetition — wiping the in-between
      // tessellation here would erase the live preview. Real lap repetitions
      // only manifest once a *committed* coordinate (anything before the
      // cursor) repeats the entry, which is the case `i < coords.length - 1`
      // covers. So always preserve the cursor.
      if (i === coords.length - 1) {
        result.push(c);
        indexMap[i] = result.length - 1;
        seen[key] = result.length - 1;
        continue;
      }
      // Lap detected: collapse everything in result after `prev`.
      result.length = prev + 1;
      // Remap any prior original indices that landed inside the dropped
      // range to the surviving anchor at `prev`.
      for (let j = 0; j < i; j++) {
        if (indexMap[j] > prev) {
          indexMap[j] = prev;
        }
      }
      // Rebuild `seen` from the surviving result so stale entries (those
      // pointing past `prev`) are dropped.
      seen = Object.create(null);
      for (let j = 0; j < result.length; j++) {
        const rc = result[j];
        seen[rc[0] + ',' + rc[1]] = j;
      }
      indexMap[i] = prev;
      continue;
    }
    result.push(c);
    indexMap[i] = result.length - 1;
    seen[key] = result.length - 1;
  }
  if (result.length === coords.length) {
    return {coords, breaks};
  }
  /** @type {Array<{index: number, type: string}>} */
  const newBreaks = [];
  for (const b of breaks) {
    const mapped =
      b.index < indexMap.length
        ? indexMap[b.index]
        : Math.max(0, result.length - 1);
    if (
      newBreaks.length > 0 &&
      newBreaks[newBreaks.length - 1].index === mapped
    ) {
      // Replace prior break at the same index — last writer wins so the
      // type that was authored later is kept.
      newBreaks[newBreaks.length - 1] = {index: mapped, type: b.type};
      continue;
    }
    newBreaks.push({index: mapped, type: b.type});
  }
  return {coords: result, breaks: newBreaks};
}

/**
 * Collapse consecutive duplicate coordinates in the preview copy.
 * @param {Array<Array<number>>} coords Preview coordinates.
 * @param {Array<{index: number, type: string}>} breaks Preview segment breaks.
 * @return {{coords: Array<Array<number>>, breaks: Array<{index: number, type: string}>}}
 *     Normalized coords and remapped breaks.
 */
function collapseConsecutivePreviewDuplicates(coords, breaks) {
  if (coords.length < 2) {
    return {coords, breaks};
  }
  const indexMap = new Array(coords.length);
  const result = [];
  let previous = null;
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i];
    if (previous && c[0] === previous[0] && c[1] === previous[1]) {
      indexMap[i] = result.length - 1;
      continue;
    }
    result.push(c);
    indexMap[i] = result.length - 1;
    previous = c;
  }
  if (result.length === coords.length) {
    return {coords, breaks};
  }
  const newBreaks = [];
  for (const b of breaks) {
    const mapped = indexMap[b.index];
    if (
      newBreaks.length > 0 &&
      newBreaks[newBreaks.length - 1].index === mapped
    ) {
      newBreaks[newBreaks.length - 1] = {index: mapped, type: b.type};
      continue;
    }
    newBreaks.push({index: mapped, type: b.type});
  }
  return {coords: result, breaks: newBreaks};
}

/**
 * Check if a coordinate is near the current drawing start coordinate.
 * @param {Array<number>} coord Coordinate.
 * @return {boolean} Coordinate is near the start coordinate.
 */
function isNearStartCoord(coord) {
  if (!startCoord || !coord) {
    return false;
  }
  const tolerance = map.getView().getResolution() * 0.5;
  return (
    Math.abs(coord[0] - startCoord[0]) < tolerance &&
    Math.abs(coord[1] - startCoord[1]) < tolerance
  );
}

/**
 * Get the preview segment info for a coordinate on a source ring.
 * @param {{ring: import('../src/ol/geom/Geometry.js').default, feature: import('../src/ol/Feature.js').default}|null} found The source ring match.
 * @param {Array<number>} coord Coordinate on or near the ring.
 * @param {Array<number>} [hintCoord] Optional next coord — disambiguates
 *     which sub-geom of a CompoundCurve ring the trace is heading along
 *     when `coord` lies on a shared corner.
 * @return {{type: string, geometry: import('../src/ol/geom/Geometry.js').default|null}}
 *     Segment type and closest source segment geometry.
 */
function getSourceSegmentInfo(found, coord, hintCoord) {
  if (!found || !found.ring) {
    return {type: 'line', geometry: null};
  }
  const ring = found.ring;
  const ringType = ring.getType();
  if (ringType !== 'CompoundCurve') {
    return {
      type: ringType === 'CircularString' ? 'arc' : 'line',
      geometry: ring,
    };
  }
  // Compound rings have multiple sub-geoms that meet at shared corners.
  // At an exact corner both sub-geoms have distance 0; when `coord` is at a
  // shared junction we use `hintCoord` (typically the next sketch coord,
  // indicating where the trace is heading) to pick the sub the trace will
  // actually follow.
  const subs = ring.getGeometriesArray();
  if (hintCoord) {
    const onJunction = subs.filter((sub) => {
      const cp = [0, 0];
      const d2 = sub.closestPointXY(coord[0], coord[1], cp, Infinity);
      return d2 < 1; // exact (squared) tolerance for control-point match
    });
    if (onJunction.length > 1) {
      let bestSub = null;
      let bestD2 = Infinity;
      for (const sub of onJunction) {
        const cp = [0, 0];
        const d2 = sub.closestPointXY(hintCoord[0], hintCoord[1], cp, Infinity);
        if (d2 < bestD2) {
          bestD2 = d2;
          bestSub = sub;
        }
      }
      if (bestSub) {
        return {
          type: bestSub.getType() === 'CircularString' ? 'arc' : 'line',
          geometry: bestSub,
        };
      }
    }
  }
  // Plain on-curve lookup via the public CompoundCurve primitive.
  // (Lower-index sub-segment wins at non-disambiguated junctions.)
  const seg = ring.getCurveSegmentAt(coord, 1);
  if (seg) {
    return {
      type: seg.getType() === 'CircularString' ? 'arc' : 'line',
      geometry: seg,
    };
  }
  // Coord not on the compound curve (snap edge case); fall back to nearest.
  let bestType = 'line';
  let bestGeometry = null;
  let bestDist = Infinity;
  for (const sub of subs) {
    const closest = [0, 0];
    const dist2 = sub.closestPointXY(coord[0], coord[1], closest, Infinity);
    if (dist2 < bestDist) {
      bestDist = dist2;
      bestType = sub.getType() === 'CircularString' ? 'arc' : 'line';
      bestGeometry = sub;
    }
  }
  return {type: bestType, geometry: bestGeometry};
}

/**
 * @param {import('../src/ol/geom/Geometry.js').default} geometry Trace source geometry.
 * @return {Array<Array<number>>} Trace target coordinates used by Draw.
 */
function getTraceTargetCoordinates(geometry) {
  if (!geometry) {
    return [];
  }
  if (geometry.tessellate) {
    const flat = geometry.tessellate();
    const coords = [];
    for (let i = 0; i < flat.length; i += 2) {
      coords.push([flat[i], flat[i + 1]]);
    }
    return coords;
  }
  return geometry.getCoordinates ? geometry.getCoordinates() : [];
}

/**
 * @param {Array<Array<number>>} coords Trace target coordinates.
 * @param {number} index Possibly wrapped/fractional trace index.
 * @return {Array<number>|null} Interpolated coordinate.
 */
function interpolateTraceCoordinate(coords, index) {
  const count = coords.length;
  if (count === 0 || index === undefined) {
    return null;
  }
  let startIndex = Math.floor(index);
  const along = index - startIndex;
  startIndex %= count;
  if (startIndex < 0) {
    startIndex += count;
  }
  let endIndex = startIndex + 1;
  if (endIndex >= count) {
    endIndex -= count;
  }
  const start = coords[startIndex];
  const end = coords[endIndex];
  return [
    start[0] + (end[0] - start[0]) * along,
    start[1] + (end[1] - start[1]) * along,
  ];
}

/**
 * Derive a coordinate just inside the traced direction from Draw's wrapped
 * trace indices. This disambiguates CompoundCurve junctions where the entry
 * coordinate belongs to both an arc and a line segment.
 * @param {import('../src/ol/geom/Geometry.js').default} geometry Trace source geometry.
 * @param {number|undefined} startIndex Trace start index.
 * @param {number|undefined} endIndex Trace end index.
 * @param {Array<number>} entryCoord Trace entry coordinate.
 * @return {Array<number>|undefined} Hint coordinate along the actual trace.
 */
function getTraceDirectionHint(geometry, startIndex, endIndex, entryCoord) {
  if (startIndex === undefined || endIndex === undefined) {
    return undefined;
  }
  const coords = getTraceTargetCoordinates(geometry);
  if (coords.length === 0) {
    return undefined;
  }
  const direction = endIndex < startIndex ? -1 : 1;
  for (let step = 1; step < Math.min(coords.length, 8); step++) {
    const hint = interpolateTraceCoordinate(
      coords,
      startIndex + direction * step,
    );
    if (hint && !coordinateEquals(hint, entryCoord)) {
      return hint;
    }
  }
  return undefined;
}

/**
 * Check whether an active trace segment can introduce curve tessellation
 * artifacts into the live self-intersection test.
 * @param {Object} tracedArc Active trace metadata.
 * @return {boolean} The active trace uses curved source geometry.
 */
function activeTraceHasCurve(tracedArc) {
  if (!tracedArc) {
    return false;
  }
  const sourceSegment = tracedArc.sourceSegment;
  if (sourceSegment) {
    if (sourceSegment.getType() === 'CircularString') {
      return true;
    }
    if (sourceSegment.getType() === 'CompoundCurve') {
      return sourceSegment
        .getGeometriesArray()
        .some((sub) => sub.getType() === 'CircularString');
    }
    return false;
  }
  const entryBreak = segmentBreaks[tracedArc.entryBreakIndex];
  if (entryBreak) {
    return entryBreak.type === 'arc';
  }
  const ring = tracedArc.ring;
  return !!ring && ring.getType() === 'CircularString';
}

/**
 * Add preview-only breaks when traced coordinates move onto another source
 * sub-geometry.  This does not mutate `segmentBreaks` or `tracedArcs`.
 * @param {Array<Array<number>>} coords Preview coordinates.
 * @param {Array<{index: number, type: string}>} breaks Preview segment breaks.
 * @return {Array<{index: number, type: string}>} Breaks for preview rendering.
 */
function addPreviewSourceSegmentBreaks(coords, breaks) {
  if (tracedArcs.length === 0 || coords.length < 3) {
    return breaks;
  }
  const active = tracedArcs[tracedArcs.length - 1];
  // `active.traceStartIdx` was recorded against the *original* sketch coords;
  // by the time we get here those coords have been trimmed of lap repetitions
  // and consecutive duplicates. Locate the entry coord in the collapsed
  // coordinate frame so we walk from the correct position.
  let startIdx = -1;
  if (active.entryCoord) {
    for (let i = 0; i < coords.length; i++) {
      if (
        coords[i][0] === active.entryCoord[0] &&
        coords[i][1] === active.entryCoord[1]
      ) {
        startIdx = i;
        break;
      }
    }
  }
  if (startIdx < 0) {
    startIdx = Math.max(0, Math.min(active.traceStartIdx, coords.length - 1));
  }
  if (startIdx >= coords.length - 1) {
    return breaks;
  }

  const result = breaks.slice();
  const startFound = findSourceRing(coords[startIdx]);
  // Hint: the next collapsed coord disambiguates the sub-geom at a corner.
  const hint = coords[startIdx + 1];
  let activeInfo = getSourceSegmentInfo(startFound, coords[startIdx], hint);
  if (!activeInfo.geometry && active.sourceSegment) {
    activeInfo = {
      type:
        active.sourceSegment.getType() === 'CircularString' ? 'arc' : 'line',
      geometry: active.sourceSegment,
    };
  }
  if (!activeInfo.geometry) {
    return result;
  }

  if (active.forceLineTrace) {
    return result;
  }

  // If the resolved active sub differs from the type segmentBreaks recorded
  // for this trace's entry break, override that entry break in the preview
  // copy so the very first segment of the trace renders correctly.
  if (active.entryBreakIndex >= 0 && active.entryBreakIndex < result.length) {
    const entryBreak = result[active.entryBreakIndex];
    if (entryBreak && entryBreak.type !== activeInfo.type) {
      result[active.entryBreakIndex] = {
        index: entryBreak.index,
        type: activeInfo.type,
      };
    }
  }

  for (let i = startIdx + 1; i < coords.length; i++) {
    const c = coords[i];
    if (coordIsOnRing(activeInfo.geometry, c)) {
      continue;
    }
    const found = findSourceRing(c);
    if (!found) {
      continue;
    }
    const nextInfo = getSourceSegmentInfo(found, c);
    if (!nextInfo.geometry || nextInfo.geometry === activeInfo.geometry) {
      continue;
    }
    if (nextInfo.type === activeInfo.type) {
      activeInfo = nextInfo;
      continue;
    }
    const splitIndex = i - 1;
    if (result.length > 0 && result[result.length - 1].index === splitIndex) {
      result[result.length - 1] = {index: splitIndex, type: nextInfo.type};
    } else {
      result.push({index: splitIndex, type: nextInfo.type});
    }
    activeInfo = nextInfo;
  }
  return normalizeSegmentBreaks(result);
}

/**
 * Sort segment breaks and collapse duplicate break indices.
 * Later entries win for the same index, so preview-generated breaks can
 * override stale persistent break types at that coordinate.
 * @param {Array<{index: number, type: string}>} breaks Segment breaks.
 * @return {Array<{index: number, type: string}>} Normalized breaks.
 */
function normalizeSegmentBreaks(breaks) {
  return breaks
    .map((breakInfo, order) => ({
      index: breakInfo.index,
      type: breakInfo.type,
      order: order,
    }))
    .sort((a, b) => a.index - b.index || a.order - b.order)
    .reduce((result, breakInfo) => {
      const last = result[result.length - 1];
      if (last && last.index === breakInfo.index) {
        last.type = breakInfo.type;
      } else {
        result.push({index: breakInfo.index, type: breakInfo.type});
      }
      return result;
    }, []);
}

/**
 * Core geometry builder: iterate breaks, slice coords, produce geometries.
 * @param {Array<Array<number>>} coords Coordinate array.
 * @param {Array<{index: number, type: string}>} breaks Segment break descriptors.
 * @return {Array<import('../src/ol/geom/SimpleGeometry.js').default>} Sub-geometries.
 */
function buildFromBreaks(coords, breaks) {
  const geoms = [];
  const normalizedBreaks = normalizeSegmentBreaks(breaks);
  for (let i = 0; i < normalizedBreaks.length; i++) {
    const {index, type} = normalizedBreaks[i];
    const end =
      i + 1 < normalizedBreaks.length
        ? normalizedBreaks[i + 1].index + 1
        : coords.length;
    const seg = coords.slice(index, end);
    if (seg.length < 2) {
      continue;
    }
    const geom = coordinatesToCurveGeometry(seg, type);
    if (geom.getType() === 'CompoundCurve') {
      geoms.push(...geom.getGeometriesArray());
    } else {
      geoms.push(geom);
    }
  }
  return geoms;
}

// ── Extract sub-arc by index from a source ring ─────────────

/**
 * Extract a CircularString sub-arc from a ring using entry/exit indices.
 * Uses traceMidpoint for direction disambiguation.
 * Returns null if validation fails (defense-in-depth; Phase 2 is load-bearing).
 *
 * @param {import('../src/ol/geom/CircularString.js').default} ring The source ring.
 * @param {Array<number>} entryCoord The entry coordinate.
 * @param {Array<number>} exitCoord The exit coordinate.
 * @param {Array<number>} [traceMidpoint] Midpoint of tessellated trace for direction.
 * @return {import('../src/ol/geom/CircularString.js').default|null} Extracted sub-arc or null.
 */
function extractSubArcByIndex(ring, entryCoord, exitCoord, traceMidpoint) {
  // Find entry (first match) and exit (last match to handle closing dup)
  const entryIdx = ring.findArcEndpointIndex(entryCoord, false);
  const exitIdx = ring.findArcEndpointIndex(exitCoord, true);

  // Defensive validation
  if (entryIdx < 0 || exitIdx < 0) {
    return null;
  }
  if (entryIdx === exitIdx) {
    return null;
  }
  if (
    coordinateEquals(
      ring.getCoordinates()[entryIdx],
      ring.getCoordinates()[exitIdx],
    )
  ) {
    return null; // same point via closing dup
  }

  const candidateA = ring.subArc(entryIdx, exitIdx);
  const candidateB = new CircularString(
    ring.subArc(exitIdx, entryIdx).getCoordinates().slice().reverse(),
  );

  const coordsA = candidateA.getCoordinates();
  const coordsB = candidateB.getCoordinates();

  // Handle degenerate cases
  if (coordsA.length < 3 && coordsB.length < 3) {
    return null;
  }
  if (coordsA.length < 3) {
    return candidateB;
  }
  if (coordsB.length < 3) {
    return candidateA;
  }

  // Direction: compare tessellation midpoints to traceMidpoint
  if (!traceMidpoint) {
    return candidateA;
  }

  const tessA = candidateA.tessellate();
  const tessB = candidateB.tessellate();

  const midAIdx = Math.floor(tessA.length / 4) * 2;
  const midBIdx = Math.floor(tessB.length / 4) * 2;
  const midA = [tessA[midAIdx], tessA[midAIdx + 1]];
  const midB = [tessB[midBIdx], tessB[midBIdx + 1]];

  const dxA = midA[0] - traceMidpoint[0];
  const dyA = midA[1] - traceMidpoint[1];
  const distA = dxA * dxA + dyA * dyA;

  const dxB = midB[0] - traceMidpoint[0];
  const dyB = midB[1] - traceMidpoint[1];
  const distB = dxB * dxB + dyB * dyB;

  return distA <= distB ? candidateA : candidateB;
}

/**
 * Reverse an array of geometries so they flow in the opposite direction.
 * Reverses the array order and reverses each geometry's coordinates.
 * @param {Array<import('../src/ol/geom/SimpleGeometry.js').default>} geoms The geometries to reverse.
 * @return {Array<import('../src/ol/geom/SimpleGeometry.js').default>} Reversed geometries.
 */
function reverseGeometries(geoms) {
  const result = [];
  for (let i = geoms.length - 1; i >= 0; i--) {
    const g = geoms[i];
    const coords = g.getCoordinates().slice().reverse();
    if (g.getType() === 'CircularString') {
      result.push(new CircularString(coords));
    } else {
      result.push(new LineString(coords));
    }
  }
  return result;
}

/**
 * Extract a traced line portion directly from the selected source segment.
 * @param {import('../src/ol/geom/Geometry.js').default|null} segment Source segment.
 * @param {Array<number>} entryCoord Trace entry coordinate.
 * @param {Array<number>} exitCoord Trace exit coordinate.
 * @return {import('../src/ol/geom/LineString.js').default|null} Extracted line.
 */
function extractLineFromSourceSegment(segment, entryCoord, exitCoord) {
  if (!segment || segment.getType() !== 'LineString') {
    return null;
  }
  const coords = segment.getCoordinates();
  let entryIdx = -1;
  let exitIdx = -1;
  for (let i = 0; i < coords.length; i++) {
    if (entryIdx < 0 && coordinateEquals(coords[i], entryCoord)) {
      entryIdx = i;
    }
    if (coordinateEquals(coords[i], exitCoord)) {
      exitIdx = i;
    }
  }
  if (entryIdx < 0 || exitIdx < 0 || entryIdx === exitIdx) {
    return null;
  }
  const slice =
    entryIdx < exitIdx
      ? coords.slice(entryIdx, exitIdx + 1)
      : coords.slice(exitIdx, entryIdx + 1).reverse();
  return slice.length >= 2 ? new LineString(slice) : null;
}

/**
 * Extract a sub-path from a CompoundCurve ring between entry and exit coords.
 * Iterates sub-geometries, slices at entry/exit, returns array of geometries.
 * Uses traceMidpoint for direction disambiguation (forward vs reverse).
 * @param {import('../src/ol/geom/CompoundCurve.js').default} ring The CompoundCurve ring.
 * @param {Array<number>} entryCoord The entry coordinate.
 * @param {Array<number>} exitCoord The exit coordinate.
 * @param {Array<number>} [traceMidpoint] Midpoint for direction.
 * @return {Array<import('../src/ol/geom/SimpleGeometry.js').default>|null} Extracted geometries or null.
 */
function extractSubPathFromCompoundCurve(
  ring,
  entryCoord,
  exitCoord,
  traceMidpoint,
) {
  const subs = ring.getGeometriesArray();
  // Build a flat list of control points with sub-geometry + local index refs
  const controlPoints = [];
  for (let s = 0; s < subs.length; s++) {
    const sub = subs[s];
    const coords = sub.getCoordinates();
    const subType = sub.getType();
    for (let i = 0; i < coords.length; i++) {
      const isControl = subType === 'LineString' || i % 2 === 0;
      if (!isControl) {
        continue;
      }
      // Skip duplicate junction points (shared between adjacent sub-geoms)
      if (
        controlPoints.length > 0 &&
        coordinateEquals(
          controlPoints[controlPoints.length - 1].coord,
          coords[i],
        )
      ) {
        continue;
      }
      controlPoints.push({coord: coords[i], subIdx: s, localIdx: i});
    }
  }

  // Find entry and exit in the control point list
  let entryCP = -1;
  let exitCP = -1;
  const n = controlPoints.length;
  const isClosed =
    n > 1 &&
    coordinateEquals(controlPoints[0].coord, controlPoints[n - 1].coord);

  for (let i = 0; i < controlPoints.length; i++) {
    if (coordinateEquals(controlPoints[i].coord, entryCoord)) {
      if (entryCP < 0) {
        entryCP = i;
      }
    }
    if (coordinateEquals(controlPoints[i].coord, exitCoord)) {
      exitCP = i; // last match
    }
  }
  // For closed rings, the last control point == first; normalize to index 0
  if (isClosed && entryCP === n - 1) {
    entryCP = 0;
  }
  if (isClosed && exitCP === n - 1) {
    exitCP = 0;
  }
  if (entryCP < 0 || exitCP < 0 || entryCP === exitCP) {
    return null;
  }

  // Build two candidate paths (forward and reverse around the ring)
  const wrapN = isClosed ? n - 1 : n;
  function buildPath(from, to) {
    const path = [];
    let idx = from;
    while (true) {
      path.push(controlPoints[idx]);
      if (idx === to) {
        break;
      }
      idx = (idx + 1) % wrapN;
      if (path.length > wrapN) {
        break; // safety
      }
    }
    return path;
  }

  const pathA = buildPath(entryCP, exitCP);
  const pathB = buildPath(exitCP, entryCP);

  // Convert a path of control points back to geometries
  function pathToGeometries(path) {
    if (path.length < 2) {
      return [];
    }
    const geoms = [];
    let i = 0;
    while (i < path.length - 1) {
      const startSub = path[i].subIdx;
      const sub = subs[startSub];
      const subType = sub.getType();
      const subCoords = sub.getCoordinates();
      // Collect consecutive points from the same sub-geometry
      let j = i + 1;
      while (j < path.length && path[j].subIdx === startSub) {
        j++;
      }
      // Determine extraction end: if crossing to another sub, extend to end
      // of current sub (to include the full tail up to the junction)
      const isCrossing = j < path.length;
      const endLocal = isCrossing ? subCoords.length - 1 : path[j - 1].localIdx;
      const startLocal = path[i].localIdx;
      if (subType === 'CircularString') {
        const slice = subCoords.slice(startLocal, endLocal + 1);
        if (slice.length >= 3) {
          geoms.push(new CircularString(slice));
        } else if (slice.length === 2) {
          geoms.push(new LineString(slice));
        }
      } else {
        const slice = subCoords.slice(startLocal, endLocal + 1);
        if (slice.length >= 2) {
          geoms.push(new LineString(slice));
        }
      }
      if (isCrossing) {
        const nextSubIdx = path[j].subIdx;
        // Add any intermediate sub-geometries that are fully traversed
        let s = (startSub + 1) % subs.length;
        while (s !== nextSubIdx) {
          const midSub = subs[s];
          const midCoords = midSub.getCoordinates();
          if (midSub.getType() === 'CircularString' && midCoords.length >= 3) {
            geoms.push(new CircularString(midCoords));
          } else if (midCoords.length >= 2) {
            geoms.push(new LineString(midCoords));
          }
          s = (s + 1) % subs.length;
        }
        // Extract head of next sub from start to first path point on it
        if (path[j].localIdx > 0) {
          const nextSub = subs[nextSubIdx];
          const nextSubCoords = nextSub.getCoordinates();
          const headSlice = nextSubCoords.slice(0, path[j].localIdx + 1);
          if (nextSub.getType() === 'CircularString' && headSlice.length >= 3) {
            geoms.push(new CircularString(headSlice));
          } else if (headSlice.length >= 2) {
            geoms.push(new LineString(headSlice));
          }
        }
      }
      i = j; // advance to first point on next sub (or past end)
    }
    return geoms;
  }

  const geomsA = pathToGeometries(pathA);
  const geomsB = pathToGeometries(pathB);

  if (geomsA.length === 0 && geomsB.length === 0) {
    return null;
  }
  if (geomsA.length === 0) {
    return reverseGeometries(geomsB);
  }
  if (geomsB.length === 0) {
    return geomsA;
  }

  // Direction disambiguation using traceMidpoint when available. When the
  // user's trace is so short that no midpoint was cached (e.g. entry and
  // exit are adjacent control points reached in a single hover step), fall
  // back to "shortest path along the ring" — going the long way around
  // produces nonsensical geometry that overlaps the entire source feature.
  if (!traceMidpoint) {
    if (pathA.length <= pathB.length) {
      return geomsA;
    }
    return reverseGeometries(geomsB);
  }

  // Use the control point paths (not produced geometries) for a representative
  // midpoint — the bridge geometries from boundary crossings can skew results.
  const midA = pathA[Math.floor(pathA.length / 2)].coord;
  const midB = pathB[Math.floor(pathB.length / 2)].coord;
  const dxA = midA[0] - traceMidpoint[0];
  const dyA = midA[1] - traceMidpoint[1];
  const dxB = midB[0] - traceMidpoint[0];
  const dyB = midB[1] - traceMidpoint[1];
  // pathA goes entry→exit (correct direction), pathB goes exit→entry (needs reversal)
  return dxA * dxA + dyA * dyA <= dxB * dxB + dyB * dyB
    ? geomsA
    : reverseGeometries(geomsB);
}

// ── Build final geometry using tracedArcs metadata ───────────

/**
 * Build sub-geometries for a non-traced coordinate slice,
 * using segment breaks that fall within the absolute range.
 * @param {Array<Array<number>>} sliceCoords The slice coordinates.
 * @param {number} absoluteStart The absolute start index.
 * @return {Array<import('../src/ol/geom/SimpleGeometry.js').default>} Sub-geometries.
 */
function buildSubGeometriesForSlice(sliceCoords, absoluteStart) {
  let activeType = 'arc';
  for (const brk of segmentBreaks) {
    if (brk.index <= absoluteStart) {
      activeType = brk.type;
    }
  }
  // Skip 'line' breaks that are traced-arc entries (handled by extractSubArcByIndex)
  const tracedBreakIndices = new Set(
    tracedArcs.map((ta) => ta.entryBreakIndex),
  );

  const rangeBreaks = [{index: 0, type: activeType}];
  const absoluteEnd = absoluteStart + sliceCoords.length - 1;
  for (let bi = 0; bi < segmentBreaks.length; bi++) {
    const brk = segmentBreaks[bi];
    if (brk.index > absoluteStart && brk.index <= absoluteEnd) {
      if (tracedBreakIndices.has(bi)) {
        continue;
      }
      rangeBreaks.push({index: brk.index - absoluteStart, type: brk.type});
    }
  }

  return buildFromBreaks(sliceCoords, rangeBreaks);
}

/**
 * Build the final sub-geometries for a ring/curve, replacing traced
 * portions with actual arc sub-geometries from source rings.
 * Non-traced portions use segment breaks for arcs/lines from user clicks.
 * @param {Array<Array<number>>} coords The full coordinate array.
 * @return {Array<import('../src/ol/geom/SimpleGeometry.js').default>} Sub-geometries.
 */
function buildFinalGeometries(coords) {
  if (tracedArcs.length === 0) {
    return buildFromBreaks(coords, segmentBreaks);
  }

  const result = [];
  let pos = 0;

  for (let tIdx = 0; tIdx < tracedArcs.length; tIdx++) {
    const ta = tracedArcs[tIdx];
    if (!ta.entryCoord || !ta.exitCoord) {
      continue;
    }

    // The entry point in the sketch coordinate array
    const entryIdx =
      ta.traceStartIdx >= 0
        ? ta.traceStartIdx
        : segmentBreaks[ta.entryBreakIndex]
          ? segmentBreaks[ta.entryBreakIndex].index
          : 0;

    // Non-traced portion before this traced arc
    if (entryIdx > pos) {
      const slice = coords.slice(pos, entryIdx + 1);
      if (slice.length >= 2) {
        result.push(...buildSubGeometriesForSlice(slice, pos));
      }
    }

    // Determine the next break after trace
    const nextBreakIdx = ta.entryBreakIndex + 1;

    if (ta.forceLineTrace || ta.chordFallback || !ta.ring) {
      // Source-ring extraction failed (off-feature exit, multi-feature trace,
      // or unmappable indices). Preserve the user's actual cursor path from
      // the sketch coordinates instead of collapsing it to a misleading
      // straight chord. This keeps the polygon faithful to what was drawn.
      const traceEnd =
        ta.traceEndIdx >= 0 && ta.traceEndIdx < coords.length
          ? ta.traceEndIdx
          : -1;
      let pathCoords = null;
      if (traceEnd > entryIdx) {
        pathCoords = coords.slice(entryIdx, traceEnd + 1);
        // De-duplicate adjacent identical points the tracer may have emitted.
        const deduped = [pathCoords[0]];
        for (let i = 1; i < pathCoords.length; i++) {
          if (!coordinateEquals(pathCoords[i], deduped[deduped.length - 1])) {
            deduped.push(pathCoords[i]);
          }
        }
        pathCoords = deduped;
      }
      if (pathCoords && pathCoords.length >= 2) {
        result.push(new LineString(pathCoords));
      } else {
        result.push(new LineString([ta.entryCoord, ta.exitCoord]));
      }
    } else if (ta.fullRing) {
      // Full ring trace (interior hole): use the entire ring as-is
      const ringType = ta.ring.getType();
      if (ringType === 'CompoundCurve') {
        const subs = ta.ring.getGeometriesArray();
        for (const sub of subs) {
          result.push(sub.clone());
        }
      } else {
        result.push(ta.ring.clone());
      }
      // Add closing segment from entry back to polygon start, skip junk coords
      const startOfRing = coords[0];
      if (!coordinateEquals(ta.entryCoord, startOfRing) && coords.length >= 2) {
        result.push(new LineString([ta.entryCoord, startOfRing]));
      }
      // Skip all remaining coords (junk from direction flip + closing coord)
      pos = coords.length;
      continue;
    } else if (ta.ring.getType() === 'CompoundCurve') {
      // CompoundCurve ring: extract sub-path spanning mixed geometry types
      const lineSegment = extractLineFromSourceSegment(
        ta.sourceSegment || null,
        ta.entryCoord,
        ta.exitCoord,
      );
      const extracted = lineSegment
        ? [lineSegment]
        : extractSubPathFromCompoundCurve(
            ta.ring,
            ta.entryCoord,
            ta.exitCoord,
            ta.traceMidpoint || null,
          );
      if (extracted && extracted.length > 0) {
        result.push(...extracted);
      } else {
        result.push(new LineString([ta.entryCoord, ta.exitCoord]));
      }
    } else {
      // CircularString ring: extract sub-arc by index
      const extracted = extractSubArcByIndex(
        ta.ring,
        ta.entryCoord,
        ta.exitCoord,
        ta.traceMidpoint || null,
      );

      if (extracted) {
        result.push(extracted);
      } else {
        // Defense-in-depth: extraction failed → chord fallback
        result.push(new LineString([ta.entryCoord, ta.exitCoord]));
      }
    }

    // Move past the traced portion.
    // For split cross-feature traces, consecutive segments handle their own
    // positioning via traceStartIdx. Use traceEndIdx when available.
    if (ta.traceEndIdx >= 0) {
      pos = ta.traceEndIdx;
    } else if (nextBreakIdx < segmentBreaks.length) {
      pos = segmentBreaks[nextBreakIdx].index;
    } else {
      pos = coords.length - 1;
    }

    // If the next traced arc starts at the same position (split trace),
    // skip the "non-traced portion" logic by not advancing pos further.
  }

  // Non-traced portion after last traced arc
  if (pos < coords.length - 1) {
    const slice = coords.slice(pos);
    if (slice.length >= 2) {
      result.push(...buildSubGeometriesForSlice(slice, pos));
    }
  }

  return result;
}

function updatePointStatus(totalCoords) {
  const m = typeSelect.value;
  if (m !== 'CompoundCurve' && m !== 'CurvePolygon') {
    return;
  }
  const n = committedInSegment(totalCoords);
  const canClose = m === 'CurvePolygon' && totalCoords >= 4;
  const canToggle = currentSegType === 'arc' ? n >= 3 && n % 2 === 1 : n >= 2;
  const tips =
    (canToggle ? ' T=toggle.' : '') +
    (canClose ? ' Click start to close.' : '');

  if (currentSegType === 'arc') {
    if (n <= 1) {
      status('Next: arc curvature point.' + tips);
    } else if (n % 2 === 0) {
      status('Arc preview. Next: through-point.' + tips);
    } else {
      status('Arc committed. Next: curvature point.' + tips);
    }
  } else {
    status('LINE segment, ' + n + ' pts.' + tips);
  }
}

// ── Crossing condition (advisory only — never blocks) ────────

/**
 * Advisory crossing check. Shows red/green status but always
 * returns true so the user is never blocked from placing points.
 * @param {import('../src/ol/MapBrowserEvent.js').default} event The map browser event.
 * @return {boolean} Always true (advisory only).
 */
function checkCrossingCondition(event) {
  if (!noModifierKeys(event)) {
    return false;
  }
  recordDebugEvent('condition', {
    coordinate: roundCoord(event.coordinate),
    sourceControl: !!isSourceControlPoint(event.coordinate),
  });
  if (!draw || !drawing) {
    return true;
  }

  // During trace: BLOCK clicks unless at a valid control point.
  // The trace itself flows continuously (OL handles edge-following);
  // this only gates vertex-adding clicks to ensure valid exit points.
  // Use wasTracing as well to cover the case where traceActive is
  // momentarily false during a cross-feature transition.
  const tracing = traceActive || wasTracing;
  if (tracing) {
    const cpMatches = getSourceControlPointsAt(event.coordinate);
    if (cpMatches.length === 0) {
      setTopoStatus(
        false,
        'Must click a control point (large dot) to exit trace',
      );
      return false;
    }
    // The control point must belong to the entry ring (when known).
    // Otherwise the user could "exit" by clicking a control point of a
    // different feature that happens to lie under the cursor — that is
    // a cross-feature hop, which is not allowed.
    if (
      activeTraceEntry &&
      activeTraceEntry.ring &&
      !cpMatches.some((m) => m.ring === activeTraceEntry.ring)
    ) {
      setTopoStatus(
        false,
        'Must click a control point of the traced feature to exit trace',
      );
      return false;
    }
  }
  // During trace: also reject clicks whose coord lies on a different ring
  // of the entry feature than the one being traced (e.g. an inner-ring
  // control point while tracing the outer ring). Inner rings are
  // unreachable from the outer ring during a trace.
  if (tracing && activeTraceEntry && activeTraceEntry.ring) {
    const entryRing = activeTraceEntry.ring;
    const entryFeature = activeTraceEntry.feature;
    const fgeom = entryFeature.getGeometry();
    const otherRings =
      fgeom && fgeom.getRingsArray
        ? fgeom.getRingsArray().filter((r) => r !== entryRing)
        : [];
    if (otherRings.length > 0) {
      const ringDist2 = (ring, c) => {
        if (ring.getType() === 'CompoundCurve') {
          let d2 = Infinity;
          for (const sub of ring.getGeometriesArray()) {
            const cp = [0, 0];
            d2 = Math.min(d2, sub.closestPointXY(c[0], c[1], cp, Infinity));
          }
          return d2;
        }
        const cp = [0, 0];
        return ring.closestPointXY(c[0], c[1], cp, Infinity);
      };
      const dEntry2 = ringDist2(entryRing, event.coordinate);
      for (const r of otherRings) {
        if (ringDist2(r, event.coordinate) < dEntry2) {
          setTopoStatus(
            false,
            'Cannot end trace on a different ring of the same feature',
          );
          return false;
        }
      }
    }
  }
  if (tracing && wasTracing) {
    userClickedDuringTrace = true;
    // Capture the user's actual click coord BEFORE OL's `updateTrace_`
    // snaps `event.coordinate` to an interpolated tessellation coord.
    // `handleTraceTransitions` uses this to find the real exit-click index
    // in the sketch buffer.
    userClickedExitCoord = event.coordinate.slice();
  }

  // During trace: detect full-ring close on interior rings (holes).
  // When the user clicks back on the entry point of the current trace
  // and the ring is a hole, flag it for handleTraceTransitions to process.
  if (tracing && wasTracing && tracedArcs.length > 0) {
    const lastTraced = tracedArcs[tracedArcs.length - 1];
    if (
      !lastTraced.exitCoord &&
      lastTraced.ring &&
      lastTraced.sourceFeature &&
      coordinateEquals(event.coordinate, lastTraced.entryCoord)
    ) {
      const geom = lastTraced.sourceFeature.getGeometry();
      const rings = geom.getRingsArray();
      if (rings.indexOf(lastTraced.ring) > 0) {
        pendingFullRingClose = true;
      }
    }
  }

  // About to START trace: if pointer is on a source feature but NOT on a
  // control point, block. This prevents trace entry at tessellation samples.
  // Only applies in trace-capable draw modes (CurvePolygon / CompoundCurve).
  if (!tracing && drawing) {
    const isOnControlPoint = !!isSourceControlPoint(event.coordinate);
    if (!isOnControlPoint) {
      // Check if pointer is near a source feature (would trigger trace)
      const res = map.getView().getResolution();
      const tolerance = res * 30; // match traceSnap pixelTolerance
      const features = source.getFeatures().filter((f) => !f.get('_snapPoint'));
      for (const f of features) {
        const geom = f.getGeometry();
        if (geom && geom.intersectsExtent) {
          const ext = [
            event.coordinate[0] - tolerance,
            event.coordinate[1] - tolerance,
            event.coordinate[0] + tolerance,
            event.coordinate[1] + tolerance,
          ];
          if (geom.intersectsExtent(ext)) {
            setTopoStatus(
              false,
              'Must click a control point (large dot) to start trace',
            );
            return false;
          }
        }
      }
    }
  }

  const feat = draw.getOverlay().getSource().getFeatures()[0];
  if (!feat) {
    return true;
  }
  const coords = feat.getGeometry().getCoordinates();
  if (coords.length < 2) {
    return true;
  }

  const candidate = event.coordinate;
  const lastPt = coords[coords.length - 2];
  const newSeg = [lastPt[0], lastPt[1], candidate[0], candidate[1]];

  // Check against existing features
  const features = source.getFeatures().filter((f) => !f.get('_snapPoint'));
  for (const f of features) {
    const existing = getTessellatedFlatCoords(f.getGeometry());
    if (!existing) {
      continue;
    }
    if (
      isVertexInFlat(lastPt, existing.coords, existing.ends[0]) &&
      isVertexInFlat(candidate, existing.coords, existing.ends[0])
    ) {
      continue;
    }
    const crossing = getSegmentsCrossingPoint(
      newSeg,
      0,
      4,
      existing.coords,
      0,
      existing.ends[0],
      2,
    );
    if (crossing) {
      setTopoStatus(false, 'Crosses existing feature');
      return true; // advisory — don't block
    }
  }

  // Self-intersection check (skip if tracing involved)
  if (!wasTracing && tracedArcs.length === 0) {
    const sketchFlat = [];
    for (let i = 0; i < coords.length - 1; i++) {
      sketchFlat.push(coords[i][0], coords[i][1]);
    }
    const checkEnd = sketchFlat.length - 2;
    if (checkEnd >= 4) {
      const crossing = getSegmentsCrossingPoint(
        newSeg,
        0,
        4,
        sketchFlat,
        0,
        checkEnd,
        2,
      );
      if (crossing) {
        setTopoStatus(false, 'Self-intersecting');
        return true; // advisory — don't block
      }
    }
  }

  setTopoStatus(true, '');
  return true;
}

// ── Finalize geometry on drawend ─────────────────────────────

function finalizeGeometry(feature) {
  const geom = feature.getGeometry();
  const mode = typeSelect.value;
  let coords = geom.getCoordinates();
  if (mode === 'CurvePolygon' && lastSketchCoordinates.length > 0) {
    coords = lastSketchCoordinates.map((coord) => coord.slice());
  }

  if (mode === 'CircularString') {
    if (coords.length >= 4 && coords.length % 2 === 0) {
      coords.pop();
      geom.setCoordinates(coords);
    }
    if (coords.length < 3) {
      setTimeout(() => source.removeFeature(feature), 0);
      return;
    }
  }

  if (mode === 'CurvePolygon') {
    // Fast path: fullRing traced on interior ring — coords are nearly empty
    // because OL's direction flip stripped them. Build directly from ring geom.
    const fullRingArc = tracedArcs.find((ta) => ta.fullRing && ta.ring);
    if (fullRingArc) {
      const ringGeom = fullRingArc.ring;
      const entry = fullRingArc.entryCoord;
      const polyStart = startCoord || coords[0];
      const sameAsStart =
        Math.abs(entry[0] - polyStart[0]) < 1 &&
        Math.abs(entry[1] - polyStart[1]) < 1;

      let exteriorRing;
      if (sameAsStart) {
        // User started drawing directly on the ring — ring IS the polygon
        exteriorRing = ringGeom.clone();
      } else {
        // User drew from a different start point to the ring entry
        // Exterior ring = LineString(start→entry) + ring + LineString(entry→start)
        const toEntry = new LineString([polyStart, entry]);
        const fromEntry = new LineString([entry, polyStart]);
        exteriorRing = new CompoundCurve([
          toEntry,
          ringGeom.clone(),
          fromEntry,
        ]);
      }
      feature.setGeometry(new CurvePolygon([exteriorRing]));
      return;
    }

    if (coords.length < 3) {
      // Not enough coords and no fullRing — reject
      setTimeout(() => source.removeFeature(feature), 0);
      return;
    }

    const first = coords[0];
    const last = coords[coords.length - 1];
    const closedOnStart = isNearStartCoord(last);
    if (!closedOnStart) {
      coords.push(first.slice());
    }

    const subs = buildFinalGeometries(coords);
    const ring =
      subs.length > 1
        ? new CompoundCurve(subs)
        : subs[0] || new LineString(coords);
    feature.setGeometry(new CurvePolygon([ring]));
  }

  if (mode === 'CompoundCurve' && coords.length >= 2) {
    const subs = buildFinalGeometries(coords);
    if (subs.length === 1) {
      feature.setGeometry(subs[0]);
    } else if (subs.length > 1) {
      feature.setGeometry(new CompoundCurve(subs));
    }
  }
}

// ── Topology validation during drawing ───────────────────────

function validateSketchTopology(geometry, checkOverlap) {
  try {
    const data = getTessellatedFlatCoords(geometry);
    if (!data || data.coords.length < 4) {
      setTopoStatus(true, '');
      return;
    }

    // The sketch coordinate buffer ends with the cursor (live mouse). For an
    // arc HEAD the tessellation supplies many intermediate points, so trimming
    // the cursor does not hide the segment from validation. For a line HEAD
    // the live segment is exactly two points (last commit → cursor); trimming
    // the cursor would leave a single isolated point, removing the in-progress
    // line segment from the self-intersection check entirely. We therefore
    // always keep the cursor in range. Strict (t,u) bounds in
    // `getSelfIntersectionPoint` already prevent endpoint false positives.
    // For overlap with existing features, ALWAYS include the cursor segment —
    // that's the live feedback the user is looking at.
    // Total tessellated length across all sub-geoms of the sketch (`ends`
    // is per sub-geometry for tessellated CompoundCurve/CurvePolygon, so
    // `ends[0]` would only cover the first arc/segment).
    const totalEnd = data.ends[data.ends.length - 1];
    const selfIntEnd = totalEnd;
    const overlapEnd = totalEnd;

    // Ring-jump: when an active trace clips from the entry ring onto a
    // different ring (typically outer→inner of the same feature), OL's
    // trace silently switches targets. We detect this by comparing the
    // cursor's distance to the entry ring against its distance to every
    // other ring of the same source feature. If another ring is strictly
    // closer, OL has hopped.
    //
    // We use `activeTraceEntry` (captured at OL's `tracestart` event) as
    // the source of truth, because `tracedArcs` only gets a push when a
    // new vertex is committed — but the user can drift the cursor from
    // outer to inner ring BEFORE the first commit click.
    if ((traceActive || wasTracing) && activeTraceEntry) {
      const entryRing = activeTraceEntry.ring;
      const entryFeature = activeTraceEntry.feature;
      if (
        entryRing &&
        entryFeature &&
        Array.isArray(lastSketchCoordinates) &&
        lastSketchCoordinates.length > 0
      ) {
        const geom = entryFeature.getGeometry();
        const otherRings =
          geom && geom.getRingsArray
            ? geom.getRingsArray().filter((r) => r !== entryRing)
            : [];
        if (otherRings.length > 0) {
          const ringDist2 = (ring, c) => {
            if (ring.getType() === 'CompoundCurve') {
              let d2 = Infinity;
              for (const sub of ring.getGeometriesArray()) {
                const cp = [0, 0];
                d2 = Math.min(d2, sub.closestPointXY(c[0], c[1], cp, Infinity));
              }
              return d2;
            }
            const cp = [0, 0];
            return ring.closestPointXY(c[0], c[1], cp, Infinity);
          };
          // Walk every coord including the live cursor — that's where a
          // target-swap first manifests.
          for (let i = 1; i < lastSketchCoordinates.length; i++) {
            const c = lastSketchCoordinates[i];
            const dEntry2 = ringDist2(entryRing, c);
            for (const r of otherRings) {
              const dOther2 = ringDist2(r, c);
              if (dOther2 < dEntry2) {
                // console.log('[RJ] HIT', {i, c, dEntry2, dOther2});
                const prev = lastSketchCoordinates[i - 1];
                validationState.crossingPoints = [c.slice()];
                validationState.errorSegment = [
                  [prev[0], prev[1]],
                  [c[0], c[1]],
                ];
                setTopoStatus(false, 'Trace jumped to a different ring');
                return;
              }
            }
          }
        }
      }
    }

    // Self-intersection requires at least 3 segments (4 points = 8 coords).
    // During an active curved trace, traced sub-arcs hug an existing boundary,
    // and tessellation rounding between adjacent sub-arcs can produce tiny
    // apparent crossings at shared join vertices. Since we already verified
    // above that no ring-jump occurred, any "crossing" inside a curved traced
    // portion is a tessellation artefact. Plain LineString traces do not have
    // that artifact, so keep them in the live self-intersection check.
    let selfIntCheckEnd = selfIntEnd;
    if ((traceActive || wasTracing) && tracedArcs.length > 0) {
      const lastTraced = tracedArcs[tracedArcs.length - 1];
      if (
        lastTraced &&
        !lastTraced.exitCoord &&
        activeTraceHasCurve(lastTraced)
      ) {
        // Convert the traceStartIdx (in user-coord space, stride 2) to a
        // flat-coord offset that aligns with the tessellated buffer. The
        // tessellation expands curves into many small segments, so the
        // tessellated offset for the same vertex is at least as far in.
        // Conservative: walk tessellated coords and find the first index
        // whose XY matches the entry coord, then use that as the upper
        // bound. If we can't find it, fall back to skipping the whole
        // self-int check (safer than false-flagging a real hugging trace).
        const entry = lastTraced.entryCoord;
        let matchIdx = -1;
        for (let i = 0; i < selfIntEnd; i += data.stride) {
          if (
            Math.abs(data.coords[i] - entry[0]) < 1 &&
            Math.abs(data.coords[i + 1] - entry[1]) < 1
          ) {
            matchIdx = i;
            break;
          }
        }
        selfIntCheckEnd = matchIdx > 0 ? matchIdx : 0;
      }
    }
    if (selfIntCheckEnd >= 8) {
      const selfInt = getSelfIntersectionPoint(
        data.coords,
        0,
        selfIntCheckEnd,
        2,
        false,
      );
      if (selfInt) {
        // console.log('[SI] HIT', {
        //   selfIntCheckEnd,
        //   selfIntEnd,
        //   traceActive,
        //   wasTracing,
        //   tracedArcs: tracedArcs.length,
        //   selfInt,
        // });
        validationState.crossingPoints = [selfInt];
        validationState.errorSegment = findSketchSubGeomNear(
          data.coords,
          data.ends,
          selfInt,
        );
        setTopoStatus(false, 'Self-intersecting');
        return;
      }
    }

    const mode = typeSelect.value;
    if (
      checkOverlap &&
      (mode === 'CurvePolygon' || mode === 'CompoundCurve') &&
      overlapEnd >= 4
    ) {
      // Features being traced along share boundary with the sketch. Keep their
      // edge-crossing checks active, but exclude them from containment checks
      // because the sketch intentionally reuses their boundary.
      const traceExcluded = new Set(
        tracedArcs.map((a) => a.sourceFeature).filter(Boolean),
      );
      /** @type {Array<import('../src/ol/geom/Geometry.js').default>} */
      const traceBoundaryRings = [];
      // Rings of arcs already committed in this sketch — their hugging
      // segments must remain exempt from crossing/containment checks even
      // after `traceend` has cleared the active entry.
      for (const a of tracedArcs) {
        if (a.ring && !traceBoundaryRings.includes(a.ring)) {
          traceBoundaryRings.push(a.ring);
        }
      }
      if (activeTraceEntry) {
        traceExcluded.add(activeTraceEntry.feature);
        if (!traceBoundaryRings.includes(activeTraceEntry.ring)) {
          traceBoundaryRings.push(activeTraceEntry.ring);
        }
      } else if (traceStartCoord) {
        const activeTrace = findSourceRing(traceStartCoord);
        if (activeTrace) {
          traceExcluded.add(activeTrace.feature);
          if (!traceBoundaryRings.includes(activeTrace.ring)) {
            traceBoundaryRings.push(activeTrace.ring);
          }
        }
      }
      const others = source.getFeatures().filter((f) => !f.get('_snapPoint'));
      const overlap = checkOverlapWithExisting(
        data.coords,
        overlapEnd,
        others,
        traceExcluded,
        mode !== 'CurvePolygon',
        traceBoundaryRings,
      );
      if (overlap) {
        // console.log('[OV] HIT', {overlap});
        validationState.crossingPoints = overlap.point ? [overlap.point] : [];
        validationState.errorSegment = overlap.point
          ? findSketchSubGeomNear(data.coords, data.ends, overlap.point)
          : null;
        setTopoStatus(false, overlap.reason);
        return;
      }
    }

    validationState.crossingPoints = [];
    setTopoStatus(true, '');
  } catch (err) {
    // Surface unexpected errors instead of silently marking valid.
    setTopoStatus(false, 'Validation error: ' + err.message);
  }
}

// ── Post-draw topology advisory ──────────────────────────────

/**
 * Inspect a freshly drawn feature for topological warnings (self-intersection,
 * overlap with neighbours). The feature is ALWAYS accepted; this function is
 * advisory only. Mixed primitives (lines + arcs) and shared boundaries are
 * legitimate authoring outcomes — the trace/draw pipeline reconciles them on
 * the fly. Returns an advisory descriptor for the caller to surface in the UI.
 *
 * @param {import('../src/ol/Feature.js').default} feature The drawn feature.
 * @return {{warning: ?string, crossings: Array<Array<number>>}} Advisory state.
 */
function inspectDrawnFeature(feature) {
  const geom = feature.getGeometry();
  const others = source
    .getFeatures()
    .filter((f) => f !== feature && !f.get('_snapPoint'));

  if (geom.getType() === 'CurvePolygon') {
    const selfCrossings = geom.getSelfIntersections(
      CROSSING_EPSILON_SQ,
      SAME_ARC_TOLERANCE_SQ,
    );
    if (selfCrossings.length > 0) {
      return {warning: 'Self-intersecting', crossings: selfCrossings};
    }

    const arcs = collectCurveSegments(geom);
    for (const other of others) {
      const otherGeom = other.getGeometry();
      if (!otherGeom || otherGeom.getType() !== 'CurvePolygon') {
        continue;
      }
      const crossings = getArcArrayCrossings(
        arcs,
        collectCurveSegments(otherGeom),
        CROSSING_EPSILON_SQ,
        true,
        SAME_ARC_TOLERANCE_SQ,
      );
      if (crossings.length > 0) {
        return {warning: 'Crosses neighbour', crossings};
      }
    }
  } else {
    const data = getTessellatedFlatCoords(geom);
    if (data) {
      const isRing =
        geom.getType() === 'CurvePolygon' || geom.getType() === 'Polygon';
      const selfInt = getSelfIntersectionPoint(
        data.coords,
        0,
        data.ends[0],
        2,
        isRing,
      );
      if (selfInt) {
        return {warning: 'Self-intersecting', crossings: [selfInt]};
      }
      const overlap = checkOverlapWithExisting(
        data.coords,
        data.ends[0],
        others,
        new Set(),
        false,
      );
      if (overlap) {
        return {warning: overlap.reason, crossings: []};
      }
    }
  }
  return {warning: null, crossings: []};
}

// ── Add draw interaction ─────────────────────────────────────

/**
 * Check whether a coordinate lies on a given source ring within tolerance.
 * @param {import('../src/ol/geom/Geometry.js').default} ring The candidate ring.
 * @param {Array<number>} coord The coordinate to test.
 * @return {boolean} True if the coord is on the ring.
 */
function coordIsOnRing(ring, coord) {
  if (!ring) {
    return false;
  }
  let dist2;
  if (ring.getType() === 'CompoundCurve') {
    dist2 = Infinity;
    for (const sub of ring.getGeometriesArray()) {
      const closest = [0, 0];
      dist2 = Math.min(
        dist2,
        sub.closestPointXY(coord[0], coord[1], closest, Infinity),
      );
    }
  } else {
    const closest = [0, 0];
    dist2 = ring.closestPointXY(coord[0], coord[1], closest, Infinity);
  }
  const resolution = map.getView().getResolution();
  const tolerance = resolution * resolution * 4; // ~2px
  return dist2 < tolerance;
}

/**
 * Handle trace state transitions within the compound geometry function.
 * Detects trace-start and trace-end, updates tracedArcs metadata.
 * @param {Array<Array<number>>} coordinates Current sketch coordinates.
 */
function handleTraceTransitions(coordinates) {
  const tracing = traceActive;
  if (tracing && !wasTracing && !suppressTraceUntilEnd) {
    // Tracing just started.  Resolve the source ring first so we can pick
    // the correct segment type for the trace preview — tracing a
    // CircularString must render as an arc, not a straight line.
    const entryCoord = traceStartCoord || coordinates[coordinates.length - 2];
    // Guard against a stale re-entry: when our user-click branches finalize
    // a trace mid-flight (`wasTracing = false`) before OL emits `traceend`,
    // the next geometry-function call still sees `traceActive` true and
    // would otherwise push a phantom tracedArc with the previous trace's
    // start coordinate. Skip if the most recently finalized trace already
    // started at this same vertex.
    const lastFinalized =
      tracedArcs.length > 0 ? tracedArcs[tracedArcs.length - 1] : null;
    if (
      lastFinalized &&
      lastFinalized.exitCoord &&
      coordinateEquals(lastFinalized.entryCoord, entryCoord)
    ) {
      return;
    }
    if (postTraceAutoLine) {
      // Trace-end set currentSegType='line' so the V→next-click edge
      // would render as a line. If a NEW trace starts before any free
      // click, restore arc-mode so the source-segment-type detection
      // works (forceLineTrace would otherwise hijack a CircularString
      // trace into a polyline).
      setSegType('arc', 'trace-start:postTraceAutoLine-reset');
      postTraceAutoLine = false;
      updateMode();
    }
    // Hint: the cursor coord just after entry tells us which sub-geom of a
    // CompoundCurve ring the trace is heading along (corner ambiguity).
    const hintCoord = coordinates[coordinates.length - 1];
    const resolved = resolveTraceStartSource(
      entryCoord,
      hintCoord,
      currentSegType,
    );
    const found = resolved.found;
    const segmentInfo = resolved.segmentInfo;
    activeTraceEntry = found;
    const entryIdx = coordinates.length - 2;
    // If the in-progress segment leading into the trace is too short to be
    // a real arc (< 3 points), force it to render as a polyline. A 2-point
    // "arc" is degenerate and would also misinterpret the trace-entry
    // control-point click as an arc midpoint instead of an endpoint.
    // A 3-point arc that lands its endpoint on a control point IS valid
    // and must be preserved.
    let preBreakIdx = -1;
    for (let bi = segmentBreaks.length - 1; bi >= 0; bi--) {
      if (segmentBreaks[bi].index < entryIdx) {
        preBreakIdx = bi;
        const segPoints = entryIdx - segmentBreaks[bi].index + 1;
        if (segmentBreaks[bi].type === 'arc' && segPoints < 3) {
          segmentBreaks[bi] = {
            index: segmentBreaks[bi].index,
            type: 'line',
          };
        }
        break;
      }
    }
    // preBreakIdx is unused but harmless — kept for readability of the loop.
    void preBreakIdx;
    const breakIndex = segmentBreaks.length;
    const forceLineTrace = currentSegType === 'line';
    // Render the trace section as a polyline through OL's tessellation
    // samples — those samples already lie on the source feature, so a
    // polyline through them visually hugs the source curve. Building a
    // CircularString through tessellation samples instead would treat
    // alternating samples as arc endpoint/midpoint pairs and produce
    // wavy zig-zag arcs that "dance around" the source. The actual
    // curve geometry is reconstructed at drawend from
    // `tracedArc.sourceSegment` (preserved below), so the final feature
    // is faithful regardless of preview type.
    segmentBreaks.push({
      index: entryIdx,
      type: 'line',
    });
    wasTracing = true;

    tracedArcs.push({
      entryCoord: entryCoord.slice(),
      exitCoord: null,
      ring: found ? found.ring : null,
      sourceSegment: segmentInfo.geometry,
      sourceFeature: found ? found.feature : null,
      entryBreakIndex: breakIndex,
      traceStartIdx: coordinates.length - 2,
      traceEndIdx: -1,
      lastCheckedIdx: coordinates.length - 2,
      forceLineTrace,
    });
  } else if (!tracing && wasTracing && userClickedDuringTrace) {
    // User clicked a control point to end the trace.
    // (Cross-feature transitions where traceActive goes briefly false
    // are ignored — only user clicks end a trace.)
    userClickedDuringTrace = false;
    // OL's `updateTrace_` snaps `event.coordinate` to an interpolated
    // tessellation coord that lands at `coordinates.length - 2` after
    // `addToDrawing_(downCoordinate)` pushes the click. The pushed
    // click sits at `length - 1` (the new cursor) but gets overwritten
    // by the next pointer move, so we can't use that index. Instead,
    // mutate the now-stable `length - 2` slot to the user's actual
    // click coord so the post-trace slice (and any between-traces
    // slice) starts at the click vertex rather than a stray
    // tessellation sample.
    const exitIdx = coordinates.length - 2;
    if (userClickedExitCoord && exitIdx >= 0) {
      coordinates[exitIdx] = userClickedExitCoord.slice();
    }
    const exitCoord = coordinates[exitIdx];
    userClickedExitCoord = null;
    if (tracedArcs.length > 0) {
      const lastTraced = tracedArcs[tracedArcs.length - 1];
      lastTraced.exitCoord = exitCoord.slice();
      lastTraced.traceEndIdx = exitIdx;
      cacheMidpoint(lastTraced, coordinates);

      // Check for full-ring completion on interior rings (holes).
      // On a closed ring, OL's trace fires traceend when it loops back to
      // the start. The exit coord will be close to (but not bitwise-equal to)
      // the entry coord due to tessellation.
      let isFullRing = false;
      if (lastTraced.ring && lastTraced.sourceFeature) {
        const dx = exitCoord[0] - lastTraced.entryCoord[0];
        const dy = exitCoord[1] - lastTraced.entryCoord[1];
        const distSq = dx * dx + dy * dy;
        const res = map.getView().getResolution();
        const tol = res * 15; // ~15 pixels tolerance
        if (distSq < tol * tol) {
          const geom = lastTraced.sourceFeature.getGeometry();
          const rings = geom.getRingsArray();
          if (rings.indexOf(lastTraced.ring) > 0) {
            isFullRing = true;
          }
        }
      }

      if (isFullRing) {
        lastTraced.exitCoord = lastTraced.entryCoord.slice();
        lastTraced.fullRing = true;
        lastTraced.chordFallback = false;
        suppressTraceUntilEnd = true;
      } else {
        validateTraceExit(lastTraced, coordinates);
      }
    }
    // Trace exit: V serves as the start of the next arc. Leave
    // `currentSegType` as 'arc' so V→click1→click2 is one arc
    // (V=start, click1=midpoint, click2=endpoint). Push a fresh
    // break at V with `currentSegType` so the post-trace slice
    // inherits the user's intended segment type — the trace's own
    // 'line' break would otherwise leak into post-trace clicks and
    // collapse 3-click arc construction to a LineString.
    segmentBreaks.push({index: exitIdx, type: currentSegType});
    wasTracing = false;
    updateMode();
  } else if (tracing && wasTracing) {
    // Continuous trace — check for user click to end trace or full-ring close.
    if (userClickedDuringTrace && tracedArcs.length > 0) {
      // User clicked a control point to exit trace while still on a
      // boundary. At this call (call A inside `handlePointerMove_`'s
      // `modifyDrawing_`), OL has snapped the cursor to an interpolated
      // tessellation coord but has NOT yet appended the click via
      // `addToDrawing_`. We can't fix the click index here — the click
      // coord isn't in the buffer yet. Defer to the post-traceend branch
      // (call B inside `addToDrawing_`) which fires after OL pushes the
      // click, where we can mutate the now-stable `length - 2` slot to
      // the captured click coord.
      // Falling through preserves `wasTracing` so the post-traceend
      // branch handles this user-click cleanly.
    } else if (pendingFullRingClose && tracedArcs.length > 0) {
      const lastTraced = tracedArcs[tracedArcs.length - 1];
      if (!lastTraced.exitCoord) {
        // Full ring trace on interior ring — force-end the trace
        lastTraced.exitCoord = lastTraced.entryCoord.slice();
        lastTraced.traceEndIdx = coordinates.length - 2;
        lastTraced.fullRing = true;
        lastTraced.chordFallback = false;
        cacheMidpoint(lastTraced, coordinates);
        // V serves as the start of the next arc; leave segType as 'arc'.
        wasTracing = false;
        suppressTraceUntilEnd = true;
        pendingFullRingClose = false;
        updateMode();
      }
    }
  }
}

/**
 * Handle drawend: finalize pending traces, build geometry, validate.
 * @param {import('../src/ol/interaction/Draw.js').DrawEvent} e The draw event.
 */
function handleDrawEnd(e) {
  recordDebugEvent('drawend:before-finalize', {
    coords: e.feature.getGeometry()
      ? e.feature.getGeometry().getCoordinates().length
      : null,
    tracedArcs: tracedArcs.map((arc) => ({
      entryCoord: roundCoord(arc.entryCoord),
      exitCoord: roundCoord(arc.exitCoord),
      traceStartIdx: arc.traceStartIdx,
      traceEndIdx: arc.traceEndIdx,
      fullRing: !!arc.fullRing,
      chordFallback: !!arc.chordFallback,
      forceLineTrace: !!arc.forceLineTrace,
      sourceSegment: arc.sourceSegment ? arc.sourceSegment.getType() : null,
      ring: arc.ring ? arc.ring.getType() : null,
    })),
  });
  drawing = false;

  // If tracing was still active at finish, record the exit and validate
  if (wasTracing && tracedArcs.length > 0) {
    const lastTraced = tracedArcs[tracedArcs.length - 1];
    if (!lastTraced.exitCoord) {
      if (typeSelect.value === 'CurvePolygon' && startCoord) {
        lastTraced.exitCoord = startCoord.slice();
      } else {
        const coords = e.feature.getGeometry().getCoordinates();
        if (coords.length >= 2) {
          lastTraced.exitCoord = coords[coords.length - 2].slice();
        }
      }
    }
    const coords = e.feature.getGeometry().getCoordinates();
    lastTraced.traceEndIdx = coords.length - 2;
    cacheMidpoint(lastTraced, coords);
    if (lastTraced.exitCoord) {
      validateTraceExit(lastTraced, coords);
    }
    wasTracing = false;
  }

  // Drop phantom degenerate trace records: when a tracestart fires on a
  // shared vertex but the actual trace happens on a different ring, the
  // first record can be left with entry == exit (zero length). These
  // produce duplicate vertices in the final geometry. Keep them only if
  // they represent a legitimate full-ring trace.
  if (tracedArcs.length > 0) {
    /** @type {Array<typeof tracedArcs[number]>} */
    const filtered = [];
    for (const ta of tracedArcs) {
      if (ta.fullRing) {
        filtered.push(ta);
        continue;
      }
      if (!ta.entryCoord || !ta.exitCoord) {
        continue;
      }
      if (coordinateEquals(ta.entryCoord, ta.exitCoord)) {
        continue;
      }
      // Zero-length on the sketch coordinate path → phantom.
      if (
        ta.traceStartIdx >= 0 &&
        ta.traceEndIdx >= 0 &&
        ta.traceStartIdx === ta.traceEndIdx
      ) {
        continue;
      }
      // Duplicate of the immediately preceding trace (same entry & exit).
      const previous = filtered[filtered.length - 1];
      if (
        previous &&
        coordinateEquals(previous.entryCoord, ta.entryCoord) &&
        previous.exitCoord &&
        coordinateEquals(previous.exitCoord, ta.exitCoord)
      ) {
        continue;
      }
      filtered.push(ta);
    }
    tracedArcs = filtered;
  }

  finalizeGeometry(e.feature);
  e.feature.set('_drawn', true);
  recordDebugEvent('drawend:after-finalize', {
    geometryType: e.feature.getGeometry()
      ? e.feature.getGeometry().getType()
      : null,
  });

  // Advisory inspection — never reject. Mixed primitives and shared
  // boundaries are valid authoring outcomes; surface warnings without
  // discarding the user's work.
  const advisory = inspectDrawnFeature(e.feature);
  recordDebugEvent('drawend:accepted', {warning: advisory.warning});
  resetState();
  if (advisory.warning) {
    validationState.crossingPoints = advisory.crossings;
    setTopoStatus(false, advisory.warning);
    status('Feature added (advisory: ' + advisory.warning + ').');
  } else {
    status('Feature added. Draw another or switch to edit mode.');
  }
  map.render();
}

function addDrawInteraction() {
  if (draw) {
    map.removeInteraction(draw);
    draw = null;
  }
  resetState();

  const mode = typeSelect.value;
  if (mode === 'None') {
    snap.setActive(false);
    traceSnap.setActive(false);
    modify.setActive(true);
    status('Edit mode — drag vertices to modify, Alt+Click to delete.');
    return;
  }
  // Draw mode: Modify must stay disabled so it cannot hijack clicks intended
  // to start a new draw session. It is re-enabled only when the user
  // switches back to 'None'.
  modify.setActive(false);

  if (mode === 'CircularString') {
    draw = new Draw({
      source,
      type: 'LineString',
      style: sketchStyle,
      condition: checkCrossingCondition,
      geometryFunction(coordinates, geometry) {
        if (!geometry) {
          geometry = new CircularString(coordinates);
        } else {
          geometry.setCoordinates(coordinates);
        }
        validateSketchTopology(geometry, true);
        return geometry;
      },
      finishCondition() {
        if (!validationState.isValid) {
          return false;
        }
        const feat = draw.getOverlay().getSource().getFeatures()[0];
        if (!feat) {
          return false;
        }
        const c = feat.getGeometry().getCoordinates();
        return c.length >= 4 && c.length % 2 === 0;
      },
    });
    status(
      'CircularString — click points (3, 5, 7, …), double-click to finish.',
    );
  } else {
    // CompoundCurve or CurvePolygon
    const isCurvePolygon = mode === 'CurvePolygon';
    let prevCount = 0;
    let closing = false;

    draw = new Draw({
      source,
      type: 'LineString',
      // Function form so OL re-evaluates per click. Accidental same-feature
      // retrace after escaping a trace is blocked for non-control-point
      // events (the loop-back-erases case), while an explicit control-point
      // click can intentionally start another trace.
      trace: (e) => {
        // When a trace is already active, this condition is consulted for
        // trace *deactivation* as well as activation. Always allow it here;
        // exit validity is enforced by checkCrossingCondition on pointerdown.
        // Otherwise updateTrace_ may replace the pointerup coordinate with a
        // non-control-point boundary interpolation and accidentally block the
        // click that was meant to leave trace mode.
        if (traceActive || wasTracing) {
          return true;
        }
        if (suppressTraceUntilEnd) {
          return false;
        }
        if (tracedArcs.length === 0) {
          return true;
        }
        const found = findSourceRing(e.coordinate);
        if (!found) {
          return true;
        }
        for (const ta of tracedArcs) {
          if (
            ta.sourceFeature === found.feature &&
            !isSourceControlPoint(e.coordinate)
          ) {
            return false;
          }
        }
        return true;
      },
      traceSource: source,
      style: sketchStyle,
      condition: checkCrossingCondition,
      geometryFunction(coordinates, geometry) {
        // Hard-prevent ring-jump within the entry feature: while OL is
        // actively tracing a ring, clamp the live cursor coordinate to
        // that entry ring whenever any OTHER ring of the same feature
        // would be closer (e.g. an inner hole vs. the outer ring).
        // Cross-feature hop prevention is handled separately by the
        // `source.getFeaturesInExtent` wrap, which restricts OL's trace
        // targets to the entry feature except at shared control points
        // (where switching to another feature is intentionally allowed).
        if (
          traceActive &&
          activeTraceEntry &&
          activeTraceEntry.ring &&
          activeTraceEntry.feature &&
          coordinates.length >= 2
        ) {
          const entryRing = activeTraceEntry.ring;
          const entryFeature = activeTraceEntry.feature;
          const entryGeom = entryFeature.getGeometry();
          const otherRings =
            entryGeom && entryGeom.getRingsArray
              ? entryGeom.getRingsArray().filter((r) => r !== entryRing)
              : [];
          if (otherRings.length > 0) {
            const closestOn = (ring, c) => {
              if (ring.getType() === 'CompoundCurve') {
                let best = [c[0], c[1]];
                let bestD2 = Infinity;
                for (const sub of ring.getGeometriesArray()) {
                  const cp = [0, 0];
                  const d2 = sub.closestPointXY(c[0], c[1], cp, Infinity);
                  if (d2 < bestD2) {
                    bestD2 = d2;
                    best = [cp[0], cp[1]];
                  }
                }
                return {pt: best, d2: bestD2};
              }
              const cp = [0, 0];
              const d2 = ring.closestPointXY(c[0], c[1], cp, Infinity);
              return {pt: [cp[0], cp[1]], d2};
            };
            const last = coordinates[coordinates.length - 1];
            const entryClosest = closestOn(entryRing, last);
            let hopped = false;
            for (const r of otherRings) {
              const otherClosest = closestOn(r, last);
              if (otherClosest.d2 < entryClosest.d2) {
                hopped = true;
                break;
              }
            }
            if (hopped) {
              // Snap cursor back onto the entry ring.
              coordinates[coordinates.length - 1] = entryClosest.pt;
            }
          }
        }
        lastSketchCoordinates = coordinates.map((coord) => coord.slice());
        const isNewPoint = coordinates.length > prevCount;

        // Track the peak coordinate count during this trace session.
        // Used to reliably detect direction-flip (massive drop from peak).
        if (isNewPoint && traceActive && wasTracing) {
          maxTracedCount = Math.max(maxTracedCount, coordinates.length);
        }

        prevCount = coordinates.length;

        // Detect full-ring direction flip on interior rings.
        // OL's trace strips coordinates when cursor nears the trace start
        // on a closed ring (direction flip). Detect via significant drop
        // from the peak coordinate count we observed during tracing.
        if (
          !isNewPoint &&
          traceActive &&
          wasTracing &&
          !suppressTraceUntilEnd &&
          tracedArcs.length > 0
        ) {
          const lastTraced = tracedArcs[tracedArcs.length - 1];
          // The flip is detected when coords drop close to the pre-trace
          // count AND we previously accumulated a significant number of
          // traced points (maxTracedCount >> traceStartIdx).
          const dropThreshold = lastTraced.traceStartIdx + 5;
          const hadSignificantTrace =
            maxTracedCount > lastTraced.traceStartIdx + 8;
          if (
            !lastTraced.exitCoord &&
            !lastTraced.fullRing &&
            lastTraced.ring &&
            lastTraced.sourceFeature &&
            hadSignificantTrace &&
            coordinates.length <= dropThreshold
          ) {
            const geom_ = lastTraced.sourceFeature.getGeometry();
            const rings_ = geom_.getRingsArray();
            const ringIdx = rings_.indexOf(lastTraced.ring);
            if (ringIdx > 0) {
              // Interior ring direction flip — full ring traced!
              lastTraced.exitCoord = lastTraced.entryCoord.slice();
              lastTraced.traceEndIdx = coordinates.length - 2;
              lastTraced.fullRing = true;
              lastTraced.chordFallback = false;
              segmentBreaks.push({
                index: lastTraced.traceStartIdx,
                type: currentSegType,
              });
              wasTracing = false;
              suppressTraceUntilEnd = true;
              // Auto-finish the drawing (the ring is complete)
              setTimeout(() => {
                try {
                  if (draw && drawing && validationState.isValid) {
                    draw.finishDrawing();
                  }
                } catch {
                  // ignore
                }
              }, 0);
            }
          }
        }

        // Track tracing state transitions
        if (isNewPoint && drawing) {
          handleTraceTransitions(coordinates);
        }

        // Diagnostic: expose live sketch state for puppeteer probes.
        // Captured AFTER handleTraceTransitions so the freshly-pushed
        // segment breaks (e.g. trace-end / first-post-trace-click) are
        // visible. Removed after the post-trace regression is closed.
        /** @type {*} */ (window).__liveSketch = {
          coords: coordinates.map((c) => c.slice()),
          segmentBreaks: segmentBreaks.slice(),
          currentSegType,
          drawing,
          traceActive,
          wasTracing,
          postTraceAutoLine,
        };

        // Auto-close: when a new point snaps to start, finish the ring
        if (
          isCurvePolygon &&
          isNewPoint &&
          !closing &&
          startCoord &&
          coordinates.length >= 4
        ) {
          const pt = coordinates[coordinates.length - 2];
          const tol = map.getView().getResolution() * 0.5;
          if (
            Math.abs(pt[0] - startCoord[0]) < tol &&
            Math.abs(pt[1] - startCoord[1]) < tol
          ) {
            closing = true;
            setTimeout(() => {
              if (draw && drawing && validationState.isValid) {
                draw.finishDrawing();
              }
              closing = false;
            }, 0);
          }
        }

        // Build sketch geometry for visual feedback during drawing.
        // Collapse multi-lap repetitions in the preview only — finalized
        // geometry is reconstructed from `tracedArcs` and stays correct.
        const trimmed = trimLapRepetitions(coordinates, segmentBreaks);
        const normalized = collapseConsecutivePreviewDuplicates(
          trimmed.coords,
          trimmed.breaks,
        );
        const previewCoords = normalized.coords;
        const previewBreaks = addPreviewSourceSegmentBreaks(
          previewCoords,
          normalized.breaks,
        );
        const geoms = buildFromBreaks(previewCoords, previewBreaks);
        if (!geometry) {
          geometry = new CompoundCurve(
            geoms.length ? geoms : [new LineString(previewCoords)],
          );
        } else {
          geometry.setGeometriesArray(
            geoms.length ? geoms : [new LineString(previewCoords)],
          );
        }
        if (isNewPoint && drawing) {
          updatePointStatus(coordinates.length);
        }

        validateSketchTopology(geometry, true);
        return geometry;
      },
      finishCondition() {
        if (!validationState.isValid) {
          return false;
        }
        const feat = draw.getOverlay().getSource().getFeatures()[0];
        return feat && feat.getGeometry().getCoordinates().length >= 3;
      },
    });

    status(
      isCurvePolygon
        ? 'CurvePolygon — click to draw arc. T=toggle. Click boundary to trace. Snap start to close.'
        : 'CompoundCurve — click to draw arc. T=toggle. Click boundary to trace. Dblclick finish.',
    );
  }

  draw.on('drawstart', (e) => {
    drawing = true;
    setSegType('arc', 'drawstart');
    segmentBreaks = [{index: 0, type: 'arc'}];
    tracedArcs = [];
    updateMode();
    const coords = e.feature.getGeometry().getCoordinates();
    if (coords.length > 0) {
      startCoord = coords[0].slice();
      if (typeSelect.value === 'CurvePolygon') {
        snapFeature = new Feature({
          geometry: new Point(startCoord),
          _snapPoint: true,
        });
        source.addFeature(snapFeature);
      }
    }
    recordDebugEvent('drawstart', {coordinate: roundCoord(startCoord)});
  });

  draw.on('tracestart', (e) => {
    if (suppressTraceUntilEnd) {
      // Don't track the restart after a full-ring completion
      return;
    }
    traceActive = true;
    traceStartCoord = e.coordinate ? e.coordinate.slice() : null;
    activeTraceEntry = traceStartCoord
      ? resolveTraceStartSource(traceStartCoord, undefined, currentSegType)
          .found
      : null;
    maxTracedCount = 0;
    recordDebugEvent('tracestart', {
      coordinate: roundCoord(traceStartCoord),
      sourceGeometry: e.traceSourceGeometry
        ? e.traceSourceGeometry.getType()
        : null,
      traceSourceRingIndex: e.traceSourceRingIndex,
      traceStartIndex: e.traceStartIndex,
      activeRing: activeTraceEntry ? activeTraceEntry.ring.getType() : null,
    });
  });

  draw.on('traceend', (e) => {
    recordDebugEvent('traceend', {
      coordinate: roundCoord(e.coordinate),
      sourceGeometry: e.traceSourceGeometry
        ? e.traceSourceGeometry.getType()
        : null,
      traceSourceRingIndex: e.traceSourceRingIndex,
      traceStartIndex: e.traceStartIndex,
      traceEndIndex: e.traceEndIndex,
    });
    if (wasTracing && tracedArcs.length > 0 && e.traceSourceGeometry) {
      const lastTraced = tracedArcs[tracedArcs.length - 1];
      const sourceFeature = findFeatureForRing(e.traceSourceGeometry);
      if (sourceFeature) {
        const hintCoord = getTraceDirectionHint(
          e.traceSourceGeometry,
          e.traceStartIndex,
          e.traceEndIndex,
          lastTraced.entryCoord,
        );
        lastTraced.ring = e.traceSourceGeometry;
        lastTraced.sourceFeature = sourceFeature;
        lastTraced.sourceSegment = getSourceSegmentInfo(
          {ring: e.traceSourceGeometry, feature: sourceFeature},
          lastTraced.entryCoord,
          hintCoord,
        ).geometry;
      }
    }
    // Detect full-ring completion on interior rings (holes). On a closed
    // ring, OL fires traceend when the trace loops back. We must catch it
    // HERE (not in handleTraceTransitions) because OL fires traceend→
    // tracestart between geometryFunction calls. The new trace*Index fields
    // on the DrawEvent let us identify a full lap directly in source-ring
    // coordinate space, no pixel tolerance needed.
    if (
      wasTracing &&
      tracedArcs.length > 0 &&
      e.traceSourceGeometry &&
      e.traceSourceRingIndex !== undefined &&
      e.traceSourceRingIndex > 0 &&
      e.traceStartIndex !== undefined &&
      e.traceEndIndex !== undefined
    ) {
      const lastTraced = tracedArcs[tracedArcs.length - 1];
      if (
        !lastTraced.exitCoord &&
        lastTraced.ring &&
        lastTraced.sourceFeature &&
        e.traceSourceGeometry === lastTraced.ring
      ) {
        const sourceGeom = e.traceSourceGeometry;
        const tessLen = sourceGeom.tessellate
          ? sourceGeom.tessellate().length / 2
          : sourceGeom.getCoordinates().length;
        const lap = Math.abs(e.traceEndIndex - e.traceStartIndex);
        if (lap >= tessLen - 1) {
          // Interior ring — full ring traced!
          const feat = draw.getOverlay().getSource().getFeatures()[0];
          const coords = feat ? feat.getGeometry().getCoordinates() : [];
          lastTraced.exitCoord = lastTraced.entryCoord.slice();
          lastTraced.traceEndIdx = coords.length - 2;
          lastTraced.fullRing = true;
          lastTraced.chordFallback = false;
          cacheMidpoint(lastTraced, coords);
          const entryIdx = segmentBreaks[lastTraced.entryBreakIndex]
            ? segmentBreaks[lastTraced.entryBreakIndex].index
            : coords.length - 2;
          segmentBreaks.push({index: entryIdx, type: currentSegType});
          wasTracing = false;
          suppressTraceUntilEnd = true;
        }
      }
    }
    traceActive = false;
    traceStartCoord = null;
    activeTraceEntry = null;
    // suppressTraceUntilEnd is cleared by resetState() on drawend/drawabort.
    // Do NOT clear it here — if fullRing detection above just set it,
    // clearing it would allow tracestart to restart the trace.
  });

  draw.on('drawend', handleDrawEnd);

  draw.on('drawabort', () => {
    drawing = false;
    resetState();
  });

  map.addInteraction(draw);
  // Re-add snap interactions AFTER draw so they process before it.
  // Processing order (last-to-first): snap → traceSnap → draw.
  // snap brings coordinate near tessellation vertex/edge,
  // traceSnap refines to exact control point, draw uses the result.
  map.removeInteraction(snap);
  map.removeInteraction(traceSnap);
  snap.setActive(true);
  traceSnap.setActive(true);
  map.addInteraction(traceSnap);
  map.addInteraction(snap);
}

addDrawInteraction();

// ── UI event handlers ────────────────────────────────────────

typeSelect.addEventListener('change', addDrawInteraction);

document.getElementById('undo').addEventListener('click', () => {
  if (!draw) {
    return;
  }
  draw.removeLastPoint();
  if (segmentBreaks.length > 1) {
    const feat = draw.getOverlay().getSource().getFeatures()[0];
    if (feat) {
      const coords = feat.getGeometry().getCoordinates();
      const last = segmentBreaks[segmentBreaks.length - 1];
      if (coords.length - 1 <= last.index) {
        segmentBreaks.pop();
        setSegType(segmentBreaks[segmentBreaks.length - 1].type, 'undo');
        updateMode();
      }
    }
  }
});

document.getElementById('clear').addEventListener('click', () => {
  source.clear();
  snapFeature = null;
  source.addFeature(preFeatureA);
  source.addFeature(preFeatureB);
  source.addFeature(preFeatureC);
  setTopoStatus(true, '');
  status('Cleared. Pre-populated features restored.');
});

// T key — toggle arc/line segment
document.addEventListener('keydown', (e) => {
  if (e.key !== 't' && e.key !== 'T') {
    return;
  }
  const m = typeSelect.value;
  if ((m !== 'CompoundCurve' && m !== 'CurvePolygon') || !draw || !drawing) {
    return;
  }
  const feat = draw.getOverlay().getSource().getFeatures()[0];
  if (!feat) {
    return;
  }
  const coords = feat.getGeometry().getCoordinates();
  const n = committedInSegment(coords.length);
  if (n < 2) {
    status('Need ≥ 2 points before toggling.');
    return;
  }
  if (currentSegType === 'arc' && n % 2 === 0) {
    status('Arc needs odd point count (3, 5, …). Add one more point.');
    return;
  }
  setSegType(currentSegType === 'arc' ? 'line' : 'arc', 'T-toggle');
  postTraceAutoLine = false;
  segmentBreaks.push({index: coords.length - 2, type: currentSegType});
  updateMode();
  status(
    currentSegType === 'arc'
      ? 'Switched to ARC. Next: curvature point.'
      : 'Switched to LINE. Click to add vertices.',
  );
});

// Discard/stop button — abort current draw and switch to edit mode
document.getElementById('stop-draw').addEventListener('click', () => {
  if (draw && drawing) {
    draw.abortDrawing();
  }
  // Switch to edit mode
  typeSelect.value = 'None';
  addDrawInteraction();
});

// Start draw button — activate the selected draw type
document.getElementById('start-draw').addEventListener('click', () => {
  if (typeSelect.value === 'None') {
    typeSelect.value = 'CurvePolygon';
  }
  addDrawInteraction();
});

// ESC — abort current draw and switch to edit mode
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (draw && drawing) {
      draw.abortDrawing();
    }
    if (typeSelect.value !== 'None') {
      typeSelect.value = 'None';
      addDrawInteraction();
    }
  }
});

// SPACE — single-object diagnostic dump (copy-paste friendly).
// Builds ONE plain object summarising every feature, every ring, every
// sub-geometry (CompoundCurve), plus the live drawing/trace state. Object
// identity is encoded as stable string IDs ("ring#3", "flat#7", …) via a
// WeakMap so shared references show up as the same ID in the JSON dump.
// Press Space outside text inputs.
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' && e.code !== 'Space') {
    return;
  }
  const tag = /** @type {HTMLElement} */ (e.target).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return;
  }
  e.preventDefault();

  const ids = new WeakMap();
  const counters = {};
  /**
   * @param {string} kind Kind label (geom, ring, sub, flat, feat).
   * @param {object|Array<number>} obj Object to identify.
   * @return {string} Stable ID.
   */
  function id(kind, obj) {
    if (!obj) {
      return null;
    }
    if (ids.has(obj)) {
      return ids.get(obj);
    }
    counters[kind] = (counters[kind] || 0) + 1;
    const tag = `${kind}#${counters[kind]}`;
    ids.set(obj, tag);
    return tag;
  }

  /**
   * @param {any} coords Coordinates.
   * @return {any} Rounded coordinates (3 decimals).
   */
  function round(coords) {
    if (!Array.isArray(coords)) {
      return coords;
    }
    if (typeof coords[0] === 'number') {
      return coords.map((value) => Math.round(value * 1000) / 1000);
    }
    return coords.map((coord) => round(coord));
  }

  /**
   * @param {any} r Ring geometry (CircularString | LineString | CompoundCurve).
   * @return {Object} Ring summary.
   */
  function ringSummary(r) {
    const out = {
      type: r.getType(),
      ringId: id('ring', r),
      flatId: id('flat', r.flatCoordinates),
      flatLen: r.flatCoordinates ? r.flatCoordinates.length : -1,
      coordCount: r.getCoordinates ? r.getCoordinates().length : -1,
      coords: r.getCoordinates ? round(r.getCoordinates()) : null,
    };
    if (r.getType() === 'CompoundCurve') {
      out.subGeoms = r.getGeometriesArray().map((/** @type {any} */ sg) => ({
        type: sg.getType(),
        subId: id('sub', sg),
        flatId: id('flat', sg.flatCoordinates),
        flatLen: sg.flatCoordinates ? sg.flatCoordinates.length : -1,
        coordCount: sg.getCoordinates().length,
        coords: round(sg.getCoordinates()),
      }));
    }
    return out;
  }

  /**
   * @param {import('../src/ol/geom/Geometry.js').default} g Geometry.
   * @return {Array<Object>} Per-ring summary.
   */
  function ringsOf(g) {
    const type = g.getType();
    if (type === 'CurvePolygon') {
      const cp =
        /** @type {import('../src/ol/geom/CurvePolygon.js').default} */ (g);
      return cp.getRingsArray().map((r) => ringSummary(r));
    }
    return [ringSummary(/** @type {any} */ (g))];
  }

  const feats = source.getFeatures();
  const features = feats.map((f, i) => {
    const g = f.getGeometry();
    return {
      i,
      featId: id('feat', f),
      geomId: id('geom', g),
      type: g ? g.getType() : null,
      rings: g ? ringsOf(g) : [],
    };
  });

  function probeResult(result) {
    if (!result) {
      return null;
    }
    const featureIndex = feats.indexOf(result.feature);
    return {
      reason: result.reason,
      point: result.point || null,
      featureIndex,
      featureId: featureIndex >= 0 ? features[featureIndex].featId : null,
    };
  }

  /**
   * @param {Array<number>} point Point coordinate.
   * @param {Array<number>} coord Coordinate to compare.
   * @return {number} Squared distance.
   */
  function distanceSq(point, coord) {
    const dx = point[0] - coord[0];
    const dy = point[1] - coord[1];
    return dx * dx + dy * dy;
  }

  /**
   * @param {Array<number>} flat Flat coordinates.
   * @param {number} start Segment start offset.
   * @return {Array<Array<number>>} Segment endpoints.
   */
  function flatSegment(flat, start) {
    return [
      [flat[start], flat[start + 1]],
      [flat[start + 2], flat[start + 3]],
    ];
  }

  /**
   * @param {Array<number>} point Point coordinate.
   * @param {Array<Array<number>>} segment Segment endpoints.
   * @return {Object} Endpoint proximity descriptor.
   */
  function endpointInfo(point, segment) {
    const firstDistSq = distanceSq(point, segment[0]);
    const secondDistSq = distanceSq(point, segment[1]);
    return {
      firstDistSq: Math.round(firstDistSq * 1000) / 1000,
      secondDistSq: Math.round(secondDistSq * 1000) / 1000,
      nearFirst: firstDistSq <= CROSSING_EPSILON_SQ,
      nearSecond: secondDistSq <= CROSSING_EPSILON_SQ,
      nearAny:
        firstDistSq <= CROSSING_EPSILON_SQ ||
        secondDistSq <= CROSSING_EPSILON_SQ,
    };
  }

  /**
   * @param {Array<number>} point Point coordinate.
   * @param {Array<number>} arc Arc tuple [bx, by, mx, my, ex, ey].
   * @return {Object} Arc endpoint proximity descriptor.
   */
  function arcEndpointInfo(point, arc) {
    return endpointInfo(point, [
      [arc[0], arc[1]],
      [arc[4], arc[5]],
    ]);
  }

  /**
   * @param {Array<number>} a First arc tuple [bx, by, mx, my, ex, ey].
   * @param {Array<number>} b Second arc tuple [bx, by, mx, my, ex, ey].
   * @return {boolean} Whether the arcs share an endpoint coordinate.
   */
  function arcsShareEndpoint(a, b) {
    const a0 = [a[0], a[1]];
    const a1 = [a[4], a[5]];
    const b0 = [b[0], b[1]];
    const b1 = [b[4], b[5]];
    return (
      coordinateEquals(a0, b0) ||
      coordinateEquals(a0, b1) ||
      coordinateEquals(a1, b0) ||
      coordinateEquals(a1, b1)
    );
  }

  /**
   * @param {Array<number>} a First flat coordinates.
   * @param {number} aEnd First exclusive end offset.
   * @param {Array<number>} b Second flat coordinates.
   * @param {number} bEnd Second exclusive end offset.
   * @return {Array<Object>} Segment-level crossing witnesses.
   */
  function segmentCrossingWitnesses(a, aEnd, b, bEnd) {
    const witnesses = [];
    for (let ai = 0; ai <= aEnd - 4; ai += 2) {
      const aSeg = flatSegment(a, ai);
      for (let bi = 0; bi <= bEnd - 4; bi += 2) {
        const crossing = getSegmentsCrossingPoint(
          a,
          ai,
          ai + 4,
          b,
          bi,
          bi + 4,
          2,
        );
        if (!crossing) {
          continue;
        }
        const bSeg = flatSegment(b, bi);
        const aEndpoint = endpointInfo(crossing, aSeg);
        const bEndpoint = endpointInfo(crossing, bSeg);
        witnesses.push({
          point: round(crossing),
          aSegmentIndex: ai / 2,
          bSegmentIndex: bi / 2,
          aSegment: round(aSeg),
          bSegment: round(bSeg),
          aEndpoint,
          bEndpoint,
          endpointTouch: aEndpoint.nearAny || bEndpoint.nearAny,
          sharedEndpoint:
            (aEndpoint.nearAny && bEndpoint.nearAny) ||
            coordinateEquals(aSeg[0], bSeg[0]) ||
            coordinateEquals(aSeg[0], bSeg[1]) ||
            coordinateEquals(aSeg[1], bSeg[0]) ||
            coordinateEquals(aSeg[1], bSeg[1]),
        });
        if (witnesses.length >= 12) {
          return witnesses;
        }
      }
    }
    return witnesses;
  }

  /**
   * @param {Array<Array<number>>} arcs First curve segments.
   * @param {Array<Array<number>>} otherArcs Second curve segments.
   * @return {Array<Object>} Arc-level crossing witnesses.
   */
  function arcCrossingWitnesses(arcs, otherArcs) {
    const witnesses = [];
    for (let ai = 0; ai < arcs.length; ai++) {
      for (let bi = 0; bi < otherArcs.length; bi++) {
        const crossings = getArcArrayCrossings(
          [arcs[ai]],
          [otherArcs[bi]],
          CROSSING_EPSILON_SQ,
          true,
          SAME_ARC_TOLERANCE_SQ,
        );
        for (const point of crossings) {
          const aEndpoint = arcEndpointInfo(point, arcs[ai]);
          const bEndpoint = arcEndpointInfo(point, otherArcs[bi]);
          witnesses.push({
            point: round(point),
            aArcIndex: ai,
            bArcIndex: bi,
            aArc: round(arcs[ai]),
            bArc: round(otherArcs[bi]),
            aEndpoint,
            bEndpoint,
            endpointTouch: aEndpoint.nearAny || bEndpoint.nearAny,
            sharedEndpoint:
              (aEndpoint.nearAny && bEndpoint.nearAny) ||
              arcsShareEndpoint(arcs[ai], otherArcs[bi]),
          });
          if (witnesses.length >= 12) {
            return witnesses;
          }
        }
      }
    }
    return witnesses;
  }

  const validationProbe = features.map((entry, i) => {
    const feature = feats[i];
    const geometry = feature.getGeometry();
    const data = geometry ? getTessellatedFlatCoords(geometry) : null;
    if (!data) {
      return {i, skipped: true};
    }
    const others = feats.filter((f) => f !== feature && !f.get('_snapPoint'));
    const forward = checkOverlapWithExisting(
      data.coords,
      data.ends[data.ends.length - 1],
      others,
      new Set(),
      false,
    );
    const reverse = [];
    for (const other of others) {
      const otherGeometry = other.getGeometry();
      const otherData = otherGeometry
        ? getTessellatedFlatCoords(otherGeometry)
        : null;
      if (!otherData) {
        continue;
      }
      reverse.push({
        otherIndex: feats.indexOf(other),
        result: probeResult(
          checkOverlapWithExisting(
            otherData.coords,
            otherData.ends[otherData.ends.length - 1],
            [feature],
            new Set(),
            false,
          ),
        ),
      });
    }
    return {
      i,
      end: data.ends[data.ends.length - 1],
      forward: probeResult(forward),
      reverse,
    };
  });

  const topologyFocus = [];
  for (let i = 0; i < feats.length; i++) {
    const feature = feats[i];
    const geometry = feature.getGeometry();
    if (!geometry || feature.get('_snapPoint')) {
      continue;
    }
    const featureData = getTessellatedFlatCoords(geometry);
    const featureEnd = featureData
      ? featureData.ends[featureData.ends.length - 1]
      : 0;
    const featureArcs =
      geometry.getType() === 'CurvePolygon'
        ? collectCurveSegments(geometry)
        : [];
    for (let j = i + 1; j < feats.length; j++) {
      const other = feats[j];
      const otherGeometry = other.getGeometry();
      if (!otherGeometry || other.get('_snapPoint')) {
        continue;
      }
      const otherData = getTessellatedFlatCoords(otherGeometry);
      const otherEnd = otherData
        ? otherData.ends[otherData.ends.length - 1]
        : 0;
      const segmentWitnesses =
        featureData && otherData
          ? segmentCrossingWitnesses(
              featureData.coords,
              featureEnd,
              otherData.coords,
              otherEnd,
            )
          : [];
      const otherArcs =
        otherGeometry.getType() === 'CurvePolygon'
          ? collectCurveSegments(otherGeometry)
          : [];
      const arcWitnesses =
        featureArcs.length && otherArcs.length
          ? arcCrossingWitnesses(featureArcs, otherArcs)
          : [];
      const forward = featureData
        ? checkOverlapWithExisting(
            featureData.coords,
            featureEnd,
            [other],
            new Set(),
            false,
          )
        : null;
      const reverse = otherData
        ? checkOverlapWithExisting(
            otherData.coords,
            otherEnd,
            [feature],
            new Set(),
            false,
          )
        : null;
      if (
        arcWitnesses.length === 0 &&
        segmentWitnesses.length === 0 &&
        !forward &&
        !reverse
      ) {
        continue;
      }
      topologyFocus.push({
        featureIndex: i,
        featureId: features[i].featId,
        otherIndex: j,
        otherFeatureId: features[j].featId,
        featureType: geometry.getType(),
        otherType: otherGeometry.getType(),
        forward: probeResult(forward),
        reverse: probeResult(reverse),
        arcWitnesses,
        segmentWitnesses,
      });
    }
  }

  /**
   * Build the same trace exclusion context used by live sketch validation.
   * @return {{excluded: Set<import('../src/ol/Feature.js').default>, rings: Array<import('../src/ol/geom/Geometry.js').default>}}
   *   Features excluded from containment checks and boundary rings being traced.
   */
  function buildTraceExclusionContext() {
    const excluded = new Set(
      tracedArcs.map((arc) => arc.sourceFeature).filter(Boolean),
    );
    /** @type {Array<import('../src/ol/geom/Geometry.js').default>} */
    const rings = [];
    for (const arc of tracedArcs) {
      if (arc.ring && !rings.includes(arc.ring)) {
        rings.push(arc.ring);
      }
    }
    if (activeTraceEntry) {
      excluded.add(activeTraceEntry.feature);
      if (!rings.includes(activeTraceEntry.ring)) {
        rings.push(activeTraceEntry.ring);
      }
    } else if (traceStartCoord) {
      const activeTrace = findSourceRing(traceStartCoord);
      if (activeTrace) {
        excluded.add(activeTrace.feature);
        if (!rings.includes(activeTrace.ring)) {
          rings.push(activeTrace.ring);
        }
      }
    }
    return {excluded, rings};
  }

  let sketchTopologyFocus = null;
  const sketchFeature = draw
    ? draw.getOverlay().getSource().getFeatures()[0]
    : null;
  const sketchGeometry = sketchFeature ? sketchFeature.getGeometry() : null;
  const sketchData = sketchGeometry
    ? getTessellatedFlatCoords(sketchGeometry)
    : null;
  if (sketchGeometry && sketchData) {
    const sketchEnd = sketchData.ends[sketchData.ends.length - 1];
    const sketchArcs =
      sketchGeometry.getType() === 'CurvePolygon'
        ? collectCurveSegments(sketchGeometry)
        : [];
    const traceContext = buildTraceExclusionContext();
    const sourceNeighbours = feats.filter(
      (feature) => !feature.get('_snapPoint'),
    );
    const neighbours = [];
    for (const other of sourceNeighbours) {
      const otherGeometry = other.getGeometry();
      if (!otherGeometry) {
        continue;
      }
      const otherData = getTessellatedFlatCoords(otherGeometry);
      const otherEnd = otherData
        ? otherData.ends[otherData.ends.length - 1]
        : 0;
      const otherArcs =
        otherGeometry.getType() === 'CurvePolygon'
          ? collectCurveSegments(otherGeometry)
          : [];
      const overlap = checkOverlapWithExisting(
        sketchData.coords,
        sketchEnd,
        [other],
        traceContext.excluded,
        typeSelect.value !== 'CurvePolygon',
        traceContext.rings,
      );
      const segmentWitnesses = otherData
        ? segmentCrossingWitnesses(
            sketchData.coords,
            sketchEnd,
            otherData.coords,
            otherEnd,
          )
        : [];
      const arcWitnesses =
        sketchArcs.length && otherArcs.length
          ? arcCrossingWitnesses(sketchArcs, otherArcs)
          : [];
      if (
        !overlap &&
        segmentWitnesses.length === 0 &&
        arcWitnesses.length === 0
      ) {
        continue;
      }
      const otherIndex = feats.indexOf(other);
      neighbours.push({
        otherIndex,
        otherFeatureId: otherIndex >= 0 ? features[otherIndex].featId : null,
        otherType: otherGeometry.getType(),
        traceExcluded: traceContext.excluded.has(other),
        overlap: probeResult(overlap),
        arcWitnesses,
        segmentWitnesses,
      });
    }
    const selfIntersection =
      sketchEnd >= 8
        ? getSelfIntersectionPoint(sketchData.coords, 0, sketchEnd, 2, false)
        : null;
    sketchTopologyFocus = {
      type: sketchGeometry.getType(),
      end: sketchEnd,
      coords: sketchGeometry.getCoordinates
        ? round(sketchGeometry.getCoordinates())
        : null,
      rawSelfIntersection: round(selfIntersection),
      traceExcludedFeatureIds: Array.from(traceContext.excluded).map(
        (feature) => id('feat', feature),
      ),
      traceBoundaryRingIds: traceContext.rings.map((ring) => id('ring', ring)),
      neighbours,
    };
  }

  const realFeatureIndexes = feats
    .map((feature, index) => ({feature, index}))
    .filter(({feature}) => !feature.get('_snapPoint'))
    .map(({index}) => index);
  const lastRealFeatureIndex = realFeatureIndexes.length
    ? realFeatureIndexes[realFeatureIndexes.length - 1]
    : -1;

  const topologyState = {
    uiText: topoStatusEl.textContent,
    statusText: statusEl.textContent,
    isValid: validationState.isValid,
    crossingPoints: round(validationState.crossingPoints),
    errorSegment: round(validationState.errorSegment),
    errorFeatureIds: Array.from(validationState.errorFeatures).map((feature) =>
      id('feat', feature),
    ),
    lastRealFeatureIndex,
    lastRealFeatureTopologyFocus: topologyFocus.filter(
      (entry) =>
        entry.featureIndex === lastRealFeatureIndex ||
        entry.otherIndex === lastRealFeatureIndex,
    ),
  };

  const dump = {
    featureCount: feats.length,
    features,
    validationProbe,
    topologyState,
    sketchTopologyFocus,
    topologyFocus,
    events: debugEvents.slice(),
    state: {
      drawing,
      wasTracing,
      traceActive,
      suppressTraceUntilEnd,
      userClickedDuringTrace,
      activeTraceEntry: activeTraceEntry
        ? {
            featId: id('feat', activeTraceEntry.feature),
            ringId: id('ring', activeTraceEntry.ring),
          }
        : null,
      tracedArcs: tracedArcs.map((ta, idx) => ({
        idx,
        ringId: id('ring', ta.ring),
        sourceFeatId: id('feat', ta.sourceFeature),
        entryCoord: ta.entryCoord,
        exitCoord: ta.exitCoord,
        traceStartIdx: ta.traceStartIdx,
        traceEndIdx: ta.traceEndIdx,
        fullRing: /** @type {any} */ (ta).fullRing || false,
        chordFallback: ta.chordFallback,
        forceLineTrace: !!ta.forceLineTrace,
        sourceSegment: ta.sourceSegment ? ta.sourceSegment.getType() : null,
      })),
      segmentBreaks: segmentBreaks.slice(),
      currentSegType,
      postTraceAutoLine,
    },
    segTypeWrites: segTypeWrites.slice(),
  };

  /** @type {any} */ (window).__dump = dump;
  // eslint-disable-next-line no-console
  console.log('[SPACE DUMP]', dump);
});
