/**
 * @module ol/geom/flat/CircularArc
 */

/**
 * Tolerance for coincident point and collinearity checks.
 * @type {number}
 */
const EPSILON = 1e-10;

/**
 * Computes and returns the CCW angle at a specific vector wrt. the given origin.
 * The angle is returned in radians and ranges from 0 to +2PI.
 * @param {Vector2} origin The given origin.
 * @param {Vector2} at The vector for which to compute the angle.
 * @return {number} The computed angle.
 */
export function angleFromOrigin(origin, at) {
  let angle = Math.atan2(at.y - origin.y, at.x - origin.x);

  if (angle < 0) {
    angle = 2 * Math.PI + angle;
  }

  return angle;
}

export class Vector2 {
  /**
   * Constructs a new Vector2 given an X and Y coordinate.
   * @param {number} x The X coordinate.
   * @param {number} y The Y coordinate.
   */
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  /**
   * Adds a given other vector and returns the result.
   * @param {Vector2} other The given other vector.
   * @return {Vector2} The resulting vector.
   */
  add(other) {
    return new Vector2(this.x + other.x, this.y + other.y);
  }

  /**
   * Subtracts a given other vector and returns the result.
   * @param {Vector2} other The given other vector.
   * @return {Vector2} The resulting vector.
   */
  subtract(other) {
    return new Vector2(this.x - other.x, this.y - other.y);
  }

  /**
   * Multiplies this vector with the given multiplier and returns the result.
   * @param {number} multiplier The multiplication factor.
   * @return {Vector2} The resulting vector.
   */
  times(multiplier) {
    return new Vector2(this.x * multiplier, this.y * multiplier);
  }

  /**
   * Computes and returns the vector's magnitude.
   * @return {number} The computed magnitude.
   */
  magnitude() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  /**
   * Rotates the vector 90 degrees around the origin in clockwise direction
   * and returns the result.
   * @return {Vector2} The resulting vector.
   */
  rotated90ClockWise() {
    return new Vector2(-this.y, this.x);
  }

  /**
   * Computes and returns the distance from this vector to a given other.
   * @param {Vector2} other The given other vector.
   * @return {number} The computed distance.
   */
  distance(other) {
    return this.subtract(other).magnitude();
  }

  /**
   * Tests if this vector and the given other vector are equal. They are
   * considered equal if the distance between them is smaller than 1e-6.
   * @param {Vector2} other The given other vector.
   * @return {boolean} True if equal, false otherwise.
   */
  equals(other) {
    return this.distance(other) < 1e-6;
  }

  /**
   * Computes and returns the normalized version of this vector.
   * @return {Vector2} The normalized vector.
   */
  normalized() {
    const magnitude = this.magnitude();
    return new Vector2(this.x / magnitude, this.y / magnitude);
  }
}

class Line {
  /**
   * Constructs a new Line given a begin and end vector.
   * @param {Vector2} begin The given begin vector.
   * @param {Vector2} end The given end vector.
   */
  constructor(begin, end) {
    this.begin = begin;
    this.end = end;
  }

  /**
   * Computes and returns the center of the line.
   * @return {Vector2} The center.
   */
  center() {
    return new Vector2(
      (this.begin.x + this.end.x) / 2,
      (this.begin.y + this.end.y) / 2,
    );
  }

  /**
   * Computes and returns the length of the line.
   * @return {number} The length.
   */
  length() {
    return this.end.subtract(this.begin).magnitude();
  }

  /**
   * Computes and returns a unit vector in direction of the line's end.
   * @return {Vector2} The computed unit vector.
   */
  unit() {
    return this.end.subtract(this.begin).normalized();
  }

  /**
   * Computes and returns the vector at which this line and a given other line
   * would intersect, if any. If no such intersection can be computed an
   * exception is thrown. The returned vector is the vector where they would
   * intersect if they don't actually intersect as of right now.
   * @param {Line} other The given other line.
   * @return {Vector2} The vector of intersection.
   */
  intersection(other) {
    // source:
    // https://dirask.com/posts/JavaScript-how-to-calculate-intersection-point-of-two-lines-for-given-4-points-VjvnAj

    const p1 = this.begin;
    const p2 = this.end;
    const p3 = other.begin;
    const p4 = other.end;

    // down part of intersection point formula
    const d1 = (p1.x - p2.x) * (p3.y - p4.y); // (x1 - x2) * (y3 - y4)
    const d2 = (p1.y - p2.y) * (p3.x - p4.x); // (y1 - y2) * (x3 - x4)
    const d = d1 - d2;

    if (d === 0) {
      throw new Error('Number of intersection points is zero or infinity.');
    }

    // upper part of intersection point formula
    const u1 = p1.x * p2.y - p1.y * p2.x; // (x1 * y2 - y1 * x2)
    const u4 = p3.x * p4.y - p3.y * p4.x; // (x3 * y4 - y3 * x4)

    const u2x = p3.x - p4.x; // (x3 - x4)
    const u3x = p1.x - p2.x; // (x1 - x2)
    const u2y = p3.y - p4.y; // (y3 - y4)
    const u3y = p1.y - p2.y; // (y1 - y2)

    // intersection point formula
    const px = (u1 * u2x - u3x * u4) / d;
    const py = (u1 * u2y - u3y * u4) / d;

    return new Vector2(px, py);
  }
}

export class CircularArc {
  /**
   * Constructs a circular arc given a begin, middle and end point.
   * @param {Vector2} begin The given begin point.
   * @param {Vector2} middle The given middle point.
   * @param {Vector2} end The given end point.
   */
  constructor(
    begin = new Vector2(),
    middle = new Vector2(),
    end = new Vector2(),
  ) {
    this.begin = begin;
    this.middle = middle;
    this.end = end;
  }

  /**
   * Computes and returns an array of coordinates which may be used to
   * construct a bounding box for the arc.
   * @param {Vector2} centerOfCircle The circle's center coordinates.
   * @param {number} radius The circle's radius.
   * @param {number} startAngle The arc's start angle.
   * @param {number} endAngle The arc's end angle.
   * @param {boolean} clockwise True if the arc is drawn in clockwise direction, false otherwise.
   * @return {Array<Vector2>} The array of bounding coordinates.
   */
  boundingCoords(centerOfCircle, radius, startAngle, endAngle, clockwise) {
    const extremes = [
      centerOfCircle.add(new Vector2(0, radius)),
      centerOfCircle.add(new Vector2(radius, 0)),
      centerOfCircle.add(new Vector2(0, -radius)),
      centerOfCircle.add(new Vector2(-radius, 0)),
    ];

    if (this.fullCircle()) {
      return extremes;
    }

    const coords = [this.begin, this.end];
    const start = !clockwise ? startAngle : endAngle;
    const end = !clockwise ? endAngle : startAngle;
    let startToEnd = this.angleDistance(start, end);

    // validate sweep using the middle point: if middle falls outside
    // the computed sweep, we picked the wrong arc (near-complete circle case)
    const middleAngle = angleFromOrigin(centerOfCircle, this.middle);
    const startToMiddle = this.angleDistance(start, middleAngle);
    if (startToMiddle > startToEnd) {
      startToEnd = 2 * Math.PI - startToEnd;
    }

    for (let i = 0, ii = extremes.length; i < ii; ++i) {
      const angle = angleFromOrigin(centerOfCircle, extremes[i]);
      const startToExtreme = this.angleDistance(start, angle);

      if (startToExtreme < startToEnd) {
        coords.push(extremes[i]);
      }
    }

    return coords;
  }

  /**
   * Computes and returns the radius given the center of the circle.
   * @param {Vector2} center The center of the circle.
   * @return {number} The computed radius.
   */
  radius(center) {
    return this.begin.subtract(center).magnitude();
  }

  /**
   * Returns if the arc concerns a full circle.
   * @return {boolean} True if so, false otherwise.
   */
  fullCircle() {
    return this.begin.equals(this.end);
  }

  /**
   * Computes and returns the CCW distance from the given start angle
   * to the given end angle.
   * @param {number} start The angle in radians.
   * @param {number} end The angle in radians.
   * @return {number} The distance in radians.
   */
  angleDistance(start, end) {
    return (end - start + 2 * Math.PI) % (2 * Math.PI);
  }

  /**
   * Computes and returns if the arc moves in clockwise direction.
   * @return {boolean} True if clockwise, false otherwise.
   */
  clockwise() {
    const cross =
      (this.middle.x - this.begin.x) * (this.end.y - this.begin.y) -
      (this.middle.y - this.begin.y) * (this.end.x - this.begin.x);
    return cross < 0;
  }

  /**
   * Computes and returns the angles at all three positions with the center
   * of the circle as their origin.
   * @param {Vector2} center The optional center of the circle, if already known, otherwise it will be computed.
   * @return {{startAngle: number, endAngle: number, middleAngle: number}} The computed angles.
   */
  angles(center) {
    if (this.fullCircle()) {
      return {
        startAngle: 0,
        middleAngle: Math.PI,
        endAngle: 2 * Math.PI,
      };
    }

    const centerOfCircle = center ? center : this.centerOfCircle();

    return {
      startAngle: angleFromOrigin(centerOfCircle, this.begin),
      middleAngle: angleFromOrigin(centerOfCircle, this.middle),
      endAngle: angleFromOrigin(centerOfCircle, this.end),
    };
  }

  /**
   * Splits this arc at the given angle into two sub-arcs.
   * Returns an array `[before, after]` where `before` is the arc from
   * `begin` to the split point and `after` is the arc from the split point
   * to `end`. If the split angle coincides with the start or end of the arc,
   * the corresponding element is `null`.
   * @param {number} angle The split angle in radians (0–2π).
   * @param {Vector2} [center] The center of the circle, if already known.
   * @return {Array<CircularArc|null>} The two sub-arcs `[before, after]`.
   */
  splitAtAngle(angle, center) {
    const c = center || this.centerOfCircle();
    if (!c) {
      // degenerate (collinear) arc — cannot split by angle
      return [this, null];
    }
    const radius = this.radius(c);
    const angles = this.angles(c);
    const cw = this.clockwise();
    const TWO_PI = 2 * Math.PI;

    // Normalize the split angle to 0–2π
    let splitAngle = ((angle % TWO_PI) + TWO_PI) % TWO_PI;

    // Check if split coincides with start or end
    const startAngle = angles.startAngle;
    const endAngle = angles.endAngle;

    const dStart = Math.abs(this.angleDistance(splitAngle, startAngle));
    const dEnd = Math.abs(this.angleDistance(splitAngle, endAngle));
    if (dStart < EPSILON || Math.abs(dStart - TWO_PI) < EPSILON) {
      return [null, this];
    }
    if (dEnd < EPSILON || Math.abs(dEnd - TWO_PI) < EPSILON) {
      return [this, null];
    }

    // Compute the split point on the circle
    const splitPoint = new Vector2(
      c.x + radius * Math.cos(splitAngle),
      c.y + radius * Math.sin(splitAngle),
    );

    // Compute midpoint angles for each sub-arc.
    // For CCW: sweep = angleDistance(start, end) (positive, going CCW).
    // For CW: we go from start to end in the CW direction.
    let midAngle1, midAngle2;
    if (cw) {
      // CW arc: start → split → end (all going clockwise = decreasing angle)
      // sweep1 = CW distance from start to split
      const sweep1 = this.angleDistance(splitAngle, startAngle);
      midAngle1 = startAngle - sweep1 / 2;
      // sweep2 = CW distance from split to end
      const sweep2 = this.angleDistance(endAngle, splitAngle);
      midAngle2 = splitAngle - sweep2 / 2;
    } else {
      // CCW arc: start → split → end (all going counter-clockwise)
      // sweep1 = CCW distance from start to split
      const sweep1 = this.angleDistance(startAngle, splitAngle);
      midAngle1 = startAngle + sweep1 / 2;
      // sweep2 = CCW distance from split to end
      const sweep2 = this.angleDistance(splitAngle, endAngle);
      midAngle2 = splitAngle + sweep2 / 2;
    }

    const midPoint1 = new Vector2(
      c.x + radius * Math.cos(midAngle1),
      c.y + radius * Math.sin(midAngle1),
    );
    const midPoint2 = new Vector2(
      c.x + radius * Math.cos(midAngle2),
      c.y + radius * Math.sin(midAngle2),
    );

    return [
      new CircularArc(this.begin, midPoint1, splitPoint),
      new CircularArc(splitPoint, midPoint2, this.end),
    ];
  }

  /**
   * Computes and returns the center of the circle.
   * @return {Vector2|null} The center of the circle, or null if points are
   *     collinear or coincident.
   */
  centerOfCircle() {
    if (this.fullCircle()) {
      return new Line(this.begin, this.middle).center();
    }

    const l1 = new Line(this.begin, this.middle);
    const l2 = new Line(this.middle, this.end);

    // coincident points - no valid circle center
    if (l1.length() < EPSILON || l2.length() < EPSILON) {
      return null;
    }

    const perpendicularL1 = new Line(
      l1.center(),
      l1.center().add(l1.unit().rotated90ClockWise()),
    );

    const perpendicularL2 = new Line(
      l2.center(),
      l2.center().add(l2.unit().rotated90ClockWise()),
    );

    const p1 = perpendicularL1.begin;
    const p2 = perpendicularL1.end;
    const p3 = perpendicularL2.begin;
    const p4 = perpendicularL2.end;
    const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
    if (Math.abs(d) < EPSILON) {
      // perpendicular bisectors are parallel - points are collinear
      return null;
    }

    return perpendicularL1.intersection(perpendicularL2);
  }

  /**
   * Check if a point is near either endpoint of this arc.
   * Uses squared distance to avoid sqrt.
   * @param {Vector2} pt The point to test.
   * @param {number} epsilonSq Squared distance threshold.
   * @return {boolean} True if pt is within epsilon of begin or end.
   */
  isNearEndpoint(pt, epsilonSq) {
    const d1x = pt.x - this.begin.x;
    const d1y = pt.y - this.begin.y;
    if (d1x * d1x + d1y * d1y < epsilonSq) {
      return true;
    }
    const d2x = pt.x - this.end.x;
    const d2y = pt.y - this.end.y;
    return d2x * d2x + d2y * d2y < epsilonSq;
  }

  /**
   * Test whether an angle lies within this arc's angular sweep.
   * @param {number} angle The angle to test (radians).
   * @param {Vector2} center The arc's center of circle.
   * @return {boolean} True if the angle is within the arc's sweep.
   */
  containsAngle(angle, center) {
    const angles = this.angles(center);
    const cw = this.clockwise();
    const TWO_PI = 2 * Math.PI;

    const a = ((angle % TWO_PI) + TWO_PI) % TWO_PI;

    const start = !cw ? angles.startAngle : angles.endAngle;
    const end = !cw ? angles.endAngle : angles.startAngle;
    let sweep = this.angleDistance(start, end);

    const startToMiddle = this.angleDistance(start, angles.middleAngle);
    if (startToMiddle > sweep) {
      sweep = TWO_PI - sweep;
    }

    const startToAngle = this.angleDistance(start, a);
    return startToAngle <= sweep + 1e-7;
  }

  /**
   * Check if another arc represents the same arc (shared boundary).
   * Two arcs are considered the same if they share a midpoint and have
   * matching endpoints (in either direction).
   * @param {CircularArc} other The other arc.
   * @return {boolean} True if they represent the same arc.
   */
  isSameArc(other) {
    if (!this.middle.equals(other.middle)) {
      return false;
    }
    if (this.begin.equals(other.begin) && this.end.equals(other.end)) {
      return true;
    }
    if (this.begin.equals(other.end) && this.end.equals(other.begin)) {
      return true;
    }
    const beginMatches =
      this.begin.equals(other.begin) || this.begin.equals(other.end);
    const endMatches =
      this.end.equals(other.end) || this.end.equals(other.begin);
    return beginMatches || endMatches;
  }
}

/**
 * Create degenerate CircularArc objects from coordinate pairs.
 * Each consecutive pair of coordinates becomes an arc where the midpoint
 * is the geometric center of the segment.
 * @param {Array<Array<number>>} coords Array of [x, y] coordinates.
 * @return {Array<CircularArc>} Array of degenerate arcs.
 */
export function lineStringToDegenerateArcs(coords) {
  const arcs = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const begin = new Vector2(coords[i][0], coords[i][1]);
    const end = new Vector2(coords[i + 1][0], coords[i + 1][1]);
    const mid = new Vector2((begin.x + end.x) / 2, (begin.y + end.y) / 2);
    arcs.push(new CircularArc(begin, mid, end));
  }
  return arcs;
}
