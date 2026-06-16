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
    const features = this.getFeatures();
    for (const feature of features) {
      const geometry = feature.getGeometry();
      this.collectVerticesFromGeometry_(geometry);
    }
  }

  /**
   * @private
   * @param {import("../geom/Geometry.js").default} geometry The geometry.
   */
  collectVerticesFromGeometry_(geometry) {
    if (geometry instanceof LineString) {
      this.addRing_(geometry.getCoordinates(), false);
      return;
    }
    if (geometry instanceof Polygon) {
      const rings = geometry.getCoordinates();
      const max = Math.min(this.exteriorOnly_ ? 1 : rings.length, rings.length);
      for (let i = 0; i < max; ++i) {
        this.addRing_(rings[i], true);
      }
      return;
    }
    // Other geometry types added in later tasks.
  }

  /**
   * @private
   * @param {Array<import("../coordinate.js").Coordinate>} coordinates Ring coordinates.
   * @param {boolean} ring True for closed rings (skip the duplicated closing coordinate).
   */
  addRing_(coordinates, ring) {
    const last = ring ? coordinates.length - 1 : coordinates.length;
    for (let i = 0; i < last; ++i) {
      this.findOrAddVertex_(coordinates[i]);
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
}

export default TraceSource;
