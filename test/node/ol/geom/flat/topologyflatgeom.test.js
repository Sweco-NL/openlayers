import {
  lineStringIsClosed,
  getSelfIntersectionPoint,
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
});
