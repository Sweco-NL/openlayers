import {
  CircularArc,
  Vector2,
  angleFromOrigin,
  lineStringToDegenerateArcs,
} from '../../../../../src/ol/geom/flat/CircularArc.js';
import expect from '../../../expect.js';

describe('ol/geom/flat/CircularArc.test.js', () => {
  describe('angleFromOrigin', () => {
    it('returns the expected value in simple cases', () => {
      const zeroDeg = angleFromOrigin(new Vector2(0, 0), new Vector2(5, 0));
      expect(zeroDeg).to.roughlyEqual(0.0, 1e-9);
      const ccw45deg = angleFromOrigin(new Vector2(0, 0), new Vector2(5, 5));
      expect(ccw45deg).to.roughlyEqual(Math.PI * 0.25, 1e-9);
      const ccw90deg = angleFromOrigin(new Vector2(0, 0), new Vector2(0, 5));
      expect(ccw90deg).to.roughlyEqual(Math.PI * 0.5, 1e-9);
      const ccw180deg = angleFromOrigin(new Vector2(0, 0), new Vector2(-5, 0));
      expect(ccw180deg).to.roughlyEqual(Math.PI, 1e-9);
      const ccw225deg = angleFromOrigin(new Vector2(0, 0), new Vector2(-5, -5));
      expect(ccw225deg).to.roughlyEqual(Math.PI + 0.25 * Math.PI, 1e-9);
      const ccw270deg = angleFromOrigin(new Vector2(0, 0), new Vector2(0, -5));
      expect(ccw270deg).to.roughlyEqual(Math.PI + 0.5 * Math.PI, 1e-9);
      const ccw315deg = angleFromOrigin(new Vector2(0, 0), new Vector2(5, -5));
      expect(ccw315deg).to.roughlyEqual(Math.PI + 0.75 * Math.PI, 1e-9);
    });
  });

  describe('CircularArc', () => {
    describe('angles', () => {
      it('returns the expected values in simple cases', () => {
        const topRightArc = new CircularArc(
          new Vector2(5, 0),
          new Vector2(5, 5).normalized().times(5),
          new Vector2(0, 5),
        );
        expect(topRightArc.angles().startAngle).to.roughlyEqual(0.0, 1e-9);
        expect(topRightArc.angles().middleAngle).to.roughlyEqual(
          Math.PI * 0.25,
          1e-9,
        );
        expect(topRightArc.angles().endAngle).to.roughlyEqual(
          Math.PI * 0.5,
          1e-9,
        );

        const topLeftArc = new CircularArc(
          new Vector2(0, 5),
          new Vector2(-5, 5).normalized().times(5),
          new Vector2(-5, 0),
        );
        expect(topLeftArc.angles().startAngle).to.roughlyEqual(
          Math.PI * 0.5,
          1e-9,
        );
        expect(topLeftArc.angles().middleAngle).to.roughlyEqual(
          Math.PI * 0.75,
          1e-9,
        );
        expect(topLeftArc.angles().endAngle).to.roughlyEqual(Math.PI, 1e-9);

        const bottomLeftArc = new CircularArc(
          new Vector2(-5, 0),
          new Vector2(-5, -5).normalized().times(5),
          new Vector2(0, -5),
        );
        expect(bottomLeftArc.angles().startAngle).to.roughlyEqual(
          Math.PI,
          1e-9,
        );
        expect(bottomLeftArc.angles().middleAngle).to.roughlyEqual(
          Math.PI + Math.PI * 0.25,
          1e-9,
        );
        expect(bottomLeftArc.angles().endAngle).to.roughlyEqual(
          Math.PI + Math.PI * 0.5,
          1e-9,
        );

        const bottomRightArc = new CircularArc(
          new Vector2(0, -5),
          new Vector2(5, -5).normalized().times(5),
          new Vector2(5, 0),
        );
        expect(bottomRightArc.angles().startAngle).to.roughlyEqual(
          Math.PI + Math.PI * 0.5,
          1e-9,
        );
        expect(bottomRightArc.angles().middleAngle).to.roughlyEqual(
          Math.PI + Math.PI * 0.75,
          1e-9,
        );
        expect(bottomRightArc.angles().endAngle).to.roughlyEqual(0.0, 1e-9);
      });
    });
    describe('angleDistance', () => {
      it('returns the expected values in simple cases', () => {
        const arc = new CircularArc(
          new Vector2(5, 0),
          new Vector2(5, 5).normalized().times(5),
          new Vector2(0, 5),
        );
        const angles = arc.angles();

        const startToMiddle = arc.angleDistance(
          angles.startAngle,
          angles.middleAngle,
        );
        expect(startToMiddle).to.roughlyEqual(Math.PI * 0.25, 1e-9);

        const middleToEnd = arc.angleDistance(
          angles.middleAngle,
          angles.endAngle,
        );
        expect(middleToEnd).to.roughlyEqual(Math.PI * 0.25, 1e-9);

        const startToEnd = arc.angleDistance(
          angles.startAngle,
          angles.endAngle,
        );
        expect(startToEnd).to.roughlyEqual(Math.PI * 0.5, 1e-9);

        const endToStart = arc.angleDistance(
          angles.endAngle,
          angles.startAngle,
        );
        expect(endToStart).to.roughlyEqual(Math.PI + Math.PI * 0.5, 1e-9);

        const middleToStart = arc.angleDistance(
          angles.middleAngle,
          angles.startAngle,
        );
        expect(middleToStart).to.roughlyEqual(Math.PI + Math.PI * 0.75, 1e-9);
      });
    });
    describe('clockwise', () => {
      it('returns the expected values in simple cases', () => {
        const counterClockwiseArc = new CircularArc(
          new Vector2(5, 0),
          new Vector2(5, 5).normalized().times(5),
          new Vector2(0, 5),
        );
        const counterClockwiseAngles = counterClockwiseArc.angles();
        expect(counterClockwiseArc.clockwise(counterClockwiseAngles)).to.equal(
          false,
        );

        const clockwiseArc = new CircularArc(
          new Vector2(0, 5),
          new Vector2(5, 5).normalized().times(5),
          new Vector2(5, 0),
        );
        const clockwiseAngles = clockwiseArc.angles();
        expect(clockwiseArc.clockwise(clockwiseAngles)).to.equal(true);
      });
    });
    describe('centerOfCircle', () => {
      it('returns the expected values in simple cases', () => {
        const arcAroundZeroZero = new CircularArc(
          new Vector2(5, 0),
          new Vector2(5, 5).normalized().times(5),
          new Vector2(0, 5),
        );
        const zeroZero = arcAroundZeroZero.centerOfCircle();
        expect(zeroZero.equals(new Vector2(0, 0))).to.equal(true);

        const arcAroundTwoTwo = new CircularArc(
          new Vector2(7, 2),
          new Vector2(5, 5).normalized().times(5).add(new Vector2(2, 2)),
          new Vector2(2, 7),
        );
        const twoTwo = arcAroundTwoTwo.centerOfCircle();
        expect(twoTwo.equals(new Vector2(2, 2))).to.equal(true);
      });
    });
    describe('boundingCoords', () => {
      it('returns the expected amount of coordinates in simple cases', () => {
        const arc = new CircularArc(
          new Vector2(5, 0),
          new Vector2(5, 5).normalized().times(5),
          new Vector2(0, 5),
        );

        const coords = arc.boundingCoords(
          arc.centerOfCircle(),
          5.0,
          arc.angles().startAngle,
          arc.angles().endAngle,
          arc.clockwise(arc.angles()),
        );
        expect(coords.length).to.equal(3);

        const halfCircle = new CircularArc(
          new Vector2(5, -5).normalized().times(5),
          new Vector2(5, 5).normalized().times(5),
          new Vector2(-5, 5).normalized().times(5),
        );
        const halfCircleCoords = halfCircle.boundingCoords(
          halfCircle.centerOfCircle(),
          5.0,
          halfCircle.angles().startAngle,
          halfCircle.angles().endAngle,
          halfCircle.clockwise(halfCircle.angles()),
        );
        expect(halfCircleCoords.length).to.equal(4);
      });
    });
  });

  describe('centerOfCircle', () => {
    it('returns null for coincident begin and middle', () => {
      const arc = new CircularArc(
        new Vector2(5, 5),
        new Vector2(5, 5),
        new Vector2(10, 0),
      );
      expect(arc.centerOfCircle()).to.be(null);
    });

    it('returns null for coincident middle and end', () => {
      const arc = new CircularArc(
        new Vector2(0, 0),
        new Vector2(10, 0),
        new Vector2(10, 0),
      );
      expect(arc.centerOfCircle()).to.be(null);
    });

    it('returns null for collinear points', () => {
      const arc = new CircularArc(
        new Vector2(0, 0),
        new Vector2(5, 0),
        new Vector2(10, 0),
      );
      expect(arc.centerOfCircle()).to.be(null);
    });
  });

  describe('fullCircle', () => {
    it('returns false when begin and end are close but not equal', () => {
      const arc = new CircularArc(
        new Vector2(5, 0),
        new Vector2(-5, 0),
        new Vector2(5, 0.001),
      );
      expect(arc.fullCircle()).to.be(false);
    });

    it('returns true when begin equals end', () => {
      const arc = new CircularArc(
        new Vector2(5, 0),
        new Vector2(-5, 0),
        new Vector2(5, 0),
      );
      expect(arc.fullCircle()).to.be(true);
    });
  });

  describe('Vector2 math', function () {
    it('add combines components', function () {
      const a = new Vector2(1, 2);
      const b = new Vector2(3, 4);
      const c = a.add(b);
      expect(c.x).to.be(4);
      expect(c.y).to.be(6);
    });

    it('subtract computes difference', function () {
      const a = new Vector2(5, 7);
      const b = new Vector2(2, 3);
      const c = a.subtract(b);
      expect(c.x).to.be(3);
      expect(c.y).to.be(4);
    });

    it('times scales components', function () {
      const a = new Vector2(3, 4);
      const b = a.times(2);
      expect(b.x).to.be(6);
      expect(b.y).to.be(8);
    });

    it('magnitude of (3,4) is 5', function () {
      const v = new Vector2(3, 4);
      expect(v.magnitude()).to.roughlyEqual(5, 1e-9);
    });

    it('normalized has magnitude 1', function () {
      const v = new Vector2(3, 4);
      const n = v.normalized();
      expect(n.magnitude()).to.roughlyEqual(1, 1e-9);
    });

    it('rotated90ClockWise rotates correctly', function () {
      const v = new Vector2(0, 1);
      const r = v.rotated90ClockWise();
      expect(r.x).to.roughlyEqual(-1, 1e-9);
      expect(r.y).to.roughlyEqual(0, 1e-9);
    });
  });

  describe('CircularArc exact values', function () {
    it('radius of unit semicircle is 1', function () {
      const arc = new CircularArc(
        new Vector2(1, 0),
        new Vector2(0, 1),
        new Vector2(-1, 0),
      );
      const center = arc.centerOfCircle();
      expect(arc.radius(center)).to.roughlyEqual(1, 1e-9);
    });

    it('radius of large arc matches', function () {
      const arc = new CircularArc(
        new Vector2(10, 0),
        new Vector2(0, 10),
        new Vector2(-10, 0),
      );
      const center = arc.centerOfCircle();
      expect(arc.radius(center)).to.roughlyEqual(10, 1e-9);
    });
  });

  describe('splitAtAngle', function () {
    it('splits a CCW quarter-arc at the midpoint', function () {
      // CCW arc from (5,0) to (0,5) around origin, radius 5
      const R = 5;
      const arc = new CircularArc(
        new Vector2(R, 0),
        new Vector2(R, R).normalized().times(R),
        new Vector2(0, R),
      );
      const center = arc.centerOfCircle();
      expect(center.x).to.roughlyEqual(0, 1e-6);
      expect(center.y).to.roughlyEqual(0, 1e-6);

      // Split at 22.5° (π/8) — halfway through the 0→90° arc
      const splitAngle = Math.PI / 8;
      const [before, after] = arc.splitAtAngle(splitAngle, center);

      expect(before).not.to.be(null);
      expect(after).not.to.be(null);

      // Split point should be on the circle at splitAngle
      const splitPt = before.end;
      expect(splitPt.distance(after.begin)).to.be.lessThan(1e-9);
      expect(splitPt.x).to.roughlyEqual(R * Math.cos(splitAngle), 1e-9);
      expect(splitPt.y).to.roughlyEqual(R * Math.sin(splitAngle), 1e-9);

      // Both sub-arcs share center and radius
      const c1 = before.centerOfCircle();
      const c2 = after.centerOfCircle();
      expect(before.radius(c1)).to.roughlyEqual(R, 1e-6);
      expect(after.radius(c2)).to.roughlyEqual(R, 1e-6);

      // Begin/end preserved exactly
      expect(before.begin.x).to.roughlyEqual(R, 1e-9);
      expect(before.begin.y).to.roughlyEqual(0, 1e-9);
      expect(after.end.x).to.roughlyEqual(0, 1e-9);
      expect(after.end.y).to.roughlyEqual(R, 1e-9);

      // Both sub-arcs should be CCW (same direction as original)
      expect(before.clockwise()).to.be(false);
      expect(after.clockwise()).to.be(false);
    });

    it('splits a CW semicircle', function () {
      // CW arc from (0,5) to (5,0) around origin — going clockwise
      const R = 5;
      const mid45 = new Vector2(R, R).normalized().times(R);
      const arc = new CircularArc(
        new Vector2(0, R),
        mid45,
        new Vector2(R, 0),
      );
      expect(arc.clockwise()).to.be(true);
      const center = arc.centerOfCircle();

      // Split at 60° (π/3) — inside the arc range
      const splitAngle = Math.PI / 3;
      const [before, after] = arc.splitAtAngle(splitAngle, center);

      expect(before).not.to.be(null);
      expect(after).not.to.be(null);

      // Both sub-arcs should be CW
      expect(before.clockwise()).to.be(true);
      expect(after.clockwise()).to.be(true);

      // Split point on the circle
      expect(before.end.x).to.roughlyEqual(R * Math.cos(splitAngle), 1e-9);
      expect(before.end.y).to.roughlyEqual(R * Math.sin(splitAngle), 1e-9);

      // Endpoints preserved
      expect(before.begin.x).to.roughlyEqual(0, 1e-9);
      expect(before.begin.y).to.roughlyEqual(R, 1e-9);
      expect(after.end.x).to.roughlyEqual(R, 1e-9);
      expect(after.end.y).to.roughlyEqual(0, 1e-9);
    });

    it('returns [null, arc] when split at start angle', function () {
      const R = 5;
      const arc = new CircularArc(
        new Vector2(R, 0),
        new Vector2(0, R),
        new Vector2(-R, 0),
      );
      const center = arc.centerOfCircle();
      const startAngle = arc.angles(center).startAngle;
      const [before, after] = arc.splitAtAngle(startAngle, center);
      expect(before).to.be(null);
      expect(after).to.be(arc);
    });

    it('returns [arc, null] when split at end angle', function () {
      const R = 5;
      const arc = new CircularArc(
        new Vector2(R, 0),
        new Vector2(0, R),
        new Vector2(-R, 0),
      );
      const center = arc.centerOfCircle();
      const endAngle = arc.angles(center).endAngle;
      const [before, after] = arc.splitAtAngle(endAngle, center);
      expect(before).to.be(arc);
      expect(after).to.be(null);
    });

    it('handles split without explicit center', function () {
      const R = 10;
      const arc = new CircularArc(
        new Vector2(R, 0),
        new Vector2(R, R).normalized().times(R),
        new Vector2(0, R),
      );
      // no center argument — should compute internally
      const [before, after] = arc.splitAtAngle(Math.PI / 4);
      expect(before).not.to.be(null);
      expect(after).not.to.be(null);
      expect(before.end.distance(after.begin)).to.be.lessThan(1e-9);
    });
  });

  describe('isNearEndpoint', function () {
    const arc = new CircularArc(
      new Vector2(0, 0),
      new Vector2(1, 1),
      new Vector2(2, 0),
    );

    it('returns true for point at begin', function () {
      expect(arc.isNearEndpoint(new Vector2(0, 0), 4)).to.be(true);
    });

    it('returns true for point at end', function () {
      expect(arc.isNearEndpoint(new Vector2(2, 0), 4)).to.be(true);
    });

    it('returns true for point near begin within epsilon', function () {
      expect(arc.isNearEndpoint(new Vector2(0.5, 0), 4)).to.be(true);
    });

    it('returns false for point far from endpoints', function () {
      expect(arc.isNearEndpoint(new Vector2(1, 1), 0.5)).to.be(false);
    });

    it('respects epsilon parameter', function () {
      // distance² from (1.5,0) to (0,0) = 2.25, to (2,0) = 0.25
      expect(arc.isNearEndpoint(new Vector2(1.5, 0), 4)).to.be(true);
      expect(arc.isNearEndpoint(new Vector2(1.5, 0), 0.01)).to.be(false);
    });
  });

  describe('containsAngle', function () {
    const arc = new CircularArc(
      new Vector2(1, 0),
      new Vector2(0, 1),
      new Vector2(-1, 0),
    );
    const center = arc.centerOfCircle();

    it('returns true for angle within arc sweep', function () {
      expect(arc.containsAngle(Math.PI / 2, center)).to.be(true);
    });

    it('returns false for angle outside arc sweep', function () {
      expect(arc.containsAngle((3 * Math.PI) / 2, center)).to.be(false);
    });

    it('returns true for start angle', function () {
      expect(arc.containsAngle(0, center)).to.be(true);
    });

    it('returns true for end angle', function () {
      expect(arc.containsAngle(Math.PI, center)).to.be(true);
    });
  });

  describe('isSameArc', function () {
    it('returns true for identical arcs', function () {
      const a = new CircularArc(
        new Vector2(0, 0),
        new Vector2(1, 1),
        new Vector2(2, 0),
      );
      const b = new CircularArc(
        new Vector2(0, 0),
        new Vector2(1, 1),
        new Vector2(2, 0),
      );
      expect(a.isSameArc(b)).to.be(true);
    });

    it('returns true for reversed arcs', function () {
      const a = new CircularArc(
        new Vector2(0, 0),
        new Vector2(1, 1),
        new Vector2(2, 0),
      );
      const b = new CircularArc(
        new Vector2(2, 0),
        new Vector2(1, 1),
        new Vector2(0, 0),
      );
      expect(a.isSameArc(b)).to.be(true);
    });

    it('returns false for different arcs', function () {
      const a = new CircularArc(
        new Vector2(0, 0),
        new Vector2(1, 1),
        new Vector2(2, 0),
      );
      const b = new CircularArc(
        new Vector2(3, 0),
        new Vector2(4, 1),
        new Vector2(5, 0),
      );
      expect(a.isSameArc(b)).to.be(false);
    });

    it('returns true when midpoints match and one endpoint matches', function () {
      const a = new CircularArc(
        new Vector2(0, 0),
        new Vector2(1, 1),
        new Vector2(2, 0),
      );
      const b = new CircularArc(
        new Vector2(0, 0),
        new Vector2(1, 1),
        new Vector2(2.0000001, 0.0000001),
      );
      expect(a.isSameArc(b)).to.be(true);
    });
  });

  describe('lineStringToDegenerateArcs', function () {
    it('creates degenerate arcs from coordinate pairs', function () {
      const coords = [
        [0, 0],
        [1, 0],
        [1, 1],
      ];
      const arcs = lineStringToDegenerateArcs(coords);
      expect(arcs.length).to.be(2);
      expect(arcs[0].middle.x).to.be(0.5);
      expect(arcs[0].middle.y).to.be(0);
      expect(arcs[1].middle.x).to.be(1);
      expect(arcs[1].middle.y).to.be(0.5);
    });

    it('returns empty for single point', function () {
      const arcs = lineStringToDegenerateArcs([[0, 0]]);
      expect(arcs.length).to.be(0);
    });

    it('returns empty for empty array', function () {
      const arcs = lineStringToDegenerateArcs([]);
      expect(arcs.length).to.be(0);
    });
  });
});
