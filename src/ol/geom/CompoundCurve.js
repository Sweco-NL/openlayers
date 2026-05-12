/**
 * @module ol/geom/CompoundCurve
 */
import {assert} from '../asserts.js';
import {warn} from '../console.js';
import {listen, unlistenByKey} from '../events.js';
import EventType from '../events/EventType.js';
import {
  closestSquaredDistanceXY,
  createOrUpdateEmpty,
  extend,
  getCenter,
  intersects,
} from '../extent.js';
import Geometry from './Geometry.js';

/**
 * A sub-geometry of a CompoundCurve (CircularString or LineString).
 * @typedef {import("./CircularString.js").default | import("./LineString.js").default} CurveSegment
 */

/**
 * @classdesc
 * CompoundCurve geometry.
 *
 * @api
 */
class CompoundCurve extends Geometry {
  /**
   * @param {Array<import("./Geometry.js").default>} [geometries] Geometries.
   * @param {import("./Geometry.js").GeometryLayout} [layout] Layout.
   */
  constructor(geometries, layout) {
    super();

    /**
     * @private
     * @type {import("../coordinate.js").Coordinate|null}
     */
    this.flatMidpoint_ = null;

    /**
     * @private
     * @type {number}
     */
    this.flatMidpointRevision_ = -1;

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
     * @type {Array<CurveSegment>}
     */
    this.geometries_ = /** @type {Array<CurveSegment>} */ (geometries || []);

    /**
     * @private
     * @type {Array<import("../events.js").EventsKey>}
     */
    this.changeEventsKeys_ = [];

    /**
     * @private
     * @type {import("./Geometry.js").GeometryLayout}
     */
    this.layout_ = 'XY';

    /**
     * @private
     * @type {number}
     */
    this.stride_ = 2;

    this.init_(layout);
    this.listenGeometriesChange_();
  }

  /**
   * Initialize layout from geometries or explicit layout parameter.
   * @param {import("./Geometry.js").GeometryLayout} [layout] Layout.
   * @private
   */
  init_(layout) {
    if (layout) {
      this.layout_ = layout;
      this.stride_ =
        layout === 'XY' ? 2 : layout === 'XYZ' || layout === 'XYM' ? 3 : 4;
    } else if (this.geometries_.length > 0) {
      this.layout_ = this.geometries_[0].getLayout();
      this.stride_ = this.geometries_[0].getStride();
    }
    for (let i = 0, ii = this.geometries_.length; i < ii; ++i) {
      const type = this.geometries_[i].getType();
      assert(
        type === 'CircularString' || type === 'LineString',
        `CompoundCurve sub-geometry must be CircularString or LineString, got '${type}'`,
      );
      if (i > 0) {
        assert(
          this.geometries_[i].getLayout() === this.layout_,
          `CompoundCurve sub-geometry layout mismatch: expected '${this.layout_}', got '${this.geometries_[i].getLayout()}'`,
        );
      }
    }
  }

  /**
   * @private
   */
  listenGeometriesChange_() {
    const geometries = this.geometries_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      this.changeEventsKeys_.push(
        listen(geometries[i], EventType.CHANGE, this.changed, this),
      );
    }
  }

  /**
   * @private
   */
  unlistenGeometriesChange_() {
    this.changeEventsKeys_.forEach(unlistenByKey);
    this.changeEventsKeys_.length = 0;
  }

  /**
   * Return the layout of the geometry.
   * @return {import("./Geometry.js").GeometryLayout} Layout.
   * @api
   */
  getLayout() {
    return this.layout_;
  }

  /**
   * Return the stride (number of values per coordinate).
   * @return {number} Stride.
   * @api
   */
  getStride() {
    return this.stride_;
  }

  /**
   * Return the flat coordinates of the compound curve
   * (concatenated from sub-geometries, deduplicating junction points).
   * @return {Array<number>} Flat coordinates.
   */
  getFlatCoordinates() {
    const flatCoordinates = [];
    const geometries = this.geometries_;
    const stride = this.stride_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      const geomFlat = geometries[i].getFlatCoordinates();
      // skip the first coordinate of subsequent sub-geometries (junction dedup)
      const start = i > 0 ? stride : 0;
      for (let j = start, jj = geomFlat.length; j < jj; ++j) {
        flatCoordinates.push(geomFlat[j]);
      }
    }
    return flatCoordinates;
  }

  /**
   * Returns cloned copies of the geometries of which this curve consists.
   * @return {Array<CurveSegment>} The geometries.
   * @api
   */
  getGeometries() {
    return this.geometries_.map(
      (geom) => /** @type {CurveSegment} */ (geom.clone()),
    );
  }

  /**
   * Returns the internal array of geometries without cloning.
   * @return {Array<CurveSegment>} The geometries.
   */
  getGeometriesArray() {
    return this.geometries_;
  }

  /**
   * Set the geometries that make up this compound curve.
   * @param {Array<CurveSegment>} geometries Geometries.
   * @api
   */
  setGeometries(geometries) {
    this.setGeometriesArray(
      geometries.map((geom) => /** @type {CurveSegment} */ (geom.clone())),
    );
  }

  /**
   * @param {Array<CurveSegment>} geometries Geometries.
   */
  setGeometriesArray(geometries) {
    this.unlistenGeometriesChange_();
    this.geometries_ = geometries;
    this.init_();
    this.listenGeometriesChange_();
    this.changed();
  }

  /**
   * Append a sub-geometry to this compound curve.
   * @param {CurveSegment} geometry Geometry to append.
   * @api
   */
  appendGeometry(geometry) {
    const type = geometry.getType();
    assert(
      type === 'CircularString' || type === 'LineString',
      `CompoundCurve sub-geometry must be CircularString or LineString, got '${type}'`,
    );
    if (this.geometries_.length > 0) {
      assert(
        geometry.getLayout() === this.layout_,
        `CompoundCurve sub-geometry layout mismatch: expected '${this.layout_}', got '${geometry.getLayout()}'`,
      );
    }
    this.geometries_.push(geometry);
    this.changeEventsKeys_.push(
      listen(geometry, EventType.CHANGE, this.changed, this),
    );
    this.changed();
  }

  /**
   * Reverses the curve.
   */
  reverse() {
    const geometries = this.geometries_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      geometries[i].reverse();
    }
    geometries.reverse();
    this.changed();
  }

  /**
   * Apply a transform function to the coordinates of the geometry.
   * The geometry is modified in place.
   * If you do not want the geometry modified in place, first `clone()` it and
   * then use this function on the clone.
   *
   * Note that when applying a projection transform, circular arcs may be
   * distorted since the control points are transformed but the arc segments
   * between them remain circular. This is the same behavior as
   * {@link module:ol/geom/Circle~Circle}.
   *
   * @param {import("../proj.js").TransformFunction} transformFn Transform function.
   *     Called with a flat array of geometry coordinates.
   * @api
   * @override
   */
  applyTransform(transformFn) {
    const geometries = this.geometries_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      geometries[i].applyTransform(transformFn);
    }
    this.changed();
  }

  /**
   * Returns the type of this geometry.
   * @return {import("./Geometry.js").Type} Geometry type.
   * @api
   * @override
   */
  getType() {
    return 'CompoundCurve';
  }

  /**
   * Make a complete copy of the geometry.
   * @return {!CompoundCurve} Clone.
   * @api
   * @override
   */
  clone() {
    const clonedGeometries = new Array(this.geometries_.length);
    for (let i = 0, ii = this.geometries_.length; i < ii; ++i) {
      clonedGeometries[i] = this.geometries_[i].clone();
    }
    const compoundCurve = new CompoundCurve(clonedGeometries, this.layout_);
    compoundCurve.applyProperties(this);
    return compoundCurve;
  }

  /**
   * Return the coordinate at the provided fraction along the compound curve.
   * The `fraction` is a number between 0 and 1, where 0 is the start of the
   * geometry and 1 is the end.
   * @param {number} fraction Fraction.
   * @param {import("../coordinate.js").Coordinate} [dest] Optional coordinate whose values will
   *     be modified. If not provided, a new coordinate will be returned.
   * @return {import("../coordinate.js").Coordinate} Coordinate of the interpolated point.
   * @api
   */
  getCoordinateAt(fraction, dest) {
    const geometries = this.geometries_;
    const n = geometries.length;
    if (n === 0) {
      return dest || null;
    }
    // return exact endpoints for boundary fractions
    if (fraction <= 0) {
      return geometries[0].getCoordinateAt(0, dest);
    }
    if (fraction >= 1) {
      return geometries[n - 1].getCoordinateAt(1, dest);
    }
    // compute cumulative sub-geometry lengths
    const lengths = new Array(n);
    let totalLength = 0;
    for (let i = 0; i < n; i++) {
      lengths[i] = geometries[i].getLength();
      totalLength += lengths[i];
    }
    if (totalLength === 0) {
      return geometries[0].getCoordinateAt(0, dest);
    }
    const target = fraction * totalLength;
    let cumulative = 0;
    for (let i = 0; i < n; i++) {
      if (cumulative + lengths[i] >= target || i === n - 1) {
        const localFraction =
          lengths[i] > 0 ? (target - cumulative) / lengths[i] : 0;
        return geometries[i].getCoordinateAt(Math.min(localFraction, 1), dest);
      }
      cumulative += lengths[i];
    }
    return geometries[n - 1].getCoordinateAt(1, dest);
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
   * Returns the coordinates of the compound curve.
   * @return {Array<import("../coordinate.js").Coordinate>} Coordinates.
   * @api
   */
  getCoordinates() {
    const flatCoordinates = this.getFlatCoordinates();
    const stride = this.stride_;
    const coordinates = [];
    for (let i = 0, ii = flatCoordinates.length; i < ii; i += stride) {
      coordinates.push(flatCoordinates.slice(i, i + stride));
    }
    return coordinates;
  }

  /**
   * Computes the extent of the compound curve.
   * @param {import("../extent.js").Extent} extent Extent.
   * @return {import("../extent.js").Extent} extent Extent.
   * @protected
   * @override
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
   * @override
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
        minSquaredDistance,
      );
    }
    return minSquaredDistance;
  }

  /**
   * Test if the geometry and the passed extent intersect.
   * @param {import("../extent.js").Extent} extent Extent.
   * @return {boolean} `true` if the geometry and the extent intersect.
   * @api
   * @override
   */
  intersectsExtent(extent) {
    if (!intersects(this.getExtent(), extent)) {
      return false;
    }
    const geometries = this.geometries_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      if (geometries[i].intersectsExtent(extent)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Return a simplified version of this geometry. For compound curves
   * with arc segments, no simplification is applied.
   * @param {number} squaredTolerance Squared tolerance.
   * @return {CompoundCurve} Simplified geometry.
   * @override
   */
  getSimplifiedGeometry(squaredTolerance) {
    return this;
  }

  /**
   * Call the callback for each tessellated line segment (start, end).
   * All sub-geometries are iterated with the same 2-argument callback,
   * matching the contract of
   * {@link module:ol/geom/LineString~LineString#forEachSegment}.
   * If the callback returns a truthy value, the function returns that value
   * immediately. Otherwise the function returns `false`.
   * @param {function(import("../coordinate.js").Coordinate, import("../coordinate.js").Coordinate): T} callback
   *     Function called for each segment with (start, end).
   * @return {T|boolean} Value.
   * @template T
   * @api
   */
  forEachSegment(callback) {
    const flat = this.tessellate();
    for (let i = 0, ii = flat.length - 2; i < ii; i += 2) {
      const ret = callback([flat[i], flat[i + 1]], [flat[i + 2], flat[i + 3]]);
      if (ret) {
        return ret;
      }
    }
    return false;
  }

  /**
   * Call the callback for each arc or line segment of each sub-geometry.
   * For CircularString sub-geometries, the callback receives arc triples
   * (start, mid, end). For LineString sub-geometries, the callback receives
   * line pairs (start, end).
   * If the callback returns a truthy value, the function returns that value
   * immediately. Otherwise the function returns `false`.
   * @param {Function} callback Function called for each segment.
   * @return {*} Value.
   * @api
   */
  forEachArc(callback) {
    const geometries = this.geometries_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      const geom = geometries[i];
      let ret;
      if (geom.getType() === 'CircularString') {
        ret = /** @type {import("./CircularString.js").default} */ (
          geom
        ).forEachArc(
          /** @type {function(import("../coordinate.js").Coordinate, import("../coordinate.js").Coordinate, import("../coordinate.js").Coordinate): *} */ (
            callback
          ),
        );
      } else {
        ret = /** @type {import("./LineString.js").default} */ (
          geom
        ).forEachSegment(
          /** @type {function(this:*, import("../coordinate.js").Coordinate, import("../coordinate.js").Coordinate): *} */ (
            callback
          ),
        );
      }
      if (ret) {
        return ret;
      }
    }
    return false;
  }

  /**
   * Rotate the geometry around a given coordinate. This modifies the geometry
   * coordinates in place.
   * @param {number} angle Rotation angle in counter-clockwise radians.
   * @param {import("../coordinate.js").Coordinate} anchor The rotation center.
   * @api
   * @override
   */
  rotate(angle, anchor) {
    const geometries = this.geometries_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      geometries[i].rotate(angle, anchor);
    }
    this.changed();
  }

  /**
   * Scale the geometry (with an optional origin). This modifies the geometry
   * coordinates in place.
   * @param {number} sx The scaling factor in the x-direction.
   * @param {number} [sy] The scaling factor in the y-direction (defaults to sx).
   * @param {import("../coordinate.js").Coordinate} [anchor] The scale origin (defaults to the center
   *     of the geometry extent).
   * @api
   * @override
   */
  scale(sx, sy, anchor) {
    if (sy === undefined) {
      sy = sx;
    }
    if (sy !== sx) {
      warn(
        'CompoundCurve: non-uniform scale (sx !== sy) distorts circular arcs into ellipses. Results may be inaccurate.',
      );
    }
    if (!anchor) {
      anchor = getCenter(this.getExtent());
    }
    const geometries = this.geometries_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      geometries[i].scale(sx, sy, anchor);
    }
    this.changed();
  }

  /**
   * Translate the geometry. This modifies the geometry coordinates in place.
   * @param {number} deltaX Delta X.
   * @param {number} deltaY Delta Y.
   * @api
   * @override
   */
  translate(deltaX, deltaY) {
    const geometries = this.geometries_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      geometries[i].translate(deltaX, deltaY);
    }
    this.changed();
  }

  /**
   * Return the total length of the compound curve.
   * @return {number} Length.
   * @api
   */
  getLength() {
    let length = 0;
    const geometries = this.geometries_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      length += geometries[i].getLength();
    }
    return length;
  }

  /**
   * Return the first coordinate of the geometry.
   * @return {import("../coordinate.js").Coordinate} First coordinate.
   * @api
   */
  getFirstCoordinate() {
    if (this.geometries_.length > 0) {
      return this.geometries_[0].getFirstCoordinate();
    }
    return null;
  }

  /**
   * Return the last coordinate of the geometry.
   * @return {import("../coordinate.js").Coordinate} Last coordinate.
   * @api
   */
  getLastCoordinate() {
    if (this.geometries_.length > 0) {
      return this.geometries_[this.geometries_.length - 1].getLastCoordinate();
    }
    return null;
  }

  /**
   * Clean up.
   * @override
   */
  disposeInternal() {
    this.unlistenGeometriesChange_();
    super.disposeInternal();
  }

  /**
   * Returns tessellated (densified) flat coordinates approximating the curve
   * as polyline segments. The output uses stride 2 (X, Y only).
   * @param {number} [pointsPerArc] Points per arc (default 36).
   * @return {Array<number>} Flat coordinates with stride 2.
   * @api
   */
  tessellate(pointsPerArc) {
    const coords = [];
    const geometries = this.geometries_;
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      const geom = geometries[i];
      if (geom.getType() === 'CircularString') {
        const sub = /** @type {import("./CircularString.js").default} */ (
          geom
        ).tessellate(pointsPerArc);
        // skip duplicate junction with previous sub-geometry
        const start = i > 0 && sub.length >= 2 ? 2 : 0;
        for (let j = start; j < sub.length; j++) {
          coords.push(sub[j]);
        }
      } else {
        // LineString - get flat XY coordinates
        const flat = geom.getFlatCoordinates();
        const stride = geom.getStride();
        const start = i > 0 ? stride : 0;
        for (let j = start; j < flat.length; j += stride) {
          coords.push(flat[j], flat[j + 1]);
        }
      }
    }
    return coords;
  }
}

export default CompoundCurve;
