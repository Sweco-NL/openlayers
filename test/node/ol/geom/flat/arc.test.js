import {
  angleFromOrigin,
  angleDistance,
  containsAngle,
  getCircleCenter,
  getArcRadius,
  getArcAngles,
  isArcClockwise,
  isFullCircle,
  splitArcAtAngle,
  getArcBoundingCoords,
} from '../../../../../src/ol/geom/flat/arc.js';
import expect from '../../../expect.js';

describe('ol/geom/flat/arc.js', () => {
  describe('angleFromOrigin', () => {
    it('returns the expected value in simple cases', () => {
      expect(angleFromOrigin(0, 0, 5, 0)).to.roughlyEqual(0.0, 1e-9);
      expect(angleFromOrigin(0, 0, 5, 5)).to.roughlyEqual(
        Math.PI * 0.25,
        1e-9,
      );
      expect(angleFromOrigin(0, 0, 0, 5)).to.roughlyEqual(
        Math.PI * 0.5,
        1e-9,
      );
      expect(angleFromOrigin(0, 0, -5, 0)).to.roughlyEqual(Math.PI, 1e-9);
      expect(angleFromOrigin(0, 0, -5, -5)).to.roughlyEqual(
        Math.PI * 1.25,
        1e-9,
      );
      expect(angleFromOrigin(0, 0, 0, -5)).to.roughlyEqual(
        Math.PI * 1.5,
        1e-9,
      );
      expect(angleFromOrigin(0, 0, 5, -5)).to.roughlyEqual(
        Math.PI * 1.75,
        1e-9,
      );
    });

    it('works with non-zero origin', () => {
      expect(angleFromOrigin(3, 4, 8, 4)).to.roughlyEqual(0.0, 1e-9);
      expect(angleFromOrigin(3, 4, 3, 9)).to.roughlyEqual(
        Math.PI * 0.5,
        1e-9,
      );
    });
  });

  describe('angleDistance', () => {
    it('returns CCW distance between angles', () => {
      expect(angleDistance(0, Math.PI)).to.roughlyEqual(Math.PI, 1e-9);
      expect(angleDistance(Math.PI, 0)).to.roughlyEqual(Math.PI, 1e-9);
      expect(angleDistance(0, Math.PI * 0.5)).to.roughlyEqual(
        Math.PI * 0.5,
        1e-9,
      );
    });

    it('wraps around correctly', () => {
      expect(angleDistance(Math.PI * 1.75, Math.PI * 0.25)).to.roughlyEqual(
        Math.PI * 0.5,
        1e-9,
      );
    });
  });

  describe('getCircleCenter', () => {
    it('computes center for a simple arc', () => {
      // Arc through (0,0), (1,1), (2,0) — center should be at (1, 0)
      const center = getCircleCenter(0, 0, 1, 1, 2, 0);
      expect(center).not.to.be(null);
      expect(center[0]).to.roughlyEqual(1, 1e-6);
      expect(center[1]).to.roughlyEqual(0, 1e-6);
    });

    it('computes center for unit circle arc', () => {
      // Points on unit circle: (1,0), (0,1), (-1,0)
      const center = getCircleCenter(1, 0, 0, 1, -1, 0);
      expect(center).not.to.be(null);
      expect(center[0]).to.roughlyEqual(0, 1e-6);
      expect(center[1]).to.roughlyEqual(0, 1e-6);
    });

    it('returns null for collinear points', () => {
      const center = getCircleCenter(0, 0, 1, 1, 2, 2);
      expect(center).to.be(null);
    });

    it('returns null for coincident points', () => {
      const center = getCircleCenter(1, 1, 1, 1, 2, 0);
      expect(center).to.be(null);
    });

    it('handles full circle (begin == end)', () => {
      // Full circle: begin=end=(1,0), middle=(0,1)
      const center = getCircleCenter(1, 0, 0, 1, 1, 0);
      expect(center).not.to.be(null);
      expect(center[0]).to.roughlyEqual(0.5, 1e-6);
      expect(center[1]).to.roughlyEqual(0.5, 1e-6);
    });
  });

  describe('getArcRadius', () => {
    it('computes radius from center and point', () => {
      expect(getArcRadius(0, 0, 5, 0)).to.roughlyEqual(5, 1e-9);
      expect(getArcRadius(1, 1, 4, 5)).to.roughlyEqual(5, 1e-9);
    });
  });

  describe('getArcAngles', () => {
    it('computes angles for a CCW arc', () => {
      // Arc through (1,0), (0,1), (-1,0) on unit circle centered at (0,0)
      const angles = getArcAngles(0, 0, 1, 0, 0, 1, -1, 0);
      expect(angles.startAngle).to.roughlyEqual(0, 1e-9);
      expect(angles.middleAngle).to.roughlyEqual(Math.PI / 2, 1e-9);
      expect(angles.endAngle).to.roughlyEqual(Math.PI, 1e-9);
    });

    it('returns fixed angles for full circle', () => {
      const angles = getArcAngles(0, 0, 1, 0, 0, 1, 1, 0);
      expect(angles.startAngle).to.be(0);
      expect(angles.middleAngle).to.be(Math.PI);
      expect(angles.endAngle).to.be(2 * Math.PI);
    });
  });

  describe('isArcClockwise', () => {
    it('detects CW arc', () => {
      // (0,0) → (1,1) → (2,0): cross product < 0 → CW
      // (middle above chord → arc traces upper semicircle CW from left to right)
      expect(isArcClockwise(0, 0, 1, 1, 2, 0)).to.be(true);
    });

    it('detects CCW arc', () => {
      // (0,0) → (1,-1) → (2,0): cross product > 0 → CCW
      // (middle below chord → arc traces lower semicircle CCW)
      expect(isArcClockwise(0, 0, 1, -1, 2, 0)).to.be(false);
    });
  });

  describe('isFullCircle', () => {
    it('returns true when begin equals end', () => {
      expect(isFullCircle(5, 3, 5, 3)).to.be(true);
    });

    it('returns false when begin differs from end', () => {
      expect(isFullCircle(0, 0, 2, 0)).to.be(false);
    });

    it('returns true within tolerance', () => {
      expect(isFullCircle(5, 3, 5 + 1e-7, 3 - 1e-7)).to.be(true);
    });
  });

  describe('containsAngle', () => {
    it('detects angle within CCW arc sweep', () => {
      // CCW arc from 0 to π, middle at π/2
      expect(containsAngle(0, Math.PI, false, Math.PI / 2, Math.PI / 4)).to.be(
        true,
      );
    });

    it('detects angle outside CCW arc sweep', () => {
      expect(
        containsAngle(0, Math.PI, false, Math.PI / 2, Math.PI * 1.5),
      ).to.be(false);
    });

    it('detects angle within CW arc sweep', () => {
      // CW arc from π/2 to 0, middle at π/4
      // Test angle π/8 should be within the sweep
      expect(
        containsAngle(Math.PI / 2, 0, true, Math.PI / 4, Math.PI / 8),
      ).to.be(true);
    });

    it('detects angle outside CW arc sweep', () => {
      // CW arc from π/2 to 0, middle at π/4
      // Test angle 3π/4 should be outside the sweep
      expect(
        containsAngle(Math.PI / 2, 0, true, Math.PI / 4, (Math.PI * 3) / 4),
      ).to.be(false);
    });
  });

  describe('splitArcAtAngle', () => {
    it('splits a CCW arc into two sub-arcs', () => {
      // Arc on unit circle: (1,0) → (0,1) → (-1,0), center at (0,0)
      const result = splitArcAtAngle(1, 0, 0, 1, -1, 0, 0, 0, Math.PI / 2);
      // Split at 90° (which is the middle point itself)
      // The split point should be at (0,1)
      expect(result).not.to.be(null);
      expect(result[4]).to.roughlyEqual(0, 1e-6); // split x
      expect(result[5]).to.roughlyEqual(1, 1e-6); // split y
    });

    it('returns null when split angle coincides with start', () => {
      const result = splitArcAtAngle(1, 0, 0, 1, -1, 0, 0, 0, 0);
      expect(result).to.be(null);
    });

    it('returns null when split angle coincides with end', () => {
      const result = splitArcAtAngle(1, 0, 0, 1, -1, 0, 0, 0, Math.PI);
      expect(result).to.be(null);
    });

    it('produces valid sub-arcs for CW arc', () => {
      // CW arc: (1,0) → (0,-1) → (-1,0), center at (0,0)
      const result = splitArcAtAngle(
        1,
        0,
        0,
        -1,
        -1,
        0,
        0,
        0,
        Math.PI * 1.5,
      );
      expect(result).not.to.be(null);
      // Split point at 270° = (0, -1)
      expect(result[4]).to.roughlyEqual(0, 1e-6);
      expect(result[5]).to.roughlyEqual(-1, 1e-6);
    });
  });

  describe('getArcBoundingCoords', () => {
    it('returns all four extremes for a full circle', () => {
      // Full circle on unit circle, center at (0,0)
      const coords = getArcBoundingCoords(1, 0, 0, 1, 1, 0, 0, 0);
      // Should contain top, right, bottom, left extremes
      expect(coords.length).to.be(8); // 4 points × 2 coords
    });

    it('includes endpoints and relevant extremes', () => {
      // CCW arc from (1,0) to (0,1) on unit circle — passes through 45°
      // Only the right extreme (1,0) and top extreme (0,1) should be relevant
      // but those ARE the endpoints, so no extras
      const coords = getArcBoundingCoords(1, 0, 0.7071, 0.7071, 0, 1, 0, 0);
      // Should include at least the endpoints
      expect(coords.length).to.be.greaterThan(2);
      // First two values are begin point
      expect(coords[0]).to.roughlyEqual(1, 1e-6);
      expect(coords[1]).to.roughlyEqual(0, 1e-6);
    });

    it('includes axis extremes that fall within arc sweep', () => {
      // CCW arc from (1,0) to (-1,0) going through (0,1) — sweeps 180°
      // Should include the top extreme (0,1)
      const coords = getArcBoundingCoords(1, 0, 0, 1, -1, 0, 0, 0);
      // Endpoints: (1,0), (-1,0) + top extreme (0,1)
      expect(coords.length).to.be(6); // 3 points × 2 coords
    });
  });
});
