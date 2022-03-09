/**
 * @module ol/geom/CurvePolygon
 */
import GeometryType from './GeometryType.js';
import SimpleGeometry from './SimpleGeometry.js';
import {createOrUpdateEmpty, extend} from '../extent.js';
import {linearRingIsClockwise} from './flat/orient.js';

class CurvePolygon extends SimpleGeometry {
  /**
   * @param {Array<import('../geom/Geometry.js').default>} [rings] rings
   * @param {import("./GeometryLayout.js").default} [opt_layout] Layout.
   */
  constructor(rings, opt_layout) {
    super();

    /**
     * @private
     * @type {Array<import('../geom/SimpleGeometry.js').default>} [rings] rings
     */
    this.rings_ =
      /** @type {Array<import('../geom/SimpleGeometry.js').default>} */ (rings);

    this.update();
  }

  /**
   * Updates the polygon's internals.
   * @private
   */
  update() {
    this.orientRings();
    this.updateFlatCoordinates();
  }

  /**
   * Updates the polygon's array of flat coordinates.
   * @private
   */
  updateFlatCoordinates() {
    this.flatCoordinates = this.rings_.reduce((previous, current) => {
      return previous.concat(current.getFlatCoordinates());
    }, []);
  }

  /**
   * Changes the orientation of the rings such that inner rings are oriented
   * counterclockwise and the outer ring is oriented clockwise.
   * @private
   */
  orientRings() {
    if (this.rings_.length < 2) {
      return;
    }
    const outerRing = this.rings_[0];
    if (!this.ringIsClockwiseOriented(outerRing)) {
      outerRing.reverse();
    }
    this.rings_.slice(1).forEach((ring) => {
      if (this.ringIsClockwiseOriented(ring)) {
        ring.reverse();
      }
    });
  }

  /**
   * Returns whether the given ring is clockwise oriented.
   * @private
   * @param {import('../geom/SimpleGeometry.js').default} ring The given ring.
   * @return {boolean} True if clockwise oriented, false otherwise.
   */
  ringIsClockwiseOriented(ring) {
    const coords = ring.getFlatCoordinates();
    const end = coords.length;
    return linearRingIsClockwise(coords, 0, end, ring.getStride());
  }

  /**
   * Returns the polygon's array of rings where the first ring concerns the
   * outer ring and all subsequent rings the inner rings.
   * @return {Array<import('../geom/SimpleGeometry.js').default>} The rings.
   */
  getRings() {
    return this.rings_;
  }

  /**
   * Make a complete copy of the geometry.
   * @return {!CurvePolygon} Clone.
   * @api
   */
  clone() {
    const curvePolygon = new CurvePolygon(
      this.rings_.map((ring) => ring.clone()),
      this.layout
    );
    curvePolygon.applyProperties(this);
    return curvePolygon;
  }

  /**
   * Returns the type of this geometry.
   * @return {import("./GeometryType.js").default} Geometry type.
   * @api
   */
  getType() {
    return GeometryType.CURVE_POLYGON;
  }

  /**
   * Apply a transform function to the coordinates of the geometry.
   * The geometry is modified in place.
   * If you do not want the geometry modified in place, first `clone()` it and
   * then use this function on the clone.
   * @param {import("../proj.js").TransformFunction} transformFn Transform function.
   * Called with a flat array of geometry coordinates.
   * @api
   */
  applyTransform(transformFn) {
    this.rings_.forEach((ring) => {
      ring.applyTransform(transformFn);
    });
    this.update();
    this.changed();
  }

  /**
   * Computes the polygon's extent and returns the result.
   * @protected
   * @param {import("../extent.js").Extent} extent Extent.
   * @return {import("../extent.js").Extent} extent Extent.
   */
  computeExtent(extent) {
    createOrUpdateEmpty(extent);
    this.rings_.forEach((ring) => {
      extend(extent, ring.getExtent());
    });
    return extent;
  }
}

export default CurvePolygon;
