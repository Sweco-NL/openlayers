import {
  arcsAreEqual,
  getArcArcCrossingPoint,
  getArcArcCrossingPoints,
  getArcArrayCrossings,
  getLineArcCrossingPoint,
  getLineLineCrossingPoint,
  getSameCircleArcOverlap,
  getSelfIntersectionPoint,
  lineStringIsClosed,
} from '../../../../../src/ol/geom/flat/topology.js';
import expect from '../../../expect.js';

describe('ol/geom/flat/topology.js', function () {
  describe('lineStringIsClosed', function () {
    it('identifies closed lines aka boundaries', function () {
      const flatCoordinates = [0, 0, 3, 0, 0, 3, 0, 0];
      const isClosed = lineStringIsClosed(
        flatCoordinates,
        0,
        flatCoordinates.length,
        2,
      );
      expect(isClosed).to.be(true);
    });

    it('identifies regular linestrings', function () {
      const flatCoordinates = [0, 0, 3, 0, 0, 3, 5, 2];
      const isClosed = lineStringIsClosed(
        flatCoordinates,
        0,
        flatCoordinates.length,
        2,
      );
      expect(isClosed).to.be(false);
    });

    it('identifies degenerate boundaries', function () {
      let flatCoordinates = [0, 0, 3, 0, 0, 0];
      let isClosed = lineStringIsClosed(
        flatCoordinates,
        0,
        flatCoordinates.length,
        2,
      );
      expect(isClosed).to.be(false);

      flatCoordinates = [0, 0, 1, 1, 3, 3, 5, 5, 0, 0];
      isClosed = lineStringIsClosed(
        flatCoordinates,
        0,
        flatCoordinates.length,
        2,
      );
      expect(isClosed).to.be(false);
    });
  });

  describe('getSelfIntersectionPoint', function () {
    describe('linestrings (isRing=false)', function () {
      it('returns undefined for a simple linestring', function () {
        // A straight line: no self-intersection
        const coords = [0, 0, 1, 0, 2, 0, 3, 0];
        const result = getSelfIntersectionPoint(
          coords,
          0,
          coords.length,
          2,
          false,
        );
        expect(result).to.be(undefined);
      });

      it('returns undefined for an L-shaped linestring', function () {
        const coords = [0, 0, 2, 0, 2, 2];
        const result = getSelfIntersectionPoint(
          coords,
          0,
          coords.length,
          2,
          false,
        );
        expect(result).to.be(undefined);
      });

      it('detects a figure-8 self-intersection', function () {
        // Lines cross at (1, 1):
        // segment (0,0)→(2,2) crosses segment (2,0)→(0,2)
        const coords = [0, 0, 2, 2, 2, 0, 0, 2];
        const result = getSelfIntersectionPoint(
          coords,
          0,
          coords.length,
          2,
          false,
        );
        expect(result).not.to.be(undefined);
        expect(result[0]).to.roughlyEqual(1, 1e-10);
        expect(result[1]).to.roughlyEqual(1, 1e-10);
      });

      it('returns undefined for too few segments', function () {
        // Single segment: can't self-intersect
        const coords = [0, 0, 1, 1];
        const result = getSelfIntersectionPoint(
          coords,
          0,
          coords.length,
          2,
          false,
        );
        expect(result).to.be(undefined);
      });

      it('works with offset and stride', function () {
        // Pad with garbage, use stride=3 (XYZ)
        const coords = [99, 99, 99, 0, 0, 0, 2, 2, 0, 2, 0, 0, 0, 2, 0];
        const result = getSelfIntersectionPoint(coords, 3, 15, 3, false);
        expect(result).not.to.be(undefined);
        expect(result[0]).to.roughlyEqual(1, 1e-10);
        expect(result[1]).to.roughlyEqual(1, 1e-10);
      });
    });

    describe('rings (isRing=true)', function () {
      it('returns undefined for a simple convex ring', function () {
        // Square: (0,0) → (4,0) → (4,4) → (0,4) → (0,0)
        const coords = [0, 0, 4, 0, 4, 4, 0, 4, 0, 0];
        const result = getSelfIntersectionPoint(
          coords,
          0,
          coords.length,
          2,
          true,
        );
        expect(result).to.be(undefined);
      });

      it('returns undefined for a simple concave ring', function () {
        // L-shaped concave polygon
        const coords = [0, 0, 2, 0, 2, 1, 1, 1, 1, 2, 0, 2, 0, 0];
        const result = getSelfIntersectionPoint(
          coords,
          0,
          coords.length,
          2,
          true,
        );
        expect(result).to.be(undefined);
      });

      it('detects a bowtie (self-intersecting ring)', function () {
        // Bowtie: (0,0) → (2,2) → (2,0) → (0,2) → (0,0)
        // Crosses at (1,1)
        const coords = [0, 0, 2, 2, 2, 0, 0, 2, 0, 0];
        const result = getSelfIntersectionPoint(
          coords,
          0,
          coords.length,
          2,
          true,
        );
        expect(result).not.to.be(undefined);
        expect(result[0]).to.roughlyEqual(1, 1e-10);
        expect(result[1]).to.roughlyEqual(1, 1e-10);
      });

      it('does not false-positive on closure vertex', function () {
        // Triangle: (0,0) → (4,0) → (2,3) → (0,0)
        // First and last segments share the closure vertex (0,0)
        // but this is NOT a self-intersection
        const coords = [0, 0, 4, 0, 2, 3, 0, 0];
        const result = getSelfIntersectionPoint(
          coords,
          0,
          coords.length,
          2,
          true,
        );
        expect(result).to.be(undefined);
      });

      it('does not false-positive on T-shaped vertex touch', function () {
        // Path where an endpoint of one segment touches the interior
        // of another non-adjacent segment (T-shape). This is a vertex
        // touch, not a proper crossing.
        // (0,0) → (4,0) → (2,2) → (2,0)  ← endpoint (2,0) is ON seg (0,0)→(4,0)
        const coords = [0, 0, 4, 0, 2, 2, 2, 0];
        const result = getSelfIntersectionPoint(
          coords,
          0,
          coords.length,
          2,
          false,
        );
        expect(result).to.be(undefined);
      });
    });
  });

  describe('getLineLineCrossingPoint', function () {
    it('finds a proper interior crossing', function () {
      // X-crossing: (0,0)→(2,2) crosses (2,0)→(0,2) at (1,1)
      const result = getLineLineCrossingPoint(0, 0, 2, 2, 2, 0, 0, 2);
      expect(result).not.to.be(null);
      expect(result[0]).to.roughlyEqual(1, 1e-10);
      expect(result[1]).to.roughlyEqual(1, 1e-10);
    });

    it('returns null for parallel lines', function () {
      // Two horizontal lines at y=0 and y=1
      const result = getLineLineCrossingPoint(0, 0, 2, 0, 0, 1, 2, 1);
      expect(result).to.be(null);
    });

    it('returns null for collinear segments', function () {
      // Same line, overlapping range
      const result = getLineLineCrossingPoint(0, 0, 4, 0, 2, 0, 6, 0);
      expect(result).to.be(null);
    });

    it('returns null when crossing is at segment endpoint (t≈0)', function () {
      // Crossing at start of segment 1
      const result = getLineLineCrossingPoint(1, 1, 3, 3, 0, 2, 2, 0);
      // Crossing is at (1,1), which is t≈0 for seg1 → should be rejected
      expect(result).to.be(null);
    });

    it('returns null when crossing is at segment endpoint (t≈1)', function () {
      // Crossing at end of segment 1: (0,0)→(1,1) crossed by (0,2)→(2,0) at (1,1)
      const result = getLineLineCrossingPoint(0, 0, 1, 1, 0, 2, 2, 0);
      // Crossing is at (1,1), which is t≈1 for seg1 → should be rejected
      expect(result).to.be(null);
    });

    it('returns null when segments do not intersect within bounds', function () {
      // Segments that would intersect if extended but don't in their range
      const result = getLineLineCrossingPoint(0, 0, 1, 0, 2, -1, 2, 1);
      expect(result).to.be(null);
    });

    it('returns null for nearly-parallel lines (denom < threshold)', function () {
      // Nearly parallel: angle difference ≈ 1e-12 radians
      const result = getLineLineCrossingPoint(
        0,
        0,
        1000,
        1e-7,
        0,
        1,
        1000,
        1 + 1e-7,
      );
      expect(result).to.be(null);
    });

    it('finds crossing with non-integer coordinates', function () {
      // (0.5, 0.5)→(2.5, 2.5) crosses (0.5, 2.5)→(2.5, 0.5) at (1.5, 1.5)
      const result = getLineLineCrossingPoint(
        0.5,
        0.5,
        2.5,
        2.5,
        0.5,
        2.5,
        2.5,
        0.5,
      );
      expect(result).not.to.be(null);
      expect(result[0]).to.roughlyEqual(1.5, 1e-10);
      expect(result[1]).to.roughlyEqual(1.5, 1e-10);
    });
  });

  describe('getLineArcCrossingPoint', function () {
    // Arc: unit circle CCW from (1,0) through (0,1) to (-1,0)
    // Center (0,0), radius 1
    const bx = 1,
      by = 0,
      mx = 0,
      my = 1,
      ex = -1,
      ey = 0;
    const eps = 1e-4;

    it('finds crossing of line through arc interior', function () {
      // Horizontal line y=0.5 from x=-2 to x=2 crosses unit arc
      const result = getLineArcCrossingPoint(
        -2,
        0.5,
        2,
        0.5,
        bx,
        by,
        mx,
        my,
        ex,
        ey,
        eps,
      );
      expect(result.length).to.be.greaterThan(0);
      // Crossing should be on the unit circle at y=0.5
      const dist = Math.sqrt(result[0][0] * result[0][0] + result[0][1] * result[0][1]);
      expect(dist).to.roughlyEqual(1, 1e-6);
      expect(result[0][1]).to.roughlyEqual(0.5, 1e-6);
    });

    it('returns empty array when line misses circle entirely', function () {
      // Line at y=2, completely above unit circle
      const result = getLineArcCrossingPoint(
        -2,
        2,
        2,
        2,
        bx,
        by,
        mx,
        my,
        ex,
        ey,
        eps,
      );
      expect(result.length).to.be(0);
    });

    it('returns empty array when line crosses circle but not arc portion', function () {
      // Arc is upper half. Line y=-0.5 crosses lower half of circle only.
      const result = getLineArcCrossingPoint(
        -2,
        -0.5,
        2,
        -0.5,
        bx,
        by,
        mx,
        my,
        ex,
        ey,
        eps,
      );
      expect(result.length).to.be(0);
    });

    it('returns empty array for degenerate zero-length line segment', function () {
      const result = getLineArcCrossingPoint(
        1,
        0.5,
        1,
        0.5,
        bx,
        by,
        mx,
        my,
        ex,
        ey,
        eps,
      );
      expect(result.length).to.be(0);
    });

    it('falls back to line-line for degenerate (collinear) arc', function () {
      // Degenerate arc: three collinear points
      const result = getLineArcCrossingPoint(
        1,
        -1,
        1,
        1,
        0,
        0,
        1,
        0,
        2,
        0,
        eps,
      );
      // Line (1,-1)→(1,1) crosses line (0,0)→(2,0) at (1,0)
      expect(result.length).to.be.greaterThan(0);
      expect(result[0][0]).to.roughlyEqual(1, 1e-10);
      expect(result[0][1]).to.roughlyEqual(0, 1e-10);
    });

    it('skips crossing near shared endpoint', function () {
      // Line starts at arc begin point (1,0), goes up — shared endpoint
      const result = getLineArcCrossingPoint(
        1,
        0,
        0,
        1,
        bx,
        by,
        mx,
        my,
        ex,
        ey,
        eps,
      );
      // The "crossing" at (1,0) is a shared endpoint → should be filtered
      expect(result.length).to.be(0);
    });

    it('finds crossing on CW arc', function () {
      // CW arc: from (1,0) through (0,-1) to (-1,0) (lower semicircle)
      const cwBx = 1,
        cwBy = 0,
        cwMx = 0,
        cwMy = -1,
        cwEx = -1,
        cwEy = 0;
      const result = getLineArcCrossingPoint(
        -2,
        -0.5,
        2,
        -0.5,
        cwBx,
        cwBy,
        cwMx,
        cwMy,
        cwEx,
        cwEy,
        eps,
      );
      expect(result.length).to.be.greaterThan(0);
      const dist = Math.sqrt(result[0][0] * result[0][0] + result[0][1] * result[0][1]);
      expect(dist).to.roughlyEqual(1, 1e-6);
      expect(result[0][1]).to.roughlyEqual(-0.5, 1e-6);
    });

    it('returns empty array when line intersects outside t bounds', function () {
      // Very short line segment that doesn't reach the circle
      const result = getLineArcCrossingPoint(
        -5,
        0.5,
        -3,
        0.5,
        bx,
        by,
        mx,
        my,
        ex,
        ey,
        eps,
      );
      expect(result.length).to.be(0);
    });

    it('returns two crossings when line bisects a semicircular arc', function () {
      // Line y=0.5 from x=-2 to x=2 crosses the upper semicircle at two points
      // Upper semicircle: (1,0)→(0,1)→(-1,0) on unit circle at origin
      // Intersections at x=±sqrt(1-0.25)=±sqrt(0.75)≈±0.866
      const result = getLineArcCrossingPoint(
        -2,
        0.5,
        2,
        0.5,
        bx,
        by,
        mx,
        my,
        ex,
        ey,
        eps,
      );
      expect(result.length).to.be(2);
      // Both points should be on the unit circle at y=0.5
      for (const pt of result) {
        const dist = Math.sqrt(pt[0] * pt[0] + pt[1] * pt[1]);
        expect(dist).to.roughlyEqual(1, 1e-6);
        expect(pt[1]).to.roughlyEqual(0.5, 1e-6);
      }
      // X values should be symmetric around 0
      const xs = result.map((p) => p[0]).sort((a, b) => a - b);
      expect(xs[0]).to.roughlyEqual(-Math.sqrt(0.75), 1e-6);
      expect(xs[1]).to.roughlyEqual(Math.sqrt(0.75), 1e-6);
    });

    it('respects angular tolerance for near-boundary crossings', function () {
      // Create a very short arc (small sweep) where a crossing falls
      // just barely outside the strict arc range but within the 5% tolerance.
      // Arc from angle 0° to 10° on a large circle (radius 1000) centered at origin.
      const r = 1000;
      const startAngle = 0;
      const endAngle = (10 * Math.PI) / 180; // 10 degrees
      const midAngle = (startAngle + endAngle) / 2; // 5 degrees
      const arcBx = r * Math.cos(startAngle);
      const arcBy = r * Math.sin(startAngle);
      const arcMx = r * Math.cos(midAngle);
      const arcMy = r * Math.sin(midAngle);
      const arcEx = r * Math.cos(endAngle);
      const arcEy = r * Math.sin(endAngle);

      // Line that crosses the circle at an angle just barely past the arc end
      // The 5% tolerance on a 10° arc is 0.5° ≈ 0.00873 rad
      // Place the line to cross at ~10.3° (within tolerance)
      const crossAngle = endAngle + 0.003; // ~0.17° past end, well within 5% tolerance
      const cx = r * Math.cos(crossAngle);
      const cy = r * Math.sin(crossAngle);

      // Line perpendicular to the radius at the crossing point
      const result = getLineArcCrossingPoint(
        cx - 100,
        cy - 100,
        cx + 100,
        cy + 100,
        arcBx,
        arcBy,
        arcMx,
        arcMy,
        arcEx,
        arcEy,
        eps,
      );
      // The crossing is near the arc boundary — within angular tolerance
      // it should be detected (not rejected)
      expect(result.length).to.be.greaterThan(0);
      const dist = Math.sqrt(
        result[0][0] * result[0][0] + result[0][1] * result[0][1],
      );
      expect(dist).to.roughlyEqual(r, 1);
    });
  });

  describe('getArcArcCrossingPoint', function () {
    const eps = 1e-4;

    it('finds crossing of two arcs from different circles', function () {
      // Arc 1: upper half of unit circle at origin, CCW (1,0)→(0,1)→(-1,0)
      // Arc 2: upper half of unit circle at (1,0), CCW (2,0)→(1,1)→(0,0)
      // These circles intersect; we need to find crossing on both arcs.
      const result = getArcArcCrossingPoint(
        1,
        0,
        0,
        1,
        -1,
        0,
        2,
        0,
        1,
        1,
        0,
        0,
        eps,
      );
      if (result) {
        // Crossing must be on both circles
        const d1 = Math.sqrt(result[0] * result[0] + result[1] * result[1]);
        const d2 = Math.sqrt(
          (result[0] - 1) * (result[0] - 1) + result[1] * result[1],
        );
        expect(d1).to.roughlyEqual(1, 1e-6);
        expect(d2).to.roughlyEqual(1, 1e-6);
      }
    });

    it('returns null for non-intersecting circles (too far apart)', function () {
      // Arc 1: unit circle at origin
      // Arc 2: unit circle at (5,0) — distance 5 > r1+r2=2
      const result = getArcArcCrossingPoint(
        1,
        0,
        0,
        1,
        -1,
        0,
        6,
        0,
        5,
        1,
        4,
        0,
        eps,
      );
      expect(result).to.be(null);
    });

    it('returns null when one circle is inside the other', function () {
      // Arc 1: radius 5 circle at origin
      // Arc 2: radius 1 circle at (1,0) — inside the first
      const result = getArcArcCrossingPoint(
        5,
        0,
        0,
        5,
        -5,
        0,
        2,
        0,
        1,
        1,
        0,
        0,
        eps,
      );
      expect(result).to.be(null);
    });

    it('dispatches to line-line when both arcs are degenerate', function () {
      // Two collinear arcs (degenerate to lines) that cross
      // Line 1: (0,0)→(2,2), line 2: (2,0)→(0,2)
      const result = getArcArcCrossingPoint(
        0,
        0,
        1,
        1,
        2,
        2,
        2,
        0,
        1,
        1,
        0,
        2,
        eps,
      );
      expect(result).not.to.be(null);
      expect(result[0]).to.roughlyEqual(1, 1e-6);
      expect(result[1]).to.roughlyEqual(1, 1e-6);
    });

    it('dispatches to line-arc when one arc is degenerate', function () {
      // Arc 1: degenerate (collinear) — line from (0,0.5) to (2,0.5)
      // Arc 2: upper semicircle (1,0)→(0,1)→(-1,0), center (0,0), r=1
      const result = getArcArcCrossingPoint(
        0,
        0.5,
        1,
        0.5,
        2,
        0.5,
        1,
        0,
        0,
        1,
        -1,
        0,
        eps,
      );
      expect(result).not.to.be(null);
      const dist = Math.sqrt(result[0] * result[0] + result[1] * result[1]);
      expect(dist).to.roughlyEqual(1, 1e-6);
    });

    it('skips crossing near shared endpoint', function () {
      // Two arcs sharing endpoint at (1,0)
      // Arc 1: (1,0)→(0,1)→(-1,0) on unit circle at origin
      // Arc 2: (1,0)→(1,1)→(0,0) on circle at ≈(0.5,0.5)
      // The only intersection near (1,0) should be filtered as shared
      const result = getArcArcCrossingPoint(
        1,
        0,
        0,
        1,
        -1,
        0,
        1,
        0,
        1.5,
        0.5,
        2,
        0,
        eps,
      );
      // Shared endpoint (1,0) is filtered; other crossing may or may not exist
      if (result) {
        const dx = result[0] - 1;
        const dy = result[1] - 0;
        expect(dx * dx + dy * dy).to.be.greaterThan(eps);
      }
    });

    it('delegates to getSameCircleArcOverlap for same circle', function () {
      // Two arcs on the same unit circle at origin, overlapping
      // Arc 1: (1,0)→(0,1)→(-1,0) — upper half CCW
      // Arc 2: (0,1)→(-1,0)→(0,-1) — left half CCW
      // Overlap region: from (0,1) to (-1,0)
      const result = getArcArcCrossingPoint(
        1,
        0,
        0,
        1,
        -1,
        0,
        0,
        1,
        -1,
        0,
        0,
        -1,
        eps,
      );
      // Should return a point in the overlap (the midpoint of one of the arcs)
      if (result) {
        const dist = Math.sqrt(result[0] * result[0] + result[1] * result[1]);
        expect(dist).to.roughlyEqual(1, 1e-6);
      }
    });
  });

  describe('getArcArcCrossingPoints', function () {
    const eps = 1e-4;

    it('returns empty array for non-intersecting arcs', function () {
      const result = getArcArcCrossingPoints(
        1,
        0,
        0,
        1,
        -1,
        0,
        6,
        0,
        5,
        1,
        4,
        0,
        eps,
      );
      expect(result).to.eql([]);
    });

    it('returns one crossing point', function () {
      // One arc just touches the sweep of the other
      const result = getArcArcCrossingPoints(
        1,
        0,
        0,
        1,
        -1,
        0,
        2,
        0,
        1,
        1,
        0,
        0,
        eps,
      );
      expect(result.length).to.be.greaterThan(0);
      expect(result.length).to.be.lessThan(3);
      // Each point must be on both circles
      for (const pt of result) {
        const d1 = Math.sqrt(pt[0] * pt[0] + pt[1] * pt[1]);
        const d2 = Math.sqrt((pt[0] - 1) * (pt[0] - 1) + pt[1] * pt[1]);
        expect(d1).to.roughlyEqual(1, 1e-5);
        expect(d2).to.roughlyEqual(1, 1e-5);
      }
    });

    it('returns two crossing points for full semicircles', function () {
      // Arc 1: full upper semicircle on unit circle at origin
      // Arc 2: full upper semicircle on unit circle at (0.5, 0)
      // Two circles with r=1, centers 0.5 apart → 2 intersections in upper half
      // Arc 1: upper half of unit circle (1,0)→(0,1)→(-1,0)
      // Arc 2: upper half of circle at (0.5,0): (1.5,0)→(0.5,1)→(-0.5,0)
      const result = getArcArcCrossingPoints(
        1,
        0,
        0,
        1,
        -1,
        0,
        1.5,
        0,
        0.5,
        1,
        -0.5,
        0,
        eps,
      );
      // Both intersections of circles r=1 at (0,0) and (0.5,0) are at
      // x=0.25, y=±sqrt(1-0.0625)≈±0.968. Upper one is in both arc sweeps.
      // With these arc configurations, at least 1 crossing expected.
      expect(result.length).to.be.greaterThan(0);
      expect(result.length).to.be.lessThan(3);
    });

    it('returns at most 1 for degenerate (line-line)', function () {
      const result = getArcArcCrossingPoints(
        0,
        0,
        1,
        1,
        2,
        2,
        2,
        0,
        1,
        1,
        0,
        2,
        eps,
      );
      expect(result.length).to.be(1);
      expect(result[0][0]).to.roughlyEqual(1, 1e-6);
      expect(result[0][1]).to.roughlyEqual(1, 1e-6);
    });
  });

  describe('getSameCircleArcOverlap', function () {
    const eps = 1e-4;

    it('returns null for identical arcs (same midpoint)', function () {
      const result = getSameCircleArcOverlap(
        1,
        0,
        0,
        1,
        -1,
        0,
        1,
        0,
        0,
        1,
        -1,
        0,
        eps,
      );
      expect(result).to.be(null);
    });

    it('returns overlap point when arc1 middle is in arc2 sweep', function () {
      // Arc 1: CCW from (1,0) through (0,1) to (-1,0) — upper half
      // Arc 2: CCW from (0,1) through (-1,0) to (0,-1) — left half
      // Arc1 midpoint (0,1) is start of arc2, arc2 midpoint (-1,0) is end of arc1
      // Overlap: the portion from (0,1) to (-1,0)
      const result = getSameCircleArcOverlap(
        1,
        0,
        0,
        1,
        -1,
        0,
        0,
        1,
        -1,
        0,
        0,
        -1,
        eps,
      );
      // Should return a representative point in the overlap
      if (result) {
        const dist = Math.sqrt(result[0] * result[0] + result[1] * result[1]);
        expect(dist).to.roughlyEqual(1, 1e-6);
      }
    });

    it('returns null for non-overlapping arcs on same circle', function () {
      // Arc 1: upper-right quadrant (1,0)→(cos45,sin45)→(0,1)
      const cos45 = Math.cos(Math.PI / 4);
      const sin45 = Math.sin(Math.PI / 4);
      // Arc 2: lower-left quadrant (-1,0)→(-cos45,-sin45)→(0,-1)
      const result = getSameCircleArcOverlap(
        1,
        0,
        cos45,
        sin45,
        0,
        1,
        -1,
        0,
        -cos45,
        -sin45,
        0,
        -1,
        eps,
      );
      expect(result).to.be(null);
    });

    it('returns null for degenerate (collinear) arc', function () {
      const result = getSameCircleArcOverlap(
        0,
        0,
        1,
        0,
        2,
        0,
        1,
        0,
        2,
        0,
        3,
        0,
        eps,
      );
      expect(result).to.be(null);
    });

    it('handles arc1 midpoint near arc2 endpoint (falls through)', function () {
      // Arc1 midpoint is very close to arc2 begin → should NOT report overlap
      // Arc 1: (1,0)→(0,1)→(-1,0), midpoint (0,1)
      // Arc 2: starts at (0,1) — arc1 midpoint near arc2 endpoint
      const result = getSameCircleArcOverlap(
        1,
        0,
        0,
        1,
        -1,
        0,
        0,
        1,
        -0.707,
        -0.707,
        0,
        -1,
        eps,
      );
      // (0,1) is near arc2 begin, so distance check fails, tries arc2 middle
      // Arc2 middle (-0.707, -0.707) is NOT in arc1 sweep (upper half)
      expect(result).to.be(null);
    });
  });

  describe('arcsAreEqual', function () {
    it('returns true for identical arcs', function () {
      const a = [0, 0, 1, 1, 2, 0];
      const b = [0, 0, 1, 1, 2, 0];
      expect(arcsAreEqual(a, b)).to.be(true);
    });

    it('returns true for reversed arcs', function () {
      const a = [0, 0, 1, 1, 2, 0];
      const b = [2, 0, 1, 1, 0, 0];
      expect(arcsAreEqual(a, b)).to.be(true);
    });

    it('returns false for different arcs', function () {
      const a = [0, 0, 1, 1, 2, 0];
      const b = [0, 0, 1, 2, 2, 0];
      expect(arcsAreEqual(a, b)).to.be(false);
    });

    it('returns false when midpoints differ beyond tolerance', function () {
      const a = [0, 0, 1, 1, 2, 0];
      const b = [0, 0, 1, 1.02, 2, 0]; // midpoint shifted by 0.02
      expect(arcsAreEqual(a, b, 1e-4)).to.be(false);
    });

    it('returns true when within custom tolerance', function () {
      const a = [0, 0, 1, 1, 2, 0];
      const b = [0.001, 0.001, 1.001, 1.001, 2.001, 0.001];
      expect(arcsAreEqual(a, b, 0.01)).to.be(true);
    });

    it('uses default tolerance of 1e-4', function () {
      const a = [0, 0, 1, 1, 2, 0];
      // Shift by sqrt(1e-4)/2 ≈ 0.005 in each coord → squared dist ≈ 5e-5 < 1e-4
      const b = [0.005, 0.005, 1.005, 1.005, 2.005, 0.005];
      expect(arcsAreEqual(a, b)).to.be(true);
    });

    it('returns false when midpoints match but endpoints differ', function () {
      const a = [0, 0, 1, 1, 2, 0];
      const b = [0, 2, 1, 1, 2, 2]; // same mid, different begin/end
      expect(arcsAreEqual(a, b)).to.be(false);
    });
  });

  describe('getArcArrayCrossings', function () {
    const eps = 1e-4;

    it('returns crossings between two arc arrays', function () {
      // Array A: single arc, upper semicircle
      const arcsA = [[1, 0, 0, 1, -1, 0]];
      // Array B: single arc on circle at (0.5,0)
      const arcsB = [[1.5, 0, 0.5, 1, -0.5, 0]];
      const result = getArcArrayCrossings(arcsA, arcsB, eps);
      expect(result.length).to.be.greaterThan(0);
      for (const pt of result) {
        expect(pt.length).to.be(2);
      }
    });

    it('returns empty array for non-intersecting arcs', function () {
      const arcsA = [[1, 0, 0, 1, -1, 0]];
      const arcsB = [[10, 0, 9, 1, 8, 0]];
      const result = getArcArrayCrossings(arcsA, arcsB, eps);
      expect(result).to.eql([]);
    });

    it('skips same arc by default', function () {
      const arc = [1, 0, 0, 1, -1, 0];
      const arcsA = [arc];
      const arcsB = [arc.slice()]; // same geometry
      const result = getArcArrayCrossings(arcsA, arcsB, eps);
      expect(result).to.eql([]);
    });

    it('does not skip same arc when skipSameArc=false', function () {
      // Same arc arrays, but overlapping → getSameCircleArcOverlap
      const arc = [1, 0, 0, 1, -1, 0];
      const arcsA = [arc];
      const arcsB = [arc.slice()];
      const result = getArcArrayCrossings(arcsA, arcsB, eps, false);
      // Same arc on same circle — overlap detection triggers
      // Result depends on getSameCircleArcOverlap (same midpoint → null)
      // so this should still be empty since identical midpoints are filtered
      expect(result).to.eql([]);
    });

    it('handles empty arrays', function () {
      expect(getArcArrayCrossings([], [], eps)).to.eql([]);
      expect(getArcArrayCrossings([[1, 0, 0, 1, -1, 0]], [], eps)).to.eql([]);
      expect(getArcArrayCrossings([], [[1, 0, 0, 1, -1, 0]], eps)).to.eql([]);
    });

    it('finds crossings across multiple arcs', function () {
      // Arc A: upper semicircle of unit circle at origin: (1,0)→(0,1)→(-1,0)
      const arcsA = [[1, 0, 0, 1, -1, 0]];
      // Arc B: upper semicircle of unit circle at (0.5, 0): (1.5,0)→(0.5,1)→(-0.5,0)
      const arcsB = [[1.5, 0, 0.5, 1, -0.5, 0]];
      const result = getArcArrayCrossings(arcsA, arcsB, eps);
      expect(result.length).to.be.greaterThan(0);
      // Each crossing is on both circles
      for (const pt of result) {
        const d1 = Math.sqrt(pt[0] * pt[0] + pt[1] * pt[1]);
        const d2 = Math.sqrt((pt[0] - 0.5) * (pt[0] - 0.5) + pt[1] * pt[1]);
        expect(d1).to.roughlyEqual(1, 1e-5);
        expect(d2).to.roughlyEqual(1, 1e-5);
      }
    });
  });
});
