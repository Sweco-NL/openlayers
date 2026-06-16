/**
 * @module ol/geom/CircularString
 */
import {assert} from '../asserts.js';
import {warn} from '../console.js';
import {
  closestSquaredDistanceXY,
  containsXY,
  createOrUpdateFromFlatCoordinates,
  getCenter,
  intersects,
} from '../extent.js';
import SimpleGeometry from './SimpleGeometry.js';
import {
  angleDistance,
  getArcAngles,
  getArcBoundingCoords,
  getArcRadius,
  getCircleCenter,
  isArcClockwise,
  isFullCircle,
} from './flat/arc.js';
import {deflateCoordinates} from './flat/deflate.js';
import {inflateCoordinates} from './flat/inflate.js';

/**
 * Default angular step in radians (~5° per segment, same as legacy 36-for-semicircle).
 * @type {number}
 */
const DEFAULT_ANGULAR_STEP = Math.PI / 36;

/**
 * Compute the number of tessellation segments for an arc, given its radius,
 * absolute sweep angle, and an optional tolerance (max chord-to-arc error).
 * When tolerance is not provided, uses a fixed angular step of ~5°.
 * @param {number} radius Arc radius.
 * @param {number} absSweep Absolute sweep angle in radians.
 * @param {number} [tolerance] Max chord-to-arc deviation in coordinate units.
 * @return {number} Number of segments, clamped to [4, 512].
 */
function computeSegmentCount(radius, absSweep, tolerance) {
  let n;
  if (tolerance !== undefined && tolerance > 0) {
    const ratio = tolerance / radius;
    if (ratio >= 1) {
      n = 4;
    } else {
      n = Math.ceil(absSweep / (2 * Math.acos(1 - ratio)));
    }
  } else {
    // Default: fixed angular resolution of ~5° per segment
    n = Math.ceil(absSweep / DEFAULT_ANGULAR_STEP);
  }
  return Math.max(4, Math.min(512, n));
}

/**
 * @classdesc
 * CircularString geometry.
 *
 * @api
 */
class CircularString extends SimpleGeometry {
  /**
   * @param {Array<import("../coordinate.js").Coordinate>} coordinates Coordinates.
   * @param {import("./Geometry.js").GeometryLayout} [layout] Layout.
   */
  constructor(coordinates, layout) {
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
     * @type {Array<number>}
     */
    this.flatCenterOfCircleCoordinates_ = [];

    /**
     * @private
     * @type {Array<number>}
     */
    this.drawableFlatCoordinates_ = [];

    this.setCoordinates(coordinates, layout);
  }

  /**
   * Updates internals. Called whenever the geometry's flat coordinates have
   * been changed.
   * @private
   */
  update() {
    const arcCount = this.arcCount();
    if (arcCount === 0) {
      this.flatCenterOfCircleCoordinates_ = [];
      this.drawableFlatCoordinates_ = [];
      return;
    }
    this.updateFlatCenterOfCircleCoordinates();
    this.updateDrawableFlatCoordinates();
  }

  /**
   * Updates the center of circle for each arc in the string.
   * @private
   */
  updateFlatCenterOfCircleCoordinates() {
    const arcCount = this.arcCount();
    const stride = this.stride;
    const flat = this.flatCoordinates;
    this.flatCenterOfCircleCoordinates_ = new Array(arcCount * 2);
    for (let i = 0; i < arcCount; ++i) {
      const offset = i * 2 * stride;
      const bx = flat[offset];
      const by = flat[offset + 1];
      const mx = flat[offset + stride];
      const my = flat[offset + stride + 1];
      const ex = flat[offset + stride * 2];
      const ey = flat[offset + stride * 2 + 1];
      const ci = i * 2;
      const center = getCircleCenter(bx, by, mx, my, ex, ey);
      if (center) {
        this.flatCenterOfCircleCoordinates_[ci] = center[0];
        this.flatCenterOfCircleCoordinates_[ci + 1] = center[1];
      } else {
        this.flatCenterOfCircleCoordinates_[ci] = (bx + ex) / 2;
        this.flatCenterOfCircleCoordinates_[ci + 1] = (by + ey) / 2;
      }
    }
  }

  /**
   * Constructs an array of flat coordinates which may be used for drawing
   * purposes. Apart from start, middle, and end coordinates this array
   * includes the coordinates for the center of circle for each arc.
   * Only non-degenerate arcs are included.
   * @private
   */
  updateDrawableFlatCoordinates() {
    const arcCount = this.arcCount();
    const stride = this.getStride();
    const flatCoords = this.getFlatCoordinates();
    let validCount = 0;
    for (let i = 0; i < arcCount; ++i) {
      const offset = i * 2 * stride;
      const center = getCircleCenter(
        flatCoords[offset],
        flatCoords[offset + 1],
        flatCoords[offset + stride],
        flatCoords[offset + stride + 1],
        flatCoords[offset + stride * 2],
        flatCoords[offset + stride * 2 + 1],
      );
      if (center) {
        validCount++;
      }
    }
    this.drawableFlatCoordinates_ = new Array(
      validCount > 0 ? validCount * 6 + 2 : 0,
    );
    const drawableCoords = this.drawableFlatCoordinates_;
    let dOffset = 0;
    for (let i = 0; i < arcCount; ++i) {
      const offset = i * 2 * stride;
      const center = getCircleCenter(
        flatCoords[offset],
        flatCoords[offset + 1],
        flatCoords[offset + stride],
        flatCoords[offset + stride + 1],
        flatCoords[offset + stride * 2],
        flatCoords[offset + stride * 2 + 1],
      );
      if (!center) {
        continue;
      }
      // start coordinates
      drawableCoords[dOffset] = flatCoords[offset];
      drawableCoords[dOffset + 1] = flatCoords[offset + 1];
      // middle coordinates
      drawableCoords[dOffset + 2] = flatCoords[offset + stride];
      drawableCoords[dOffset + 3] = flatCoords[offset + stride + 1];
      // center of circle coordinates
      const ci = i * 2;
      drawableCoords[dOffset + 4] = this.flatCenterOfCircleCoordinates_[ci];
      drawableCoords[dOffset + 5] = this.flatCenterOfCircleCoordinates_[ci + 1];
      dOffset += 6;
    }
    // trailing end coordinates of the last valid arc
    if (validCount > 0) {
      for (let i = arcCount - 1; i >= 0; --i) {
        const offset = i * 2 * stride;
        const center = getCircleCenter(
          flatCoords[offset],
          flatCoords[offset + 1],
          flatCoords[offset + stride],
          flatCoords[offset + stride + 1],
          flatCoords[offset + stride * 2],
          flatCoords[offset + stride * 2 + 1],
        );
        if (center) {
          const endOffset = offset + stride * 2;
          drawableCoords[dOffset] = flatCoords[endOffset];
          drawableCoords[dOffset + 1] = flatCoords[endOffset + 1];
          break;
        }
      }
    }
  }

  /**
   * Returns the flat coordinates which may be used for drawing. Unlike the
   * regular flat coordinates this includes the center coordinates for each
   * circle of each arc.
   * @return {Array<number>} The flat coordinates.
   * @api
   */
  getDrawableFlatCoordinates() {
    return this.drawableFlatCoordinates_;
  }

  /**
   * Returns the center of circle for the arc at the given index. The returned
   * coordinates concern flat coordinates.
   * @param {number} arcIndex The given arc index.
   * @return {import("../coordinate.js").Coordinate} The center of circle.
   * @api
   */
  flatCenterOfCircle(arcIndex) {
    const start = arcIndex * 2;
    return this.flatCenterOfCircleCoordinates_.slice(start, start + 2);
  }

  /**
   * Returns the bounding extent of a specific arc. For non-degenerate arcs
   * this is the bounding box of the full circle the arc lies on
   * (center +/- radius). For degenerate (collinear) arcs this is the bounding
   * box of the start and end control points.
   * @param {number} arcIndex The arc index.
   * @return {import("../extent.js").Extent} The arc's bounding extent.
   * @private
   */
  arcExtent_(arcIndex) {
    const stride = this.stride;
    const si = arcIndex * 2 * stride;
    const mi = si + stride;
    const ei = si + 2 * stride;
    const sx = this.flatCoordinates[si],
      sy = this.flatCoordinates[si + 1];
    const mx = this.flatCoordinates[mi],
      my = this.flatCoordinates[mi + 1];
    const ex = this.flatCoordinates[ei],
      ey = this.flatCoordinates[ei + 1];
    const cIdx = arcIndex * 2;
    const cx = this.flatCenterOfCircleCoordinates_[cIdx],
      cy = this.flatCenterOfCircleCoordinates_[cIdx + 1];
    const dx = sx - cx,
      dy = sy - cy;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (r === 0) {
      return [
        Math.min(sx, mx, ex),
        Math.min(sy, my, ey),
        Math.max(sx, mx, ex),
        Math.max(sy, my, ey),
      ];
    }
    // include all three control points explicitly so that floating-point
    // rounding in center/radius never causes a control point to fall
    // outside the extent boundary.
    return [
      Math.min(cx - r, sx, mx, ex),
      Math.min(cy - r, sy, my, ey),
      Math.max(cx + r, sx, mx, ex),
      Math.max(cy + r, sy, my, ey),
    ];
  }

  /**
   * Apply a transform function to the coordinates of the geometry.
   * The geometry is modified in place.
   * If you do not want the geometry modified in place, first `clone()` it and
   * then use this function on the clone.
   * @param {import("../proj.js").TransformFunction} transformFn Transform function.
   *     Called with a flat array of geometry coordinates.
   * @api
   * @override
   */
  applyTransform(transformFn) {
    super.applyTransform(transformFn);
    this.update();
  }

  /**
   * Make a complete copy of the geometry.
   * @return {!CircularString} Clone.
   * @api
   * @override
   */
  clone() {
    const circularString = new CircularString(
      this.getCoordinates(),
      this.layout,
    );
    circularString.applyProperties(this);
    return circularString;
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
    const stride = this.stride;
    const coords = this.flatCoordinates;
    for (let i = 0, n = this.arcCount(); i < n; ++i) {
      const offset = i * 2 * stride;
      const bx = coords[offset];
      const by = coords[offset + 1];
      const mx = coords[offset + stride];
      const my = coords[offset + stride + 1];
      const ex = coords[offset + stride * 2];
      const ey = coords[offset + stride * 2 + 1];

      const center = getCircleCenter(bx, by, mx, my, ex, ey);
      if (!center) {
        continue;
      }
      const cx = center[0];
      const cy = center[1];
      const radius = getArcRadius(cx, cy, bx, by);
      const angles = getArcAngles(cx, cy, bx, by, mx, my, ex, ey);
      const cw = isArcClockwise(bx, by, mx, my, ex, ey);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let queryAngle = Math.atan2(dy, dx);
      if (queryAngle < 0) {
        queryAngle += 2 * Math.PI;
      }

      const onArc = this.angleWithinArc_(
        queryAngle,
        angles.startAngle,
        angles.endAngle,
        cw,
        isFullCircle(bx, by, ex, ey),
      );

      let candidateX, candidateY;
      if (onArc && dist > 0) {
        candidateX = cx + (radius * dx) / dist;
        candidateY = cy + (radius * dy) / dist;
      } else {
        // closest is one of the endpoints
        const si = i * 2 * stride;
        const ei = si + 2 * stride;
        const sx = coords[si],
          sy = coords[si + 1];
        const ex = coords[ei],
          ey = coords[ei + 1];
        const dStart = (x - sx) * (x - sx) + (y - sy) * (y - sy);
        const dEnd = (x - ex) * (x - ex) + (y - ey) * (y - ey);
        if (dStart <= dEnd) {
          candidateX = sx;
          candidateY = sy;
        } else {
          candidateX = ex;
          candidateY = ey;
        }
      }

      const squaredDist =
        (x - candidateX) * (x - candidateX) +
        (y - candidateY) * (y - candidateY);
      if (squaredDist < minSquaredDistance) {
        minSquaredDistance = squaredDist;
        closestPoint[0] = candidateX;
        closestPoint[1] = candidateY;
      }
    }
    return minSquaredDistance;
  }

  /**
   * Returns the closest point on a specific arc to the given point.
   * @param {number} arcIndex The arc index.
   * @param {number} x X coordinate.
   * @param {number} y Y coordinate.
   * @return {import("../coordinate.js").Coordinate} The closest point on the arc.
   * @api
   */
  closestPointOnArc(arcIndex, x, y) {
    const stride = this.stride;
    const flat = this.flatCoordinates;
    const offset = arcIndex * 2 * stride;
    const bx = flat[offset];
    const by = flat[offset + 1];
    const mx = flat[offset + stride];
    const my = flat[offset + stride + 1];
    const ex = flat[offset + stride * 2];
    const ey = flat[offset + stride * 2 + 1];

    const center = getCircleCenter(bx, by, mx, my, ex, ey);
    if (!center) {
      // degenerate (collinear) arc - closest endpoint
      const dStart = (x - bx) * (x - bx) + (y - by) * (y - by);
      const dEnd = (x - ex) * (x - ex) + (y - ey) * (y - ey);
      return dStart <= dEnd ? [bx, by] : [ex, ey];
    }
    const cx = center[0];
    const cy = center[1];
    const radius = getArcRadius(cx, cy, bx, by);
    const angles = getArcAngles(cx, cy, bx, by, mx, my, ex, ey);
    const cw = isArcClockwise(bx, by, mx, my, ex, ey);
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let queryAngle = Math.atan2(dy, dx);
    if (queryAngle < 0) {
      queryAngle += 2 * Math.PI;
    }
    if (
      this.angleWithinArc_(
        queryAngle,
        angles.startAngle,
        angles.endAngle,
        cw,
        isFullCircle(bx, by, ex, ey),
      ) &&
      dist > 0
    ) {
      return [cx + (radius * dx) / dist, cy + (radius * dy) / dist];
    }
    // outside arc range - closest endpoint
    const dStart = (x - bx) * (x - bx) + (y - by) * (y - by);
    const dEnd = (x - ex) * (x - ex) + (y - ey) * (y - ey);
    return dStart <= dEnd ? [bx, by] : [ex, ey];
  }

  /**
   * Checks whether an angle falls within an arc's angular range.
   * @param {number} angle The angle to test.
   * @param {number} startAngle The arc's start angle.
   * @param {number} endAngle The arc's end angle.
   * @param {boolean} cw True if the arc is clockwise.
   * @param {boolean} full True if the arc is a full circle.
   * @return {boolean} True if the angle is within the arc.
   * @private
   */
  angleWithinArc_(angle, startAngle, endAngle, cw, full) {
    if (full) {
      return true;
    }
    const TWO_PI = 2 * Math.PI;
    if (cw) {
      // CW: arc goes from startAngle decreasing to endAngle
      // normalize: sweep from start going clockwise (decreasing angle)
      const sweep = (((startAngle - endAngle) % TWO_PI) + TWO_PI) % TWO_PI;
      const fromStart = (((startAngle - angle) % TWO_PI) + TWO_PI) % TWO_PI;
      return fromStart <= sweep;
    }
    // CCW: arc goes from startAngle increasing to endAngle
    const sweep = (((endAngle - startAngle) % TWO_PI) + TWO_PI) % TWO_PI;
    const fromStart = (((angle - startAngle) % TWO_PI) + TWO_PI) % TWO_PI;
    return fromStart <= sweep;
  }

  /**
   * Return the coordinates of the circular string.
   * @return {Array<import("../coordinate.js").Coordinate>} Coordinates.
   * @api
   * @override
   */
  getCoordinates() {
    return inflateCoordinates(
      this.flatCoordinates,
      0,
      this.flatCoordinates.length,
      this.stride,
    );
  }

  /**
   * Return the coordinate at the provided fraction along the circular string.
   * The `fraction` is a number between 0 and 1, where 0 is the start of the
   * geometry and 1 is the end.
   * @param {number} fraction Fraction.
   * @param {import("../coordinate.js").Coordinate} [dest] Optional coordinate whose values will
   *     be modified. If not provided, a new coordinate will be returned.
   * @return {import("../coordinate.js").Coordinate} Coordinate of the interpolated point.
   * @api
   */
  getCoordinateAt(fraction, dest) {
    const n = this.arcCount();
    if (n === 0) {
      return dest || null;
    }
    const stride = this.stride;
    const coords = this.flatCoordinates;
    const result = dest || [0, 0];
    // return exact endpoints for boundary fractions
    if (fraction <= 0) {
      result[0] = coords[0];
      result[1] = coords[1];
      return result;
    }
    if (fraction >= 1) {
      const end = coords.length;
      result[0] = coords[end - stride];
      result[1] = coords[end - stride + 1];
      return result;
    }
    // compute cumulative arc lengths
    const arcLengths = new Array(n);
    let totalLength = 0;
    for (let i = 0; i < n; ++i) {
      arcLengths[i] = this.arcLength_(i);
      totalLength += arcLengths[i];
    }
    if (totalLength === 0) {
      result[0] = coords[0];
      result[1] = coords[1];
      return result;
    }
    const target = fraction * totalLength;
    // find which arc the target falls in
    let cumulative = 0;
    for (let i = 0; i < n; ++i) {
      if (cumulative + arcLengths[i] >= target || i === n - 1) {
        const localFraction =
          arcLengths[i] > 0 ? (target - cumulative) / arcLengths[i] : 0;
        return this.interpolateArc_(i, localFraction, result);
      }
      cumulative += arcLengths[i];
    }
    // should not reach here
    return this.interpolateArc_(n - 1, 1, result);
  }

  /**
   * Interpolates a point along the arc at the given index.
   * @param {number} arcIndex The arc index.
   * @param {number} fraction Fraction within this arc (0-1).
   * @param {import("../coordinate.js").Coordinate} [dest] Optional destination coordinate.
   * @return {import("../coordinate.js").Coordinate} The interpolated coordinate.
   * @private
   */
  interpolateArc_(arcIndex, fraction, dest) {
    const stride = this.stride;
    const flat = this.flatCoordinates;
    const offset = arcIndex * 2 * stride;
    const bx = flat[offset];
    const by = flat[offset + 1];
    const mx = flat[offset + stride];
    const my = flat[offset + stride + 1];
    const ex = flat[offset + stride * 2];
    const ey = flat[offset + stride * 2 + 1];

    const center = getCircleCenter(bx, by, mx, my, ex, ey);
    const result = dest || [0, 0];
    if (!center) {
      result[0] = bx + fraction * (ex - bx);
      result[1] = by + fraction * (ey - by);
      return result;
    }
    const cx = center[0];
    const cy = center[1];
    const radius = getArcRadius(cx, cy, bx, by);

    if (isFullCircle(bx, by, ex, ey)) {
      const startAngle = Math.atan2(by - cy, bx - cx);
      const cw = isArcClockwise(bx, by, mx, my, ex, ey);
      const angle = cw
        ? startAngle - fraction * 2 * Math.PI
        : startAngle + fraction * 2 * Math.PI;
      result[0] = cx + radius * Math.cos(angle);
      result[1] = cy + radius * Math.sin(angle);
      return result;
    }

    const angles = getArcAngles(cx, cy, bx, by, mx, my, ex, ey);
    const cw = isArcClockwise(bx, by, mx, my, ex, ey);
    let sweep;
    if (cw) {
      sweep = angleDistance(angles.endAngle, angles.startAngle);
    } else {
      sweep = angleDistance(angles.startAngle, angles.endAngle);
    }
    const angle = cw
      ? angles.startAngle - fraction * sweep
      : angles.startAngle + fraction * sweep;
    result[0] = cx + radius * Math.cos(angle);
    result[1] = cy + radius * Math.sin(angle);
    return result;
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
   * Get the type of this geometry.
   * @return {import("./Geometry.js").Type} Geometry type.
   * @api
   * @override
   */
  getType() {
    return 'CircularString';
  }

  /**
   * Returns the amount of arcs of which this geometry consists.
   * @return {number} The amount of arcs.
   * @api
   */
  arcCount() {
    const numPoints = this.flatCoordinates.length / this.stride;
    if (numPoints < 3) {
      return 0;
    }
    return Math.floor((numPoints - 1) / 2);
  }

  /**
   * Returns the flat coordinates [bx, by, mx, my, ex, ey] for the arc
   * at the given index.
   * @param {number} index The arc's index.
   * @return {Array<number>} The 6-element flat coordinate array.
   * @private
   */
  getArcCoords_(index) {
    const stride = this.stride;
    const offset = stride * 2 * index;
    const flat = this.flatCoordinates;
    return [
      flat[offset],
      flat[offset + 1],
      flat[offset + stride],
      flat[offset + stride + 1],
      flat[offset + stride * 2],
      flat[offset + stride * 2 + 1],
    ];
  }

  /**
   * Computes and returns the flat bounding coordinates for the given arc.
   * @private
   * @param {number} bx Begin X.
   * @param {number} by Begin Y.
   * @param {number} mx Middle X.
   * @param {number} my Middle Y.
   * @param {number} ex End X.
   * @param {number} ey End Y.
   * @return {Array<number>} The computed bounding coordinates.
   */
  flatBoundingArcCoordinates(bx, by, mx, my, ex, ey) {
    const center = getCircleCenter(bx, by, mx, my, ex, ey);
    if (!center) {
      return [bx, by, ex, ey];
    }
    return getArcBoundingCoords(bx, by, mx, my, ex, ey, center[0], center[1]);
  }

  /**
   * Computes and returns the flat bounding coordinates for the geometry as
   * a whole.
   * @private
   * @return {Array<number>} The computed bounding coordinates.
   */
  flatBoundingCoordinates() {
    let boundingCoords = [];
    const stride = this.stride;
    const flat = this.flatCoordinates;
    const count = this.arcCount();
    for (let i = 0; i < count; ++i) {
      const offset = i * 2 * stride;
      boundingCoords = boundingCoords.concat(
        this.flatBoundingArcCoordinates(
          flat[offset],
          flat[offset + 1],
          flat[offset + stride],
          flat[offset + stride + 1],
          flat[offset + stride * 2],
          flat[offset + stride * 2 + 1],
        ),
      );
    }
    return boundingCoords;
  }

  /**
   * @param {import("../extent.js").Extent} extent Extent.
   * @protected
   * @return {import("../extent.js").Extent} extent Extent.
   * @override
   */
  computeExtent(extent) {
    const boundingCoords = this.flatBoundingCoordinates();
    return createOrUpdateFromFlatCoordinates(
      boundingCoords,
      0,
      boundingCoords.length,
      2,
      extent,
    );
  }

  /**
   * Set the coordinates of the circular string.
   * @param {!Array<import("../coordinate.js").Coordinate>} coordinates Coordinates.
   * @param {import("./Geometry.js").GeometryLayout} [layout] Layout.
   * @api
   * @override
   */
  setCoordinates(coordinates, layout) {
    assert(
      !coordinates || coordinates.length === 0 || coordinates.length % 2 === 1,
      `CircularString requires an odd number of points (≥3), got ${coordinates ? coordinates.length : 0}`,
    );
    this.setLayout(layout, coordinates, 1);
    if (!this.flatCoordinates) {
      this.flatCoordinates = [];
    }
    this.flatCoordinates.length = deflateCoordinates(
      this.flatCoordinates,
      0,
      coordinates,
      this.stride,
    );
    this.update();
    this.changed();
  }

  /**
   * Call the callback for each curve segment with flat scalar coordinates.
   * Curved segments have a non-collinear midpoint; straight (linear) segments
   * have midpoint = segment center (collinear with endpoints).
   * If the callback returns a truthy value, iteration stops and that value
   * is returned. Otherwise the function returns `false`.
   * @param {function(number, number, number, number, number, number, number): T} callback
   *     Function called for each curve segment with (bx, by, mx, my, ex, ey, index).
   * @return {T|boolean} Value.
   * @template T
   * @api
   */
  forEachCurveSegment(callback) {
    const flat = this.flatCoordinates;
    const stride = this.stride;
    const count = this.arcCount();
    for (let i = 0; i < count; ++i) {
      const offset = i * 2 * stride;
      const ret = callback(
        flat[offset],
        flat[offset + 1],
        flat[offset + stride],
        flat[offset + stride + 1],
        flat[offset + stride * 2],
        flat[offset + stride * 2 + 1],
        i,
      );
      if (ret) {
        return ret;
      }
    }
    return false;
  }

  /**
   * Call the callback for each tessellated line segment (start, end).
   * The arcs are tessellated into straight-line segments matching the
   * contract of {@link module:ol/geom/LineString~LineString#forEachSegment}.
   * If the callback returns a truthy value, the function returns that value
   * immediately. Otherwise the function returns `false`.
   *
   * Note: for a CircularString the point is considered "on the curve" when
   * it lies on one of the tessellated segments. Use {@link #containsXY}
   * (inherited from {@link module:ol/geom/Geometry~Geometry}) accordingly.
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
    const stride = this.stride;
    const coords = this.flatCoordinates;
    // check if any control point is inside the extent
    for (let i = 0, ii = coords.length; i < ii; i += stride) {
      if (containsXY(extent, coords[i], coords[i + 1])) {
        return true;
      }
    }
    // check if any arc intersects any extent edge
    const edges = [
      [extent[0], extent[1], extent[2], extent[1]], // bottom
      [extent[2], extent[1], extent[2], extent[3]], // right
      [extent[2], extent[3], extent[0], extent[3]], // top
      [extent[0], extent[3], extent[0], extent[1]], // left
    ];
    for (let i = 0, n = this.arcCount(); i < n; ++i) {
      const offset = i * 2 * stride;
      const abx = coords[offset];
      const aby = coords[offset + 1];
      const amx = coords[offset + stride];
      const amy = coords[offset + stride + 1];
      const aex = coords[offset + stride * 2];
      const aey = coords[offset + stride * 2 + 1];
      const center = getCircleCenter(abx, aby, amx, amy, aex, aey);
      if (!center) {
        continue;
      }
      const cx = center[0];
      const cy = center[1];
      const radius = getArcRadius(cx, cy, abx, aby);
      const angles = getArcAngles(cx, cy, abx, aby, amx, amy, aex, aey);
      const cw = isArcClockwise(abx, aby, amx, amy, aex, aey);
      const full = isFullCircle(abx, aby, aex, aey);
      for (let e = 0; e < 4; ++e) {
        if (
          this.arcIntersectsSegment_(
            center,
            radius,
            angles.startAngle,
            angles.endAngle,
            cw,
            full,
            edges[e][0],
            edges[e][1],
            edges[e][2],
            edges[e][3],
          )
        ) {
          return true;
        }
      }
    }
    // check if extent is fully inside a closed curve
    // (all control points outside extent, no edge intersections,
    // but the extent could still be enclosed by the curve)
    const center = getCenter(extent);
    const closest = [0, 0];
    this.closestPointXY(center[0], center[1], closest, Infinity);
    if (containsXY(extent, closest[0], closest[1])) {
      return true;
    }
    return false;
  }

  /**
   * Checks whether a circular arc intersects a line segment.
   * @param {Array<number>} center Circle center [cx, cy].
   * @param {number} radius Circle radius.
   * @param {number} startAngle Arc start angle.
   * @param {number} endAngle Arc end angle.
   * @param {boolean} cw Clockwise.
   * @param {boolean} full Full circle.
   * @param {number} x1 Segment start x.
   * @param {number} y1 Segment start y.
   * @param {number} x2 Segment end x.
   * @param {number} y2 Segment end y.
   * @return {boolean} True if they intersect.
   * @private
   */
  arcIntersectsSegment_(
    center,
    radius,
    startAngle,
    endAngle,
    cw,
    full,
    x1,
    y1,
    x2,
    y2,
  ) {
    const cx = center[0];
    const cy = center[1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const fx = x1 - cx;
    const fy = y1 - cy;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    let discriminant = b * b - 4 * a * c;
    if (discriminant < 0) {
      return false;
    }
    discriminant = Math.sqrt(discriminant);
    for (const sign of [-1, 1]) {
      const t = (-b + sign * discriminant) / (2 * a);
      if (t >= 0 && t <= 1) {
        const ix = x1 + t * dx;
        const iy = y1 + t * dy;
        let angle = Math.atan2(iy - cy, ix - cx);
        if (angle < 0) {
          angle += 2 * Math.PI;
        }
        if (this.angleWithinArc_(angle, startAngle, endAngle, cw, full)) {
          return true;
        }
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
    super.rotate(angle, anchor);
    this.update();
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
    if (sy !== undefined && sy !== sx) {
      warn(
        'CircularString: non-uniform scale (sx !== sy) distorts circular arcs into ellipses. Results may be inaccurate.',
      );
    }
    super.scale(sx, sy, anchor);
    this.update();
  }

  /**
   * Translate the geometry. This modifies the geometry coordinates in place.
   * @param {number} deltaX Delta X.
   * @param {number} deltaY Delta Y.
   * @api
   * @override
   */
  translate(deltaX, deltaY) {
    super.translate(deltaX, deltaY);
    this.update();
  }

  /**
   * Return the length of the CircularString (sum of arc lengths).
   * @return {number} Length.
   * @api
   */
  getLength() {
    let length = 0;
    for (let i = 0, n = this.arcCount(); i < n; ++i) {
      length += this.arcLength_(i);
    }
    return length;
  }

  /**
   * Computes the arc length of the arc at the given index.
   * @param {number} arcIndex The arc index.
   * @return {number} The arc length.
   * @private
   */
  arcLength_(arcIndex) {
    const stride = this.stride;
    const flat = this.flatCoordinates;
    const offset = arcIndex * 2 * stride;
    const bx = flat[offset];
    const by = flat[offset + 1];
    const mx = flat[offset + stride];
    const my = flat[offset + stride + 1];
    const ex = flat[offset + stride * 2];
    const ey = flat[offset + stride * 2 + 1];

    const center = getCircleCenter(bx, by, mx, my, ex, ey);
    if (!center) {
      const dx = ex - bx;
      const dy = ey - by;
      return Math.sqrt(dx * dx + dy * dy);
    }
    const cx = center[0];
    const cy = center[1];
    const radius = getArcRadius(cx, cy, bx, by);
    if (isFullCircle(bx, by, ex, ey)) {
      return 2 * Math.PI * radius;
    }
    const angles = getArcAngles(cx, cy, bx, by, mx, my, ex, ey);
    const cw = isArcClockwise(bx, by, mx, my, ex, ey);
    let sweep;
    if (cw) {
      sweep = angleDistance(angles.endAngle, angles.startAngle);
    } else {
      sweep = angleDistance(angles.startAngle, angles.endAngle);
    }
    return radius * sweep;
  }

  /**
   * Returns tessellated (densified) flat coordinates approximating the arcs
   * as polyline segments. The output uses stride 2 (X, Y only).
   *
   * When `tolerance` is provided, each arc is subdivided adaptively so that
   * the maximum chord-to-arc deviation does not exceed `tolerance` coordinate
   * units. When omitted, a default angular step of ~5° is used (equivalent to
   * 36 segments for a semicircular arc), scaled proportionally to each arc's
   * sweep angle.
   *
   * @param {number} [tolerance] Max chord-to-arc error in coordinate units.
   * @return {Array<number>} Flat coordinates with stride 2.
   * @api
   */
  tessellate(tolerance) {
    const count = this.arcCount();
    if (count === 0) {
      return [];
    }
    const flat = this.flatCoordinates;
    const stride = this.stride;
    const coords = [];
    for (let i = 0; i < count; ++i) {
      const offset = i * 2 * stride;
      const bx = flat[offset];
      const by = flat[offset + 1];
      const mx = flat[offset + stride];
      const my = flat[offset + stride + 1];
      const ex = flat[offset + stride * 2];
      const ey = flat[offset + stride * 2 + 1];

      const center = getCircleCenter(bx, by, mx, my, ex, ey);
      if (!center) {
        // degenerate arc - emit straight line endpoints
        if (i === 0) {
          coords.push(bx, by);
        }
        coords.push(ex, ey);
        continue;
      }
      const cx = center[0];
      const cy = center[1];
      const radius = getArcRadius(cx, cy, bx, by);
      const angles = getArcAngles(cx, cy, bx, by, mx, my, ex, ey);
      const cw = isArcClockwise(bx, by, mx, my, ex, ey);
      const full = isFullCircle(bx, by, ex, ey);
      const startAngle = angles.startAngle;
      let sweep;
      if (full) {
        sweep = 2 * Math.PI;
      } else if (cw) {
        sweep = -angleDistance(angles.endAngle, angles.startAngle);
      } else {
        sweep = angleDistance(angles.startAngle, angles.endAngle);
      }
      const absSweep = Math.abs(sweep);
      const numSeg = computeSegmentCount(radius, absSweep, tolerance);
      // Compute the tessellation step closest to the through-point so we
      // can replace it with the exact control-point coordinate.
      let midStep = -1;
      if (!full) {
        const midAngle = angles.middleAngle;
        let midOffset = midAngle - startAngle;
        if (cw) {
          if (midOffset > 0) {
            midOffset -= 2 * Math.PI;
          }
        } else {
          if (midOffset < 0) {
            midOffset += 2 * Math.PI;
          }
        }
        midStep = Math.round((midOffset / sweep) * numSeg);
        if (midStep <= 0 || midStep >= numSeg) {
          midStep = -1;
        }
      }
      const startJ = i === 0 ? 0 : 1;
      for (let j = startJ; j <= numSeg; ++j) {
        if (j === 0) {
          coords.push(bx, by);
        } else if (j === numSeg) {
          coords.push(ex, ey);
        } else if (j === midStep) {
          coords.push(mx, my);
        } else {
          const frac = j / numSeg;
          const angle = startAngle + sweep * frac;
          coords.push(
            cx + radius * Math.cos(angle),
            cy + radius * Math.sin(angle),
          );
        }
      }
    }
    return coords;
  }

  /**
   * Returns tessellated flat coordinate data suitable for topology operations.
   * This provides the bridge between curve geometry and flat-coordinate
   * algorithms (e.g. `getSegmentsCrossingPoint`, `linearRingContainsXY`).
   *
   * @param {number} [tolerance] Max chord-to-arc error in coordinate units.
   * @return {{flatCoordinates: Array<number>, ends: Array<number>, stride: number}}
   *   Tessellated flat coordinates with end indices and stride.
   * @api
   */
  getTessellatedFlatData(tolerance) {
    const flatCoordinates = this.tessellate(tolerance);
    return {
      flatCoordinates,
      ends: [flatCoordinates.length],
      stride: 2,
    };
  }

  /**
   * Find the index of a control point matching the given coordinate.
   * @param {import("../coordinate.js").Coordinate} coord The coordinate to find.
   * @param {boolean} [lastMatch] If true, return the last occurrence
   *   (e.g., index n-1 for closed rings exit). If false, return the first
   *   occurrence (canonical index 0 for closed rings entry).
   * @return {number} The coordinate index (even-indexed endpoints only), or -1 if not found.
   * @api
   */
  findArcEndpointIndex(coord, lastMatch) {
    const stride = this.stride;
    const flat = this.flatCoordinates;
    const numPoints = flat.length / stride;
    const cx = coord[0];
    const cy = coord[1];
    const TOLERANCE = 1e-6;

    let found = -1;
    for (let i = 0; i < numPoints; i += 2) {
      const offset = i * stride;
      const dx = flat[offset] - cx;
      const dy = flat[offset + 1] - cy;
      if (dx * dx + dy * dy < TOLERANCE * TOLERANCE) {
        if (!lastMatch) {
          return i;
        }
        found = i;
      }
    }
    return found;
  }

  /**
   * Return a new CircularString containing the control points from
   * `startIdx` to `endIdx` (inclusive), handling wrap-around for closed rings.
   * Both indices must be even (arc endpoints).
   * @param {number} startIdx Start index (must be even).
   * @param {number} endIdx End index (must be even).
   * @return {CircularString} The sliced sub-arc.
   * @api
   */
  subArc(startIdx, endIdx) {
    const coords = this.getCoordinates();
    const n = coords.length;
    let slice;
    if (startIdx <= endIdx) {
      slice = coords.slice(startIdx, endIdx + 1);
    } else {
      // Wrap-around: take from startIdx to end, then from beginning to endIdx
      // For closed rings, skip the duplicate closing point
      const isClosed =
        n >= 3 &&
        Math.abs(coords[0][0] - coords[n - 1][0]) < 1e-6 &&
        Math.abs(coords[0][1] - coords[n - 1][1]) < 1e-6;
      const wrapEnd = isClosed ? n - 1 : n;
      slice = coords
        .slice(startIdx, wrapEnd)
        .concat(coords.slice(0, endIdx + 1));
    }
    return new CircularString(slice, this.layout);
  }
}

export default CircularString;
