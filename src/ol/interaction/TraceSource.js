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
   * @private
   * @param {Array<import("../coordinate.js").Coordinate>} coordinates Ring or line coordinates.
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
   * closest edge wins.
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
      return getPointSegmentRelationship(
        coordinate[0],
        coordinate[1],
        edge.startVertex.coordinate,
        edge.endVertex.coordinate,
      ).squaredDistance;
    }
    // CircularString edge: delegate to the sub geometry's closestPointXY which
    // returns the squared distance to the closest point on the curve.
    const closest = [0, 0];
    return edge.subGeometry.closestPointXY(
      coordinate[0],
      coordinate[1],
      closest,
      Infinity,
    );
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
