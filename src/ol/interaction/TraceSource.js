/**
 * @module ol/interaction/TraceSource
 */
import Collection from '../Collection.js';

/**
 * @typedef {Object} Options
 * @property {Array<import("../Feature.js").default> | Collection<import("../Feature.js").default>} features
 * Source features whose outer rings form the trace graph. May be an array (static) or a
 * Collection (the graph cache invalidates on add/remove/change).
 * @property {boolean} [exteriorOnly=true] When true, interior rings (holes) of CurvePolygon
 * and Polygon features are excluded from the graph. When false, interior rings participate
 * as their own connected components.
 */

/**
 * Owns the planar graph of shared vertices across a set of source features, used by
 * {@link module:ol/interaction/Draw~Draw} when tracing in vertex-only-exit mode.
 *
 * The graph has one vertex per *exact-coordinate-equal* topology vertex across all eligible
 * rings, and one edge per sub-geometry (each arc of a CircularString, each segment of a
 * LineString, each sub of a CompoundCurve). Features stitch only at shared vertices.
 *
 * @api
 */
class TraceSource {
  /**
   * @param {Options} options Options.
   */
  constructor(options) {
    /**
     * @private
     * @type {Array<import("../Feature.js").default> | Collection<import("../Feature.js").default>}
     */
    this.features_ = options.features;

    /**
     * @private
     * @type {boolean}
     */
    this.exteriorOnly_ = options.exteriorOnly !== false;
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
}

export default TraceSource;
