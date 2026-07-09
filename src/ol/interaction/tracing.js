/**
 * Coordinate type when drawing lines.
 * @typedef {Array<import("../coordinate.js").Coordinate>} LineCoordType
 */

import {distance} from '../coordinate.js';
import CircularString from '../geom/CircularString.js';
import CompoundCurve from '../geom/CompoundCurve.js';
import CurvePolygon from '../geom/CurvePolygon.js';
import {inflateCoordinates} from '../geom/flat/inflate.js';
import GeometryCollection from '../geom/GeometryCollection.js';
import LineString from '../geom/LineString.js';
import MultiLineString from '../geom/MultiLineString.js';
import MultiPolygon from '../geom/MultiPolygon.js';
import Polygon from '../geom/Polygon.js';
import {clamp, squaredDistance, toFixed} from '../math.js';

/**
 * @param {LineCoordType} coordinates The ring coordinates.
 * @param {number} index The index.  May be wrapped.
 * @return {import("../coordinate.js").Coordinate} The coordinate.
 */
export function getCoordinate(coordinates, index) {
  const count = coordinates.length;
  if (index < 0) {
    return coordinates[index + count];
  }
  if (index >= count) {
    return coordinates[index - count];
  }
  return coordinates[index];
}

/**
 * @param {LineCoordType} coordinates The coordinates.
 * @param {number} index The index.  May be fractional and may wrap.
 * @return {import("../coordinate.js").Coordinate} The interpolated coordinate.
 */
export function interpolateCoordinate(coordinates, index) {
  const count = coordinates.length;

  let startIndex = Math.floor(index);
  const along = index - startIndex;
  if (startIndex >= count) {
    startIndex -= count;
  } else if (startIndex < 0) {
    startIndex += count;
  }

  let endIndex = startIndex + 1;
  if (endIndex >= count) {
    endIndex -= count;
  }

  const start = coordinates[startIndex];
  const x0 = start[0];
  const y0 = start[1];
  const end = coordinates[endIndex];
  const dx = end[0] - x0;
  const dy = end[1] - y0;

  return [x0 + dx * along, y0 + dy * along];
}

/**
 * Describes a single traceable target produced by {@link module:ol/interaction/tracing.getTraceTargets}.
 * Returned in the order discovered during geometry traversal.
 *
 * @typedef {Object} TraceTarget
 * @property {Array<import("../coordinate.js").Coordinate>} coordinates Target coordinates.
 * @property {boolean} ring The target coordinates are a linear ring.
 * @property {number} startIndex The index of first traced coordinate.  A fractional index represents an
 * edge intersection.  Index values for rings will wrap (may be negative or larger than coordinates length).
 * @property {number} endIndex The index of last traced coordinate.  Details from startIndex also apply here.
 * @property {Array<number>} [vertexIndices] Whole coordinate indices that are legal topology vertices.
 * @property {import("../Feature.js").default} [feature] The source feature this target was extracted from.
 * @property {import("../geom/SimpleGeometry.js").default | import("../geom/CompoundCurve.js").default} [geometry]
 * The smallest geometry instance this target corresponds to. For LineString features this is the LineString
 * itself. For CurvePolygon this is the specific ring (CircularString/CompoundCurve/LineString). For Polygon
 * this is the top-level Polygon (rings are not separate geometry instances; use `ringIndex` to identify the
 * ring). For MultiLineString and MultiPolygon this is the top-level multi-geometry (sub-components are not
 * exposed because their instances are cloned per accessor call and would not be stable across event dispatch).
 * @property {number} [ringIndex] For `Polygon` and `CurvePolygon` sources, the index of the ring within
 * the polygon (0 for the outer ring, 1+ for interior rings/holes). Undefined for line-shaped sources and
 * for `MultiPolygon` (where polygon identity is not attributed).
 * @api
 */

/**
 * @typedef {Object} TraceState
 * @property {boolean} active Tracing active.
 * @property {import("../coordinate.js").Coordinate} [startCoord] The initially clicked coordinate.
 * @property {Array<TraceTarget>} [targets] Targets available for tracing.
 * @property {number} [targetIndex] The index of the currently traced target.  A value of -1 indicates
 * that no trace target is active.
 */

/**
 * @typedef {Object} TraceTargetUpdateInfo
 * @property {number} index The new target index.
 * @property {number} endIndex The new segment end index.
 * @property {number} closestTargetDistance The squared distance to the closest target.
 */

/**
 * @type {TraceTargetUpdateInfo}
 */
const sharedUpdateInfo = {
  index: -1,
  endIndex: NaN,
  closestTargetDistance: Infinity,
};

/**
 * @param {import("../coordinate.js").Coordinate} coordinate The coordinate.
 * @param {TraceState} traceState The trace state.
 * @param {import("../Map.js").default} map The map.
 * @param {number} snapTolerance The snap tolerance.
 * @return {TraceTargetUpdateInfo} Information about the new trace target.  The returned
 * object is reused between calls and must not be modified by the caller.
 */
export function getTraceTargetUpdate(
  coordinate,
  traceState,
  map,
  snapTolerance,
) {
  const x = coordinate[0];
  const y = coordinate[1];

  let closestTargetDistance = Infinity;

  let newTargetIndex = -1;
  let newEndIndex = NaN;

  for (
    let targetIndex = 0;
    targetIndex < traceState.targets.length;
    ++targetIndex
  ) {
    if (
      traceState.targetIndex !== -1 &&
      targetIndex !== traceState.targetIndex &&
      !canSwitchTraceTarget_(
        traceState.targets[traceState.targetIndex],
        traceState.targets[targetIndex],
        coordinate,
      )
    ) {
      continue;
    }

    const target = traceState.targets[targetIndex];
    const coordinates = target.coordinates;

    let minSegmentDistance = Infinity;
    let endIndex;
    for (
      let coordinateIndex = 0;
      coordinateIndex < coordinates.length - 1;
      ++coordinateIndex
    ) {
      const start = coordinates[coordinateIndex];
      const end = coordinates[coordinateIndex + 1];
      const rel = getPointSegmentRelationship(x, y, start, end);
      if (rel.squaredDistance < minSegmentDistance) {
        minSegmentDistance = rel.squaredDistance;
        endIndex = coordinateIndex + rel.along;
      }
    }

    if (minSegmentDistance < closestTargetDistance) {
      closestTargetDistance = minSegmentDistance;
      if (target.ring && traceState.targetIndex === targetIndex) {
        // same target, maintain the same trace direction
        if (target.endIndex > target.startIndex) {
          // forward trace
          if (endIndex < target.startIndex) {
            endIndex += coordinates.length;
          }
        } else if (target.endIndex < target.startIndex) {
          // reverse trace
          if (endIndex > target.startIndex) {
            endIndex -= coordinates.length;
          }
        }
      }
      newEndIndex = endIndex;
      newTargetIndex = targetIndex;
    }
  }

  const newTarget = traceState.targets[newTargetIndex];
  let considerBothDirections = newTarget.ring;
  if (traceState.targetIndex === newTargetIndex && considerBothDirections) {
    // only consider switching trace direction if close to the start
    const newCoordinate = interpolateCoordinate(
      newTarget.coordinates,
      newEndIndex,
    );
    const pixel = map.getPixelFromCoordinate(newCoordinate);
    const startPx = map.getPixelFromCoordinate(traceState.startCoord);
    if (distance(pixel, startPx) > snapTolerance) {
      considerBothDirections = false;
    }
  }

  if (considerBothDirections) {
    const coordinates = newTarget.coordinates;
    const count = coordinates.length;
    const startIndex = newTarget.startIndex;
    const endIndex = newEndIndex;
    if (startIndex < endIndex) {
      const forwardDistance = getCumulativeSquaredDistance(
        coordinates,
        startIndex,
        endIndex,
      );
      const reverseDistance = getCumulativeSquaredDistance(
        coordinates,
        startIndex,
        endIndex - count,
      );
      if (reverseDistance < forwardDistance) {
        newEndIndex -= count;
      }
    } else {
      const reverseDistance = getCumulativeSquaredDistance(
        coordinates,
        startIndex,
        endIndex,
      );
      const forwardDistance = getCumulativeSquaredDistance(
        coordinates,
        startIndex,
        endIndex + count,
      );
      if (forwardDistance < reverseDistance) {
        newEndIndex += count;
      }
    }
  }

  sharedUpdateInfo.index = newTargetIndex;
  sharedUpdateInfo.endIndex = newEndIndex;
  sharedUpdateInfo.closestTargetDistance = closestTargetDistance;
  return sharedUpdateInfo;
}

/**
 * @param {TraceTarget} oldTarget Currently traced target.
 * @param {TraceTarget} newTarget Candidate target.
 * @param {import("../coordinate.js").Coordinate} coordinate Current coordinate.
 * @return {boolean} The candidate can be reached from the active target.
 */
function canSwitchTraceTarget_(oldTarget, newTarget, coordinate) {
  return (
    isTraceVertexPivot(oldTarget, newTarget, coordinate) ||
    isStoredSharedTraceVertex(oldTarget, newTarget)
  );
}

/**
 * @param {TraceTarget} oldTarget Currently traced target.
 * @param {TraceTarget} newTarget Candidate target.
 * @param {import("../coordinate.js").Coordinate} coordinate Current coordinate.
 * @return {boolean} The candidate pivots at a shared target vertex.
 */
export function isTraceVertexPivot(oldTarget, newTarget, coordinate) {
  return (
    getTraceVertexIndexAtCoordinate(oldTarget, coordinate) !== null &&
    traceTargetStartsAtCoordinate_(newTarget, coordinate)
  );
}

/**
 * @param {TraceTarget} oldTarget Currently traced target.
 * @param {TraceTarget} newTarget Candidate target.
 * @return {boolean} The current trace endpoint is the candidate start vertex.
 */
export function isStoredSharedTraceVertex(oldTarget, newTarget) {
  if (
    !isTraceTargetVertexIndex(oldTarget, oldTarget.endIndex) ||
    !isTraceTargetVertexIndex(newTarget, newTarget.startIndex)
  ) {
    return false;
  }
  const oldEnd = interpolateCoordinate(
    oldTarget.coordinates,
    oldTarget.endIndex,
  );
  const newStart = interpolateCoordinate(
    newTarget.coordinates,
    newTarget.startIndex,
  );
  return coordinatesEqualXY(oldEnd, newStart);
}

/**
 * @param {TraceTarget} target Trace target.
 * @param {import("../coordinate.js").Coordinate} coordinate Coordinate.
 * @return {number|null} Whole target index at the coordinate, or null.
 */
export function getTraceVertexIndexAtCoordinate(target, coordinate) {
  const coordinates = target.coordinates;
  for (let i = 0, ii = coordinates.length; i < ii; ++i) {
    const candidate = coordinates[i];
    if (
      coordinatesEqualXY(candidate, coordinate) &&
      isTraceTargetVertexIndex(target, i)
    ) {
      return i;
    }
  }
  return null;
}

/**
 * @param {TraceTarget} target Trace target.
 * @param {import("../coordinate.js").Coordinate} coordinate Coordinate.
 * @return {boolean} The target starts at the coordinate.
 */
function traceTargetStartsAtCoordinate_(target, coordinate) {
  if (!isTraceTargetVertexIndex(target, target.startIndex)) {
    return false;
  }
  const start = interpolateCoordinate(target.coordinates, target.startIndex);
  return coordinatesEqualXY(start, coordinate);
}

/**
 * Discover all traceable targets at a coordinate across a list of features. This is the same
 * computation the {@link module:ol/interaction/Draw~Draw} interaction performs internally when
 * tracing starts. Exposed so applications can introspect candidate trace sources (for example
 * to drive UI feedback before the user commits to a trace).
 *
 * Returns one entry per traceable component: one per `LineString` / `CircularString` /
 * `CompoundCurve` feature, one per ring of each `Polygon` / `CurvePolygon`, and recursively
 * for the children of `MultiLineString`, `MultiPolygon`, and `GeometryCollection`.
 * The returned objects share the same shape as the data the trace event handler observes;
 * see {@link TraceTarget} for the per-field contract.
 *
 * @param {import("../coordinate.js").Coordinate} coordinate The coordinate.
 * @param {Array<import("../Feature.js").default>} features The candidate features.
 * @return {Array<TraceTarget>} The trace targets.
 * @api
 */
export function getTraceTargets(coordinate, features) {
  /**
   * @type {Array<TraceTarget>}
   */
  const targets = [];

  for (let i = 0; i < features.length; ++i) {
    const feature = features[i];
    const geometry = feature.getGeometry();
    appendGeometryTraceTargets(coordinate, geometry, targets, feature);
  }

  return targets;
}

/**
 * @param {TraceTarget} target Trace target.
 * @param {number} index Trace target index.
 * @return {boolean} The index identifies a legal topology vertex for this target.
 */
export function isTraceTargetVertexIndex(target, index) {
  if (Math.abs(index - Math.round(index)) >= 1e-9) {
    return false;
  }
  if (!target.vertexIndices) {
    return true;
  }
  const normalized = getNormalizedIndex_(target.coordinates, Math.round(index));
  return target.vertexIndices.includes(normalized);
}

/**
 * @param {import("../coordinate.js").Coordinate} coordinate The coordinate.
 * @param {import("../geom/Geometry.js").default} geometry The candidate geometry.
 * @param {Array<TraceTarget>} targets The trace targets.
 * @param {import("../Feature.js").default} [feature] The source feature (propagated to targets).
 */
function appendGeometryTraceTargets(coordinate, geometry, targets, feature) {
  if (geometry instanceof LineString) {
    appendTraceTarget(
      coordinate,
      geometry.getCoordinates(),
      false,
      targets,
      undefined,
      feature,
      geometry,
    );
    return;
  }
  if (geometry instanceof MultiLineString) {
    const coordinates = geometry.getCoordinates();
    for (let i = 0, ii = coordinates.length; i < ii; ++i) {
      appendTraceTarget(
        coordinate,
        coordinates[i],
        false,
        targets,
        undefined,
        feature,
        geometry,
      );
    }
    return;
  }
  if (geometry instanceof Polygon) {
    const coordinates = geometry.getCoordinates();
    for (let i = 0, ii = coordinates.length; i < ii; ++i) {
      appendTraceTarget(
        coordinate,
        coordinates[i],
        true,
        targets,
        undefined,
        feature,
        geometry,
        i,
      );
    }
    return;
  }
  if (geometry instanceof MultiPolygon) {
    const polyCoords = geometry.getCoordinates();
    for (let i = 0, ii = polyCoords.length; i < ii; ++i) {
      const coordinates = polyCoords[i];
      for (let j = 0, jj = coordinates.length; j < jj; ++j) {
        appendTraceTarget(
          coordinate,
          coordinates[j],
          true,
          targets,
          undefined,
          feature,
          geometry,
        );
      }
    }
    return;
  }
  if (geometry instanceof CurvePolygon) {
    const rings = geometry.getRingsArray();
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      const ring = rings[i];
      let tessellated;
      const ringType = ring.getType();
      if (ringType === 'CircularString') {
        tessellated =
          /** @type {import("../geom/CircularString.js").default} */ (
            ring
          ).tessellate();
      } else if (ringType === 'CompoundCurve') {
        tessellated =
          /** @type {import("../geom/CompoundCurve.js").default} */ (
            ring
          ).tessellate();
      } else {
        tessellated =
          /** @type {import("../geom/SimpleGeometry.js").default} */ (
            ring
          ).getFlatCoordinates();
      }
      const coords = inflateCoordinates(tessellated, 0, tessellated.length, 2);
      const vertexIndices = getTraceVertexIndices_(ring, coords);
      appendTraceTarget(
        coordinate,
        coords,
        true,
        targets,
        vertexIndices,
        feature,
        ring,
        i,
      );
    }
    return;
  }
  if (geometry instanceof CompoundCurve) {
    const tessellated = geometry.tessellate();
    if (tessellated && tessellated.length >= 4) {
      const coords = inflateCoordinates(tessellated, 0, tessellated.length, 2);
      const vertexIndices = getTraceVertexIndices_(geometry, coords);
      appendTraceTarget(
        coordinate,
        coords,
        false,
        targets,
        vertexIndices,
        feature,
        geometry,
      );
    }
    return;
  }
  if (geometry instanceof CircularString) {
    const tessellated = geometry.tessellate();
    if (tessellated && tessellated.length >= 4) {
      const coords = inflateCoordinates(tessellated, 0, tessellated.length, 2);
      const vertexIndices = getTraceVertexIndices_(geometry, coords);
      appendTraceTarget(
        coordinate,
        coords,
        false,
        targets,
        vertexIndices,
        feature,
        geometry,
      );
    }
    return;
  }
  if (geometry instanceof GeometryCollection) {
    const geometries = geometry.getGeometries();
    for (let i = 0; i < geometries.length; ++i) {
      appendGeometryTraceTargets(coordinate, geometries[i], targets, feature);
    }
    return;
  }
  // other types cannot be traced
}

/**
 * @param {import("../coordinate.js").Coordinate} coordinate The clicked coordinate.
 * @param {Array<import("../coordinate.js").Coordinate>} coordinates The geometry component coordinates.
 * @param {boolean} ring The coordinates represent a linear ring.
 * @param {Array<TraceTarget>} targets The trace targets.
 * @param {Array<number>} [vertexIndices] Whole coordinate indices that are legal topology vertices.
 * @param {import("../Feature.js").default} [feature] Source feature for this target.
 * @param {import("../geom/SimpleGeometry.js").default | import("../geom/CompoundCurve.js").default} [geometry]
 * Smallest geometry instance for this target.
 * @param {number} [ringIndex] Ring index within a polygon source (undefined for line-shaped sources).
 */
function appendTraceTarget(
  coordinate,
  coordinates,
  ring,
  targets,
  vertexIndices,
  feature,
  geometry,
  ringIndex,
) {
  const x = coordinate[0];
  const y = coordinate[1];
  for (let i = 0, ii = coordinates.length - 1; i < ii; ++i) {
    const start = coordinates[i];
    const end = coordinates[i + 1];
    const rel = getPointSegmentRelationship(x, y, start, end);
    if (rel.squaredDistance === 0) {
      const index = i + rel.along;
      targets.push({
        coordinates: coordinates,
        ring: ring,
        startIndex: index,
        endIndex: index,
        vertexIndices: vertexIndices,
        feature: feature,
        geometry: geometry,
        ringIndex: ringIndex,
      });
      return;
    }
  }
}

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

/**
 * @param {LineCoordType} coordinates The coordinates.
 * @param {number} index The index. May wrap.
 * @return {number} Normalized whole index.
 */
function getNormalizedIndex_(coordinates, index) {
  const count = coordinates.length;
  let normalized = index % count;
  if (normalized < 0) {
    normalized += count;
  }
  return normalized;
}

/**
 * @param {import("../geom/Geometry.js").default} geometry The curve geometry.
 * @param {Array<import("../coordinate.js").Coordinate>} vertexCoordinates Legal vertex coordinates.
 */
function appendTraceVertexCoordinates_(geometry, vertexCoordinates) {
  if (geometry instanceof LineString) {
    vertexCoordinates.push(...geometry.getCoordinates());
    return;
  }
  if (geometry instanceof CircularString) {
    const coordinates = geometry.getCoordinates();
    for (let i = 0, ii = coordinates.length; i < ii; i += 2) {
      vertexCoordinates.push(coordinates[i]);
    }
    return;
  }
  if (geometry instanceof CompoundCurve) {
    const geometries = geometry.getGeometriesArray();
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      appendTraceVertexCoordinates_(geometries[i], vertexCoordinates);
    }
  }
}

/**
 * @param {import("../geom/Geometry.js").default} geometry The curve geometry.
 * @param {LineCoordType} coordinates Tessellated target coordinates.
 * @return {Array<number>} Legal topology vertex indices in the target coordinates.
 */
function getTraceVertexIndices_(geometry, coordinates) {
  const vertexCoordinates = [];
  appendTraceVertexCoordinates_(geometry, vertexCoordinates);
  const vertexIndices = [];
  for (let i = 0, ii = coordinates.length; i < ii; ++i) {
    if (
      vertexCoordinates.some((vertex) =>
        coordinatesEqualXY(vertex, coordinates[i]),
      )
    ) {
      vertexIndices.push(i);
    }
  }
  return vertexIndices;
}

/**
 * @param {import("../coordinate.js").Coordinate} a One coordinate.
 * @param {import("../coordinate.js").Coordinate} b Another coordinate.
 * @return {number} The squared distance between the two coordinates.
 */
function getSquaredDistance(a, b) {
  return squaredDistance(a[0], a[1], b[0], b[1]);
}

/**
 * Get the cumulative squared distance along a ring path.  The end index index may be "wrapped" and it may
 * be less than the start index to indicate the direction of travel.  The start and end index may have
 * a fractional part to indicate a point between two coordinates.
 * @param {LineCoordType} coordinates Ring coordinates.
 * @param {number} startIndex The start index.
 * @param {number} endIndex The end index.
 * @return {number} The cumulative squared distance along the ring path.
 */
function getCumulativeSquaredDistance(coordinates, startIndex, endIndex) {
  let lowIndex, highIndex;
  if (startIndex < endIndex) {
    lowIndex = startIndex;
    highIndex = endIndex;
  } else {
    lowIndex = endIndex;
    highIndex = startIndex;
  }
  const lowWholeIndex = Math.ceil(lowIndex);
  const highWholeIndex = Math.floor(highIndex);

  if (lowWholeIndex > highWholeIndex) {
    // both start and end are on the same segment
    const start = interpolateCoordinate(coordinates, lowIndex);
    const end = interpolateCoordinate(coordinates, highIndex);
    return getSquaredDistance(start, end);
  }

  let sd = 0;

  if (lowIndex < lowWholeIndex) {
    const start = interpolateCoordinate(coordinates, lowIndex);
    const end = getCoordinate(coordinates, lowWholeIndex);
    sd += getSquaredDistance(start, end);
  }

  if (highWholeIndex < highIndex) {
    const start = getCoordinate(coordinates, highWholeIndex);
    const end = interpolateCoordinate(coordinates, highIndex);
    sd += getSquaredDistance(start, end);
  }

  for (let i = lowWholeIndex; i < highWholeIndex - 1; ++i) {
    const start = getCoordinate(coordinates, i);
    const end = getCoordinate(coordinates, i + 1);
    sd += getSquaredDistance(start, end);
  }

  return sd;
}

/**
 * @typedef {Object} PointSegmentRelationship
 * @property {number} along The closest point expressed as a fraction along the segment length.
 * @property {number} squaredDistance The squared distance of the point to the segment.
 */

/**
 * @type {PointSegmentRelationship}
 */
const sharedRel = {along: 0, squaredDistance: 0};

/**
 * @param {number} x The point x.
 * @param {number} y The point y.
 * @param {import("../coordinate.js").Coordinate} start The segment start.
 * @param {import("../coordinate.js").Coordinate} end The segment end.
 * @return {PointSegmentRelationship} The point segment relationship.  The returned object is
 * shared between calls and must not be modified by the caller.
 */
export function getPointSegmentRelationship(x, y, start, end) {
  const x1 = start[0];
  const y1 = start[1];
  const x2 = end[0];
  const y2 = end[1];
  const dx = x2 - x1;
  const dy = y2 - y1;
  let along = 0;
  let px = x1;
  let py = y1;
  if (dx !== 0 || dy !== 0) {
    along = clamp(((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy), 0, 1);
    px += dx * along;
    py += dy * along;
  }

  sharedRel.along = along;
  sharedRel.squaredDistance = toFixed(squaredDistance(x, y, px, py), 10);
  return sharedRel;
}
