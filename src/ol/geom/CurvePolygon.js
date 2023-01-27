/**
 * @module ol/geom/CurvePolygon
 */
import SimpleGeometry from "./SimpleGeometry.js";
import { createOrUpdateEmpty, extend } from "../extent.js";
import { linearRingIsClockwise } from "./flat/orient.js";
import { getCenter } from "../extent.js";
import { getInteriorPointOfArray } from "./flat/interiorpoint.js";
import { linearRingsAreOriented, orientLinearRings } from "./flat/orient.js";
import Point from "./Point.js";
import { quantizeArray } from "./flat/simplify.js";
import { deflateCoordinatesArray } from "./flat/deflate.js";

class CurvePolygon extends SimpleGeometry {
  /**
   * @param {Array<import('../geom/Geometry.js').default>} [rings] rings
   * @param {import("../geom/Geometry.js").GeometryLayout} [opt_layout] Layout.
   * @param {Array<number>} [ends] Ends (for internal use with flat coordinates).
   */
  constructor(rings, opt_layout, ends) {
    super();

    /**
     * @type {Array<number>}
     * @private
     */
    this.ends_ = [];

    /**
     * @private
     * @type {number}
     */
    this.flatInteriorPointRevision_ = -1;

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
    const coordinatess = [
      this.rings_
        .map((ring) => ring.getCoordinates())
        .reduce((previous, current) => {
          return previous.concat(current);
        }, []),
    ];
    this.ends_ = deflateCoordinatesArray(
      this.flatCoordinates,
      0,
      coordinatess,
      this.stride,
      this.ends_
    );
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
   * @return {Array<number>} Ends.
   */
  getEnds() {
    return this.ends_;
  }

  /**
   * @return {Array<number>} Interior point.
   */
  getFlatInteriorPoint() {
    if (this.flatInteriorPointRevision_ != this.getRevision()) {
      const flatCenter = getCenter(this.getExtent());
      this.flatInteriorPoint_ = getInteriorPointOfArray(
        this.getOrientedFlatCoordinates(),
        0,
        this.ends_,
        this.stride,
        flatCenter,
        0
      );
      this.flatInteriorPointRevision_ = this.getRevision();
    }
    return this.flatInteriorPoint_;
  }

  /**
   * @return {Array<number>} Oriented flat coordinates.
   */
  getOrientedFlatCoordinates() {
    if (this.orientedRevision_ != this.getRevision()) {
      const flatCoordinates = this.flatCoordinates;
      if (linearRingsAreOriented(flatCoordinates, 0, this.ends_, this.stride)) {
        this.orientedFlatCoordinates_ = flatCoordinates;
      } else {
        this.orientedFlatCoordinates_ = flatCoordinates.slice();
        this.orientedFlatCoordinates_.length = orientLinearRings(
          this.orientedFlatCoordinates_,
          0,
          this.ends_,
          this.stride
        );
      }
      this.orientedRevision_ = this.getRevision();
    }
    return this.orientedFlatCoordinates_;
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
   * Return an interior point of the polygon.
   * @return {Point} Interior point as XYM coordinate, where M is the
   * length of the horizontal intersection that the point belongs to.
   * @api
   */
  getInteriorPoint() {
    return new Point(this.getFlatInteriorPoint(), "XYM");
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
   * @return {import("./Geometry.js").Type} Geometry type.
   * @api
   */
  getType() {
    return "CurvePolygon";
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
