/**
 * @module ol/geom/flat/segments
 */

/**
 * This function calls `callback` for each segment of the flat coordinates
 * array. If the callback returns a truthy value the function returns that
 * value immediately. Otherwise the function returns `false`.
 * @param {Array<number>} flatCoordinates Flat coordinates.
 * @param {number} offset Offset.
 * @param {number} end End.
 * @param {number} stride Stride.
 * @param {function(import("../../coordinate.js").Coordinate, import("../../coordinate.js").Coordinate): T} callback Function
 *     called for each segment.
 * @return {T|boolean} Value.
 * @template T
 */
export function forEach(flatCoordinates, offset, end, stride, callback) {
  let ret;
  offset += stride;
  for (; offset < end; offset += stride) {
    ret = callback(
      flatCoordinates.slice(offset - stride, offset),
      flatCoordinates.slice(offset, offset + stride),
    );
    if (ret) {
      return ret;
    }
  }
  return false;
}

/**
 * Calculate the intersection point of two line segments.
 * Reference: https://stackoverflow.com/a/72474223/2389327
 * @param {Array<import("../../coordinate.js").Coordinate>} segment1 The first line segment as an array of two points.
 * @param {Array<import("../../coordinate.js").Coordinate>} segment2 The second line segment as an array of two points.
 * @return {import("../../coordinate.js").Coordinate|undefined} The intersection point or `undefined` if no intersection.
 */
export function getIntersectionPoint(segment1, segment2) {
  const [a, b] = segment1;
  const [c, d] = segment2;
  const t =
    ((a[0] - c[0]) * (c[1] - d[1]) - (a[1] - c[1]) * (c[0] - d[0])) /
    ((a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]));
  const u =
    ((a[0] - c[0]) * (a[1] - b[1]) - (a[1] - c[1]) * (a[0] - b[0])) /
    ((a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]));

  // Check if lines actually intersect
  if (0 <= t && t <= 1 && 0 <= u && u <= 1) {
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  }
  return undefined;
}

/**
 * Find the first proper crossing point between two sets of segments
 * (e.g. two linear rings or two linestrings).
 *
 * Uses strict bounds (0 < t < 1 and 0 < u < 1) so that shared endpoints
 * (e.g. two polygons touching at a vertex) are NOT reported as crossings,
 * and collinear/overlapping segments return `undefined`.
 *
 * @param {Array<number>} flatCoordinates1 Flat coordinates of the first geometry.
 * @param {number} offset1 Offset into flatCoordinates1.
 * @param {number} end1 End index in flatCoordinates1.
 * @param {Array<number>} flatCoordinates2 Flat coordinates of the second geometry.
 * @param {number} offset2 Offset into flatCoordinates2.
 * @param {number} end2 End index in flatCoordinates2.
 * @param {number} stride Stride.
 * @return {import("../../coordinate.js").Coordinate|undefined} The first
 *   crossing point, or `undefined` if no edges cross.
 */
export function getSegmentsCrossingPoint(
  flatCoordinates1,
  offset1,
  end1,
  flatCoordinates2,
  offset2,
  end2,
  stride,
) {
  for (let i = offset1 + stride; i < end1; i += stride) {
    const ax = flatCoordinates1[i - stride];
    const ay = flatCoordinates1[i - stride + 1];
    const bx = flatCoordinates1[i];
    const by = flatCoordinates1[i + 1];

    for (let j = offset2 + stride; j < end2; j += stride) {
      const cx = flatCoordinates2[j - stride];
      const cy = flatCoordinates2[j - stride + 1];
      const dx = flatCoordinates2[j];
      const dy = flatCoordinates2[j + 1];

      const denom = (ax - bx) * (cy - dy) - (ay - by) * (cx - dx);
      if (denom === 0) {
        // Parallel or collinear — no proper crossing
        continue;
      }

      const t = ((ax - cx) * (cy - dy) - (ay - cy) * (cx - dx)) / denom;
      const u = ((ax - cx) * (ay - by) - (ay - cy) * (ax - bx)) / denom;

      // Strict bounds: exclude endpoint touches
      if (t > 0 && t < 1 && u > 0 && u < 1) {
        return [ax + t * (bx - ax), ay + t * (by - ay)];
      }
    }
  }
  return undefined;
}
