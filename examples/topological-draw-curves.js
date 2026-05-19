import Feature from '../src/ol/Feature.js';
import Map from '../src/ol/Map.js';
import {unByKey} from '../src/ol/Observable.js';
import View from '../src/ol/View.js';
import {equals as coordinateEquals} from '../src/ol/coordinate.js';
import {noModifierKeys} from '../src/ol/events/condition.js';
import CircularString from '../src/ol/geom/CircularString.js';
import CompoundCurve, {coordinatesToCurveGeometry} from '../src/ol/geom/CompoundCurve.js';
import CurvePolygon from '../src/ol/geom/CurvePolygon.js';
import LineString from '../src/ol/geom/LineString.js';
import Point from '../src/ol/geom/Point.js';
import {getArcArrayCrossings, getSelfIntersectionPoint} from '../src/ol/geom/flat/topology.js';
import {getSegmentsCrossingPoint} from '../src/ol/geom/flat/segments.js';
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
 * Collect all arcs from a geometry as flat coordinate arrays.
 * @param {import('../src/ol/geom/Geometry.js').default} geom The geometry.
 * @return {Array<Array<number>>} Array of [bx, by, mx, my, ex, ey].
 */
function collectArcs(geom) {
  const result = [];
  geom.forEachArc(function (bx, by, mx, my, ex, ey) {
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
  reason: '',
  /** @type {Array<Array<number>>} crossing points [x, y] shown during drag */
  crossingPoints: [],
};

function setTopoStatus(valid, reason) {
  validationState.isValid = valid;
  validationState.reason = reason;
  if (valid) {
    validationState.crossingPoints = [];
    topoStatusEl.textContent = '✓ Valid';
    topoStatusEl.style.background = '#28a745';
  } else {
    topoStatusEl.textContent = '✗ ' + reason;
    topoStatusEl.style.background = '#dc3545';
  }
}

let drawing = false;
let currentSegType = 'arc';

function status(msg) {
  statusEl.textContent = msg;
}

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
    return {coords: data.flatCoordinates, ends: data.ends, stride: data.stride};
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

function checkOverlapWithExisting(sketchCoords, sketchEnd, sourceFeatures) {
  for (const feat of sourceFeatures) {
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
    const crossing = getSegmentsCrossingPoint(
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
        feature: feat,
        point: crossing,
      };
    }
    if (existingGeom.containsXY) {
      // Test multiple interior points — first vertex may lie on boundary.
      // Skip points that lie on or very near the existing feature boundary
      // (shared junction vertices produce false positives).
      for (let ti = 0; ti < sketchEnd - 2; ti += 2) {
        const mx = (sketchCoords[ti] + sketchCoords[ti + 2]) / 2;
        const my = (sketchCoords[ti + 1] + sketchCoords[ti + 3]) / 2;
        // Skip if midpoint is near any tessellated vertex of existing feature
        let onBoundary = false;
        for (let ei = 0; ei < existing.ends[0]; ei += 2) {
          const dx = mx - existing.coords[ei];
          const dy = my - existing.coords[ei + 1];
          if (dx * dx + dy * dy < 1) {
            // within 1 map unit — on boundary
            onBoundary = true;
            break;
          }
        }
        if (!onBoundary && existingGeom.containsXY(mx, my)) {
          return {
            reason: 'Overlaps existing feature (contained)',
            feature: feat,
            point: [mx, my],
          };
        }
        break; // only test first segment midpoint for efficiency
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
      const coords = ring.getCoordinates();
      const isCircular =
        ring.getType() === 'CircularString' ||
        ring.getType() === 'CompoundCurve';
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
  const color = valid ? '#28a745' : '#dc3545';

  if (geom.getType() === 'Point') {
    return new Style({
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({color}),
      }),
    });
  }
  return new Style({
    stroke: new Stroke({
      color,
      width: 2,
      lineDash: valid ? undefined : [6, 4],
    }),
  });
}

// ── Map setup ────────────────────────────────────────────────

const source = new VectorSource();

const preFeatureA = new Feature({
  geometry: new CurvePolygon([
    new CircularString([
      [-3000000, 1000000],
      [-1500000, 2500000],
      [0, 1000000],
      [-1500000, -500000],
      [-3000000, 1000000],
    ]),
  ]),
});

const preFeatureB = new Feature({
  geometry: new CurvePolygon([
    new CircularString([
      [2000000, 1000000],
      [3500000, 2500000],
      [5000000, 1000000],
      [3500000, -500000],
      [2000000, 1000000],
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

function rebuildControlPointSource() {
  controlPointSource.clear(true);
  for (const feat of source.getFeatures()) {
    if (feat.get('_snapPoint')) {
      continue;
    }
    const geom = feat.getGeometry();
    if (!geom || geom.getType() !== 'CurvePolygon') {
      continue;
    }
    const rings = geom.getRingsArray();
    for (const ring of rings) {
      const type = ring.getType();
      if (type === 'CircularString') {
        const coords = ring.getCoordinates();
        for (let i = 0; i < coords.length; i++) {
          controlPointSource.addFeature(
            new Feature({geometry: new Point(coords[i]), _controlPoint: true}),
          );
        }
      } else if (type === 'CompoundCurve') {
        const subGeoms = ring.getGeometriesArray();
        for (const sub of subGeoms) {
          const coords = sub.getCoordinates();
          for (let i = 0; i < coords.length; i++) {
            controlPointSource.addFeature(
              new Feature({
                geometry: new Point(coords[i]),
                _controlPoint: true,
              }),
            );
          }
        }
      } else {
        // LineString / LinearRing
        const coords = ring.getCoordinates();
        for (let i = 0; i < coords.length; i++) {
          controlPointSource.addFeature(
            new Feature({geometry: new Point(coords[i]), _controlPoint: true}),
          );
        }
      }
    }
  }
}
rebuildControlPointSource();
let modifyActive = false;
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


let geometrySnapshots = null;
let modifyChangeKeys = [];
let currentlyModifiedFeatures = new Set();

/**
 * Live validation during modify drag. Validates:
 * - Self-intersection: arcs within the same feature crossing each other.
 * - Co-modified features: trigonometric arc-arc intersection (exact geometry).
 * - Non-co-modified features: tessellation segment crossing detection.
 * Collects ALL crossing points for visualization.
 * @param {import('../src/ol/Feature.js').default} feature The modified feature.
 */
function validateFeatureLive(feature) {
  const geom = feature.getGeometry();
  if (!geom) {
    return;
  }

  const allCrossings = [];

  // Self-intersection: use CurvePolygon's built-in method
  if (geom.getType() === 'CurvePolygon') {
    allCrossings.push(
      ...geom.getSelfIntersections(CROSSING_EPSILON_SQ, SAME_ARC_TOLERANCE_SQ),
    );
  }

  const myArcs = collectArcs(geom);

  // Check against other features
  const others = source
    .getFeatures()
    .filter((o) => o !== feature && !o.get('_snapPoint'));

  for (const other of others) {
    const otherGeom = other.getGeometry();
    if (!otherGeom) {
      continue;
    }

    if (currentlyModifiedFeatures.has(other)) {
      // Co-modified: use trigonometric arc-arc intersection (no tessellation).
      const otherArcs = collectArcs(otherGeom);
      allCrossings.push(
        ...getArcArrayCrossings(
          myArcs,
          otherArcs,
          CROSSING_EPSILON_SQ,
          true,
          SAME_ARC_TOLERANCE_SQ,
        ),
      );
    } else {
      // Non-co-modified: use arc-arc if both are CurvePolygon (handles shared
      // arcs from tracing), otherwise fall back to tessellation.
      if (
        geom.getType() === 'CurvePolygon' &&
        otherGeom.getType() === 'CurvePolygon'
      ) {
        const otherArcs = collectArcs(otherGeom);
        allCrossings.push(
          ...getArcArrayCrossings(
            myArcs,
            otherArcs,
            CROSSING_EPSILON_SQ,
            true,
            SAME_ARC_TOLERANCE_SQ,
          ),
        );
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

  if (allCrossings.length > 0) {
    validationState.crossingPoints = allCrossings;
    setTopoStatus(false, 'Overlaps');
  } else if (validationState.crossingPoints.length > 0) {
    validationState.crossingPoints = [];
    setTopoStatus(true, '');
  }
}

// ── Drift audit: track shared coordinate pairs across features ──

let sharedPairs = [];

/**
 * Collect all control point coordinates from a feature's CurvePolygon rings.
 * @param {import('../src/ol/Feature.js').default} feature The feature.
 * @return {Array<{coord: Array<number>, ringIdx: number, ptIdx: number}>} Coords with path info.
 */
function getAllCoordsForAudit(feature) {
  const result = [];
  const geom = feature.getGeometry();
  if (!geom || geom.getType() !== 'CurvePolygon') {
    return result;
  }
  const rings = geom.getRingsArray();
  for (let r = 0; r < rings.length; r++) {
    const coords = rings[r].getCoordinates();
    for (let i = 0; i < coords.length; i++) {
      result.push({coord: coords[i], ringIdx: r, ptIdx: i});
    }
  }
  return result;
}

/**
 * Check if any previously-bitwise-equal coordinate pairs have diverged.
 */
function auditSharedPairs() {
  for (const pair of sharedPairs) {
    const coordsA = getAllCoordsForAudit(pair.featureA);
    const coordsB = getAllCoordsForAudit(pair.featureB);
    const a = coordsA.find(
      (c) => c.ringIdx === pair.ringIdxA && c.ptIdx === pair.ptIdxA,
    );
    const b = coordsB.find(
      (c) => c.ringIdx === pair.ringIdxB && c.ptIdx === pair.ptIdxB,
    );
    if (!a || !b) {
      continue;
    }
    const bitwiseEqual = a.coord[0] === b.coord[0] && a.coord[1] === b.coord[1];
    if (!bitwiseEqual && !pair.driftLogged) {
      pair.driftLogged = true;
    }
  }
}

modify.on('modifystart', (event) => {
  modifyActive = true;
  snap.setActive(false);
  traceSnap.setActive(false);
  // During modify, only snap to OTHER features' control points (not the
  // feature being dragged). Rebuild with exclusion.
  const modifiedFeats = new Set(event.features.getArray());
  controlPointSource.clear(true);
  for (const feat of source.getFeatures()) {
    if (feat.get('_snapPoint') || modifiedFeats.has(feat)) {
      continue;
    }
    const geom = feat.getGeometry();
    if (!geom || geom.getType() !== 'CurvePolygon') {
      continue;
    }
    const rings = geom.getRingsArray();
    for (const ring of rings) {
      if (ring.getType() !== 'CircularString') {
        continue;
      }
      const coords = ring.getCoordinates();
      for (let i = 0; i < coords.length; i++) {
        controlPointSource.addFeature(
          new Feature({geometry: new Point(coords[i]), _controlPoint: true}),
        );
      }
    }
  }
  geometrySnapshots = new WeakMap();
  currentlyModifiedFeatures = new Set();

  // Find all initially-shared coordinates between features
  sharedPairs = [];
  const feats = source.getFeatures().filter((f) => !f.get('_snapPoint'));
  const featsCoords = feats.map((f) => ({
    feature: f,
    coords: getAllCoordsForAudit(f),
  }));
  for (let i = 0; i < featsCoords.length; i++) {
    for (let j = i + 1; j < featsCoords.length; j++) {
      for (const ac of featsCoords[i].coords) {
        for (const bc of featsCoords[j].coords) {
          if (ac.coord[0] === bc.coord[0] && ac.coord[1] === bc.coord[1]) {
            sharedPairs.push({
              featureA: featsCoords[i].feature,
              featureB: featsCoords[j].feature,
              ringIdxA: ac.ringIdx,
              ptIdxA: ac.ptIdx,
              ringIdxB: bc.ringIdx,
              ptIdxB: bc.ptIdx,
              originalValue: ac.coord.slice(),
              driftLogged: false,
            });
          }
        }
      }
    }
  }

  // Debounced validation: Modify updates co-grabbed geometries sequentially,
  // firing 'change' after each one. We must wait until ALL geometries in the
  // current drag frame have been updated before validating crossings.
  let validationPending = false;
  function scheduleValidation() {
    if (!validationPending) {
      validationPending = true;
      queueMicrotask(() => {
        validationPending = false;
        auditSharedPairs();
        // Validate the first co-modified feature (all arcs are checked pairwise)
        const firstModified = currentlyModifiedFeatures.values().next().value;
        if (firstModified) {
          validateFeatureLive(firstModified);
        }
      });
    }
  }

  event.features.forEach((f) => {
    geometrySnapshots.set(f, f.getGeometry().clone());
    currentlyModifiedFeatures.add(f);
    const key = f.getGeometry().on('change', () => scheduleValidation());
    modifyChangeKeys.push(key);
  });
});

modify.on('modifyend', (event) => {
  modifyActive = false;
  modifyChangeKeys.forEach((key) => unByKey(key));
  modifyChangeKeys = [];

  // Run final validation synchronously before checking result.
  // The last geometry 'change' microtask may not have fired yet.
  const firstModified = currentlyModifiedFeatures.values().next().value;
  if (firstModified) {
    validateFeatureLive(firstModified);
  }

  currentlyModifiedFeatures.clear();

  // Capture validation result BEFORE clearing state
  const wasInvalid = !validationState.isValid;

  // Clear validation markers
  validationState.crossingPoints = [];

  rebuildControlPointSource();
  // Only re-enable snap if a draw interaction is active (not in edit-only mode)
  snap.setActive(!!draw);
  traceSnap.setActive(false);

  if (!(geometrySnapshots instanceof WeakMap)) {
    setTopoStatus(true, '');
    return;
  }
  const snapshots = geometrySnapshots;
  geometrySnapshots = null;

  // If live validation found a violation, revert
  if (wasInvalid) {
    event.features.forEach((f) => {
      if (snapshots.has(f)) {
        f.setGeometry(snapshots.get(f));
      }
    });
    setTopoStatus(false, 'Modification reverted');
    setTimeout(() => setTopoStatus(true, ''), 1500);
    return;
  }

  // Live arc-arc validation passed — accept the modification.
  setTopoStatus(true, '');
});

// ── Drawing state ────────────────────────────────────────────

let draw = null;
let segmentBreaks = [];
currentSegType = 'arc';
drawing = false;
let wasTracing = false;
let traceActive = false;
let traceStartCoord = null;
let snapFeature = null;
let startCoord = null;

/**
 * Recorded trace arcs: captures source ring + entry/exit for each trace.
 * @type {Array<{entryCoord: Array<number>, exitCoord: Array<number>|null, ring: object, sourceFeature: import('../src/ol/Feature.js').default|null, entryBreakIndex: number, traceStartIdx: number, traceEndIdx: number}>}
 */
let tracedArcs = [];

function committedInSegment(totalCoords) {
  return totalCoords - 1 - segmentBreaks[segmentBreaks.length - 1].index;
}

function resetState() {
  segmentBreaks = [{index: 0, type: 'arc'}];
  currentSegType = 'arc';
  drawing = false;
  wasTracing = false;
  traceActive = false;
  traceStartCoord = null;
  tracedArcs = [];
  startCoord = null;
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
      const closest = [0, 0];
      const dist2 = ring.closestPointXY(coord[0], coord[1], closest, Infinity);
      if (dist2 < bestDist) {
        bestDist = dist2;
        bestRing = ring;
        bestFeature = feat;
      }
    }
  }
  // Accept if within ~10px at current resolution
  const resolution = map.getView().getResolution();
  const tolerance = resolution * resolution * 100;
  return bestDist < tolerance ? {ring: bestRing, feature: bestFeature} : null;
}

// ── Arc endpoint validation (even-index only) ────────────────

/**
 * Check if a coordinate is an arc endpoint (even-indexed control point) on
 * any source CurvePolygon ring. Uses bitwise equality (no epsilon).
 * @param {Array<number>} coord The coordinate to check.
 * @return {{ring: import('../src/ol/geom/CircularString.js').default, feature: import('../src/ol/Feature.js').default, index: number}|null} The ring, feature, and index, or null.
 */
function isSourceArcEndpoint(coord) {
  const features = source.getFeatures().filter((f) => !f.get('_snapPoint'));
  let bestMatch = null;
  let bestEvenDistSq = Infinity;
  let bestOddDistSq = Infinity;
  for (const feat of features) {
    const geom = feat.getGeometry();
    if (!geom || geom.getType() !== 'CurvePolygon') {
      continue;
    }
    const rings = geom.getRingsArray();
    for (const ring of rings) {
      if (ring.getType() !== 'CircularString') {
        continue;
      }
      const coords = ring.getCoordinates();
      for (let i = 0; i < coords.length; i++) {
        const dx = coords[i][0] - coord[0];
        const dy = coords[i][1] - coord[1];
        const d2 = dx * dx + dy * dy;
        if (i % 2 === 0) {
          if (d2 < bestEvenDistSq) {
            bestEvenDistSq = d2;
          }
          if (d2 === 0) {
            bestMatch = {ring, feature: feat, index: i};
          }
        } else if (d2 < bestOddDistSq) {
          bestOddDistSq = d2;
        }
      }
    }
  }
  return bestMatch;
}

// ── Build sub-geometries from segment breaks ─────────────────

function buildSubGeometries(coords) {
  const geoms = [];
  for (let i = 0; i < segmentBreaks.length; i++) {
    const {index, type} = segmentBreaks[i];
    const end =
      i + 1 < segmentBreaks.length
        ? segmentBreaks[i + 1].index + 1
        : coords.length;
    const seg = coords.slice(index, end);
    if (seg.length < 2) {
      continue;
    }
    const geom = coordinatesToCurveGeometry(seg, type);
    if (geom.getType() === 'CompoundCurve') {
      // Flatten CompoundCurve into its sub-geometries for assembly
      const subGeoms = geom.getGeometriesArray();
      for (let j = 0; j < subGeoms.length; j++) {
        geoms.push(subGeoms[j]);
      }
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
  if (coordinateEquals(ring.getCoordinates()[entryIdx], ring.getCoordinates()[exitIdx])) {
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

  const geoms = [];
  for (let i = 0; i < rangeBreaks.length; i++) {
    const {index, type} = rangeBreaks[i];
    const end =
      i + 1 < rangeBreaks.length
        ? rangeBreaks[i + 1].index + 1
        : sliceCoords.length;
    const seg = sliceCoords.slice(index, end);
    if (seg.length < 2) {
      continue;
    }
    const geom = coordinatesToCurveGeometry(seg, type);
    if (geom.getType() === 'CompoundCurve') {
      const subGeoms = geom.getGeometriesArray();
      for (let j = 0; j < subGeoms.length; j++) {
        geoms.push(subGeoms[j]);
      }
    } else {
      geoms.push(geom);
    }
  }
  return geoms;
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
    return buildSubGeometries(coords);
  }

  const result = [];
  let pos = 0;

  for (const ta of tracedArcs) {
    if (!ta.entryCoord || !ta.exitCoord) {
      continue;
    }

    // The entry point in the sketch is at the segment break index
    const entryIdx = segmentBreaks[ta.entryBreakIndex]
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

    if (ta.chordFallback || !ta.ring) {
      // Chord fallback: replace dense tessellation with 2-point LineString
      result.push(new LineString([ta.entryCoord, ta.exitCoord]));
    } else {
      // Valid trace: extract arc by index using cached traceMidpoint
      // (cached at trace-end time when sketch indices were still valid)
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

    // Move past the traced portion
    if (nextBreakIdx < segmentBreaks.length) {
      pos = segmentBreaks[nextBreakIdx].index;
    } else {
      pos = coords.length - 1;
    }
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
  if (!draw || !drawing) {
    return true;
  }

  // During trace: BLOCK clicks unless the coordinate is an arc endpoint.
  // The traceSnap guides the pointer toward control points; this enforces it.
  const tracing = traceActive;
  if (tracing && !isSourceArcEndpoint(event.coordinate)) {
    setTopoStatus(
      false,
      'Must click an arc endpoint (large dot) to exit trace',
    );
    return false;
  }

  // About to START trace: if pointer is on a source feature but NOT on a
  // control point, block. This prevents trace entry at tessellation samples.
  // Only applies in trace-capable draw modes (CurvePolygon / CompoundCurve).
  if (!tracing && drawing) {
    const isOnControlPoint = !!isSourceArcEndpoint(event.coordinate);
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
              'Must click an arc endpoint (large dot) to start trace',
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
  const coords = geom.getCoordinates();

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

  if (mode === 'CurvePolygon' && coords.length >= 3) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
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

function validateSketchTopology(geometry) {
  try {
    const data = getTessellatedFlatCoords(geometry);
    if (!data || data.coords.length < 8) {
      setTopoStatus(true, '');
      return;
    }

    const checkEnd = data.ends[0] - data.stride;
    if (checkEnd >= 6) {
      const selfInt = getSelfIntersectionPoint(data.coords, 0, checkEnd, 2, false);
      if (selfInt) {
        validationState.crossingPoints = [selfInt];
        setTopoStatus(false, 'Self-intersecting');
        return;
      }
    }

    const mode = typeSelect.value;
    if (
      mode === 'CurvePolygon' &&
      checkEnd >= 8 &&
      !wasTracing &&
      tracedArcs.length === 0
    ) {
      const others = source.getFeatures().filter((f) => !f.get('_snapPoint'));
      const overlap = checkOverlapWithExisting(data.coords, checkEnd, others);
      if (overlap) {
        validationState.crossingPoints = overlap.point ? [overlap.point] : [];
        setTopoStatus(false, overlap.reason);
        return;
      }
    }

    validationState.crossingPoints = [];
    setTopoStatus(true, '');
  } catch {
    setTopoStatus(true, '');
  }
}

// ── Add draw interaction ─────────────────────────────────────

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
    status('Edit mode — drag vertices to modify, Alt+Click to delete.');
    return;
  }

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
        validateSketchTopology(geometry);
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
      trace: true,
      traceSource: source,
      style: sketchStyle,
      condition: checkCrossingCondition,
      geometryFunction(coordinates, geometry) {
        const isNewPoint = coordinates.length > prevCount;
        prevCount = coordinates.length;

        // Track tracing state transitions
        if (isNewPoint && drawing) {
          const tracing = traceActive;
          if (tracing && !wasTracing) {
            // Tracing just started → insert 'line' break
            const breakIndex = segmentBreaks.length;
            segmentBreaks.push({
              index: coordinates.length - 2,
              type: 'line',
            });
            wasTracing = true;

            // Record trace metadata: entry coord + source ring
            const entryCoord =
              traceStartCoord ||
              coordinates[coordinates.length - 2];
            const found = findSourceRing(entryCoord);
            tracedArcs.push({
              entryCoord: entryCoord.slice(),
              exitCoord: null,
              ring: found ? found.ring : null,
              sourceFeature: found ? found.feature : null,
              entryBreakIndex: breakIndex,
              traceStartIdx: coordinates.length - 2,
              traceEndIdx: -1,
            });
          } else if (!tracing && wasTracing) {
            // Tracing just ended → record exit coordinate and validate
            const exitIdx = coordinates.length - 2;
            const exitCoord = coordinates[exitIdx];
            if (tracedArcs.length > 0) {
              const lastTraced = tracedArcs[tracedArcs.length - 1];
              lastTraced.exitCoord = exitCoord.slice();
              lastTraced.traceEndIdx = exitIdx;

              // Cache traceMidpoint NOW while sketch indices are still valid.
              // After finalizeGeometry pushes a closing point, these indices
              // become stale and would read wrong coordinates.
              const tmStart = lastTraced.traceStartIdx;
              const tmEnd = exitIdx;
              if (tmEnd > tmStart + 1) {
                const tmMid = Math.floor((tmStart + tmEnd) / 2);
                if (tmMid < coordinates.length) {
                  lastTraced.traceMidpoint = coordinates[tmMid].slice();
                }
              }

              // Phase 2: Validate trace at EXIT
              const entryResult = isSourceArcEndpoint(lastTraced.entryCoord);
              const exitResult = isSourceArcEndpoint(exitCoord);
              if (
                !entryResult ||
                !exitResult ||
                entryResult.ring !== exitResult.ring ||
                coordinateEquals(lastTraced.entryCoord, exitCoord)
              ) {
                // Validation failed → mark as chord fallback
                lastTraced.chordFallback = true;
              } else {
                // Valid trace: record ring indices for Phase 3 extraction
                lastTraced.ring = entryResult.ring;
                lastTraced.sourceFeature = entryResult.feature;
                lastTraced.entryRingIdx = entryResult.index;
                lastTraced.exitRingIdx = exitResult.index;
                lastTraced.chordFallback = false;
              }
            }
            // Resume user's segment type
            segmentBreaks.push({
              index: coordinates.length - 2,
              type: currentSegType,
            });
            wasTracing = false;
          }
        }

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

        // Build sketch geometry for visual feedback during drawing
        const geoms = buildSubGeometries(coordinates);
        if (!geometry) {
          geometry = new CompoundCurve(
            geoms.length ? geoms : [new LineString(coordinates)],
          );
        } else {
          geometry.setGeometriesArray(
            geoms.length ? geoms : [new LineString(coordinates)],
          );
        }
        if (isNewPoint && drawing) {
          updatePointStatus(coordinates.length);
        }

        validateSketchTopology(geometry);
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
    modify.setActive(false);
    currentSegType = 'arc';
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
  });

  draw.on('tracestart', (e) => {
    traceActive = true;
    traceStartCoord = e.coordinate ? e.coordinate.slice() : null;
  });

  draw.on('traceend', () => {
    traceActive = false;
    traceStartCoord = null;
  });

  draw.on('drawend', (e) => {
    drawing = false;
    modify.setActive(true);

    // If tracing was still active at finish, record the exit and validate
    if (wasTracing && tracedArcs.length > 0) {
      const lastTraced = tracedArcs[tracedArcs.length - 1];
      if (!lastTraced.exitCoord) {
        // For CurvePolygon close: use startCoord as exit (ring must close)
        if (typeSelect.value === 'CurvePolygon' && startCoord) {
          lastTraced.exitCoord = startCoord.slice();
        } else {
          const coords = e.feature.getGeometry().getCoordinates();
          if (coords.length >= 2) {
            lastTraced.exitCoord = coords[coords.length - 2].slice();
          }
        }
      }
      // Record trace end index for direction validation
      const coords = e.feature.getGeometry().getCoordinates();
      lastTraced.traceEndIdx = coords.length - 2;

      // Cache traceMidpoint while sketch coords are still pre-close
      const tmStart = lastTraced.traceStartIdx;
      const tmEnd = lastTraced.traceEndIdx;
      if (tmEnd > tmStart + 1) {
        const tmMid = Math.floor((tmStart + tmEnd) / 2);
        if (tmMid < coords.length) {
          lastTraced.traceMidpoint = coords[tmMid].slice();
        }
      }

      // Phase 2: Validate trace at EXIT
      if (lastTraced.exitCoord) {
        const entryResult = isSourceArcEndpoint(lastTraced.entryCoord);
        const exitResult = isSourceArcEndpoint(lastTraced.exitCoord);
        if (
          !entryResult ||
          !exitResult ||
          entryResult.ring !== exitResult.ring ||
          coordinateEquals(lastTraced.entryCoord, lastTraced.exitCoord)
        ) {
          lastTraced.chordFallback = true;
        } else {
          lastTraced.ring = entryResult.ring;
          lastTraced.sourceFeature = entryResult.feature;
          lastTraced.entryRingIdx = entryResult.index;
          lastTraced.exitRingIdx = exitResult.index;
          lastTraced.chordFallback = false;
        }
      }
      wasTracing = false;
    }

    finalizeGeometry(e.feature);

    // Tag so validation routing distinguishes drawn from source features
    e.feature.set('_drawn', true);

    // Post-finalize validation — remove feature if it has crossings
    const finalGeom = e.feature.getGeometry();

    // Self-intersection via arc-arc
    if (finalGeom.getType() === 'CurvePolygon') {
      const selfCrossings = finalGeom.getSelfIntersections(
        CROSSING_EPSILON_SQ,
        SAME_ARC_TOLERANCE_SQ,
      );
      if (selfCrossings.length > 0) {
        source.removeFeature(e.feature);
        validationState.crossingPoints = selfCrossings;
        setTopoStatus(false, 'Rejected: self-intersecting');
        resetState();
        status('Feature rejected (self-intersecting). Try again.');
        return;
      }

      // Overlap with existing features (arc-arc with shared arc filtering)
      const arcs = collectArcs(finalGeom);
      const others = source
        .getFeatures()
        .filter((f) => f !== e.feature && !f.get('_snapPoint'));
      for (const other of others) {
        const otherGeom = other.getGeometry();
        if (!otherGeom || otherGeom.getType() !== 'CurvePolygon') {
          continue;
        }
        const otherArcs = collectArcs(otherGeom);
        const crossings = getArcArrayCrossings(
          arcs,
          otherArcs,
          CROSSING_EPSILON_SQ,
          true,
          SAME_ARC_TOLERANCE_SQ,
        );
        if (crossings.length > 0) {
          source.removeFeature(e.feature);
          validationState.crossingPoints = crossings;
          setTopoStatus(false, 'Rejected: overlaps existing feature');
          resetState();
          status('Feature rejected (overlaps existing). Try again.');
          return;
        }
      }
    } else {
      // Fallback for non-CurvePolygon geometries: tessellation-based
      const data = getTessellatedFlatCoords(finalGeom);
      if (data) {
        const isRing =
          finalGeom.getType() === 'CurvePolygon' ||
          finalGeom.getType() === 'Polygon';
        const selfInt = getSelfIntersectionPoint(
          data.coords,
          0,
          data.ends[0],
          2,
          isRing,
        );
        if (selfInt) {
          source.removeFeature(e.feature);
          setTopoStatus(false, 'Rejected: self-intersecting');
          resetState();
          status('Feature rejected (self-intersecting). Try again.');
          return;
        }
        const others = source
          .getFeatures()
          .filter((f) => f !== e.feature && !f.get('_snapPoint'));
        const overlap = checkOverlapWithExisting(
          data.coords,
          data.ends[0],
          others,
        );
        if (overlap) {
          source.removeFeature(e.feature);
          setTopoStatus(false, 'Rejected: ' + overlap.reason);
          resetState();
          status('Feature rejected (overlaps existing). Try again.');
          return;
        }
      }
    }

    resetState();
    status('Feature added. Draw another or switch to edit mode.');
  });

  draw.on('drawabort', () => {
    drawing = false;
    modify.setActive(true);
    resetState();
  });

  map.addInteraction(draw);
  map.removeInteraction(snap);
  snap.setActive(true);
  map.addInteraction(snap);
  traceSnap.setActive(true);
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
        currentSegType = segmentBreaks[segmentBreaks.length - 1].type;
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
  currentSegType = currentSegType === 'arc' ? 'line' : 'arc';
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
