/**
 * @module ol/geom/flat/arc
 */

/**
 * Tolerance for coincident point and collinearity checks.
 * @type {number}
 */
const EPSILON = 1e-10;

/**
 * Compute the CCW angle from an origin to a point.
 * Returns a value in [0, 2π).
 * @param {number} cx Origin X.
 * @param {number} cy Origin Y.
 * @param {number} px Point X.
 * @param {number} py Point Y.
 * @return {number} Angle in radians.
 */
export function angleFromOrigin(cx, cy, px, py) {
  let angle = Math.atan2(py - cy, px - cx);
  if (angle < 0) {
    angle += 2 * Math.PI;
  }
  return angle;
}

/**
 * Compute the CCW angular distance from `start` to `end`.
 * Always returns a positive value in [0, 2π).
 * @param {number} start Start angle in radians.
 * @param {number} end End angle in radians.
 * @return {number} Angular distance in radians.
 */
export function angleDistance(start, end) {
  return (end - start + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Determine whether a test angle lies within the arc sweep.
 * @param {number} startAngle The arc's start angle.
 * @param {number} endAngle The arc's end angle.
 * @param {boolean} clockwise Whether the arc sweeps clockwise.
 * @param {number} middleAngle The angle at the arc's middle control point (used for disambiguation).
 * @param {number} testAngle The angle to test.
 * @return {boolean} True if the angle is within the arc's sweep.
 */
export function containsAngle(
  startAngle,
  endAngle,
  clockwise,
  middleAngle,
  testAngle,
) {
  const TWO_PI = 2 * Math.PI;
  const a = ((testAngle % TWO_PI) + TWO_PI) % TWO_PI;

  const start = !clockwise ? startAngle : endAngle;
  const end = !clockwise ? endAngle : startAngle;
  let sweep = angleDistance(start, end);

  const startToMiddle = angleDistance(start, middleAngle);
  if (startToMiddle > sweep) {
    sweep = TWO_PI - sweep;
  }

  const startToAngle = angleDistance(start, a);
  return startToAngle <= sweep + 1e-7;
}

/**
 * Compute the center of the circle passing through three points.
 * Uses perpendicular bisector intersection.
 * @param {number} bx Begin X.
 * @param {number} by Begin Y.
 * @param {number} mx Middle X.
 * @param {number} my Middle Y.
 * @param {number} ex End X.
 * @param {number} ey End Y.
 * @return {Array<number>|null} [cx, cy] or null if points are collinear/coincident.
 */
export function getCircleCenter(bx, by, mx, my, ex, ey) {
  // Full circle case: begin equals end
  const dx = bx - ex;
  const dy = by - ey;
  if (dx * dx + dy * dy < 1e-12) {
    // Full circle: center is midpoint of begin-middle chord
    return [(bx + mx) / 2, (by + my) / 2];
  }

  // Midpoints of segments begin→middle and middle→end
  const m1x = (bx + mx) / 2;
  const m1y = (by + my) / 2;
  const m2x = (mx + ex) / 2;
  const m2y = (my + ey) / 2;

  // Direction vectors of the two segments
  const d1x = mx - bx;
  const d1y = my - by;
  const d2x = ex - mx;
  const d2y = ey - my;

  // Check for coincident points (zero-length segments)
  if (d1x * d1x + d1y * d1y < EPSILON || d2x * d2x + d2y * d2y < EPSILON) {
    return null;
  }

  // Perpendicular bisector directions (rotated 90° CW: [dx, dy] → [-dy, dx])
  const p1x = -d1y;
  const p1y = d1x;
  const p2x = -d2y;
  const p2y = d2x;

  // Intersection of two rays: m1 + t*p1 = m2 + u*p2
  // Solve for t: (m1 + t*p1 - m2) × p2 = 0
  const denom = p1x * p2y - p1y * p2x;
  if (Math.abs(denom) < EPSILON) {
    // Perpendicular bisectors are parallel — points are collinear
    return null;
  }

  const t = ((m2x - m1x) * p2y - (m2y - m1y) * p2x) / denom;

  return [m1x + t * p1x, m1y + t * p1y];
}

/**
 * Compute the radius of the arc's circle given the center and one point.
 * @param {number} cx Center X.
 * @param {number} cy Center Y.
 * @param {number} px Point X (typically begin).
 * @param {number} py Point Y (typically begin).
 * @return {number} The radius.
 */
export function getArcRadius(cx, cy, px, py) {
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute the start, middle, and end angles of an arc relative to its center.
 * @param {number} cx Center X.
 * @param {number} cy Center Y.
 * @param {number} bx Begin X.
 * @param {number} by Begin Y.
 * @param {number} mx Middle X.
 * @param {number} my Middle Y.
 * @param {number} ex End X.
 * @param {number} ey End Y.
 * @return {{startAngle: number, middleAngle: number, endAngle: number}} The computed angles.
 */
export function getArcAngles(cx, cy, bx, by, mx, my, ex, ey) {
  // Full circle case
  const dx = bx - ex;
  const dy = by - ey;
  if (dx * dx + dy * dy < 1e-12) {
    return {
      startAngle: 0,
      middleAngle: Math.PI,
      endAngle: 2 * Math.PI,
    };
  }

  return {
    startAngle: angleFromOrigin(cx, cy, bx, by),
    middleAngle: angleFromOrigin(cx, cy, mx, my),
    endAngle: angleFromOrigin(cx, cy, ex, ey),
  };
}

/**
 * Determine if an arc sweeps clockwise.
 * Uses the cross product of (middle - begin) × (end - begin).
 * @param {number} bx Begin X.
 * @param {number} by Begin Y.
 * @param {number} mx Middle X.
 * @param {number} my Middle Y.
 * @param {number} ex End X.
 * @param {number} ey End Y.
 * @return {boolean} True if clockwise.
 */
export function isArcClockwise(bx, by, mx, my, ex, ey) {
  const cross = (mx - bx) * (ey - by) - (my - by) * (ex - bx);
  return cross < 0;
}

/**
 * Determine if begin and end points coincide (full circle).
 * @param {number} bx Begin X.
 * @param {number} by Begin Y.
 * @param {number} ex End X.
 * @param {number} ey End Y.
 * @return {boolean} True if begin equals end (within tolerance).
 */
export function isFullCircle(bx, by, ex, ey) {
  const dx = bx - ex;
  const dy = by - ey;
  return dx * dx + dy * dy < 1e-12;
}

/**
 * Split an arc at the given angle into two sub-arcs.
 * Returns a 12-element flat array: [b1x,b1y,m1x,m1y,e1x,e1y, b2x,b2y,m2x,m2y,e2x,e2y]
 * representing the two sub-arcs [begin→split] and [split→end].
 * Returns null if the split angle coincides with the start or end.
 * @param {number} bx Begin X.
 * @param {number} by Begin Y.
 * @param {number} mx Middle X.
 * @param {number} my Middle Y.
 * @param {number} ex End X.
 * @param {number} ey End Y.
 * @param {number} cx Center X.
 * @param {number} cy Center Y.
 * @param {number} angle Split angle in radians.
 * @return {Array<number>|null} 12-element flat array of two sub-arcs, or null if split is at endpoint.
 */
export function splitArcAtAngle(bx, by, mx, my, ex, ey, cx, cy, angle) {
  const radius = getArcRadius(cx, cy, bx, by);
  const angles = getArcAngles(cx, cy, bx, by, mx, my, ex, ey);
  const cw = isArcClockwise(bx, by, mx, my, ex, ey);
  const TWO_PI = 2 * Math.PI;

  // Normalize the split angle to [0, 2π)
  let splitAngle = ((angle % TWO_PI) + TWO_PI) % TWO_PI;

  // Check if split coincides with start or end
  const dStart = Math.abs(angleDistance(splitAngle, angles.startAngle));
  const dEnd = Math.abs(angleDistance(splitAngle, angles.endAngle));
  if (dStart < EPSILON || Math.abs(dStart - TWO_PI) < EPSILON) {
    return null;
  }
  if (dEnd < EPSILON || Math.abs(dEnd - TWO_PI) < EPSILON) {
    return null;
  }

  // Split point on the circle
  const sx = cx + radius * Math.cos(splitAngle);
  const sy = cy + radius * Math.sin(splitAngle);

  // Compute midpoint angles for each sub-arc
  let midAngle1, midAngle2;
  if (cw) {
    const sweep1 = angleDistance(splitAngle, angles.startAngle);
    midAngle1 = angles.startAngle - sweep1 / 2;
    const sweep2 = angleDistance(angles.endAngle, splitAngle);
    midAngle2 = splitAngle - sweep2 / 2;
  } else {
    const sweep1 = angleDistance(angles.startAngle, splitAngle);
    midAngle1 = angles.startAngle + sweep1 / 2;
    const sweep2 = angleDistance(splitAngle, angles.endAngle);
    midAngle2 = splitAngle + sweep2 / 2;
  }

  const m1x = cx + radius * Math.cos(midAngle1);
  const m1y = cy + radius * Math.sin(midAngle1);
  const m2x = cx + radius * Math.cos(midAngle2);
  const m2y = cy + radius * Math.sin(midAngle2);

  return [bx, by, m1x, m1y, sx, sy, sx, sy, m2x, m2y, ex, ey];
}

/**
 * Compute bounding coordinates for an arc. Returns the arc's endpoints
 * plus any axis-aligned extremes that fall within the arc's sweep.
 * @param {number} bx Begin X.
 * @param {number} by Begin Y.
 * @param {number} mx Middle X.
 * @param {number} my Middle Y.
 * @param {number} ex End X.
 * @param {number} ey End Y.
 * @param {number} cx Center X.
 * @param {number} cy Center Y.
 * @return {Array<number>} Flat array of [x,y,...] bounding coordinates.
 */
export function getArcBoundingCoords(bx, by, mx, my, ex, ey, cx, cy) {
  const radius = getArcRadius(cx, cy, bx, by);
  const cw = isArcClockwise(bx, by, mx, my, ex, ey);
  const fullCircle = isFullCircle(bx, by, ex, ey);

  // Four axis-aligned extremes
  const extremes = [
    cx, cy + radius, // top (90°)
    cx + radius, cy, // right (0°)
    cx, cy - radius, // bottom (270°)
    cx - radius, cy, // left (180°)
  ];

  if (fullCircle) {
    return extremes;
  }

  // Start with endpoints
  const coords = [bx, by, ex, ey];

  const angles = getArcAngles(cx, cy, bx, by, mx, my, ex, ey);
  const start = !cw ? angles.startAngle : angles.endAngle;
  const end = !cw ? angles.endAngle : angles.startAngle;
  let startToEnd = angleDistance(start, end);

  // Validate sweep using middle point
  const startToMiddle = angleDistance(start, angles.middleAngle);
  if (startToMiddle > startToEnd) {
    startToEnd = 2 * Math.PI - startToEnd;
  }

  for (let i = 0; i < 4; i++) {
    const extremeAngle = angleFromOrigin(
      cx,
      cy,
      extremes[i * 2],
      extremes[i * 2 + 1],
    );
    const startToExtreme = angleDistance(start, extremeAngle);
    if (startToExtreme > EPSILON && startToExtreme < startToEnd - EPSILON) {
      coords.push(extremes[i * 2], extremes[i * 2 + 1]);
    }
  }

  return coords;
}
