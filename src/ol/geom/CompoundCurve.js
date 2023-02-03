/**
 * @module ol/geom/CompoundCurve
 */
import SimpleGeometry from "./SimpleGeometry.js";
import {
  closestSquaredDistanceXY,
  createOrUpdateEmpty,
  extend,
} from "../extent.js";
import { deflateCoordinates } from "./flat/deflate.js";
import { inflateCoordinates } from "./flat/inflate.js";
import { interpolatePoint } from "./flat/interpolate.js";

/**
 * @classdesc
 * CompoundCurve geometry.
 *
 * @api
 */
class CompoundCurve extends SimpleGeometry {
  /**
   * @param {Array<import('../geom/Geometry.js').default>} [geometries] Geometries
   * @param {import("../geom/Geometry.js").GeometryLayout} [opt_layout] Layout.
   */
  constructor(geometries, opt_layout) {
    super();

    /**
     * @private
     * @type {number}
     */
    this.maxDelta_ = -1;

    /**
     * @private
     * @type {number}
     */
    this.maxDeltaRevision_ = -1;

    /**
     * @private
     * @type {Array<import('../geom/SimpleGeometry.js').default>} [geometries] Geometries
     */
    this.geometries_ =
      /** @type {Array<import('../geom/SimpleGeometry.js').default>} */ (
        geometries
      );

    this.updateCoordinates(opt_layout);
  }

  /**
     * Updates the curve's coordinates based on the geometries' coordinates.
     * @param {import("../geom/Geometry.js").GeometryLayout} [opt_layout] Layout.
     */
  updateCoordinates(opt_layout) {
    this.setCoordinates_(
      this.geometries_.reduce((previous, current) => {
        if (previous.length < 1) {
          return previous.concat(current.getCoordinates());
        }

        return previous.concat(current.getCoordinates().slice(1));
      }, [])
    , opt_layout);
  }

  /**
   * Returns the array of geometries of which this curve consists.
   * @return {Array<import('../geom/SimpleGeometry.js').default>}
   * The geometries.
   */
  getGeometries() {
    return this.geometries_;
  }

  /**
   * Reverses the curve.
   */
  reverse() {
    this.geometries_.forEach((geometry) => {
      geometry.reverse();
    });
    this.geometries_.reverse();
    this.updateCoordinates();
    this.changed();
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
    const geometries = this.geometries_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      geometries[i].applyTransform(transformFn);
    }
    super.applyTransform(transformFn);
  }

  /**
   * Returns the type of this geometry.
   * @return {import("./Geometry.js").Type} Geometry type.
   * @api
   */
  getType() {
    return "CompoundCurve";
  }

  /**
   * Sets the coordinates of this curve.
   * @private
   * @param {!Array<import("../coordinate.js").Coordinate>} coordinates
   * The given coordinates.
   * @param {import("../geom/Geometry.js").GeometryLayout} [opt_layout] Layout.
   * The geometry layout.
   */
  setCoordinates_(coordinates, opt_layout) {
    this.setLayout(opt_layout, coordinates, 1);
    if (!this.flatCoordinates) {
      this.flatCoordinates = [];
    }
    this.flatCoordinates.length = deflateCoordinates(
      this.flatCoordinates,
      0,
      coordinates,
      this.stride
    );
    this.changed();
  }

  /**
   * Make a complete copy of the geometry.
   * @return {!CompoundCurve} Clone.
   * @api
   */
  clone() {
    const compoundCurve = new CompoundCurve(
      this.geometries_.map((geometry) => geometry.clone()),
      this.layout
    );
    compoundCurve.applyProperties(this);
    return compoundCurve;
  }

  /**
   * Return the coordinate at the provided fraction along the linestring.
   * The `fraction` is a number between 0 and 1, where 0 is the start of the
   * linestring and 1 is the end.
   * @param {number} fraction Fraction.
   * @param {import("../coordinate.js").Coordinate} [dest] Optional coordinate whose values will
   *     be modified. If not provided, a new coordinate will be returned.
   * @return {import("../coordinate.js").Coordinate} Coordinate of the interpolated point.
   * @api
   */
  getCoordinateAt(fraction, dest) {
    return interpolatePoint(
      this.flatCoordinates,
      0,
      this.flatCoordinates.length,
      this.stride,
      fraction,
      dest,
      this.stride
    );
  }

  /**
   * @return {Array<number>} Flat midpoint.
   */
  getFlatMidpoint() {
    if (this.flatMidpointRevision_ != this.getRevision()) {
      this.flatMidpoint_ = this.getCoordinateAt(0.5, this.flatMidpoint_);
      this.flatMidpointRevision_ = this.getRevision();
    }
    return this.flatMidpoint_;
  }

  /**
   * Returns the coordinates of the circular string.
   * @return {Array<import("../coordinate.js").Coordinate>} Coordinates.
   * @api
   */
  getCoordinates() {
    return inflateCoordinates(
      this.flatCoordinates,
      0,
      this.flatCoordinates.length,
      this.stride
    );
  }

  /**
   * Computes the extent of the compound curve.
   * @protected
   * @param {import("../extent.js").Extent} extent Extent.
   * @return {import("../extent.js").Extent} extent Extent.
   */
  computeExtent(extent) {
    createOrUpdateEmpty(extent);
    const geometries = this.geometries_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      extend(extent, geometries[i].getExtent());
    }
    return extent;
  }

  /**
   * @param {number} x X.
   * @param {number} y Y.
   * @param {import("../coordinate.js").Coordinate} closestPoint Closest point.
   * @param {number} minSquaredDistance Minimum squared distance.
   * @return {number} Minimum squared distance.
   */
  closestPointXY(x, y, closestPoint, minSquaredDistance) {
    if (minSquaredDistance < closestSquaredDistanceXY(this.getExtent(), x, y)) {
      return minSquaredDistance;
    }
    const geometries = this.geometries_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      minSquaredDistance = geometries[i].closestPointXY(
        x,
        y,
        closestPoint,
        minSquaredDistance
      );
    }
    return minSquaredDistance;
  }
}

export default CompoundCurve;
