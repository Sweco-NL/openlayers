/**
 * @module ol/geom/flat/topology
 */
import {
  angleDistance,
  angleFromOrigin,
  containsAngle,
  getArcAngles,
  getArcRadius,
  getCircleCenter,
  isArcClockwise,
} from './arc.js';
import {linearRing as linearRingArea} from './area.js';

/**
 * Check if the linestring is a boundary.
 * @param {Array<number>} flatCoordinates Flat coordinates.
 * @param {number} offset Offset.
 * @param {number} end End.
 * @param {number} stride Stride.
 * @return {boolean} The linestring is a boundary.
 */
export function lineStringIsClosed(flatCoordinates, offset, end, stride) {
  const lastCoord = end - stride;
  if (
    flatCoordinates[offset] === flatCoordinates[lastCoord] &&
    flatCoordinates[offset + 1] === flatCoordinates[lastCoord + 1] &&
    (end - offset) / stride > 3
  ) {
    return !!linearRingArea(flatCoordinates, offset, end, stride);
  }
  return false;
}

/**
 * Find the first self-intersection point in a linestring or ring.
 *
 * Tests all non-adjacent segment pairs for proper crossings using strict
 * bounds (0 < t < 1 and 0 < u < 1). This means shared endpoints — which
 * are normal for consecutive segments — are never reported.
 * Adjacent segments (which share a vertex) are skipped. For closed rings,
 * the first and last segments are also skipped since they share the closure vertex.
 *
 * @param {Array<number>} flatCoordinates Flat coordinates.
 * @param {number} offset Offset.
 * @param {number} end End.
 * @param {number} stride Stride.
 * @param {boolean} [isRing] Whether the coordinates form a closed ring.
 *   When true, the first/last segment pair is also skipped.
 * @return {import("../../coordinate.js").Coordinate|undefined} The first
 *   self-intersection point, or `undefined` if the geometry is simple.
 */
export function getSelfIntersectionPoint(
  flatCoordinates,
  offset,
  end,
  stride,
  isRing,
) {
  const numPoints = (end - offset) / stride;
  const numSegments = numPoints - 1;
  if (numSegments < 2) {
    return undefined;
  }

  for (let i = 0; i < numSegments; ++i) {
    const i0 = offset + i * stride;
    const ax = flatCoordinates[i0];
    const ay = flatCoordinates[i0 + 1];
    const bx = flatCoordinates[i0 + stride];
    const by = flatCoordinates[i0 + stride + 1];

    // Start at i + 2 to skip the adjacent segment (shares vertex with seg i)
    for (let j = i + 2; j < numSegments; ++j) {
      // For rings, skip the pair (first, last) — they share the closure vertex
      if (isRing && i === 0 && j === numSegments - 1) {
        continue;
      }

      const j0 = offset + j * stride;
      const cx = flatCoordinates[j0];
      const cy = flatCoordinates[j0 + 1];
      const dx = flatCoordinates[j0 + stride];
      const dy = flatCoordinates[j0 + stride + 1];

      const denom = (ax - bx) * (cy - dy) - (ay - by) * (cx - dx);
      if (denom === 0) {
        // Parallel or collinear — no proper crossing
        continue;
      }

      const t = ((ax - cx) * (cy - dy) - (ay - cy) * (cx - dx)) / denom;
      const u = ((ax - cx) * (ay - by) - (ay - cy) * (ax - bx)) / denom;

      // Strict bounds: only interior crossings, not shared endpoints
      if (t > 0 && t < 1 && u > 0 && u < 1) {
        return [ax + t * (bx - ax), ay + t * (by - ay)];
      }
    }
  }
  return undefined;
}

/**
 * Threshold for degenerate (near-infinite-radius) arcs — treated as lines.
 * @type {number}
 */
const DEGEN_RADIUS = 1e9;

/**
 * Find the first crossing point between two line segments.
 * Uses parametric intersection with strict interior bounds (excludes endpoints).
 * @param {number} x1 Segment 1 start X.
 * @param {number} y1 Segment 1 start Y.
 * @param {number} x2 Segment 1 end X.
 * @param {number} y2 Segment 1 end Y.
 * @param {number} x3 Segment 2 start X.
 * @param {number} y3 Segment 2 start Y.
 * @param {number} x4 Segment 2 end X.
 * @param {number} y4 Segment 2 end Y.
 * @return {Array<number>|null} [x, y] crossing point or null.
 */
export function getLineLineCrossingPoint(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) {
    return null;
  }

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

  if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) {
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  }
  return null;
}

/**
 * Find the crossing points between a line segment and a circular arc.
 * @param {number} x1 Line start X.
 * @param {number} y1 Line start Y.
 * @param {number} x2 Line end X.
 * @param {number} y2 Line end Y.
 * @param {number} bx Arc begin X.
 * @param {number} by Arc begin Y.
 * @param {number} mx Arc middle X.
 * @param {number} my Arc middle Y.
 * @param {number} ex Arc end X.
 * @param {number} ey Arc end Y.
 * @param {number} epsilonSq Squared distance threshold for endpoint filtering.
 * @return {Array<Array<number>>} Array of [x, y] crossing points (empty when none).
 */
export function getLineArcCrossingPoint(
  x1,
  y1,
  x2,
  y2,
  bx,
  by,
  mx,
  my,
  ex,
  ey,
  epsilonSq,
) {
  const center = getCircleCenter(bx, by, mx, my, ex, ey);
  if (!center) {
    // Arc is degenerate (line) — use line-line
    const pt = getLineLineCrossingPoint(x1, y1, x2, y2, bx, by, ex, ey);
    return pt ? [pt] : [];
  }

  const cx = center[0];
  const cy = center[1];
  const r = getArcRadius(cx, cy, bx, by);

  const dx = x2 - x1;
  const dy = y2 - y1;
  const fx = x1 - cx;
  const fy = y1 - cy;

  const a = dx * dx + dy * dy;
  if (a < 1e-20) {
    // Degenerate zero-length line segment
    return [];
  }
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;

  if (disc < 0) {
    return [];
  }

  const sqrtDisc = Math.sqrt(disc);
  const tValues = [(-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a)];

  const angles = getArcAngles(cx, cy, bx, by, mx, my, ex, ey);
  const cw = isArcClockwise(bx, by, mx, my, ex, ey);

  // Compute arc sweep for angular tolerance calculation.
  // For short arcs near shared boundaries, allow a small angular tolerance
  // to catch crossings that fall in the gap between adjacent sub-arcs
  // decomposed differently across features.
  const sweepStart = !cw ? angles.startAngle : angles.endAngle;
  const sweepEnd = !cw ? angles.endAngle : angles.startAngle;
  let arcSweep = angleDistance(sweepStart, sweepEnd);
  const sweepStartToMiddle = angleDistance(sweepStart, angles.middleAngle);
  if (sweepStartToMiddle > arcSweep) {
    arcSweep = 2 * Math.PI - arcSweep;
  }
  const angularTolerance = Math.min(0.01, arcSweep * 0.05);

  const results = [];
  for (const t of tValues) {
    if (t <= 1e-9 || t >= 1 - 1e-9) {
      continue;
    }
    const px = x1 + t * dx;
    const py = y1 + t * dy;

    // Skip crossings near SHARED endpoints (where a line endpoint coincides
    // with an arc endpoint and the crossing is at that shared vertex).
    // Uses both a spatial distance check (epsilonSq) and a parametric
    // threshold to catch near-vertex artifacts on long line segments.
    let nearShared = false;
    const lineEps = [x1, y1, x2, y2];
    const arcEps = [bx, by, ex, ey];
    for (let li = 0; li < 4; li += 2) {
      for (let ai = 0; ai < 4; ai += 2) {
        const sdx = lineEps[li] - arcEps[ai];
        const sdy = lineEps[li + 1] - arcEps[ai + 1];
        if (sdx * sdx + sdy * sdy < epsilonSq) {
          // Spatial distance check
          const dpx = px - lineEps[li];
          const dpy = py - lineEps[li + 1];
          if (dpx * dpx + dpy * dpy < epsilonSq) {
            nearShared = true;
            break;
          }
          // Parametric check: reject crossings within 0.5% of line length
          // from a shared endpoint (catches large-geometry artifacts)
          if (li === 0 && t < 0.005) {
            nearShared = true;
            break;
          }
          if (li === 2 && t > 0.995) {
            nearShared = true;
            break;
          }
        }
      }
      if (nearShared) {
        break;
      }
    }
    if (nearShared) {
      continue;
    }

    const angle = angleFromOrigin(cx, cy, px, py);
    if (
      containsAngle(
        angles.startAngle,
        angles.endAngle,
        cw,
        angles.middleAngle,
        angle,
        angularTolerance,
      )
    ) {
      results.push([px, py]);
    }
  }
  return results;
}

/**
 * Find the first crossing point between two circular arcs.
 * Dispatches to line-line, line-arc, or full circle-circle intersection
 * depending on whether arcs are degenerate.
 * @param {number} b1x Arc 1 begin X.
 * @param {number} b1y Arc 1 begin Y.
 * @param {number} m1x Arc 1 middle X.
 * @param {number} m1y Arc 1 middle Y.
 * @param {number} e1x Arc 1 end X.
 * @param {number} e1y Arc 1 end Y.
 * @param {number} b2x Arc 2 begin X.
 * @param {number} b2y Arc 2 begin Y.
 * @param {number} m2x Arc 2 middle X.
 * @param {number} m2y Arc 2 middle Y.
 * @param {number} e2x Arc 2 end X.
 * @param {number} e2y Arc 2 end Y.
 * @param {number} epsilonSq Squared distance threshold for endpoint filtering.
 * @return {Array<number>|null} [x, y] crossing point or null.
 */
export function getArcArcCrossingPoint(
  b1x,
  b1y,
  m1x,
  m1y,
  e1x,
  e1y,
  b2x,
  b2y,
  m2x,
  m2y,
  e2x,
  e2y,
  epsilonSq,
) {
  const c1 = getCircleCenter(b1x, b1y, m1x, m1y, e1x, e1y);
  const c2 = getCircleCenter(b2x, b2y, m2x, m2y, e2x, e2y);

  const isLine1 = !c1 || getArcRadius(c1[0], c1[1], b1x, b1y) > DEGEN_RADIUS;
  const isLine2 = !c2 || getArcRadius(c2[0], c2[1], b2x, b2y) > DEGEN_RADIUS;

  if (isLine1 && isLine2) {
    return getLineLineCrossingPoint(b1x, b1y, e1x, e1y, b2x, b2y, e2x, e2y);
  }
  if (isLine1) {
    const pts = getLineArcCrossingPoint(
      b1x,
      b1y,
      e1x,
      e1y,
      b2x,
      b2y,
      m2x,
      m2y,
      e2x,
      e2y,
      epsilonSq,
    );
    return pts.length > 0 ? pts[0] : null;
  }
  if (isLine2) {
    const pts = getLineArcCrossingPoint(
      b2x,
      b2y,
      e2x,
      e2y,
      b1x,
      b1y,
      m1x,
      m1y,
      e1x,
      e1y,
      epsilonSq,
    );
    return pts.length > 0 ? pts[0] : null;
  }

  const c1x = c1[0],
    c1y = c1[1];
  const c2x = c2[0],
    c2y = c2[1];
  const r1 = getArcRadius(c1x, c1y, b1x, b1y);
  const r2 = getArcRadius(c2x, c2y, b2x, b2y);

  const ddx = c2x - c1x;
  const ddy = c2y - c1y;
  const d = Math.sqrt(ddx * ddx + ddy * ddy);

  if (d > r1 + r2 + 1e-9) {
    return null;
  }
  if (d < Math.abs(r1 - r2) - 1e-9) {
    return null;
  }
  if (d < 1e-9) {
    if (Math.abs(r1 - r2) < 1e-6) {
      return getSameCircleArcOverlap(
        b1x,
        b1y,
        m1x,
        m1y,
        e1x,
        e1y,
        b2x,
        b2y,
        m2x,
        m2y,
        e2x,
        e2y,
        epsilonSq,
      );
    }
    return null;
  }

  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hSq = r1 * r1 - a * a;
  if (hSq < -1e-9) {
    return null;
  }
  const h = Math.sqrt(Math.max(0, hSq));

  const px = c1x + (a * ddx) / d;
  const py = c1y + (a * ddy) / d;

  const candidates = [];
  if (h < 1e-9) {
    candidates.push(px, py);
  } else {
    candidates.push(
      px + (h * ddy) / d,
      py - (h * ddx) / d,
      px - (h * ddy) / d,
      py + (h * ddx) / d,
    );
  }

  const angles1 = getArcAngles(c1x, c1y, b1x, b1y, m1x, m1y, e1x, e1y);
  const angles2 = getArcAngles(c2x, c2y, b2x, b2y, m2x, m2y, e2x, e2y);
  const cw1 = isArcClockwise(b1x, b1y, m1x, m1y, e1x, e1y);
  const cw2 = isArcClockwise(b2x, b2y, m2x, m2y, e2x, e2y);

  for (let i = 0; i < candidates.length; i += 2) {
    const ptx = candidates[i];
    const pty = candidates[i + 1];

    // Only skip crossings near SHARED endpoints (where both arcs meet).
    // This avoids filtering real crossings near endpoints that belong to
    // only one arc (e.g. at trace junction points between features).
    let nearSharedEndpoint = false;
    const eps1s = [b1x, b1y, e1x, e1y];
    const eps2s = [b2x, b2y, e2x, e2y];
    for (let j = 0; j < 4; j += 2) {
      for (let k = 0; k < 4; k += 2) {
        const sdx = eps1s[j] - eps2s[k];
        const sdy = eps1s[j + 1] - eps2s[k + 1];
        if (sdx * sdx + sdy * sdy < epsilonSq) {
          const dpx = ptx - eps1s[j];
          const dpy = pty - eps1s[j + 1];
          if (dpx * dpx + dpy * dpy < epsilonSq) {
            nearSharedEndpoint = true;
            break;
          }
        }
      }
      if (nearSharedEndpoint) {
        break;
      }
    }
    if (nearSharedEndpoint) {
      continue;
    }

    const angle1 = angleFromOrigin(c1x, c1y, ptx, pty);
    const angle2 = angleFromOrigin(c2x, c2y, ptx, pty);

    if (
      containsAngle(
        angles1.startAngle,
        angles1.endAngle,
        cw1,
        angles1.middleAngle,
        angle1,
      ) &&
      containsAngle(
        angles2.startAngle,
        angles2.endAngle,
        cw2,
        angles2.middleAngle,
        angle2,
      )
    ) {
      return [ptx, pty];
    }
  }
  return null;
}

/**
 * Find ALL crossing points between two circular arcs (max 2).
 * Same parameters as getArcArcCrossingPoint.
 * @param {number} b1x Arc 1 begin X.
 * @param {number} b1y Arc 1 begin Y.
 * @param {number} m1x Arc 1 middle X.
 * @param {number} m1y Arc 1 middle Y.
 * @param {number} e1x Arc 1 end X.
 * @param {number} e1y Arc 1 end Y.
 * @param {number} b2x Arc 2 begin X.
 * @param {number} b2y Arc 2 begin Y.
 * @param {number} m2x Arc 2 middle X.
 * @param {number} m2y Arc 2 middle Y.
 * @param {number} e2x Arc 2 end X.
 * @param {number} e2y Arc 2 end Y.
 * @param {number} epsilonSq Squared epsilon for endpoint exclusion.
 * @return {Array<Array<number>>} Array of [x, y] crossing points.
 */
export function getArcArcCrossingPoints(
  b1x,
  b1y,
  m1x,
  m1y,
  e1x,
  e1y,
  b2x,
  b2y,
  m2x,
  m2y,
  e2x,
  e2y,
  epsilonSq,
) {
  const c1 = getCircleCenter(b1x, b1y, m1x, m1y, e1x, e1y);
  const c2 = getCircleCenter(b2x, b2y, m2x, m2y, e2x, e2y);

  const isLine1 = !c1 || getArcRadius(c1[0], c1[1], b1x, b1y) > DEGEN_RADIUS;
  const isLine2 = !c2 || getArcRadius(c2[0], c2[1], b2x, b2y) > DEGEN_RADIUS;

  // For line-line, at most 1 crossing. For line-arc, up to 2 crossings.
  if (isLine1 && isLine2) {
    const pt = getLineLineCrossingPoint(b1x, b1y, e1x, e1y, b2x, b2y, e2x, e2y);
    return pt ? [pt] : [];
  }
  if (isLine1) {
    return getLineArcCrossingPoint(
      b1x,
      b1y,
      e1x,
      e1y,
      b2x,
      b2y,
      m2x,
      m2y,
      e2x,
      e2y,
      epsilonSq,
    );
  }
  if (isLine2) {
    return getLineArcCrossingPoint(
      b2x,
      b2y,
      e2x,
      e2y,
      b1x,
      b1y,
      m1x,
      m1y,
      e1x,
      e1y,
      epsilonSq,
    );
  }

  const c1x = c1[0],
    c1y = c1[1];
  const c2x = c2[0],
    c2y = c2[1];
  const r1 = getArcRadius(c1x, c1y, b1x, b1y);
  const r2 = getArcRadius(c2x, c2y, b2x, b2y);

  const ddx = c2x - c1x;
  const ddy = c2y - c1y;
  const d = Math.sqrt(ddx * ddx + ddy * ddy);

  if (d > r1 + r2 + 1e-9) {
    return [];
  }
  if (d < Math.abs(r1 - r2) - 1e-9) {
    return [];
  }
  if (d < 1e-9) {
    if (Math.abs(r1 - r2) < 1e-6) {
      const pt = getSameCircleArcOverlap(
        b1x,
        b1y,
        m1x,
        m1y,
        e1x,
        e1y,
        b2x,
        b2y,
        m2x,
        m2y,
        e2x,
        e2y,
        epsilonSq,
      );
      return pt ? [pt] : [];
    }
    return [];
  }

  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const hSq = r1 * r1 - a * a;
  if (hSq < -1e-9) {
    return [];
  }
  const h = Math.sqrt(Math.max(0, hSq));

  const px = c1x + (a * ddx) / d;
  const py = c1y + (a * ddy) / d;

  const candidates = [];
  if (h < 1e-9) {
    candidates.push(px, py);
  } else {
    candidates.push(
      px + (h * ddy) / d,
      py - (h * ddx) / d,
      px - (h * ddy) / d,
      py + (h * ddx) / d,
    );
  }

  const angles1 = getArcAngles(c1x, c1y, b1x, b1y, m1x, m1y, e1x, e1y);
  const angles2 = getArcAngles(c2x, c2y, b2x, b2y, m2x, m2y, e2x, e2y);
  const cw1 = isArcClockwise(b1x, b1y, m1x, m1y, e1x, e1y);
  const cw2 = isArcClockwise(b2x, b2y, m2x, m2y, e2x, e2y);

  const result = [];
  for (let i = 0; i < candidates.length; i += 2) {
    const ptx = candidates[i];
    const pty = candidates[i + 1];

    // Skip crossings near a shared endpoint between the two arcs.
    // When arc1's begin/end coincides with arc2's begin/end, the crossing
    // at that point is a vertex meeting, not a true transversal crossing.
    // Uses both spatial distance and a proportional threshold to catch
    // near-vertex artifacts on large-radius arcs.
    let nearSharedEndpoint = false;
    const eps1 = [b1x, b1y, e1x, e1y];
    const eps2 = [b2x, b2y, e2x, e2y];
    for (let ei = 0; ei < 4; ei += 2) {
      for (let ej = 0; ej < 4; ej += 2) {
        const sdx = eps1[ei] - eps2[ej];
        const sdy = eps1[ei + 1] - eps2[ej + 1];
        if (sdx * sdx + sdy * sdy < epsilonSq) {
          // These endpoints are shared; skip if the crossing is near them
          const dpx = ptx - eps1[ei];
          const dpy = pty - eps1[ei + 1];
          const distSq = dpx * dpx + dpy * dpy;
          if (distSq < epsilonSq) {
            nearSharedEndpoint = true;
            break;
          }
          // Proportional check: reject crossings within 0.5% of the
          // shorter arc chord from the shared endpoint
          const chord1Sq =
            (e1x - b1x) * (e1x - b1x) + (e1y - b1y) * (e1y - b1y);
          const chord2Sq =
            (e2x - b2x) * (e2x - b2x) + (e2y - b2y) * (e2y - b2y);
          const threshold = Math.min(chord1Sq, chord2Sq) * 25e-6;
          if (distSq < threshold) {
            nearSharedEndpoint = true;
            break;
          }
        }
      }
      if (nearSharedEndpoint) {
        break;
      }
    }
    if (nearSharedEndpoint) {
      continue;
    }

    const angle1 = angleFromOrigin(c1x, c1y, ptx, pty);
    const angle2 = angleFromOrigin(c2x, c2y, ptx, pty);

    if (
      containsAngle(
        angles1.startAngle,
        angles1.endAngle,
        cw1,
        angles1.middleAngle,
        angle1,
      ) &&
      containsAngle(
        angles2.startAngle,
        angles2.endAngle,
        cw2,
        angles2.middleAngle,
        angle2,
      )
    ) {
      result.push([ptx, pty]);
    }
  }
  return result;
}

/**
 * Handle same-circle arc overlap. Returns a representative point in the
 * overlap region, or null if no overlap.
 * @param {number} b1x Arc 1 begin X.
 * @param {number} b1y Arc 1 begin Y.
 * @param {number} m1x Arc 1 middle X.
 * @param {number} m1y Arc 1 middle Y.
 * @param {number} e1x Arc 1 end X.
 * @param {number} e1y Arc 1 end Y.
 * @param {number} b2x Arc 2 begin X.
 * @param {number} b2y Arc 2 begin Y.
 * @param {number} m2x Arc 2 middle X.
 * @param {number} m2y Arc 2 middle Y.
 * @param {number} e2x Arc 2 end X.
 * @param {number} e2y Arc 2 end Y.
 * @param {number} epsilonSq Squared distance threshold.
 * @return {Array<number>|null} [x, y] point in overlap, or null.
 */
export function getSameCircleArcOverlap(
  b1x,
  b1y,
  m1x,
  m1y,
  e1x,
  e1y,
  b2x,
  b2y,
  m2x,
  m2y,
  e2x,
  e2y,
  epsilonSq,
) {
  // Check if midpoints are the same (same arc)
  const midDx = m1x - m2x;
  const midDy = m1y - m2y;
  if (midDx * midDx + midDy * midDy < epsilonSq) {
    return null;
  }

  const center = getCircleCenter(b1x, b1y, m1x, m1y, e1x, e1y);
  if (!center) {
    return null;
  }
  const cx = center[0];
  const cy = center[1];

  const angles1 = getArcAngles(cx, cy, b1x, b1y, m1x, m1y, e1x, e1y);
  const angles2 = getArcAngles(cx, cy, b2x, b2y, m2x, m2y, e2x, e2y);
  const cw1 = isArcClockwise(b1x, b1y, m1x, m1y, e1x, e1y);
  const cw2 = isArcClockwise(b2x, b2y, m2x, m2y, e2x, e2y);

  const midAngle1 = angleFromOrigin(cx, cy, m1x, m1y);
  const midAngle2 = angleFromOrigin(cx, cy, m2x, m2y);

  // Check if arc1's middle is in arc2's sweep (and not near arc2 endpoints)
  if (
    containsAngle(
      angles2.startAngle,
      angles2.endAngle,
      cw2,
      angles2.middleAngle,
      midAngle1,
    )
  ) {
    const d1 = (m1x - b2x) * (m1x - b2x) + (m1y - b2y) * (m1y - b2y);
    const d2 = (m1x - e2x) * (m1x - e2x) + (m1y - e2y) * (m1y - e2y);
    if (d1 >= epsilonSq && d2 >= epsilonSq) {
      return [m1x, m1y];
    }
  }

  // Check if arc2's middle is in arc1's sweep
  if (
    containsAngle(
      angles1.startAngle,
      angles1.endAngle,
      cw1,
      angles1.middleAngle,
      midAngle2,
    )
  ) {
    const d1 = (m2x - b1x) * (m2x - b1x) + (m2y - b1y) * (m2y - b1y);
    const d2 = (m2x - e1x) * (m2x - e1x) + (m2y - e1y) * (m2y - e1y);
    if (d1 >= epsilonSq && d2 >= epsilonSq) {
      return [m2x, m2y];
    }
  }

  return null;
}

/**
 * Check if two flat arcs represent the same geometric arc (forward or reversed),
 * with a configurable tolerance for floating-point drift.
 *
 * Arc format: [beginX, beginY, midX, midY, endX, endY]
 *
 * Comparison order: midpoints first (arc midpoints are
 * typically not shared between features), then endpoints in forward and
 * reversed directions.
 *
 * @param {Array<number>} a First arc [bx,by,mx,my,ex,ey].
 * @param {Array<number>} b Second arc [bx,by,mx,my,ex,ey].
 * @param {number} [toleranceSq] Squared distance tolerance. Default 1e-4.
 * @return {boolean} True if arcs are geometrically equal.
 */
export function arcsAreEqual(a, b, toleranceSq) {
  if (toleranceSq === undefined) {
    toleranceSq = 1e-4;
  }
  // Midpoints must match (strongest signal)
  const mdx = a[2] - b[2];
  const mdy = a[3] - b[3];
  if (mdx * mdx + mdy * mdy > toleranceSq) {
    return false;
  }
  // Forward: begin=begin, end=end
  const fd1x = a[0] - b[0],
    fd1y = a[1] - b[1];
  const fd2x = a[4] - b[4],
    fd2y = a[5] - b[5];
  if (
    fd1x * fd1x + fd1y * fd1y < toleranceSq &&
    fd2x * fd2x + fd2y * fd2y < toleranceSq
  ) {
    return true;
  }
  // Reverse: begin=end, end=begin
  const rd1x = a[0] - b[4],
    rd1y = a[1] - b[5];
  const rd2x = a[4] - b[0],
    rd2y = a[5] - b[1];
  return (
    rd1x * rd1x + rd1y * rd1y < toleranceSq &&
    rd2x * rd2x + rd2y * rd2y < toleranceSq
  );
}

/**
 * Find all crossing points between two arrays of arcs, optionally skipping
 * pairs that represent the same geometric arc (shared boundary arcs).
 *
 * Arc format: [beginX, beginY, midX, midY, endX, endY]
 *
 * @param {Array<Array<number>>} arcsA First array of arcs.
 * @param {Array<Array<number>>} arcsB Second array of arcs.
 * @param {number} epsilonSq Squared distance threshold for crossing detection.
 * @param {boolean} [skipSameArc] Whether to skip arc pairs that are equal.
 *   Default true.
 * @param {number} [sameArcToleranceSq] Tolerance for arc equality check.
 *   Default 1e-4.
 * @return {Array<Array<number>>} Array of [x, y] crossing points.
 */
export function getArcArrayCrossings(
  arcsA,
  arcsB,
  epsilonSq,
  skipSameArc,
  sameArcToleranceSq,
) {
  if (skipSameArc === undefined) {
    skipSameArc = true;
  }
  const crossings = [];
  for (let i = 0, ii = arcsA.length; i < ii; ++i) {
    const a = arcsA[i];
    for (let j = 0, jj = arcsB.length; j < jj; ++j) {
      const b = arcsB[j];
      if (skipSameArc && arcsAreEqual(a, b, sameArcToleranceSq)) {
        continue;
      }
      const pts = getArcArcCrossingPoints(
        a[0],
        a[1],
        a[2],
        a[3],
        a[4],
        a[5],
        b[0],
        b[1],
        b[2],
        b[3],
        b[4],
        b[5],
        epsilonSq,
      );
      for (let k = 0, kk = pts.length; k < kk; ++k) {
        crossings.push(pts[k]);
      }
    }
  }
  return crossings;
}
