/**
 * @module ol/interaction/TraceSource
 */
import Collection from '../Collection.js';
import LineString from '../geom/LineString.js';
import Polygon from '../geom/Polygon.js';
import {coordinatesEqualXY} from './tracing.js';

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
}

export default TraceSource;
