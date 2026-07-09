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
import {linearRingsAreOriented, orientLinearRings} from './flat/orient.js';
import {
  DEFAULT_CROSSING_EPSILON_SQ,
  DEFAULT_SAME_ARC_TOLERANCE_SQ,
} from './flat/tolerances.js';
import {getArcArraySelfIntersections} from './flat/topology.js';
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
     * @type {number}
     */
    this.flatCoordinatesRevision_ = -1;

    /**
     * @private
     * @type {Array<number>}
     */
    this.flatCoordinates_ = null;

    /**
     * @private
     * @type {Array<number>}
     */
    this.ends_ = null;

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
    if (this.flatCoordinatesRevision_ !== this.getRevision()) {
      this.computeFlatCoordinatesAndEnds_();
    }
    return this.flatCoordinates_;
  }

  /**
   * Return the ends offsets of the **control-point** flat coordinates. These
   * pair with {@link CurvePolygon#getFlatCoordinates} (the raw, un-tessellated
   * ring coordinates) — one end offset per ring. Do **not** pair these with the
   * tessellated coordinates; use {@link CurvePolygon#getTessellatedEnds} (or the
   * bundled {@link CurvePolygon#getTessellatedFlatData}) for that.
   * @return {Array<number>} Ends.
   * @api
   */
  getEnds() {
    if (this.flatCoordinatesRevision_ !== this.getRevision()) {
      this.computeFlatCoordinatesAndEnds_();
    }
    return this.ends_;
  }

  /**
   * Compute and cache flat coordinates and ends arrays.
   * @private
   */
  computeFlatCoordinatesAndEnds_() {
    const flatCoordinates = [];
    const ends = [];
    const rings = this.rings_;
    let offset = 0;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      const ringFlat = rings[i].getFlatCoordinates();
      for (let j = 0, jj = ringFlat.length; j < jj; ++j) {
        flatCoordinates.push(ringFlat[j]);
      }
      offset += ringFlat.length;
      ends.push(offset);
    }
    this.flatCoordinates_ = flatCoordinates;
    this.ends_ = ends;
    this.flatCoordinatesRevision_ = this.getRevision();
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
   * @param {number} [tolerance] Max chord-to-arc error in coordinate units.
   * @return {Array<number>} Tessellated flat coordinates with stride 2.
   * @private
   */
  getTessellatedRingCoords_(ring, tolerance) {
    if (ring.getType() === 'CircularString') {
      return /** @type {import("./CircularString.js").default} */ (
        ring
      ).tessellate(tolerance);
    }
    if (ring.getType() === 'CompoundCurve') {
      const compoundCurve =
        /** @type {import("./CompoundCurve.js").default} */ (ring);
      const coords = [];
      const geoms = compoundCurve.getGeometriesArray();
      for (let i = 0, ii = geoms.length; i < ii; ++i) {
        const subCoords = this.getTessellatedRingCoords_(geoms[i], tolerance);
        // skip the first point of subsequent sub-geometries (junction dedup)
        const start = i > 0 ? 2 : 0;
        for (let j = start, jj = subCoords.length; j < jj; ++j) {
          coords.push(subCoords[j]);
        }
      }
      return coords;
    }
    const flat = ring.getFlatCoordinates();
    const stride = ring.getStride();
    if (stride === 2) {
      return flat;
    }
    const coords = [];
    for (let i = 0, ii = flat.length; i < ii; i += stride) {
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
      for (let j = 0, jj = tessellated.length; j < jj; ++j) {
        flatCoordinates.push(tessellated[j]);
      }
      offset += tessellated.length;
      ends.push(offset);
    }
    return {flatCoordinates, ends};
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
   * Get the end indices of the **tessellated** flat coordinates for each ring.
   * These pair with {@link CurvePolygon#getOrientedFlatCoordinates} (the
   * tessellated buffer), **not** with {@link CurvePolygon#getFlatCoordinates}.
   * Prefer {@link CurvePolygon#getTessellatedFlatData}, which bundles the
   * matching coordinates, ends, and stride so the two cannot be mismatched.
   * Ensures tessellation is up to date before returning.
   * @return {Array<number>} Tessellated ring end indices.
   */
  getTessellatedEnds() {
    this.getOrientedFlatCoordinates();
    return this.tessellatedEnds_;
  }

  /**
   * Returns tessellated flat coordinate data suitable for topology operations.
   * This provides the bridge between curve geometry and flat-coordinate
   * algorithms (e.g. `getIntersectionPoint`, `linearRingContainsXY`).
   *
   * The returned arrays are owned by the caller and may be retained safely;
   * internal cached buffers are cloned before being returned so subsequent
   * mutations to this geometry do not affect previously returned data.
   *
   * @return {{flatCoordinates: Array<number>, ends: Array<number>, stride: number}}
   *   Tessellated flat coordinates with ring end indices and stride.
   * @api
   */
  getTessellatedFlatData() {
    return {
      flatCoordinates: this.getOrientedFlatCoordinates().slice(),
      ends: this.getTessellatedEnds().slice(),
      stride: 2,
    };
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
    const rings = this.rings_;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      if (rings[i].intersectsExtent(extent)) {
        return true;
      }
    }
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
    return [];
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
    return [];
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
   * @param {number} [tolerance] Max chord-to-arc error in coordinate units.
   * @return {Array<number>} Flat coordinates with stride 2.
   * @api
   */
  tessellate(tolerance) {
    const coords = [];
    for (let i = 0, ii = this.rings_.length; i < ii; ++i) {
      const ring = this.rings_[i];
      const ringCoords = this.getTessellatedRingCoords_(ring, tolerance);
      for (let j = 0, jj = ringCoords.length; j < jj; ++j) {
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

  /**
   * Find all self-intersection points within this CurvePolygon.
   * Tests all non-identical arc pairs within and across rings for crossings.
   *
   * @param {number} [epsilonSq] Squared distance threshold for crossing
   *   detection. Default 4 (suitable for projected CRS with meter units).
   * @param {number} [sameArcToleranceSq] Tolerance for arc equality check.
   *   Default 1e-4.
   * @return {Array<Array<number>>} Array of [x, y] crossing points.
   * @api
   */
  getSelfIntersections(epsilonSq, sameArcToleranceSq) {
    if (epsilonSq === undefined) {
      epsilonSq = DEFAULT_CROSSING_EPSILON_SQ;
    }
    if (sameArcToleranceSq === undefined) {
      sameArcToleranceSq = DEFAULT_SAME_ARC_TOLERANCE_SQ;
    }
    const arcs = [];
    this.forEachCurveSegment(function (bx, by, mx, my, ex, ey) {
      arcs.push([bx, by, mx, my, ex, ey]);
    });
    return getArcArraySelfIntersections(arcs, epsilonSq, sameArcToleranceSq);
  }

  /**
   * Call the callback for each curve segment across all rings with flat scalar
   * coordinates. Curved segments have a non-collinear midpoint; linear segments
   * have midpoint = segment center (collinear with endpoints).
   * @param {function(number, number, number, number, number, number, number): *} callback
   *     Function called for each curve segment with (bx, by, mx, my, ex, ey, index).
   * @return {*} Value.
   * @api
   */
  forEachCurveSegment(callback) {
    const rings = this.rings_;
    let globalIndex = 0;
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      const ring = rings[i];
      const type = ring.getType();
      if (type === 'CircularString' || type === 'CompoundCurve') {
        const curveRing =
          /** @type {import("./CircularString.js").default|import("./CompoundCurve.js").default} */ (
            ring
          );
        const ret = curveRing.forEachCurveSegment(
          function (bx, by, mx, my, ex, ey) {
            return callback(bx, by, mx, my, ex, ey, globalIndex++);
          },
        );
        if (ret) {
          return ret;
        }
      } else {
        // LinearRing/LineString: emit degenerate arcs
        const coords = ring.getFlatCoordinates();
        const stride = ring.getStride();
        const end = coords.length;
        for (let j = 0; j + stride < end; j += stride) {
          const bx = coords[j];
          const by = coords[j + 1];
          const ex = coords[j + stride];
          const ey = coords[j + stride + 1];
          const mx = (bx + ex) / 2;
          const my = (by + ey) / 2;
          const ret = callback(bx, by, mx, my, ex, ey, globalIndex++);
          if (ret) {
            return ret;
          }
        }
      }
    }
    return false;
  }
}

export default CurvePolygon;
