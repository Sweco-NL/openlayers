/**
 * @module ol/interaction/TraceSource
 */
import Collection from '../Collection.js';
import CircularString from '../geom/CircularString.js';
import CompoundCurve from '../geom/CompoundCurve.js';
import CurvePolygon from '../geom/CurvePolygon.js';
import LineString from '../geom/LineString.js';
import Polygon from '../geom/Polygon.js';
import {coordinatesEqualXY, getPointSegmentRelationship} from './tracing.js';

/**
 * @typedef {Object} Options
 * @property {Array<import("../Feature.js").default>|Collection<import("../Feature.js").default>} features
 * Source features whose outer rings will form the trace graph. May be an array
 * (static) or a Collection (live updates land in a later commit).
 * @property {boolean} [exteriorOnly=true] When true, interior rings (holes) of CurvePolygon
 * and Polygon features will be excluded from the graph. When false, interior rings will
 * participate as their own connected components.
 */

/**
 * @typedef {Object} TraceVertex
 * @property {number} id Stable vertex id (insertion order).
 * @property {import("../coordinate.js").Coordinate} coordinate The coordinate.
 */

/**
 * @typedef {Object} TraceEdge
 * @property {'CircularString'|'LineString'} kind Canonical sub-geometry kind. Applications
 * read this to stamp segment-type breaks.
 * @property {import("../geom/SimpleGeometry.js").default|import("../geom/CompoundCurve.js").default|import("../geom/CircularString.js").default} subGeometry
 * The owning sub-geometry instance. For `LineString` and `Polygon` ring edges this is the
 * parent geometry; consumers combine with `segmentIndex` to identify the segment. For arc
 * edges this is the `CircularString` sub itself.
 * @property {number} [segmentIndex] Segment index within `subGeometry` for `LineString`-segment
 * edges. Undefined for whole-sub edges (arcs).
 * @property {number} [arcIndex] Arc index within the owning `CircularString` for arc edges.
 * Undefined for `LineString` edges.
 * @property {TraceVertex} startVertex Start vertex.
 * @property {TraceVertex} endVertex End vertex.
 * @property {import("../Feature.js").default} feature The owning feature.
 * @property {number} [ringIndex] Ring index within a polygon parent (0 = exterior).
 */

/**
 * @classdesc
 * Holds the configuration for a multi-feature trace graph: the source features whose
 * outer rings will be stitched at shared vertices, and whether interior rings (holes)
 * participate. Subsequent commits build the graph and expose query methods used by
 * {@link module:ol/interaction/Draw~Draw} for vertex-only-exit tracing.
 */
class TraceSource {
  /**
   * @param {Options} options Options.
   */
  constructor(options) {
    if (!options.features) {
      throw new Error('TraceSource requires options.features');
    }

    /**
     * @private
     * @type {Array<import("../Feature.js").default>|Collection<import("../Feature.js").default>}
     */
    this.features_ = options.features;

    /**
     * @private
     * @type {boolean}
     */
    this.exteriorOnly_ = options.exteriorOnly !== false;

    /**
     * @private
     * @type {Array<TraceVertex>|null}
     */
    this.vertices_ = null;

    /**
     * @private
     * @type {Array<TraceEdge>|null}
     */
    this.edges_ = null;

    /**
     * @private
     * @type {(function():void)|null}
     */
    this.detachCollection_ = null;

    if (this.features_ instanceof Collection) {
      const collection = this.features_;
      const invalidate = () => {
        this.vertices_ = null;
        this.edges_ = null;
      };
      collection.on('add', invalidate);
      collection.on('remove', invalidate);
      this.detachCollection_ = () => {
        collection.un('add', invalidate);
        collection.un('remove', invalidate);
      };
    }
  }

  /**
   * Discard the cached graph so it will be rebuilt on the next query.
   * Call this after any geometry change (e.g. after a Modify interaction
   * moves a vertex) so the trace graph reflects the updated coordinates.
   */
  invalidate() {
    this.vertices_ = null;
    this.edges_ = null;
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
    this.edges_ = [];
    const features = this.getFeatures();
    for (const feature of features) {
      const geometry = feature.getGeometry();
      this.collectFromGeometry_(geometry, feature);
    }
  }

  /**
   * @private
   * @param {import("../geom/Geometry.js").default} geometry The geometry.
   * @param {import("../Feature.js").default} feature The owning feature.
   */
  collectFromGeometry_(geometry, feature) {
    if (geometry instanceof LineString) {
      this.addLinearRingOrLine_(
        geometry.getCoordinates(),
        false,
        geometry,
        feature,
        undefined,
      );
      return;
    }
    if (geometry instanceof Polygon) {
      const rings = geometry.getCoordinates();
      const max = Math.min(this.exteriorOnly_ ? 1 : rings.length, rings.length);
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
      const max = Math.min(this.exteriorOnly_ ? 1 : rings.length, rings.length);
      for (let i = 0; i < max; ++i) {
        this.addCurvePolygonRing_(rings[i], feature, i);
      }
      return;
    }
    // Other geometry types added in later tasks.
  }

  /**
   * Build LineString edges for a ring or open line.
   *
   * PRECONDITION for `closed === true`: `coordinates` MUST carry the explicit
   * duplicate closing coordinate, i.e. `coordinates[length - 1]` equals
   * `coordinates[0]` (the standard OpenLayers closed-ring representation, e.g.
   * `[A, B, C, A]`). The final segment then wires its end back to the shared
   * vertex 0 instead of adding a coincident duplicate vertex. Passing an
   * unclosed array (`[A, B, C]`) with `closed === true` drops the last real
   * segment and produces a malformed graph — callers must close the ring first.
   *
   * @private
   * @param {Array<import("../coordinate.js").Coordinate>} coordinates Ring or line coordinates. For a closed ring the last coordinate must duplicate the first.
   * @param {boolean} closed True for closed rings (the closing coordinate is wired back to the first vertex without creating a duplicate).
   * @param {import("../geom/SimpleGeometry.js").default} subGeometry Owning sub-geometry.
   * @param {import("../Feature.js").default} feature Owning feature.
   * @param {number|undefined} ringIndex Ring index within a polygon parent.
   */
  addLinearRingOrLine_(coordinates, closed, subGeometry, feature, ringIndex) {
    const segmentEnd = coordinates.length - 1;
    for (let i = 0; i < segmentEnd; ++i) {
      const start = this.findOrAddVertex_(coordinates[i]);
      const end =
        closed && i === segmentEnd - 1
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

  /**
   * Dispatch a single CurvePolygon ring (which can be a CircularString, CompoundCurve,
   * or plain LineString) to the appropriate edge collector.
   * @private
   * @param {import("../geom/Geometry.js").default} ring The ring.
   * @param {import("../Feature.js").default} feature Owning feature.
   * @param {number} ringIndex Ring index (0 = exterior).
   */
  addCurvePolygonRing_(ring, feature, ringIndex) {
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
        ring.getCoordinates(),
        true,
        ring,
        feature,
        ringIndex,
      );
    }
  }

  /**
   * Walk a CircularString and emit one edge per arc triplet (start, mid, end).
   * @private
   * @param {import("../geom/CircularString.js").default} circular The CircularString.
   * @param {import("../Feature.js").default} feature Owning feature.
   * @param {number|undefined} ringIndex Ring index within a CurvePolygon parent, or undefined.
   */
  addCircularString_(circular, feature, ringIndex) {
    const coords = circular.getCoordinates();
    // CircularString coords come in (start, mid, end, mid, end, ...).
    // Each arc consumes 3 coords; consecutive arcs share their start/end.
    for (let i = 0; i + 2 < coords.length; i += 2) {
      const start = this.findOrAddVertex_(coords[i]);
      const end = this.findOrAddVertex_(coords[i + 2]);
      this.edges_.push({
        kind: 'CircularString',
        subGeometry: circular,
        segmentIndex: undefined,
        arcIndex: i / 2,
        startVertex: start,
        endVertex: end,
        feature: feature,
        ringIndex: ringIndex,
      });
    }
  }

  /**
   * Walk a CompoundCurve and emit edges for each sub geometry.
   * @private
   * @param {import("../geom/CompoundCurve.js").default} compound The CompoundCurve.
   * @param {import("../Feature.js").default} feature Owning feature.
   * @param {number|undefined} ringIndex Ring index within a CurvePolygon parent, or undefined.
   */
  addCompoundCurve_(compound, feature, ringIndex) {
    const subs = compound.getGeometriesArray();
    for (const sub of subs) {
      if (sub instanceof CircularString) {
        this.addCircularString_(sub, feature, ringIndex);
      } else if (sub instanceof LineString) {
        this.addLinearRingOrLine_(
          sub.getCoordinates(),
          false,
          sub,
          feature,
          ringIndex,
        );
      }
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
    const vertex = {
      id: this.vertices_.length,
      coordinate: coordinate.slice(),
    };
    this.vertices_.push(vertex);
    return vertex;
  }

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

  /**
   * @param {import("../coordinate.js").Coordinate} coordinate Test coordinate.
   * @param {number} tolerance Distance tolerance (same units as coordinates).
   * @return {{vertex: TraceVertex, squaredDistance: number}|null} Nearest vertex within tolerance, or null.
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
   * Resolve the active trace edge for a cursor coordinate using sticky-closest-edge
   * semantics: if `previous` is within `tolerance` of the cursor, `previous` wins (handles
   * ties at junctions and brief pauses on the current edge); otherwise the geometrically
   * closest edge among `previous` and its neighbors wins.
   *
   * Graph-walk constraint: when `previous` is non-null the candidate set is restricted
   * to `previous` itself and edges sharing a vertex (junction) with it. This guarantees
   * that the trace can only flow across connected edges and never "hops" mid-edge to an
   * unrelated nearby feature.
   *
   * @param {import("../coordinate.js").Coordinate} coordinate Cursor coordinate.
   * @param {number} tolerance Distance tolerance for the sticky check.
   * @param {TraceEdge|null} previous Previously active edge, or null.
   * @return {TraceEdge|null} The new active edge, or null when the source has no edges.
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
      if (previous && edge !== previous) {
        // Graph-walk constraint: only consider neighbors of `previous`.
        const sharesVertex =
          edge.startVertex === previous.startVertex ||
          edge.startVertex === previous.endVertex ||
          edge.endVertex === previous.startVertex ||
          edge.endVertex === previous.endVertex;
        if (!sharesVertex) {
          continue;
        }
      }
      const d2 = this.squaredDistanceToEdge_(coordinate, edge);
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestEdge = edge;
      }
    }
    // Fallback: if no candidate was found (should be impossible when `previous`
    // is a valid edge, since `previous` itself is always considered) keep the
    // previous edge so the cursor stays on the graph.
    return bestEdge || previous;
  }

  /**
   * @private
   * @param {import("../coordinate.js").Coordinate} coordinate The coordinate.
   * @param {TraceEdge} edge The edge.
   * @return {number} Squared distance from coordinate to the edge.
   */
  squaredDistanceToEdge_(coordinate, edge) {
    if (edge.kind === 'LineString') {
      return getPointSegmentRelationship(
        coordinate[0],
        coordinate[1],
        edge.startVertex.coordinate,
        edge.endVertex.coordinate,
      ).squaredDistance;
    }
    // CircularString edge: project onto the specific arc identified by
    // edge.arcIndex (NOT the whole CircularString sub-geometry which may hold
    // many arcs).
    const closest = this.closestPointOnEdge(edge, coordinate);
    const dx = coordinate[0] - closest[0];
    const dy = coordinate[1] - closest[1];
    return dx * dx + dy * dy;
  }

  /**
   * Closest point on a specific edge. For `LineString` edges this is the
   * closest point on the segment between the edge's two vertices. For
   * `CircularString` edges this is the closest point on the specific arc
   * identified by `edge.arcIndex`.
   *
   * @param {TraceEdge} edge The edge.
   * @param {import("../coordinate.js").Coordinate} coordinate The coordinate.
   * @return {import("../coordinate.js").Coordinate} Closest point on the edge.
   */
  closestPointOnEdge(edge, coordinate) {
    if (edge.kind === 'LineString') {
      const rel = getPointSegmentRelationship(
        coordinate[0],
        coordinate[1],
        edge.startVertex.coordinate,
        edge.endVertex.coordinate,
      );
      const sx = edge.startVertex.coordinate[0];
      const sy = edge.startVertex.coordinate[1];
      const ex = edge.endVertex.coordinate[0];
      const ey = edge.endVertex.coordinate[1];
      return [sx + (ex - sx) * rel.along, sy + (ey - sy) * rel.along];
    }
    // CircularString edge: project onto the specific arc.
    const circular = /** @type {CircularString} */ (edge.subGeometry);
    return circular.closestPointOnArc(
      /** @type {number} */ (edge.arcIndex),
      coordinate[0],
      coordinate[1],
    );
  }

  /**
   * Polyline approximation of one edge. For `LineString` edges this is just
   * the segment endpoints (2 coordinates). For `CircularString` edges this
   * tessellates the specific arc identified by `edge.arcIndex` so callers
   * can walk intermediate points (used for arc hugging during tracing).
   *
   * Results are cached on the edge instance keyed by tolerance so repeated
   * calls during a trace do not re-tessellate.
   *
   * @param {TraceEdge} edge The edge.
   * @param {number} [tolerance] Max chord-to-arc error in coordinate units
   *     for arc tessellation. When omitted, a default angular step of ~5° is
   *     used. Ignored for `LineString` edges.
   * @return {Array<import("../coordinate.js").Coordinate>} Polyline approximation
   *     of the edge; always at least 2 coordinates (start, end).
   */
  tessellateEdge(edge, tolerance) {
    if (edge.kind === 'LineString') {
      return [
        edge.startVertex.coordinate.slice(),
        edge.endVertex.coordinate.slice(),
      ];
    }
    const cache =
      /** @type {{tolerance: number|undefined, coords: Array<import("../coordinate.js").Coordinate>}|undefined} */ (
        /** @type {*} */ (edge).tessellation_
      );
    if (cache && cache.tolerance === tolerance) {
      return cache.coords;
    }
    const circular = /** @type {CircularString} */ (edge.subGeometry);
    const coords = circular.tessellateArc(
      /** @type {number} */ (edge.arcIndex),
      tolerance,
    );
    /** @type {*} */ (edge).tessellation_ = {tolerance, coords};
    return coords;
  }

  /**
   * Return the three canonical control points `[start, mid, end]` for a
   * `CircularString` edge, or `[start, end]` for a `LineString` edge.
   * Use these at `drawend` to replace tessellated arc coordinates with the
   * exact source geometry control points.
   *
   * @param {TraceEdge} edge The edge.
   * @return {Array<import("../coordinate.js").Coordinate>} Control points (3 for arcs, 2 for lines).
   */
  getEdgeControlPoints(edge) {
    if (edge.kind === 'LineString') {
      return [
        edge.startVertex.coordinate.slice(),
        edge.endVertex.coordinate.slice(),
      ];
    }
    const circular =
      /** @type {import("../geom/CircularString.js").default} */ (
        edge.subGeometry
      );
    const coords = circular.getCoordinates();
    const i = /** @type {number} */ (edge.arcIndex);
    return [
      coords[2 * i].slice(),
      coords[2 * i + 1].slice(),
      coords[2 * i + 2].slice(),
    ];
  }

  /**
   * Project a coordinate onto the polyline approximation of one edge,
   * returning both the projected point and a fractional index along the
   * polyline. The fractional index is `segIndex + along` where `segIndex`
   * is the polyline segment index (0-based) and `along` is the 0..1
   * parameter within that segment. Use this when walking an edge's
   * tessellation incrementally as the cursor moves.
   *
   * @param {TraceEdge} edge The edge.
   * @param {import("../coordinate.js").Coordinate} coordinate The query coordinate.
   * @param {number} [tolerance] Max chord-to-arc error for arc tessellation.
   * @return {{coordinate: import("../coordinate.js").Coordinate, fractionalIndex: number}}
   *     Projected coordinate and fractional polyline index.
   */
  projectOnEdgeTessellation(edge, coordinate, tolerance) {
    const tess = this.tessellateEdge(edge, tolerance);
    const x = coordinate[0];
    const y = coordinate[1];
    let bestSeg = 0;
    let bestAlong = 0;
    let bestDist2 = Infinity;
    let bestX = tess[0][0];
    let bestY = tess[0][1];
    for (let i = 0, ii = tess.length - 1; i < ii; ++i) {
      const a = tess[i];
      const b = tess[i + 1];
      const rel = getPointSegmentRelationship(x, y, a, b);
      if (rel.squaredDistance < bestDist2) {
        bestDist2 = rel.squaredDistance;
        bestSeg = i;
        bestAlong = rel.along;
        bestX = a[0] + (b[0] - a[0]) * rel.along;
        bestY = a[1] + (b[1] - a[1]) * rel.along;
      }
    }
    return {
      coordinate: [bestX, bestY],
      fractionalIndex: bestSeg + bestAlong,
    };
  }

  /**
   * Detach any internal listeners. The instance must not be used after dispose.
   */
  dispose() {
    if (this.detachCollection_) {
      this.detachCollection_();
      this.detachCollection_ = null;
    }
  }
}

export default TraceSource;
