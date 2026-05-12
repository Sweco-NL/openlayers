/**
 * @module ol/geom/CurvePolygon
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
import {linearRings as linearRingsArea} from './flat/area.js';
import {linearRingsContainsXY} from './flat/contains.js';
import {inflateCoordinatesArray} from './flat/inflate.js';
import {getInteriorPointOfArray} from './flat/interiorpoint.js';
import {
  linearRingIsClockwise,
  linearRingsAreOriented,
  orientLinearRings,
} from './flat/orient.js';
import Geometry from './Geometry.js';
import Point from './Point.js';

/**
 * A ring of a CurvePolygon (CircularString, CompoundCurve, LineString, or LinearRing).
 * @typedef {import("./SimpleGeometry.js").default | import("./CompoundCurve.js").default} CurveRing
 */

/**
 * @classdesc
 * CurvePolygon geometry.
 *
 * @api
 */
class CurvePolygon extends Geometry {
  /**
   * @param {Array<CurveRing>} [rings] Rings.
   * @param {import("./Geometry.js").GeometryLayout} [layout] Layout.
   */
  constructor(rings, layout) {
    super();

    /**
     * @private
     * @type {number}
     */
    this.flatInteriorPointRevision_ = -1;

    /**
     * @private
     * @type {Array<number>}
     */
    this.flatInteriorPoint_ = null;

    /**
     * @private
     * @type {number}
     */
    this.orientedRevision_ = -1;

    /**
     * @private
     * @type {Array<number>}
     */
    this.orientedFlatCoordinates_ = null;

    /**
     * @private
     * @type {Array<number>}
     */
    this.tessellatedEnds_ = null;

    /**
     * @private
     * @type {Array<CurveRing>}
     */
    this.rings_ = rings || [];

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
    this.orientRings();
    this.listenGeometriesChange_();
  }

  /**
   * Initialize layout from rings or explicit layout parameter.
   * @param {import("./Geometry.js").GeometryLayout} [layout] Layout.
   * @private
   */
  init_(layout) {
    if (layout) {
      this.layout_ = layout;
      this.stride_ =
        layout === 'XY' ? 2 : layout === 'XYZ' || layout === 'XYM' ? 3 : 4;
    } else if (this.rings_.length > 0) {
      this.layout_ = this.rings_[0].getLayout();
      this.stride_ = this.rings_[0].getStride();
    }
    const validTypes = [
      'CircularString',
      'CompoundCurve',
      'LineString',
      'LinearRing',
    ];
    for (let i = 0, ii = this.rings_.length; i < ii; ++i) {
      const type = this.rings_[i].getType();
      assert(
        validTypes.includes(type),
        `CurvePolygon ring must be CircularString, CompoundCurve, LineString, or LinearRing, got '${type}'`,
      );
      if (i > 0) {
        assert(
          this.rings_[i].getLayout() === this.layout_,
          `CurvePolygon ring layout mismatch: expected '${this.layout_}', got '${this.rings_[i].getLayout()}'`,
        );
      }
    }
  }

  /**
   * @private
   */
  listenGeometriesChange_() {
    const rings = this.rings_;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      this.changeEventsKeys_.push(
        listen(rings[i], EventType.CHANGE, this.changed, this),
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
   * Return the flat coordinates of the polygon (concatenated from rings).
   * @return {Array<number>} Flat coordinates.
   */
  getFlatCoordinates() {
    const flatCoordinates = [];
    const rings = this.rings_;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      const ringFlat = rings[i].getFlatCoordinates();
      for (let j = 0, jj = ringFlat.length; j < jj; ++j) {
        flatCoordinates.push(ringFlat[j]);
      }
    }
    return flatCoordinates;
  }

  /**
   * Return the ends offsets (computed from ring flat coordinates).
   * @return {Array<number>} Ends.
   * @api
   */
  getEnds() {
    const ends = [];
    const rings = this.rings_;
    let offset = 0;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      offset += rings[i].getFlatCoordinates().length;
      ends.push(offset);
    }
    return ends;
  }

  /**
   * Return the interior point as XYM coordinate.
   * @return {Array<number>} Interior point.
   * @api
   */
  getFlatInteriorPoint() {
    if (this.flatInteriorPointRevision_ != this.getRevision()) {
      const flatCenter = getCenter(this.getExtent());
      const flatCoords = this.getOrientedFlatCoordinates();
      this.flatInteriorPoint_ = getInteriorPointOfArray(
        flatCoords,
        0,
        this.tessellatedEnds_,
        2,
        flatCenter,
        0,
      );
      this.flatInteriorPointRevision_ = this.getRevision();
    }
    return this.flatInteriorPoint_;
  }

  /**
   * Get the oriented flat coordinates.
   * @return {Array<number>} Oriented flat coordinates.
   * @api
   */
  getOrientedFlatCoordinates() {
    if (this.orientedRevision_ != this.getRevision()) {
      const data = this.getTessellatedRingData_();
      const flatCoordinates = data.flatCoordinates;
      const ends = data.ends;
      if (linearRingsAreOriented(flatCoordinates, 0, ends, 2)) {
        this.orientedFlatCoordinates_ = flatCoordinates;
      } else {
        this.orientedFlatCoordinates_ = flatCoordinates.slice();
        this.orientedFlatCoordinates_.length = orientLinearRings(
          this.orientedFlatCoordinates_,
          0,
          ends,
          2,
        );
      }
      this.tessellatedEnds_ = ends;
      this.orientedRevision_ = this.getRevision();
    }
    return this.orientedFlatCoordinates_;
  }

  /**
   * Get tessellated (densified) coordinates for a single ring geometry.
   * CircularStrings return their tessellated coordinates.
   * CompoundCurves recurse into sub-geometries. Other geometries
   * return their raw flat coordinates (projected to stride 2).
   * @param {CurveRing} ring Ring geometry (CircularString, CompoundCurve, or LineString).
   * @param {number} [pointsPerArc] Points per arc (default 36).
   * @return {Array<number>} Tessellated flat coordinates with stride 2.
   * @private
   */
  getTessellatedRingCoords_(ring, pointsPerArc) {
    if (ring.getType() === 'CircularString') {
      return /** @type {import("./CircularString.js").default} */ (
        ring
      ).tessellate(pointsPerArc);
    }
    if (ring.getType() === 'CompoundCurve') {
      const compoundCurve =
        /** @type {import("./CompoundCurve.js").default} */ (ring);
      const coords = [];
      const geoms = compoundCurve.getGeometriesArray();
      for (let i = 0; i < geoms.length; i++) {
        const subCoords = this.getTessellatedRingCoords_(
          geoms[i],
          pointsPerArc,
        );
        // skip the first point of subsequent sub-geometries (junction dedup)
        const start = i > 0 ? 2 : 0;
        for (let j = start; j < subCoords.length; j++) {
          coords.push(subCoords[j]);
        }
      }
      return coords;
    }
    // LineString or other geometry should extract X,Y with stride 2
    const flat = ring.getFlatCoordinates();
    const stride = ring.getStride();
    if (stride === 2) {
      return flat;
    }
    const coords = [];
    for (let i = 0; i < flat.length; i += stride) {
      coords.push(flat[i], flat[i + 1]);
    }
    return coords;
  }

  /**
   * Build tessellated flat coordinates and ends for all rings.
   * @return {{flatCoordinates: Array<number>, ends: Array<number>}} Data.
   * @private
   */
  getTessellatedRingData_() {
    const flatCoordinates = [];
    const ends = [];
    let offset = 0;
    for (let i = 0, ii = this.rings_.length; i < ii; ++i) {
      const tessellated = this.getTessellatedRingCoords_(this.rings_[i]);
      for (let j = 0; j < tessellated.length; j++) {
        flatCoordinates.push(tessellated[j]);
      }
      offset += tessellated.length;
      ends.push(offset);
    }
    return {flatCoordinates, ends};
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
    for (let i = 1, ii = this.rings_.length; i < ii; ++i) {
      if (this.ringIsClockwiseOriented(this.rings_[i])) {
        this.rings_[i].reverse();
      }
    }
  }

  /**
   * Return an interior point of the polygon.
   * @return {Point} Interior point as XYM coordinate, where M is the
   * length of the horizontal intersection that the point belongs to.
   * @api
   */
  getInteriorPoint() {
    return new Point(this.getFlatInteriorPoint(), 'XYM');
  }

  /**
   * Returns whether the given ring is clockwise oriented.
   * @param {CurveRing} ring The given ring.
   * @return {boolean} True if clockwise oriented, false otherwise.
   * @private
   */
  ringIsClockwiseOriented(ring) {
    const coords = this.getTessellatedRingCoords_(ring);
    return linearRingIsClockwise(coords, 0, coords.length, 2);
  }

  /**
   * Return the number of rings of the polygon, this includes the outer
   * ring and any inner rings (holes).
   * @return {number} Number of rings.
   * @api
   */
  getRingCount() {
    return this.rings_.length;
  }

  /**
   * Return the Nth ring of the polygon geometry. The outer ring is at
   * index `0` and inner rings are at index `1` and beyond. Return `null`
   * if the given index is out of range.
   * @param {number} index Index.
   * @return {CurveRing|null} Ring.
   * @api
   */
  getRing(index) {
    if (index < 0 || index >= this.rings_.length) {
      return null;
    }
    return this.rings_[index];
  }

  /**
   * Get the end indices of the tessellated flat coordinates for each ring.
   * Ensures tessellation is up to date before returning.
   * @return {Array<number>} Tessellated ring end indices.
   */
  getTessellatedEnds() {
    this.getOrientedFlatCoordinates();
    return this.tessellatedEnds_;
  }

  /**
   * Returns cloned copies of the polygon's rings where the first ring
   * concerns the outer ring and all subsequent rings the inner rings.
   * @return {Array<CurveRing>} The rings.
   * @api
   */
  getRings() {
    return this.rings_.map((ring) => /** @type {CurveRing} */ (ring.clone()));
  }

  /**
   * Returns the internal array of rings without cloning.
   * @return {Array<CurveRing>} The rings.
   */
  getRingsArray() {
    return this.rings_;
  }

  /**
   * Set the rings that make up this curve polygon.
   * @param {Array<CurveRing>} rings Rings.
   * @api
   */
  setRings(rings) {
    this.setRingsArray(
      rings.map((ring) => /** @type {CurveRing} */ (ring.clone())),
    );
  }

  /**
   * @param {Array<CurveRing>} rings Rings.
   */
  setRingsArray(rings) {
    this.unlistenGeometriesChange_();
    this.rings_ = rings;
    this.init_();
    this.orientRings();
    this.listenGeometriesChange_();
    this.changed();
  }

  /**
   * Append the passed ring to this polygon.
   * @param {CurveRing} ring Ring.
   * @api
   */
  appendRing(ring) {
    const type = ring.getType();
    const validTypes = [
      'CircularString',
      'CompoundCurve',
      'LineString',
      'LinearRing',
    ];
    assert(
      validTypes.includes(type),
      `CurvePolygon ring must be CircularString, CompoundCurve, LineString, or LinearRing, got '${type}'`,
    );
    if (this.rings_.length > 0) {
      assert(
        ring.getLayout() === this.layout_,
        `CurvePolygon ring layout mismatch: expected '${this.layout_}', got '${ring.getLayout()}'`,
      );
    }
    this.rings_.push(ring);
    this.changeEventsKeys_.push(
      listen(ring, EventType.CHANGE, this.changed, this),
    );
    this.orientRings();
    this.changed();
  }

  /**
   * Make a complete copy of the geometry.
   * @return {!CurvePolygon} Clone.
   * @api
   * @override
   */
  clone() {
    const clonedRings = new Array(this.rings_.length);
    for (let i = 0, ii = this.rings_.length; i < ii; ++i) {
      clonedRings[i] = this.rings_[i].clone();
    }
    const curvePolygon = new CurvePolygon(clonedRings, this.layout_);
    curvePolygon.applyProperties(this);
    return curvePolygon;
  }

  /**
   * Returns the type of this geometry.
   * @return {import("./Geometry.js").Type} Geometry type.
   * @api
   * @override
   */
  getType() {
    return 'CurvePolygon';
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
    const rings = this.rings_;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      rings[i].applyTransform(transformFn);
    }
    this.changed();
  }

  /**
   * Computes the polygon's extent and returns the result.
   * @param {import("../extent.js").Extent} extent Extent.
   * @return {import("../extent.js").Extent} extent Extent.
   * @protected
   * @override
   */
  computeExtent(extent) {
    createOrUpdateEmpty(extent);
    const rings = this.rings_;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      extend(extent, rings[i].getExtent());
    }
    return extent;
  }

  /**
   * Return the area of the polygon on projected plane.
   * Uses tessellated (densified) ring coordinates. The result is an
   * approximation because circular arcs are replaced by polyline segments.
   * @return {number} Area (on projected plane).
   * @api
   */
  getArea() {
    return linearRingsArea(
      this.getOrientedFlatCoordinates(),
      0,
      this.tessellatedEnds_,
      2,
    );
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
    // Check if any ring intersects the extent
    const rings = this.rings_;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      if (rings[i].intersectsExtent(extent)) {
        return true;
      }
    }
    // Check if the extent center is inside the polygon
    const center = getCenter(extent);
    if (this.containsXY(center[0], center[1])) {
      return true;
    }
    return false;
  }

  /**
   * Test whether the given coordinate is inside this polygon.
   * @param {number} x X.
   * @param {number} y Y.
   * @return {boolean} Contains (x, y).
   * @api
   * @override
   */
  containsXY(x, y) {
    const flatCoords = this.getOrientedFlatCoordinates();
    const ends = this.tessellatedEnds_;
    if (!ends || ends.length === 0) {
      return false;
    }
    return linearRingsContainsXY(flatCoords, 0, ends, 2, x, y);
  }

  /**
   * Return a simplified version of this geometry. For curve polygons
   * with arc segments, no simplification is applied.
   * @param {number} squaredTolerance Squared tolerance.
   * @return {CurvePolygon} Simplified geometry.
   * @override
   */
  getSimplifiedGeometry(squaredTolerance) {
    return this;
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
    const rings = this.rings_;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      rings[i].rotate(angle, anchor);
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
        'CurvePolygon: non-uniform scale (sx !== sy) distorts circular arcs into ellipses. Results may be inaccurate.',
      );
    }
    if (!anchor) {
      anchor = getCenter(this.getExtent());
    }
    const rings = this.rings_;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      rings[i].scale(sx, sy, anchor);
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
    const rings = this.rings_;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      rings[i].translate(deltaX, deltaY);
    }
    this.changed();
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
    const rings = this.rings_;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      minSquaredDistance = rings[i].closestPointXY(
        x,
        y,
        closestPoint,
        minSquaredDistance,
      );
    }
    return minSquaredDistance;
  }

  /**
   * Return the coordinates of the curve polygon as an array of ring
   * coordinate arrays.
   * @param {boolean} [right] Follow the right-hand rule for coordinate
   *     orientation (counter-clockwise for exterior and clockwise for interior
   *     rings). If `false`, coordinates will be oriented according to the
   *     left-hand rule. By default, coordinate orientation will depend on how
   *     the geometry was constructed. When `right` is specified, the returned
   *     coordinates are tessellated (densified) to approximate curves.
   * @return {Array<Array<import("../coordinate.js").Coordinate>>} Coordinates.
   * @api
   */
  getCoordinates(right) {
    if (right !== undefined) {
      const flatCoordinates = this.getOrientedFlatCoordinates().slice();
      const ends = this.tessellatedEnds_.slice();
      orientLinearRings(flatCoordinates, 0, ends, 2, right);
      return inflateCoordinatesArray(flatCoordinates, 0, ends, 2);
    }
    const rings = this.rings_;
    const result = new Array(rings.length);
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      result[i] = rings[i].getCoordinates();
    }
    return result;
  }

  /**
   * Return the first coordinate of the geometry.
   * @return {import("../coordinate.js").Coordinate} First coordinate.
   * @api
   */
  getFirstCoordinate() {
    if (this.rings_.length > 0) {
      return this.rings_[0].getFirstCoordinate();
    }
    return null;
  }

  /**
   * Return the last coordinate of the geometry.
   * @return {import("../coordinate.js").Coordinate} Last coordinate.
   * @api
   */
  getLastCoordinate() {
    if (this.rings_.length > 0) {
      return this.rings_[this.rings_.length - 1].getLastCoordinate();
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
   * Returns tessellated (densified) flat coordinates approximating all rings
   * as polyline segments. The output uses stride 2 (X, Y only).
   * @param {number} [pointsPerArc] Points per arc (default 36).
   * @return {Array<number>} Flat coordinates with stride 2.
   * @api
   */
  tessellate(pointsPerArc) {
    const coords = [];
    for (let i = 0, ii = this.rings_.length; i < ii; ++i) {
      const ring = this.rings_[i];
      const ringCoords = this.getTessellatedRingCoords_(ring, pointsPerArc);
      for (let j = 0; j < ringCoords.length; j++) {
        coords.push(ringCoords[j]);
      }
    }
    return coords;
  }

  /**
   * Call the callback for each line segment of the tessellated rings.
   * If the callback returns a truthy value, the function returns that value
   * immediately. Otherwise the function returns `false`.
   * @param {function(import("../coordinate.js").Coordinate, import("../coordinate.js").Coordinate): T} callback
   *     Function called for each segment with (start, end).
   * @return {T|boolean} Value.
   * @template T
   * @api
   */
  forEachSegment(callback) {
    const rings = this.rings_;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      const ring = rings[i];
      const coords = this.getTessellatedRingCoords_(ring);
      for (let j = 0, jj = coords.length - 2; j < jj; j += 2) {
        const ret = callback(
          coords.slice(j, j + 2),
          coords.slice(j + 2, j + 4),
        );
        if (ret) {
          return ret;
        }
      }
    }
    return false;
  }
}

export default CurvePolygon;
