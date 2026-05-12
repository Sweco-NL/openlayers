/**
 * @module ol/geom/CircularString
 */
import {warn} from '../console.js';
import {
  closestSquaredDistanceXY,
  containsXY,
  createOrUpdateFromFlatCoordinates,
  getCenter,
  intersects,
} from '../extent.js';
import SimpleGeometry from './SimpleGeometry.js';
import {CircularArc, Vector2} from './flat/CircularArc.js';
import {deflateCoordinates} from './flat/deflate.js';
import {inflateCoordinates} from './flat/inflate.js';

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
    this.flatCenterOfCircleCoordinates_ = new Array(arcCount * 2);
    for (let i = 0; i < arcCount; ++i) {
      const arc = this.arc(i);
      const offset = i * 2;
      const center = arc.centerOfCircle();
      if (center) {
        this.flatCenterOfCircleCoordinates_[offset] = center.x;
        this.flatCenterOfCircleCoordinates_[offset + 1] = center.y;
      } else {
        // degenerate arc - store midpoint of chord as placeholder
        this.flatCenterOfCircleCoordinates_[offset] =
          (arc.begin.x + arc.end.x) / 2;
        this.flatCenterOfCircleCoordinates_[offset + 1] =
          (arc.begin.y + arc.end.y) / 2;
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
    // build drawable coords only for valid (non-degenerate) arcs
    // layout per arc: [startX, startY, midX, midY, centerX, centerY]
    // plus trailing [endX, endY] of the last arc. Arcs share endpoints
    // so stride is 6, with the renderer reading d..d+7.
    let validCount = 0;
    for (let i = 0; i < arcCount; ++i) {
      if (this.arc(i).centerOfCircle()) {
        validCount++;
      }
    }
    this.drawableFlatCoordinates_ = new Array(
      validCount > 0 ? validCount * 6 + 2 : 0,
    );
    const drawableCoords = this.drawableFlatCoordinates_;
    const stride = this.getStride();
    const flatCoords = this.getFlatCoordinates();
    let offset = 0;
    for (let i = 0; i < arcCount; ++i) {
      if (!this.arc(i).centerOfCircle()) {
        continue;
      }
      const startX = i * stride * 2;
      const middleX = startX + stride;
      // start coordinates
      drawableCoords[offset] = flatCoords[startX];
      drawableCoords[offset + 1] = flatCoords[startX + 1];
      // middle coordinates
      drawableCoords[offset + 2] = flatCoords[middleX];
      drawableCoords[offset + 3] = flatCoords[middleX + 1];
      // center of circle coordinates
      const centerOfCircle = this.flatCenterOfCircle(i);
      drawableCoords[offset + 4] = centerOfCircle[0];
      drawableCoords[offset + 5] = centerOfCircle[1];
      offset += 6;
    }
    // trailing end coordinates of the last valid arc
    if (validCount > 0) {
      // find the last valid arc to get its end point
      for (let i = arcCount - 1; i >= 0; --i) {
        if (this.arc(i).centerOfCircle()) {
          const startX = i * stride * 2;
          const endX = startX + stride * 2;
          drawableCoords[offset] = flatCoords[endX];
          drawableCoords[offset + 1] = flatCoords[endX + 1];
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
   * @api
   */
  arcExtent(arcIndex) {
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
    const center = this.flatCenterOfCircle(arcIndex);
    const cx = center[0],
      cy = center[1];
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
    for (let i = 0, n = this.arcCount(); i < n; i++) {
      const arc = this.arc(i);
      const center = arc.centerOfCircle();
      if (!center) {
        continue;
      }
      const radius = arc.radius(center);
      const angles = arc.angles(center);
      const cw = arc.clockwise();
      const dx = x - center.x;
      const dy = y - center.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // angle of the query point from the circle center
      let queryAngle = Math.atan2(dy, dx);
      if (queryAngle < 0) {
        queryAngle += 2 * Math.PI;
      }

      // check if queryAngle falls within the arc's angular range
      const onArc = this.angleWithinArc_(
        queryAngle,
        angles.startAngle,
        angles.endAngle,
        cw,
        arc.fullCircle(),
      );

      let candidateX, candidateY;
      if (onArc && dist > 0) {
        // project onto the arc
        candidateX = center.x + (radius * dx) / dist;
        candidateY = center.y + (radius * dy) / dist;
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
    const arc = this.arc(arcIndex);
    const center = arc.centerOfCircle();
    if (!center) {
      // degenerate (collinear) arc - closest endpoint
      const stride = this.stride;
      const si = arcIndex * 2 * stride;
      const ei = si + 2 * stride;
      const sx = this.flatCoordinates[si],
        sy = this.flatCoordinates[si + 1];
      const ex = this.flatCoordinates[ei],
        ey = this.flatCoordinates[ei + 1];
      const dStart = (x - sx) * (x - sx) + (y - sy) * (y - sy);
      const dEnd = (x - ex) * (x - ex) + (y - ey) * (y - ey);
      return dStart <= dEnd ? [sx, sy] : [ex, ey];
    }
    const radius = arc.radius(center);
    const angles = arc.angles(center);
    const cw = arc.clockwise();
    const dx = x - center.x;
    const dy = y - center.y;
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
        arc.fullCircle(),
      ) &&
      dist > 0
    ) {
      return [center.x + (radius * dx) / dist, center.y + (radius * dy) / dist];
    }
    // outside arc range - closest endpoint
    const stride2 = this.stride;
    const si2 = arcIndex * 2 * stride2;
    const ei2 = si2 + 2 * stride2;
    const sx2 = this.flatCoordinates[si2],
      sy2 = this.flatCoordinates[si2 + 1];
    const ex2 = this.flatCoordinates[ei2],
      ey2 = this.flatCoordinates[ei2 + 1];
    const dStart2 = (x - sx2) * (x - sx2) + (y - sy2) * (y - sy2);
    const dEnd2 = (x - ex2) * (x - ex2) + (y - ey2) * (y - ey2);
    return dStart2 <= dEnd2 ? [sx2, sy2] : [ex2, ey2];
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
    for (let i = 0; i < n; i++) {
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
    for (let i = 0; i < n; i++) {
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
    const arc = this.arc(arcIndex);
    const center = arc.centerOfCircle();
    const result = dest || [0, 0];
    if (!center) {
      // degenerate arc - linearly interpolate between endpoints
      result[0] = arc.begin.x + fraction * (arc.end.x - arc.begin.x);
      result[1] = arc.begin.y + fraction * (arc.end.y - arc.begin.y);
      return result;
    }
    const radius = arc.radius(center);

    if (arc.fullCircle()) {
      // full circle: start angle -> start angle + 2pi (or -2pi for CW)
      const startAngle = Math.atan2(
        arc.begin.y - center.y,
        arc.begin.x - center.x,
      );
      const cw = arc.clockwise();
      const angle = cw
        ? startAngle - fraction * 2 * Math.PI
        : startAngle + fraction * 2 * Math.PI;
      result[0] = center.x + radius * Math.cos(angle);
      result[1] = center.y + radius * Math.sin(angle);
      return result;
    }

    const angles = arc.angles(center);
    const cw = arc.clockwise();
    let sweep;
    if (cw) {
      sweep = arc.angleDistance(angles.endAngle, angles.startAngle);
    } else {
      sweep = arc.angleDistance(angles.startAngle, angles.endAngle);
    }
    const angle = cw
      ? angles.startAngle - fraction * sweep
      : angles.startAngle + fraction * sweep;
    result[0] = center.x + radius * Math.cos(angle);
    result[1] = center.y + radius * Math.sin(angle);
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
   * Constructs and returns a CircularArc object for the arc at the given
   * index.
   * @private
   * @param {number} index The arc's index.
   * @return {CircularArc} The constructed CircularArc.
   */
  arc(index) {
    const startX = this.stride * 2 * index;
    const middleX = startX + this.stride;
    const endX = startX + this.stride * 2;
    return new CircularArc(
      new Vector2(
        this.flatCoordinates[startX],
        this.flatCoordinates[startX + 1],
      ),
      new Vector2(
        this.flatCoordinates[middleX],
        this.flatCoordinates[middleX + 1],
      ),
      new Vector2(this.flatCoordinates[endX], this.flatCoordinates[endX + 1]),
    );
  }

  /**
   * Computes and returns the flat bounding coordinates for the given arc.
   * @private
   * @param {CircularArc} arc The given arc.
   * @return {Array<number>} The computed bounding coordinates.
   */
  flatBoundingArcCoordinates(arc) {
    const boundingCoords = [];
    const center = arc.centerOfCircle();
    if (!center) {
      // degenerate arc - use endpoints as bounding coords
      return [arc.begin.x, arc.begin.y, arc.end.x, arc.end.y];
    }
    const radius = arc.radius(center);
    const angles = arc.angles(center);
    const clockwise = arc.clockwise();
    const coords = arc.boundingCoords(
      center,
      radius,
      angles.startAngle,
      angles.endAngle,
      clockwise,
    );
    for (let i = 0, ii = coords.length; i < ii; ++i) {
      boundingCoords.push(coords[i].x);
      boundingCoords.push(coords[i].y);
    }
    return boundingCoords;
  }

  /**
   * Computes and returns the flat bounding coordinates for the geometry as
   * a whole.
   * @private
   * @return {Array<number>} The computed bounding coordinates.
   */
  flatBoundingCoordinates() {
    let boundingCoords = [];
    const count = this.arcCount();
    for (let i = 0; i < count; ++i) {
      const arc = this.arc(i);
      boundingCoords = boundingCoords.concat(
        this.flatBoundingArcCoordinates(arc),
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
   * Call the callback for each arc (3 control points: start, mid, end).
   * If the callback returns a truthy value, the function returns that value
   * immediately. Otherwise the function returns `false`.
   * @param {function(import("../coordinate.js").Coordinate, import("../coordinate.js").Coordinate, import("../coordinate.js").Coordinate): T} callback
   *     Function called for each arc with (start, mid, end).
   * @return {T|boolean} Value.
   * @template T
   * @api
   */
  forEachArc(callback) {
    const flatCoordinates = this.flatCoordinates;
    const stride = this.stride;
    const count = this.arcCount();
    for (let i = 0; i < count; i++) {
      const offset = i * 2 * stride;
      const start = flatCoordinates.slice(offset, offset + stride);
      const mid = flatCoordinates.slice(offset + stride, offset + 2 * stride);
      const end = flatCoordinates.slice(
        offset + 2 * stride,
        offset + 3 * stride,
      );
      const ret = callback(start, mid, end);
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
    for (let i = 0, n = this.arcCount(); i < n; i++) {
      const arc = this.arc(i);
      const center = arc.centerOfCircle();
      if (!center) {
        continue;
      }
      const radius = arc.radius(center);
      const angles = arc.angles(center);
      const cw = arc.clockwise();
      const full = arc.fullCircle();
      for (let e = 0; e < 4; e++) {
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
   * @param {import("./flat/CircularArc.js").Vector2} center Circle center.
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
    // Line segment: P = P1 + t*(P2-P1), t in [0,1]
    // Circle: (x-cx)^2 + (y-cy)^2 = r^2
    const dx = x2 - x1;
    const dy = y2 - y1;
    const fx = x1 - center.x;
    const fy = y1 - center.y;
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
        // intersection point on the line segment - check if on the arc
        const ix = x1 + t * dx;
        const iy = y1 + t * dy;
        let angle = Math.atan2(iy - center.y, ix - center.x);
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
    for (let i = 0, n = this.arcCount(); i < n; i++) {
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
    const arc = this.arc(arcIndex);
    const center = arc.centerOfCircle();
    if (!center) {
      // degenerate arc - return straight-line distance
      return arc.begin.distance(arc.end);
    }
    const radius = arc.radius(center);
    if (arc.fullCircle()) {
      return 2 * Math.PI * radius;
    }
    const angles = arc.angles(center);
    const cw = arc.clockwise();
    let sweep;
    if (cw) {
      sweep = arc.angleDistance(angles.endAngle, angles.startAngle);
    } else {
      sweep = arc.angleDistance(angles.startAngle, angles.endAngle);
    }
    return radius * sweep;
  }

  /**
   * Returns tessellated (densified) flat coordinates approximating the arcs
   * as polyline segments. Each arc is subdivided into `pointsPerArc` segments.
   * The output uses stride 2 (X, Y only).
   * @param {number} [pointsPerArc] Points per arc (default 36).
   * @return {Array<number>} Flat coordinates with stride 2.
   * @api
   */
  tessellate(pointsPerArc) {
    const numSeg = pointsPerArc || 36;
    const count = this.arcCount();
    if (count === 0) {
      return [];
    }
    const coords = [];
    for (let i = 0; i < count; i++) {
      const arc = this.arc(i);
      const center = arc.centerOfCircle();
      if (!center) {
        // degenerate arc - emit straight line endpoints
        if (i === 0) {
          coords.push(arc.begin.x, arc.begin.y);
        }
        coords.push(arc.end.x, arc.end.y);
        continue;
      }
      const radius = arc.radius(center);
      const angles = arc.angles(center);
      const cw = arc.clockwise();
      const full = arc.fullCircle();
      const startAngle = angles.startAngle;
      let sweep;
      if (full) {
        sweep = 2 * Math.PI;
      } else if (cw) {
        sweep = -arc.angleDistance(angles.endAngle, angles.startAngle);
      } else {
        sweep = arc.angleDistance(angles.startAngle, angles.endAngle);
      }
      // Compute the tessellation step closest to the through-point so we
      // can replace it with the exact control-point coordinate.  This
      // ensures downstream consumers (Snap vertex detection, hit-testing)
      // see the through-point as an exact tessellated vertex without
      // introducing a competing nearby point.
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
          midStep = -1; // coincides with start/end, skip replacement
        }
      }
      const startJ = i === 0 ? 0 : 1;
      for (let j = startJ; j <= numSeg; j++) {
        if (j === 0) {
          // Exact start-point control coordinate (avoids trig round-trip)
          coords.push(arc.begin.x, arc.begin.y);
        } else if (j === numSeg) {
          // Exact end-point control coordinate
          coords.push(arc.end.x, arc.end.y);
        } else if (j === midStep) {
          // Exact through-point control coordinate
          coords.push(arc.middle.x, arc.middle.y);
        } else {
          const frac = j / numSeg;
          const angle = startAngle + sweep * frac;
          coords.push(
            center.x + radius * Math.cos(angle),
            center.y + radius * Math.sin(angle),
          );
        }
      }
    }
    return coords;
  }
}

export default CircularString;
