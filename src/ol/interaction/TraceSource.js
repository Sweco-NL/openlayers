/**
 * @module ol/interaction/TraceSource
 */
import Collection from '../Collection.js';

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
