import Collection from '../src/ol/Collection.js';
import Feature from '../src/ol/Feature.js';
import Map from '../src/ol/Map.js';
import {unByKey} from '../src/ol/Observable.js';
import View from '../src/ol/View.js';
import {noModifierKeys} from '../src/ol/events/condition.js';
import CircularString from '../src/ol/geom/CircularString.js';
import CompoundCurve, {
  coordinatesToCurveGeometry,
} from '../src/ol/geom/CompoundCurve.js';
import CurvePolygon from '../src/ol/geom/CurvePolygon.js';
import LineString from '../src/ol/geom/LineString.js';
import Point from '../src/ol/geom/Point.js';
import {
  arcsAreEqual,
  getArcArcCrossingPoints,
  getArcArrayCrossings,
  getSelfIntersectionPoint,
} from '../src/ol/geom/flat/topology.js';
import Draw from '../src/ol/interaction/Draw.js';
import Modify from '../src/ol/interaction/Modify.js';
import Snap from '../src/ol/interaction/Snap.js';
import TraceSource from '../src/ol/interaction/TraceSource.js';
import TileLayer from '../src/ol/layer/Tile.js';
import VectorLayer from '../src/ol/layer/Vector.js';
import OSM from '../src/ol/source/OSM.js';
import VectorSource from '../src/ol/source/Vector.js';
import CircleStyle from '../src/ol/style/Circle.js';
import Fill from '../src/ol/style/Fill.js';
import Stroke from '../src/ol/style/Stroke.js';
import Style from '../src/ol/style/Style.js';

// ── Constants ────────────────────────────────────────────────

/** Squared distance threshold for filtering arc crossing points near endpoints. */
const CROSSING_EPSILON_SQ = 4;
/** Squared tolerance for arc coordinate comparison. */
const SAME_ARC_TOLERANCE_SQ = 1e-4;

// ── UI elements ──────────────────────────────────────────────

const statusEl = document.getElementById('status');
const modeEl = document.getElementById('segment-mode');
const topoStatusEl = document.getElementById('topology-status');
const typeSelect = document.getElementById('type');

// ── Validation state (read by sketch style) ──────────────────

const validationState = {
  isValid: true,
  /** @type {Array<Array<number>>} */
  crossingPoints: [],
  /** @type {Array<Array<number>>|null} */
  errorSegment: null,
};

/**
 * Overlay source for crossing-point red dot markers. Declared before
 * setTopoStatus so calls from resetSketchState (early init) don't throw.
 */
const crossingOverlaySource = new VectorSource();

function setTopoStatus(valid, reason) {
  validationState.isValid = valid;
  if (valid) {
    validationState.crossingPoints = [];
    validationState.errorSegment = null;
    topoStatusEl.textContent = '\u2713 Valid';
    topoStatusEl.style.background = '#28a745';
  } else {
    topoStatusEl.textContent = '\u2717 ' + reason;
    topoStatusEl.style.background = '#dc3545';
  }
  crossingOverlaySource.clear();
  for (const cp of validationState.crossingPoints) {
    crossingOverlaySource.addFeature(new Feature({geometry: new Point(cp)}));
  }
}

function status(msg) {
  statusEl.textContent = msg;
}

// ── Drawing-session state ────────────────────────────────────

let draw = null;
let drawing = false;
let traceActive = false;
let currentSegType = 'arc';
/** @type {Array<{index: number, type: string}>} */
let segmentBreaks = [{index: 0, type: 'arc'}];
/** @type {Array<Array<number>>} */
let lastSketchCoordinates = [];
/** Trace-source features whose boundary the sketch shares. */
let traceExcludedFeatures = new Set();
/** Trace-source rings whose boundary the sketch shares. */
let traceBoundaryRings = [];
/** The feature currently being actively traced (null when not tracing). */
let currentTraceFeature = null;
/** First committed vertex of the active draw session; null while not drawing. */
let startCoord = null;
/**
 * Set of indices into lastSketchCoordinates that correspond to coordinates
 * the user actually clicked (as opposed to trace-walk tessellation points).
 * Only these indices are rendered as control-point dots.
 */
const userPlacedIndices = new Set();
/** Entry index of the currently active trace (-1 when none). */
let activeTraceEntryIdx = -1;
/**
 * Index ranges [start, end] into `lastSketchCoordinates` that were produced by
 * a canonicalized trace run (inclusive). Only coordinates in these ranges are
 * subject to the canonical-contract tripwire — free / edge-snapped coordinates
 * legitimately lie on a source boundary without being control points.
 * @type {Array<{start: number, end: number}>}
 */
let tracedIndexRanges = [];
/** Single-feature source holding the active draw's start vertex for snap-to-close. */
const sketchSnapSource = new VectorSource();

function updateMode() {
  if (!drawing) {
    modeEl.textContent = '';
    return;
  }
  const m = typeSelect.value;
  if (m !== 'CompoundCurve' && m !== 'CurvePolygon') {
    modeEl.textContent = '';
    return;
  }
  modeEl.textContent =
    currentSegType === 'arc'
      ? 'ARC mode (T to toggle)'
      : 'LINE mode (T to toggle)';
}

function resetSketchState() {
  segmentBreaks = [{index: 0, type: 'arc'}];
  currentSegType = 'arc';
  drawing = false;
  traceActive = false;
  lastSketchCoordinates = [];
  startCoord = null;
  userPlacedIndices.clear();
  activeTraceEntryIdx = -1;
  tracedIndexRanges = [];
  traceExcludedFeatures = new Set();
  traceBoundaryRings = [];
  currentTraceFeature = null;
  sketchSnapSource.clear();
  updateMode();
  setTopoStatus(true, '');
}

// ── Source (declared early so helper functions can reference it) ─

const featuresCollection = new Collection();
const source = new VectorSource({features: featuresCollection});

/** Visual-only overlay of vertex dots ("control points"). */
const controlPointSource = new VectorSource();

// ── Topology helpers ─────────────────────────────────────────

/**
 * Collect curve segments from a geometry as flat [bx, by, mx, my, ex, ey].
 * @param {import('../src/ol/geom/Geometry.js').default} geom Geometry.
 * @return {Array<Array<number>>} Curve segments.
 */
function collectCurveSegments(geom) {
  const result = [];
  if (typeof geom.forEachCurveSegment !== 'function') {
    return result;
  }
  geom.forEachCurveSegment(function (bx, by, mx, my, ex, ey) {
    result.push([bx, by, mx, my, ex, ey]);
  });
  return result;
}

/**
 * Self-intersection points of a single feature's arc segments, using the exact
 * arc engine. Mirrors `CurvePolygon#getSelfIntersections` but works for ANY
 * curve geometry (CircularString / CompoundCurve / CurvePolygon) from its
 * collected [bx, by, mx, my, ex, ey] arc list — self-intersection was
 * previously only detected for CurvePolygon, so a self-crossing open curve
 * showed no markers. Adjacent arcs share an endpoint by construction;
 * `getArcArcCrossingPoints` filters near-shared-endpoint candidates, so only
 * genuine "loops back and crosses" intersections remain.
 * @param {Array<Array<number>>} arcs Arc segments.
 * @return {Array<Array<number>>} Self-intersection points (possibly empty).
 */
function getArcSelfIntersections(arcs) {
  const out = [];
  for (let i = 0, ii = arcs.length; i < ii; i++) {
    const a = arcs[i];
    for (let j = i + 1; j < ii; j++) {
      const b = arcs[j];
      if (arcsAreEqual(a, b, SAME_ARC_TOLERANCE_SQ)) {
        continue;
      }
      const pts = getArcArcCrossingPoints(
        a[0],
        a[1],
        a[2],
        a[3],
        a[4],
        a[5],
        b[0],
        b[1],
        b[2],
        b[3],
        b[4],
        b[5],
        CROSSING_EPSILON_SQ,
      );
      for (let k = 0, kk = pts.length; k < kk; k++) {
        out.push(pts[k]);
      }
    }
  }
  return out;
}

/**
 * Tessellate a geometry to flat coordinates with stride and per-sub ends.
 * @param {import('../src/ol/geom/Geometry.js').default} geometry Geometry.
 * @return {{coords: Array<number>, ends: Array<number>, stride: number}|null} Tessellated data.
 */
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
 * Polyline of the sketch sub-geometry containing the segment closest to point.
 * @param {Array<number>} coords Flat tessellated coords.
 * @param {Array<number>} ends Per-sub ends.
 * @param {Array<number>} point Crossing point.
 * @return {Array<Array<number>>|null} Polyline or null.
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
 * The single flat-polyline crossing predicate for the whole example. Calls
 * `callback` with each proper-interior crossing point between two flat
 * polylines and stops early if the callback returns a truthy value.
 *
 * "Proper interior" means both parameters are strictly inside their segments
 * (0 < t,u < 1) AND the crossing point is not within `CROSSING_EPSILON_SQ` of
 * any of the four segment endpoints. This epsilon filter is deliberate and
 * central to the demo's design:
 *   - Tessellation can place a shared vertex a few ULPs inside a neighbouring
 *     segment; without the filter that registers as a false "edges cross".
 *   - Trace-hugging INTENTIONALLY makes a new feature share boundary vertices
 *     (and whole collinear edges) with the traced source. Endpoint-touches and
 *     collinear overlaps are therefore NOT crossings here — reporting them
 *     (the classic "vertex-through" / "collinear overlap" cases) would flag
 *     every legitimately-hugged boundary. Shared boundaries are the feature,
 *     not a bug.
 * `denom === 0` (parallel/collinear) is skipped for the same reason.
 *
 * @param {Array<number>} flat1 First flat coordinates.
 * @param {number} off1 Offset into flat1.
 * @param {number} end1 End index in flat1.
 * @param {Array<number>} flat2 Second flat coordinates.
 * @param {number} off2 Offset into flat2.
 * @param {number} end2 End index in flat2.
 * @param {number} stride Stride.
 * @param {function(Array<number>): *} callback Called per crossing; return
 *     truthy to stop.
 * @return {*} The callback's truthy value, or false.
 */
function forEachInteriorSegmentsCrossing(
  flat1,
  off1,
  end1,
  flat2,
  off2,
  end2,
  stride,
  callback,
) {
  for (let i = off1 + stride; i < end1; i += stride) {
    const ax = flat1[i - stride];
    const ay = flat1[i - stride + 1];
    const bx = flat1[i];
    const by = flat1[i + 1];
    for (let j = off2 + stride; j < end2; j += stride) {
      const cx = flat2[j - stride];
      const cy = flat2[j - stride + 1];
      const dx = flat2[j];
      const dy = flat2[j + 1];
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
      const ret = callback(point);
      if (ret) {
        return ret;
      }
    }
  }
  return false;
}

/**
 * First proper-interior crossing between two flat polylines (no near-endpoint
 * touches). See {@link forEachInteriorSegmentsCrossing} for the epsilon policy.
 * @param {Array<number>} flat1 First flat.
 * @param {number} off1 Offset 1.
 * @param {number} end1 End 1.
 * @param {Array<number>} flat2 Second flat.
 * @param {number} off2 Offset 2.
 * @param {number} end2 End 2.
 * @param {number} stride Stride.
 * @return {Array<number>|undefined} Proper crossing point or undefined.
 */
function getInteriorSegmentsCrossingPoint(
  flat1,
  off1,
  end1,
  flat2,
  off2,
  end2,
  stride,
) {
  let found;
  forEachInteriorSegmentsCrossing(
    flat1,
    off1,
    end1,
    flat2,
    off2,
    end2,
    stride,
    (point) => {
      found = point;
      return true;
    },
  );
  return found;
}

/**
 * All proper-interior crossings between two flat polylines (no near-endpoint
 * touches). See {@link forEachInteriorSegmentsCrossing} for the epsilon policy.
 * @param {Array<number>} flat1 First flat.
 * @param {number} off1 Offset 1.
 * @param {number} end1 End 1.
 * @param {Array<number>} flat2 Second flat.
 * @param {number} off2 Offset 2.
 * @param {number} end2 End 2.
 * @param {number} stride Stride.
 * @return {Array<Array<number>>} All proper crossing points (possibly empty).
 */
function getInteriorSegmentsCrossingPoints(
  flat1,
  off1,
  end1,
  flat2,
  off2,
  end2,
  stride,
) {
  const out = [];
  forEachInteriorSegmentsCrossing(
    flat1,
    off1,
    end1,
    flat2,
    off2,
    end2,
    stride,
    (point) => {
      out.push(point);
      return false;
    },
  );
  return out;
}

/**
 * Squared distance from point to nearest point on a flat polyline.
 * @param {number} mx Point x.
 * @param {number} my Point y.
 * @param {Array<number>} flat Flat coords.
 * @param {number} end End.
 * @return {number} Squared distance.
 */
function pointToPolylineDist2(mx, my, flat, end) {
  let best = Infinity;
  for (let i = 2; i < end; i += 2) {
    const ax = flat[i - 2];
    const ay = flat[i - 1];
    const bx = flat[i];
    const by = flat[i + 1];
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
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
    }
  }
  return best;
}

/**
 * Check overlap between sketch and existing features: edge crossings AND
 * (for CurvePolygon mode) interior containment of sketch segment midpoints.
 * Collects EVERY crossing point (not just the first) so a traced sketch that
 * clips several existing features — or one feature at multiple points — shows a
 * balloon for each intersection rather than a single dot.
 * @param {Array<number>} sketchCoords Tessellated sketch coords.
 * @param {number} sketchEnd End of sketch coords.
 * @param {Array<Array<number>>} sketchSegments Sketch curve segments [b,m,e].
 * @param {Array<import('../src/ol/Feature.js').default>} features Source features.
 * @param {Set<import('../src/ol/Feature.js').default>} excludedFromContainment Features whose boundary the sketch shares.
 * @param {boolean} skipContainment Skip containment check.
 * @return {{reason: string, points: Array<Array<number>>}|null} Overlap descriptor or null.
 */
function checkOverlapWithExisting(
  sketchCoords,
  sketchEnd,
  sketchSegments,
  features,
  excludedFromContainment,
  skipContainment,
) {
  /** @type {Array<Array<number>>} */
  const crossingPoints = [];
  /** @type {Array<Array<number>>} */
  const containedPoints = [];
  for (const feat of features) {
    if (feat.get('_snapPoint')) {
      continue;
    }
    const existingGeom = feat.getGeometry();
    if (!existingGeom) {
      continue;
    }
    const existing = getTessellatedFlatCoords(existingGeom);
    if (!existing) {
      continue;
    }
    // Crossing check. Prefer the arc-aware primitive: when both sketch and
    // source expose curve segments, compare their [b,m,e] triplets with
    // getArcArrayCrossings, whose same-arc skip (arcsAreEqual, reversal-aware)
    // recognises a trace-hugged boundary — even a reverse-traced arc whose
    // canonical triplet is [end,mid,start] — as SHARED, not crossing. The
    // tessellation predicate cannot: two samplings of the same arc anchored at
    // opposite ends interleave and read as many spurious mid-segment crossings
    // (the "false positive at trace exit" symptom). Tessellation is used only
    // as a fallback for non-curve sources (plain Polygon / LineString), whose
    // straight edges tessellate identically and never produce that artefact.
    // Both primitives return ALL crossings; collect them so every intersection
    // gets its own balloon.
    const sourceSegments = collectCurveSegments(existingGeom);
    if (sketchSegments.length > 0 && sourceSegments.length > 0) {
      const arcCrossings = getArcArrayCrossings(
        sketchSegments,
        sourceSegments,
        CROSSING_EPSILON_SQ,
        true,
        SAME_ARC_TOLERANCE_SQ,
      );
      for (const p of arcCrossings) {
        crossingPoints.push(p);
      }
    } else {
      const pts = getInteriorSegmentsCrossingPoints(
        sketchCoords,
        0,
        sketchEnd,
        existing.coords,
        0,
        existing.ends[existing.ends.length - 1],
        2,
      );
      for (const p of pts) {
        crossingPoints.push(p);
      }
    }
    if (
      !skipContainment &&
      !excludedFromContainment.has(feat) &&
      existingGeom.containsXY
    ) {
      const ext = existingGeom.getExtent();
      const span = Math.max(ext[2] - ext[0], ext[3] - ext[1]);
      const onBoundaryTol2 = Math.pow(span * 1e-4, 2);
      const ec = existing.coords;
      const eend = existing.ends[existing.ends.length - 1];
      for (let ti = 0; ti < sketchEnd - 2; ti += 2) {
        const mx = (sketchCoords[ti] + sketchCoords[ti + 2]) / 2;
        const my = (sketchCoords[ti + 1] + sketchCoords[ti + 3]) / 2;
        if (pointToPolylineDist2(mx, my, ec, eend) < onBoundaryTol2) {
          continue;
        }
        if (existingGeom.containsXY(mx, my)) {
          // One representative point per contained feature is enough.
          containedPoints.push([mx, my]);
          break;
        }
      }
    }
  }
  if (crossingPoints.length > 0) {
    return {
      reason: 'Overlaps existing feature (edges cross)',
      points: crossingPoints,
    };
  }
  if (containedPoints.length > 0) {
    return {
      reason: 'Overlaps existing feature (contained)',
      points: containedPoints,
    };
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

// ── Sketch geometry builder (segment-break driven) ───────────

/**
 * Normalize segment breaks: sorted by index, dedupe by index keeping last.
 * @param {Array<{index: number, type: string}>} breaks Segment breaks.
 * @return {Array<{index: number, type: string}>} Normalized breaks.
 */
function normalizeSegmentBreaks(breaks) {
  return breaks
    .map((b, order) => ({index: b.index, type: b.type, order}))
    .sort((a, b) => a.index - b.index || a.order - b.order)
    .reduce((result, b) => {
      const last = result[result.length - 1];
      if (last && last.index === b.index) {
        last.type = b.type;
      } else {
        result.push({index: b.index, type: b.type});
      }
      return result;
    }, []);
}

/**
 * Slice coords by breaks and produce a list of arc/line sub-geometries.
 * @param {Array<Array<number>>} coords Coordinates (already canonical after getCanonicalCoordinates).
 * @param {Array<{index: number, type: string}>} breaks Segment breaks.
 * @return {Array<import('../src/ol/geom/SimpleGeometry.js').default>} Sub-geometries.
 */
function buildSubsFromBreaks(coords, breaks) {
  const geoms = [];
  const norm = normalizeSegmentBreaks(breaks);
  for (let i = 0; i < norm.length; i++) {
    const {index, type} = norm[i];
    const end = i + 1 < norm.length ? norm[i + 1].index + 1 : coords.length;
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

/**
 * Build the sketch geometry's subs for the active draw mode. The sketch is
 * always rendered as a `CompoundCurve` (mutated in place via
 * `setGeometriesArray`) regardless of the user's target geometry type. The
 * proper final geometry is constructed in `finalizeGeometry` at `drawend`.
 * @param {Array<Array<number>>} coords Coordinates.
 * @param {Array<{index: number, type: string}>} breaks Segment breaks.
 * @return {Array<import('../src/ol/geom/SimpleGeometry.js').default>} Subs.
 */
function buildSketchSubs(coords, breaks) {
  const subs = buildSubsFromBreaks(coords, breaks);
  if (subs.length === 0) {
    return [
      new LineString(coords.length >= 2 ? coords : [coords[0], coords[0]]),
    ];
  }
  return subs;
}

/**
 * Build the final feature geometry from the sketch's coords/breaks.
 * @param {Array<Array<number>>} coords Coordinates (already canonical — arc tessellations replaced).
 * @param {Array<{index: number, type: string}>} breaks Segment breaks.
 * @param {string} mode Draw mode.
 * @return {import('../src/ol/geom/Geometry.js').default} Final geometry.
 */
function buildFinalGeometry(coords, breaks, mode) {
  if (mode === 'CircularString') {
    return new CircularString(coords);
  }
  const subs = buildSubsFromBreaks(coords, breaks);
  const wrapped =
    subs.length === 0
      ? [new LineString(coords.length >= 2 ? coords : [coords[0], coords[0]])]
      : subs;
  if (mode === 'CompoundCurve') {
    return wrapped.length === 1 ? wrapped[0] : new CompoundCurve(wrapped);
  }
  // CurvePolygon
  const ring = wrapped.length === 1 ? wrapped[0] : new CompoundCurve(wrapped);
  return new CurvePolygon([ring]);
}

/**
 * Enforce the exact-shared-geometry contract at commit time. A canonicalized
 * trace run must consist entirely of exact source control points (graph
 * vertices or arc throughpoints). This tripwire checks ONLY the coordinates
 * inside known traced index ranges — free and edge-snapped coordinates
 * legitimately lie on a source boundary without being control points, so
 * checking every coordinate (as an earlier version did) produced false
 * positives under `edge: true` snapping. Comparison is exact (a tiny absolute
 * epsilon for float drift), not resolution-scaled: a canonical coordinate is
 * copied verbatim from the source, so anything but an exact match means a
 * tessellated arc sample leaked in.
 * @param {Array<import('../src/ol/coordinate.js').Coordinate>} coords Finished
 *     feature coordinates.
 * @param {Array<{start: number, end: number}>} ranges Traced index ranges.
 * @return {string|null} Violation description, or null.
 */
function findCanonicalContractViolation(coords, ranges) {
  if (traceExcludedFeatures.size === 0 || ranges.length === 0) {
    return null;
  }
  /** @type {Array<import('../src/ol/coordinate.js').Coordinate>} */
  const allowed = [];
  for (const feat of traceExcludedFeatures) {
    const geom = feat.getGeometry();
    if (!geom) {
      continue;
    }
    for (const cp of getControlPoints(geom)) {
      allowed.push(cp.coord);
    }
  }
  const tol2 = 1e-6; // exact match modulo float drift
  for (const {start, end} of ranges) {
    for (let idx = start; idx <= end && idx < coords.length; idx++) {
      const c = coords[idx];
      let matched = false;
      for (const a of allowed) {
        const dx = c[0] - a[0];
        const dy = c[1] - a[1];
        if (dx * dx + dy * dy < tol2) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        return (
          `traced coordinate #${idx} [${c[0].toFixed(1)}, ${c[1].toFixed(1)}] ` +
          `matches no source control point (a tessellated arc sample was ` +
          `committed as canonical)`
        );
      }
    }
  }
  return null;
}

// ── Multi-feature topology validation ────────────────────────

/**
 * Validate the ENTIRE scene for self-intersections and pair-wise crossings and
 * render a red dot at every crossing point. Updates `validationState`.
 *
 * This is deliberately global (every feature, not just the one being edited).
 * `setTopoStatus` rebuilds `crossingOverlaySource` from scratch on every call,
 * so validating only the edited feature would erase the markers belonging to
 * every OTHER crossing pair in the scene. That was the cause of "some
 * validation errors disappear during a modify": editing feature A wiped the
 * red dots for an existing B×C crossing because B and C were never revisited.
 * @return {boolean} True when the scene has no crossings.
 */
function validateFeatures() {
  const allFeatures = source.getFeatures().filter((f) => !f.get('_snapPoint'));
  /** @type {Array<Array<number>>} */
  const allCrossings = [];
  // NOTE: `Map` is imported from ol/Map.js in this example, so `new Map()`
  // would create an ol Map whose BaseObject#set stringifies its key — every
  // Feature collapses to "[object Object]" and all lookups return the last
  // feature's arcs. Use the native Map (via `window.Map`) for a real keyed map.
  /** @type {Map<import('../src/ol/Feature.js').default, Array<Array<number>>>} */
  const arcsByFeature = new window.Map();
  let hasSelfIntersection = false;

  // Arc segments + self-intersections for every feature in the scene.
  for (const f of allFeatures) {
    const g = f.getGeometry();
    if (!g) {
      continue;
    }
    // Arc segments for every curve geometry (empty for plain Polygon /
    // LineString, which fall back to tessellation for pair-wise checks).
    const arcs = collectCurveSegments(g);
    arcsByFeature.set(f, arcs);
    // Self-intersection for ANY curve type — not just CurvePolygon. Open
    // curves (CircularString / CompoundCurve) can loop across themselves too;
    // gating this on CurvePolygon is why self-crossing lines showed no marker.
    if (arcs.length > 0) {
      const selfX = getArcSelfIntersections(arcs);
      if (selfX.length > 0) {
        hasSelfIntersection = true;
        allCrossings.push(...selfX);
      }
    }
  }

  // Check every unordered pair of features exactly once.
  for (let i = 0, ii = allFeatures.length; i < ii; i++) {
    const fa = allFeatures[i];
    const ga = fa.getGeometry();
    if (!ga) {
      continue;
    }
    for (let j = i + 1; j < ii; j++) {
      const fb = allFeatures[j];
      const gb = fb.getGeometry();
      if (!gb) {
        continue;
      }
      // Exact arc-vs-arc whenever BOTH features expose curve segments (covers
      // every CurvePolygon / CircularString / CompoundCurve combination, not
      // just CurvePolygon-vs-CurvePolygon). Tessellation is used only when one
      // side is a plain geometry with no arcs. The same-arc skip keeps
      // trace-hugged shared boundaries from reading as crossings.
      const arcsA = arcsByFeature.get(fa);
      const arcsB = arcsByFeature.get(fb);
      if (arcsA.length > 0 && arcsB.length > 0) {
        const cross = getArcArrayCrossings(
          arcsA,
          arcsB,
          CROSSING_EPSILON_SQ,
          true,
          SAME_ARC_TOLERANCE_SQ,
        );
        allCrossings.push(...cross);
      } else {
        const a = getTessellatedFlatCoords(ga);
        const b = getTessellatedFlatCoords(gb);
        if (!a || !b) {
          continue;
        }
        // Iterate each part (ring) of both geometries separately. Feeding a
        // single 0..lastEnd span for a multi-ring geometry stitches the last
        // vertex of one ring to the first of the next, inventing a phantom
        // segment that can register bogus crossings. Per-part bounds prevent
        // that. Uses the one epsilon-filtered predicate the whole example
        // shares, so trace-hugged shared boundaries never read as crossings.
        let aStart = 0;
        for (let ai = 0; ai < a.ends.length; ai++) {
          const aEnd = a.ends[ai];
          let bStart = 0;
          for (let bi = 0; bi < b.ends.length; bi++) {
            const bEnd = b.ends[bi];
            const crosses = getInteriorSegmentsCrossingPoints(
              a.coords,
              aStart,
              aEnd,
              b.coords,
              bStart,
              bEnd,
              2,
            );
            allCrossings.push(...crosses);
            bStart = bEnd;
          }
          aStart = aEnd;
        }
      }
    }
  }

  if (allCrossings.length > 0) {
    validationState.crossingPoints = allCrossings;
    setTopoStatus(
      false,
      hasSelfIntersection ? 'Self-intersecting' : 'Overlaps',
    );
    return false;
  }
  setTopoStatus(true, '');
  return true;
}

// ── Live sketch validation (called from geometryFunction) ────

/**
 * Validate the in-progress sketch geometry. Highlights crossings in red.
 * @param {import('../src/ol/geom/Geometry.js').default} geometry Sketch geometry.
 * @param {boolean} checkOverlap Whether to check overlap with existing features.
 */
function validateSketchTopology(geometry, checkOverlap) {
  try {
    const data = getTessellatedFlatCoords(geometry);
    if (!data || data.coords.length < 4) {
      setTopoStatus(true, '');
      return;
    }
    const totalEnd = data.ends[data.ends.length - 1];

    // ── Self-intersection ─────────────────────────────────────────────────
    // Tessellation-based check (fast, works for all geometry types).
    if (totalEnd >= 8) {
      const selfInt = getSelfIntersectionPoint(
        data.coords,
        0,
        totalEnd,
        2,
        false,
      );
      if (selfInt) {
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
      totalEnd >= 4
    ) {
      const others = source
        .getFeatures()
        .filter((f) => !f.get('_snapPoint') && f !== currentTraceFeature);
      const overlap = checkOverlapWithExisting(
        data.coords,
        totalEnd,
        collectCurveSegments(geometry),
        others,
        traceExcludedFeatures,
        mode !== 'CurvePolygon',
      );
      if (overlap) {
        validationState.crossingPoints = overlap.points;
        validationState.errorSegment = findSketchSubGeomNear(
          data.coords,
          data.ends,
          overlap.points[0],
        );
        setTopoStatus(false, overlap.reason);
        return;
      }
    }

    validationState.crossingPoints = [];
    validationState.errorSegment = null;
    setTopoStatus(true, '');
  } catch (err) {
    // Surface the failure loudly (full error + stack) instead of silently
    // collapsing every exception into a terse status line — a swallowed
    // validation bug would otherwise look identical to a genuine crossing.
    // eslint-disable-next-line no-console
    console.error('[validateSketchTopology] threw:', err);
    setTopoStatus(false, 'Validation error: ' + err.message);
  }
}

/**
 * Per-click condition. Lightweight crossing check vs. existing features for
 * the new candidate edge. Topology guarantee for trace exit comes from
 * `TraceSource`'s vertex-only-exit lifecycle.
 * @param {import('../src/ol/MapBrowserEvent.js').default} event Browser event.
 * @return {boolean} Whether to accept the click.
 */
function checkCrossingCondition(event) {
  if (!noModifierKeys(event)) {
    return false;
  }
  if (!draw || !drawing) {
    return true;
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

  const features = source.getFeatures().filter((f) => !f.get('_snapPoint'));
  for (const f of features) {
    const existing = getTessellatedFlatCoords(f.getGeometry());
    if (!existing) {
      continue;
    }
    if (
      isVertexInFlat(
        lastPt,
        existing.coords,
        existing.ends[existing.ends.length - 1],
      ) &&
      isVertexInFlat(
        candidate,
        existing.coords,
        existing.ends[existing.ends.length - 1],
      )
    ) {
      continue;
    }
    const crossing = getInteriorSegmentsCrossingPoint(
      newSeg,
      0,
      4,
      existing.coords,
      0,
      existing.ends[existing.ends.length - 1],
      2,
    );
    if (crossing) {
      validationState.crossingPoints = [crossing];
      setTopoStatus(false, 'Crosses existing feature');
      return true; // advisory — don't block
    }
  }

  if (!traceActive) {
    const sketchFlat = [];
    for (let i = 0; i < coords.length - 1; i++) {
      sketchFlat.push(coords[i][0], coords[i][1]);
    }
    const checkEnd = sketchFlat.length - 2;
    if (checkEnd >= 4) {
      const crossing = getInteriorSegmentsCrossingPoint(
        newSeg,
        0,
        4,
        sketchFlat,
        0,
        checkEnd,
        2,
      );
      if (crossing) {
        validationState.crossingPoints = [crossing];
        setTopoStatus(false, 'Self-intersecting');
        return true; // advisory — don't block
      }
    }
  }

  setTopoStatus(true, '');
  return true;
}

// ── Styles ───────────────────────────────────────────────────

function featureStyle(feature) {
  if (feature.get('_snapPoint')) {
    return null;
  }
  const styles = [
    new Style({
      stroke: new Stroke({color: '#0064c8', width: 3}),
      fill: new Fill({color: 'rgba(0, 100, 200, 0.12)'}),
    }),
  ];
  return styles;
}

function sketchStyle(feature) {
  const geom = feature.getGeometry();
  const valid = validationState.isValid;
  const errSeg = validationState.errorSegment;
  const mainColor = valid || errSeg ? '#28a745' : '#dc3545';

  if (geom.getType() === 'Point') {
    // Size the cursor dot to signal what the NEXT click will commit:
    //   small ring  = arc midpoint / throughpoint
    //   large solid = arc endpoint or line vertex
    let nextIsMid = false;
    if (drawing && lastSketchCoordinates.length >= 1) {
      const norm = normalizeSegmentBreaks(segmentBreaks);
      const lastBreak = norm[norm.length - 1];
      const committedInSeg = lastSketchCoordinates.length - 1 - lastBreak.index;
      nextIsMid = lastBreak.type === 'arc' && committedInSeg % 2 === 1;
    }
    return new Style({
      image: new CircleStyle({
        radius: nextIsMid ? 4 : 6,
        fill: new Fill({color: valid ? '#28a745' : '#dc3545'}),
        stroke: nextIsMid ? new Stroke({color: '#fff', width: 1.5}) : undefined,
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

  // Committed control-point overlay.
  // Render a dot only for indices the user actually clicked; trace-walk
  // tessellation points are excluded (they were never added to userPlacedIndices).
  if (lastSketchCoordinates.length >= 2) {
    const norm = normalizeSegmentBreaks(segmentBreaks);
    const tipIdx = lastSketchCoordinates.length - 1;
    for (let i = 0; i < tipIdx; i++) {
      if (!userPlacedIndices.has(i)) {
        continue;
      }
      // Find which segment this coordinate belongs to and derive its role.
      let isMid = false;
      for (let si = norm.length - 1; si >= 0; si--) {
        if (i >= norm[si].index) {
          isMid = norm[si].type === 'arc' && (i - norm[si].index) % 2 === 1;
          break;
        }
      }
      styles.push(
        new Style({
          geometry: new Point(lastSketchCoordinates[i]),
          image: new CircleStyle({
            radius: isMid ? 3 : 5,
            fill: new Fill({color: isMid ? '#fff' : mainColor}),
            stroke: new Stroke({color: mainColor, width: 1.5}),
          }),
        }),
      );
    }

    // Dashed ring around the start vertex once the polygon has enough points
    // to close. Tells the user: click here (snap will help) to finish.
    if (
      typeSelect.value === 'CurvePolygon' &&
      startCoord &&
      lastSketchCoordinates.length >= 4
    ) {
      styles.push(
        new Style({
          geometry: new Point(startCoord),
          image: new CircleStyle({
            radius: 11,
            fill: new Fill({color: 'rgba(40, 167, 69, 0.12)'}),
            stroke: new Stroke({
              color: mainColor,
              width: 2,
              lineDash: [4, 3],
            }),
          }),
        }),
      );
    }
  }

  return styles;
}

// ── Control-point overlay (visual only) ──────────────────────

/**
 * Extract vertex coordinates from a feature's geometry. For `CircularString`
 * subs we mark midpoints separately so the style can render them smaller.
 * @param {import('../src/ol/geom/Geometry.js').default} geom Geometry.
 * @return {Array<{coord: Array<number>, isMid: boolean}>} Control points.
 */
function getControlPoints(geom) {
  const out = [];
  function fromSimple(g) {
    const coords = g.getCoordinates();
    const isCirc = g.getType() === 'CircularString';
    for (let i = 0; i < coords.length; i++) {
      out.push({coord: coords[i], isMid: isCirc && i % 2 === 1});
    }
  }
  function fromRing(ring) {
    if (ring.getType() === 'CompoundCurve') {
      for (const sub of ring.getGeometriesArray()) {
        fromSimple(sub);
      }
    } else {
      fromSimple(ring);
    }
  }
  const type = geom.getType();
  if (type === 'CurvePolygon') {
    for (const ring of geom.getRingsArray()) {
      fromRing(ring);
    }
  } else if (type === 'CompoundCurve') {
    fromRing(geom);
  } else if (type === 'CircularString' || type === 'LineString') {
    fromSimple(geom);
  }
  return out;
}

function rebuildControlPointSource() {
  controlPointSource.clear();
  for (const feat of source.getFeatures()) {
    const geom = feat.getGeometry();
    if (!geom) {
      continue;
    }
    for (const pt of getControlPoints(geom)) {
      controlPointSource.addFeature(
        new Feature({
          geometry: new Point(pt.coord),
          _controlPoint: true,
          _isMid: pt.isMid,
        }),
      );
    }
  }
}

function controlPointStyle(feature) {
  const isMid = !!feature.get('_isMid');
  return new Style({
    image: new CircleStyle({
      radius: isMid ? 3 : 5,
      fill: new Fill({color: isMid ? '#ffffff' : '#0064c8'}),
      stroke: new Stroke({color: '#003a73', width: 1.5}),
    }),
  });
}

let modifyActive = false;

source.on(['addfeature', 'removefeature', 'changefeature'], () => {
  // Skip during modify drag — rebuilding on every mousemove causes jank.
  // modifyend triggers a final rebuild after the drag completes.
  if (!modifyActive) {
    rebuildControlPointSource();
  }
});

// ── Map setup ────────────────────────────────────────────────

// Demo features pre-seeded so trace can be exercised immediately.
const demoPoly = new Feature(
  new CurvePolygon([
    new CompoundCurve([
      new LineString([
        [0, 0],
        [1e6, 0],
      ]),
      new CircularString([
        [1e6, 0],
        [1.5e6, 5e5],
        [1e6, 1e6],
      ]),
      new LineString([
        [1e6, 1e6],
        [0, 1e6],
        [0, 0],
      ]),
    ]),
  ]),
);
const demoLine = new Feature(
  new LineString([
    [0, 0],
    [-1e6, -1e6],
  ]),
);
const demoArc = new Feature(
  new CurvePolygon([
    new CircularString([
      [-2e6, 1e6],
      [-1.5e6, 1.5e6],
      [-1e6, 1e6],
      [-1.5e6, 5e5],
      [-2e6, 1e6],
    ]),
  ]),
);
source.addFeatures([demoPoly, demoLine, demoArc]);

const map = new Map({
  layers: [
    new TileLayer({source: new OSM()}),
    new VectorLayer({source, style: featureStyle}),
    new VectorLayer({source: controlPointSource, style: controlPointStyle}),
    new VectorLayer({
      source: crossingOverlaySource,
      style: new Style({
        image: new CircleStyle({
          radius: 10,
          fill: new Fill({color: 'rgba(220, 53, 69, 0.4)'}),
          stroke: new Stroke({color: '#dc3545', width: 3}),
        }),
      }),
    }),
  ],
  target: 'map',
  view: new View({center: [0, 0], zoom: 4}),
});

// Expose for browser inspection.
/** @type {any} */ (window).__map = map;

// ── Trace source ─────────────────────────────────────────────

const traceSource = new TraceSource({
  features: source.getFeaturesCollection(),
  exteriorOnly: true,
});

// ── Modify + Snap interactions ───────────────────────────────

const modify = new Modify({
  source,
  filter: (feature) => !feature.get('_snapPoint'),
});
const snap = new Snap({source, vertex: true, edge: true});
// Dedicated vertex snap on the control-point overlay (exact Point features at
// every graph vertex). Generous tolerance so the user can reliably grab a
// vertex to start tracing.
const controlPointSnap = new Snap({
  source: controlPointSource,
  vertex: true,
  edge: false,
  pixelTolerance: 20,
});
// Snaps to the start vertex of the active draw so a single click closes a CurvePolygon.
const sketchSnap = new Snap({
  source: sketchSnapSource,
  vertex: true,
  edge: false,
  pixelTolerance: 20,
});
map.addInteraction(modify);
map.addInteraction(snap);
map.addInteraction(controlPointSnap);
map.addInteraction(sketchSnap);

/** @type {Map<import('../src/ol/Feature.js').default, import('../src/ol/geom/Geometry.js').default>} */
const modifyStartSnapshots = new window.Map();

/** @type {Array<import('../src/ol/events.js').EventsKey>} */
let modifyChangeKeys = [];
/** @type {Set<import('../src/ol/Feature.js').default>} */
let modifyTargetFeatures = new Set();

modify.on('modifystart', (event) => {
  modifyActive = true;
  modifyStartSnapshots.clear();
  source.getFeatures().forEach((f) => {
    if (f.get('_snapPoint')) {
      return;
    }
    modifyStartSnapshots.set(f, f.getGeometry().clone());
  });

  // Live crossing feedback: validate synchronously on every geometry change
  // so that crossingOverlaySource is updated before OL's already-scheduled
  // render fires. Using rAF here meant OL rendered first (from its own
  // feature.changed() → map.scheduleRender() chain) then our rAF updated the
  // overlay source — but with no subsequent render scheduled, the dot never
  // appeared. Synchronous validation ensures the overlay source is populated
  // at render time.
  modifyTargetFeatures = new Set(
    event.features.getArray().filter((f) => !f.get('_snapPoint')),
  );
  modifyChangeKeys = [];
  for (const f of modifyTargetFeatures) {
    const key = f.on('change', () => {
      if (modifyActive) {
        validateFeatures();
      }
    });
    modifyChangeKeys.push(key);
  }
});

modify.on('modifyend', () => {
  modifyActive = false;
  // Remove live-validation listeners.
  modifyChangeKeys.forEach(unByKey);
  modifyChangeKeys = [];

  // Invalidate the TraceSource graph so it reflects the updated vertex
  // positions (e.g. when Modify connects two features at a shared node).
  traceSource.invalidate();
  validateFeatures();
  if (validationState.isValid) {
    status('Edit accepted.');
  } else {
    status('Edit creates crossing — shown in red. Undo to revert.');
  }
  modifyStartSnapshots.clear();
  rebuildControlPointSource();
});

// ── Draw interaction wiring ──────────────────────────────────

function wireTraceLifecycle(drawInteraction) {
  // Index of the trace-entry vertex in the sketch. Stable across the trace:
  // canonicalization at traceend removes/appends only coordinates AFTER this
  // index, so it never shifts.
  let traceEntryIdx = -1;
  drawInteraction.on('tracestart', () => {
    traceActive = true;
    currentTraceFeature = null;
    // tracestart fires INSIDE the exit/entry click handling, BEFORE the
    // entry-click's addToDrawing_ commits the clicked vertex. That vertex
    // lands at exactly the current tip slot (length - 1).
    traceEntryIdx = Math.max(0, lastSketchCoordinates.length - 1);
    activeTraceEntryIdx = traceEntryIdx;
    userPlacedIndices.add(activeTraceEntryIdx);
    status('Tracing along boundary — click a vertex to exit.');
  });

  drawInteraction.on('trace', (e) => {
    // Accumulate every feature whose boundary this trace touches (a single
    // trace may junction-hop across features A→B→…). Doing this from the
    // continuous `trace` event — not only at traceend — keeps every hugged
    // feature excluded from containment/crossing checks.
    if (e.traceSourceFeature) {
      currentTraceFeature = e.traceSourceFeature;
      traceExcludedFeatures.add(e.traceSourceFeature);
    }
    if (
      e.traceSourceGeometry &&
      !traceBoundaryRings.includes(e.traceSourceGeometry)
    ) {
      traceBoundaryRings.push(e.traceSourceGeometry);
    }
    // Live preview: while tracing, the sketch tail is a tessellated polyline
    // (the walk keeps its current mechanics; only the exit converts to
    // canonical control points). Render the whole traced run as a single
    // LineString by ensuring ONE 'line' break at the entry vertex. This
    // splits the traced polyline from the pre-trace free segment without
    // stamping per-point breaks — so backtracking, which removes tail
    // coordinates, can never strand a break at a vanished index.
    //
    // The break must be forced to type 'line' even when one already sits at
    // the entry index. When the trace starts as the FIRST drawing action (the
    // click lands directly on an origin-feature vertex), traceEntryIdx is 0 —
    // exactly where drawstart seeded {index: 0, type: 'arc'}. A simple
    // "append when last.index < entry" test never fires there, leaving the
    // traced tessellation typed 'arc', so buildSketchSubs fits a CircularString
    // through every tessellation sample and a rogue arc bulges along a run that
    // should hug the traced geometry. Find-or-replace keeps exactly one break
    // at the entry index, retyped to 'line'.
    if (traceEntryIdx < 0) {
      return;
    }
    const existing = segmentBreaks.find((b) => b.index === traceEntryIdx);
    if (existing) {
      existing.type = 'line';
    } else {
      segmentBreaks.push({index: traceEntryIdx, type: 'line'});
    }
  });

  drawInteraction.on('traceend', (e) => {
    traceActive = false;
    currentTraceFeature = null;
    const E = traceEntryIdx;
    traceEntryIdx = -1;
    activeTraceEntryIdx = -1;
    if (e.traceSourceFeature) {
      traceExcludedFeatures.add(e.traceSourceFeature);
    }
    if (
      e.traceSourceGeometry &&
      !traceBoundaryRings.includes(e.traceSourceGeometry)
    ) {
      traceBoundaryRings.push(e.traceSourceGeometry);
    }

    // The sketch tail is now canonical (Draw.canonicalizeTraceRun_ ran before
    // this event). `traceSourceCanonicalEdges` describes the traced run as an
    // ordered list of {kind, controlPointCount}. Stamp segment breaks at the
    // exact canonical indices, walking control-point counts from the entry.
    const edges = e.traceSourceCanonicalEdges || [];
    // Drop the temporary live-preview break (and any defensive stragglers) at
    // or beyond the entry vertex before re-stamping from the canonical run.
    segmentBreaks = segmentBreaks.filter((b) => b.index < E);
    if (edges.length === 0) {
      return;
    }
    let pos = E;
    let lastType = null;
    for (let k = 0; k < edges.length; k++) {
      const type = edges[k].kind === 'CircularString' ? 'arc' : 'line';
      // Always split the first traced edge from the pre-trace segment. Merge
      // consecutive traced line edges into one LineString; arcs never merge.
      if (k === 0 || !(type === 'line' && lastType === 'line')) {
        segmentBreaks.push({index: pos, type});
      }
      lastType = type;
      pos += edges[k].controlPointCount - 1;
    }
    // Record the canonical run's coordinate span so the commit-time tripwire
    // checks exactly these indices (and nothing free/edge-snapped).
    if (pos > E) {
      tracedIndexRanges.push({start: E, end: pos});
    }
    // Start the post-trace free segment at the exit vertex (pos), typed to the
    // user's current mode. Skip when it would merge with a trailing traced
    // line of the same type.
    if (!(currentSegType === 'line' && lastType === 'line')) {
      segmentBreaks.push({index: pos, type: currentSegType});
    }

    // Rebuild the sketch geometry from the now-canonical coordinates and the
    // fresh breaks, then revalidate immediately. The canonicalization churn
    // (removeLastPoints_/appendCoordinates) left the rendered CompoundCurve and
    // `validationState` reflecting the STALE live-preview breaks; nothing else
    // reruns geometryFunction until the next pointermove. Without this, a
    // finish (double-click) or auto-close firing in that window would read a
    // stale verdict and render collapsed-to-chords geometry.
    const sketchFeature = draw.getOverlay().getSource().getFeatures()[0];
    if (sketchFeature && lastSketchCoordinates.length >= 2) {
      const sketchGeom = sketchFeature.getGeometry();
      if (sketchGeom && sketchGeom.getType() === 'CompoundCurve') {
        /** @type {CompoundCurve} */ (sketchGeom).setGeometriesArray(
          buildSketchSubs(lastSketchCoordinates, segmentBreaks),
        );
        validateSketchTopology(sketchGeom, true);
      }
    }
  });
}

function addDrawInteraction() {
  if (draw) {
    map.removeInteraction(draw);
    draw = null;
  }
  resetSketchState();

  const mode = typeSelect.value;
  if (mode === 'None') {
    modify.setActive(true);
    snap.setActive(true);
    status(
      'Edit mode — drag vertices to modify. Press Start Draw to add features.',
    );
    return;
  }
  modify.setActive(false);

  if (mode === 'CircularString') {
    draw = new Draw({
      source,
      type: 'LineString',
      snapTolerance: 20,
      style: sketchStyle,
      condition: checkCrossingCondition,
      geometryFunction(coordinates, geometry) {
        lastSketchCoordinates = coordinates.map((c) => c.slice());
        const built = new CircularString(coordinates);
        if (!geometry) {
          geometry = built;
        } else {
          geometry.setCoordinates(built.getCoordinates());
        }
        validateSketchTopology(geometry, true);
        return geometry;
      },
      finishCondition() {
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
    // CompoundCurve or CurvePolygon — mixed arc/line via segment breaks.
    const isCurvePolygon = mode === 'CurvePolygon';
    let closing = false;

    draw = new Draw({
      source,
      type: 'LineString',
      trace: true,
      traceSource,
      snapTolerance: 20,
      style: sketchStyle,
      condition: checkCrossingCondition,
      geometryFunction(coordinates, geometry) {
        const prevLen = lastSketchCoordinates.length;
        lastSketchCoordinates = coordinates.map((c) => c.slice());
        // Track user-clicked indices (not trace-walk tessellation).
        // addToDrawing_ grows length by 1; modifyDrawing_ keeps length equal.
        // Trace-walk addToDrawing_ calls are guarded by traceActive.
        if (
          drawing &&
          !traceActive &&
          prevLen > 0 &&
          lastSketchCoordinates.length === prevLen + 1
        ) {
          userPlacedIndices.add(lastSketchCoordinates.length - 2);
        }
        const subs = buildSketchSubs(coordinates, segmentBreaks);

        if (!geometry) {
          geometry = new CompoundCurve(subs);
        } else {
          /** @type {CompoundCurve} */ (geometry).setGeometriesArray(subs);
        }

        // Auto-close: when the cursor near-snaps back to the start vertex.
        if (
          isCurvePolygon &&
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
        return feat.getGeometry().getCoordinates().length >= 3;
      },
    });

    draw.on('drawstart', (e) => {
      drawing = true;
      currentSegType = 'arc';
      segmentBreaks = [{index: 0, type: 'arc'}];
      traceExcludedFeatures = new Set();
      traceBoundaryRings = [];
      tracedIndexRanges = [];
      userPlacedIndices.clear();
      userPlacedIndices.add(0); // first vertex
      const coords = e.feature.getGeometry().getCoordinates();
      if (coords.length > 0) {
        startCoord = coords[0].slice();
        // Populate the sketch-snap source with the start vertex so the user
        // can single-click it (snapped) to close a CurvePolygon.
        if (isCurvePolygon) {
          sketchSnapSource.clear();
          sketchSnapSource.addFeature(
            new Feature({geometry: new Point(startCoord)}),
          );
        }
      }
      updateMode();
    });

    wireTraceLifecycle(draw);

    status(
      isCurvePolygon
        ? 'CurvePolygon — click to draw. T=toggle arc/line. Click a vertex to start trace, click another vertex to exit. Snap start to close.'
        : 'CompoundCurve — click to draw. T=toggle arc/line. Click a vertex to start trace. Dblclick to finish.',
    );
  }

  draw.on('drawend', (e) => {
    drawing = false;
    e.feature.set('_drawn', true);
    // Replace the sketch's CompoundCurve with the proper final type.
    const mode = typeSelect.value;
    if (mode === 'CompoundCurve' || mode === 'CurvePolygon') {
      // The sketch is already canonical: traced runs are converted to exact
      // source control points at `traceend` (Draw.canonicalizeTraceRun_), so
      // `lastSketchCoordinates` and `segmentBreaks` are consistent with no
      // post-hoc remapping needed.
      const coords = lastSketchCoordinates.length
        ? lastSketchCoordinates.map((c) => c.slice())
        : e.feature.getGeometry().getCoordinates();
      const breaks = normalizeSegmentBreaks(segmentBreaks);

      // Tripwire: every coordinate inside a canonicalized trace run MUST be an
      // exact source control point (graph vertex or arc throughpoint). If a
      // tessellated arc point slipped through as canonical this surfaces it
      // loudly instead of silently committing bad geometry. Only traced index
      // ranges are checked, so free / edge-snapped coordinates that happen to
      // lie on a boundary are not misreported.
      const violation = findCanonicalContractViolation(
        coords,
        tracedIndexRanges,
      );
      if (violation) {
        // eslint-disable-next-line no-console
        console.error('[CANONICAL CONTRACT]', violation);
        status('⚠ Canonical contract violation — see console.');
      }

      // Close CurvePolygon by duplicating the first vertex. Force the closing
      // edge to a LineString: it is never rendered during the sketch, so it
      // must not inherit an arc parity (odd/even control-point count) the user
      // never established — an even count would make CircularString throw.
      if (mode === 'CurvePolygon' && coords.length >= 3) {
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          const closeIdx = coords.length - 1;
          coords.push(first.slice());
          breaks.push({index: closeIdx, type: 'line'});
        }
      }
      e.feature.setGeometry(
        buildFinalGeometry(coords, normalizeSegmentBreaks(breaks), mode),
      );
    }
    resetSketchState();
    // Give the freshly committed feature an honest multi-feature verdict at
    // commit time. Without this, a finished feature is shown valid regardless
    // of crossings until the next modify happens to revalidate it.
    validateFeatures();
    status(
      validationState.isValid
        ? 'Feature added. Draw another or switch to edit mode.'
        : 'Feature added but crosses another feature — shown in red.',
    );
    map.render();
  });

  draw.on('drawabort', () => {
    drawing = false;
    resetSketchState();
  });

  map.addInteraction(draw);
  // Re-add snap interactions so they process before draw (last-added → first-handled).
  map.removeInteraction(snap);
  map.removeInteraction(controlPointSnap);
  map.removeInteraction(sketchSnap);
  snap.setActive(true);
  controlPointSnap.setActive(true);
  sketchSnap.setActive(true);
  map.addInteraction(snap);
  map.addInteraction(controlPointSnap);
  map.addInteraction(sketchSnap);
}

addDrawInteraction();

// ── UI handlers ──────────────────────────────────────────────

typeSelect.addEventListener('change', addDrawInteraction);

document.getElementById('undo').addEventListener('click', () => {
  if (!draw) {
    return;
  }
  // Remove the just-uncommitted index from user-placed tracking before the
  // coordinate is dropped from lastSketchCoordinates.
  if (lastSketchCoordinates.length >= 2) {
    userPlacedIndices.delete(lastSketchCoordinates.length - 2);
  }
  draw.removeLastPoint();
  if (segmentBreaks.length > 1) {
    const feat = draw.getOverlay().getSource().getFeatures()[0];
    if (feat) {
      const coords = feat.getGeometry().getCoordinates();
      const last = segmentBreaks[segmentBreaks.length - 1];
      if (coords.length - 1 <= last.index) {
        segmentBreaks.pop();
        currentSegType = segmentBreaks[segmentBreaks.length - 1].type;
        updateMode();
      }
    }
  }
});

document.getElementById('clear').addEventListener('click', () => {
  source.clear();
  source.addFeatures([demoPoly, demoLine, demoArc]);
  setTopoStatus(true, '');
  status('Cleared. Pre-populated features restored.');
});

document.getElementById('start-draw').addEventListener('click', () => {
  if (typeSelect.value === 'None') {
    typeSelect.value = 'CurvePolygon';
  }
  addDrawInteraction();
});

document.getElementById('stop-draw').addEventListener('click', () => {
  if (draw && drawing) {
    draw.abortDrawing();
  }
  typeSelect.value = 'None';
  addDrawInteraction();
});

// T — toggle arc/line segment type for the next user-click sub-segment.
document.addEventListener('keydown', (e) => {
  if (e.key !== 't' && e.key !== 'T') {
    return;
  }
  const tag = /** @type {HTMLElement} */ (e.target).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
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
  const lastBreak = segmentBreaks[segmentBreaks.length - 1];
  const committedInSeg = coords.length - 1 - lastBreak.index;
  if (committedInSeg < 2) {
    status('Need \u2265 2 points before toggling.');
    return;
  }
  if (currentSegType === 'arc' && committedInSeg % 2 === 0) {
    status('Arc needs odd point count (3, 5, …). Add one more point.');
    return;
  }
  currentSegType = currentSegType === 'arc' ? 'line' : 'arc';
  segmentBreaks.push({index: coords.length - 2, type: currentSegType});
  updateMode();
  status(
    currentSegType === 'arc'
      ? 'Switched to ARC. Next click sets the curvature point.'
      : 'Switched to LINE. Click to add vertices.',
  );
});

// ESC — abort current draw and switch to edit mode.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') {
    return;
  }
  if (draw && drawing) {
    draw.abortDrawing();
  }
  if (typeSelect.value !== 'None') {
    typeSelect.value = 'None';
    addDrawInteraction();
  }
});
