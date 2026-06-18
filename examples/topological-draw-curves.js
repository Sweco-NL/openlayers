import Collection from '../src/ol/Collection.js';
import Feature from '../src/ol/Feature.js';
import Map from '../src/ol/Map.js';
import View from '../src/ol/View.js';
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
  traceExcludedFeatures = new Set();
  traceBoundaryRings = [];
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
  geom.forEachCurveSegment(function (bx, by, mx, my, ex, ey) {
    result.push([bx, by, mx, my, ex, ey]);
  });
  return result;
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
 * First proper-interior crossing between two flat polylines (no near-endpoint
 * touches). Tessellation can place a shared vertex a few ULPs inside a segment;
 * filter those out so trace-hugging does not produce false "edges cross".
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
      return point;
    }
  }
  return undefined;
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
 * @param {Array<number>} sketchCoords Tessellated sketch coords.
 * @param {number} sketchEnd End of sketch coords.
 * @param {Array<import('../src/ol/Feature.js').default>} features Source features.
 * @param {Set<import('../src/ol/Feature.js').default>} excludedFromContainment Features whose boundary the sketch shares.
 * @param {boolean} skipContainment Skip containment check.
 * @return {{reason: string, point: Array<number>}|null} Overlap descriptor or null.
 */
function checkOverlapWithExisting(
  sketchCoords,
  sketchEnd,
  features,
  excludedFromContainment,
  skipContainment,
) {
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
      return {
        reason: 'Overlaps existing feature (edges cross)',
        point: crossing,
      };
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
      const eend = existing.ends[0];
      for (let ti = 0; ti < sketchEnd - 2; ti += 2) {
        const mx = (sketchCoords[ti] + sketchCoords[ti + 2]) / 2;
        const my = (sketchCoords[ti + 1] + sketchCoords[ti + 3]) / 2;
        if (pointToPolylineDist2(mx, my, ec, eend) < onBoundaryTol2) {
          continue;
        }
        if (existingGeom.containsXY(mx, my)) {
          return {
            reason: 'Overlaps existing feature (contained)',
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
 * @param {Array<Array<number>>} coords Coordinates.
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
 * @param {Array<Array<number>>} coords Coordinates.
 * @param {Array<{index: number, type: string}>} breaks Segment breaks.
 * @param {string} mode Draw mode.
 * @return {import('../src/ol/geom/Geometry.js').default} Final geometry.
 */
function buildFinalGeometry(coords, breaks, mode) {
  if (mode === 'CircularString') {
    return new CircularString(coords);
  }
  const subs = buildSketchSubs(coords, breaks);
  if (mode === 'CompoundCurve') {
    return subs.length === 1 ? subs[0] : new CompoundCurve(subs);
  }
  // CurvePolygon
  const ring = subs.length === 1 ? subs[0] : new CompoundCurve(subs);
  return new CurvePolygon([ring]);
}

// ── Multi-feature topology validation ────────────────────────

/**
 * Validate one or more features for self-intersection and pair-wise crossings
 * against every feature in the source. Updates `validationState`.
 * @param {Array<import('../src/ol/Feature.js').default>} targets Features under test.
 * @return {boolean} True when no crossings found.
 */
function validateFeatures(targets) {
  const allFeatures = source.getFeatures().filter((f) => !f.get('_snapPoint'));
  const targetSet = new Set(targets);
  /** @type {Array<Array<number>>} */
  const allCrossings = [];
  /** @type {Map<import('../src/ol/Feature.js').default, Array<Array<number>>>} */
  const arcsByFeature = new Map();
  let hasSelfIntersection = false;

  for (const f of allFeatures) {
    const g = f.getGeometry();
    if (!g) {
      continue;
    }
    arcsByFeature.set(f, collectCurveSegments(g));
    if (targetSet.has(f) && g.getType() === 'CurvePolygon') {
      const selfX = g.getSelfIntersections(
        CROSSING_EPSILON_SQ,
        SAME_ARC_TOLERANCE_SQ,
      );
      if (selfX.length > 0) {
        hasSelfIntersection = true;
        allCrossings.push(...selfX);
      }
    }
  }

  // Check each target against every other feature exactly once.
  for (const target of targets) {
    const tg = target.getGeometry();
    if (!tg) {
      continue;
    }
    const targetArcs = arcsByFeature.get(target);
    for (const other of allFeatures) {
      if (other === target) {
        continue;
      }
      // Skip target-target pairs we've already checked.
      if (
        targetSet.has(other) &&
        targets.indexOf(other) < targets.indexOf(target)
      ) {
        continue;
      }
      const og = other.getGeometry();
      if (!og) {
        continue;
      }
      if (tg.getType() === 'CurvePolygon' && og.getType() === 'CurvePolygon') {
        const cross = getArcArrayCrossings(
          targetArcs,
          arcsByFeature.get(other),
          CROSSING_EPSILON_SQ,
          true,
          SAME_ARC_TOLERANCE_SQ,
        );
        allCrossings.push(...cross);
      } else {
        const a = getTessellatedFlatCoords(tg);
        const b = getTessellatedFlatCoords(og);
        if (!a || !b) {
          continue;
        }
        const c = getSegmentsCrossingPoint(
          a.coords,
          0,
          a.ends[0],
          b.coords,
          0,
          b.ends[0],
          2,
        );
        if (c) {
          allCrossings.push(c);
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
      const others = source.getFeatures().filter((f) => !f.get('_snapPoint'));
      const overlap = checkOverlapWithExisting(
        data.coords,
        totalEnd,
        others,
        traceExcludedFeatures,
        mode !== 'CurvePolygon',
      );
      if (overlap) {
        validationState.crossingPoints = [overlap.point];
        validationState.errorSegment = findSketchSubGeomNear(
          data.coords,
          data.ends,
          overlap.point,
        );
        setTopoStatus(false, overlap.reason);
        return;
      }
    }

    validationState.crossingPoints = [];
    validationState.errorSegment = null;
    setTopoStatus(true, '');
  } catch (err) {
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

  if (!traceActive) {
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
  // Crossing markers (red dots at intersections during drag).
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

source.on(['addfeature', 'removefeature', 'changefeature'], () => {
  rebuildControlPointSource();
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
  ],
  target: 'map',
  view: new View({center: [0, 0], zoom: 4}),
});

// Expose for browser inspection.
/** @type {any} */ (window).__map = map;

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
map.addInteraction(modify);
map.addInteraction(snap);
map.addInteraction(controlPointSnap);

/** @type {Map<import('../src/ol/Feature.js').default, import('../src/ol/geom/Geometry.js').default>} */
const modifyStartSnapshots = new window.Map();

modify.on('modifystart', () => {
  modifyStartSnapshots.clear();
  source.getFeatures().forEach((f) => {
    if (f.get('_snapPoint')) {
      return;
    }
    modifyStartSnapshots.set(f, f.getGeometry().clone());
  });
});

modify.on('modifyend', (event) => {
  const featuresToCheck = event.features
    .getArray()
    .filter((f) => !f.get('_snapPoint'));
  if (!validateFeatures(featuresToCheck)) {
    for (const f of featuresToCheck) {
      const snap = modifyStartSnapshots.get(f);
      if (snap) {
        f.setGeometry(snap);
      }
    }
    setTopoStatus(true, '');
    status('Edit reverted: would create a topological invalid feature.');
  } else {
    status('Edit accepted.');
  }
  modifyStartSnapshots.clear();
});

// ── Trace source ─────────────────────────────────────────────

const traceSource = new TraceSource({
  features: source.getFeaturesCollection(),
  exteriorOnly: true,
});

// ── Draw interaction wiring ──────────────────────────────────

function wireTraceLifecycle(drawInteraction) {
  let traceStartIdx = -1;
  drawInteraction.on('tracestart', () => {
    traceActive = true;
    // Anchor the trace-entry split point at the index where the just-clicked
    // trace-anchor coordinate will land. Tracestart fires INSIDE
    // `toggleTraceState_`, which runs BEFORE the click's `addToDrawing_`
    // pushes the clicked coordinate, so the anchor is at
    // `length - 1` (the current tip slot, which the click commit shifts
    // into a real committed coord and re-tips). Off-by-one (using
    // `length - 2`, the previous committed index) leaves the trace-entry
    // break unstamped, which fed every traced coord plus the pre-trace
    // freehand history into ONE CircularString — visibly bending the
    // already-drawn "starting line" into the trace arc.
    traceStartIdx = Math.max(0, lastSketchCoordinates.length - 1);
    status('Tracing along boundary — click a vertex to exit.');
  });

  drawInteraction.on('trace', (e) => {
    if (lastSketchCoordinates.length < 2) {
      return;
    }
    // Use length-2 (last committed coord) rather than length-1 (the
    // about-to-be-popped tip): the next appendCoordinates from the trace
    // walk pops the tip and shifts everything past it, which would leave
    // a tip-anchored break pointing at the wrong post-walk coordinate.
    const idx = lastSketchCoordinates.length - 2;
    const type =
      e.traceSourceSubGeometryKind === 'CircularString' ? 'arc' : 'line';
    const last = segmentBreaks[segmentBreaks.length - 1];
    // Force a split at the trace-entry vertex even if its type matches the
    // leading break's type. Without this, dedup against an already-arc
    // leading break would leave the pre-trace stub (a 2-point free-draw
    // sub) merged with the traced sequence and re-fitted as one bogus arc.
    if (idx === traceStartIdx && (!last || last.index < idx)) {
      segmentBreaks.push({index: idx, type});
      traceStartIdx = -1;
      return;
    }
    if (last && last.type === type && last.index === idx) {
      return;
    }
    if (last && last.type === type) {
      return; // dedupe consecutive same-type stamps
    }
    segmentBreaks.push({index: idx, type});
  });

  drawInteraction.on('traceend', (e) => {
    traceActive = false;
    traceStartIdx = -1;
    // Stamp a return-to-user-segment-type break that starts the post-trace
    // free segment at the trace-exit vertex. At traceend time (which fires
    // INSIDE `toggleTraceState_`, BEFORE the exit-click's `addToDrawing_`
    // pushes the click coord), the trace walk has just tip-duplicated the
    // exit vertex (via `appendCoordinates` which pops + pushes + tip-dups),
    // so the sketch ends with two adjacent coords at the exit vertex
    // (`length - 2` and `length - 1`). The exit-click's `addToDrawing_`
    // then pushes a THIRD copy. Anchoring the next free segment at
    // `length - 2` (the older walk-committed copy) makes the segment slice
    // `[exit, exit, exit, next_free, ...]` — a 3-point CircularString
    // through coincident points which renders as a wild degenerate arc
    // that "consumes" everything that follows. Use `length - 1` (the
    // walk's tip-dup) so the segment slice starts AFTER the first
    // duplicate, yielding `[exit, exit, next_free, ...]` with the
    // duplicate tucked at the segment's start (LineString- or
    // arc-tail-tolerant) and the visible free segment fitting cleanly.
    const exitIdx = Math.max(0, lastSketchCoordinates.length - 1);
    const last = segmentBreaks[segmentBreaks.length - 1];
    if (!last || last.index !== exitIdx || last.type !== currentSegType) {
      segmentBreaks.push({index: exitIdx, type: currentSegType});
    }
    if (e.traceSourceFeature) {
      traceExcludedFeatures.add(e.traceSourceFeature);
    }
    if (
      e.traceSourceGeometry &&
      !traceBoundaryRings.includes(e.traceSourceGeometry)
    ) {
      traceBoundaryRings.push(e.traceSourceGeometry);
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
    let startCoord = null;

    draw = new Draw({
      source,
      type: 'LineString',
      trace: true,
      traceSource,
      snapTolerance: 20,
      style: sketchStyle,
      condition: checkCrossingCondition,
      geometryFunction(coordinates, geometry) {
        lastSketchCoordinates = coordinates.map((c) => c.slice());
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
      const coords = e.feature.getGeometry().getCoordinates();
      if (coords.length > 0) {
        startCoord = coords[0].slice();
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
      const coords = lastSketchCoordinates.length
        ? lastSketchCoordinates.map((c) => c.slice())
        : e.feature.getGeometry().getCoordinates();
      // Close-by-duplicating-first for CurvePolygon if the user didn't.
      if (mode === 'CurvePolygon' && coords.length >= 3) {
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          coords.push(first.slice());
        }
      }
      e.feature.setGeometry(buildFinalGeometry(coords, segmentBreaks, mode));
    }
    resetSketchState();
    status('Feature added. Draw another or switch to edit mode.');
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
  snap.setActive(true);
  controlPointSnap.setActive(true);
  map.addInteraction(snap);
  map.addInteraction(controlPointSnap);
}

addDrawInteraction();

// ── UI handlers ──────────────────────────────────────────────

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

// Spacebar — same as T, secondary binding for accessibility/touchpads.
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' && e.code !== 'Space') {
    return;
  }
  const tag = /** @type {HTMLElement} */ (e.target).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return;
  }
  if (!draw || !drawing) {
    return;
  }
  e.preventDefault();
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 't'}));
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
