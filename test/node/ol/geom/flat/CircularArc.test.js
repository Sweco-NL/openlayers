import expect from '../../../expect.js';
import {
  CircularArc,
  Vector2,
} from '../../../../../build/ol/geom/flat/CircularArc.js';
import {angleFromOrigin} from '../../../../../src/ol/geom/flat/CircularArc.js';

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
          new Vector2(0, 5)
        );
        expect(topRightArc.angles().startAngle).to.roughlyEqual(0.0, 1e-9);
        expect(topRightArc.angles().middleAngle).to.roughlyEqual(
          Math.PI * 0.25,
          1e-9
        );
        expect(topRightArc.angles().endAngle).to.roughlyEqual(
          Math.PI * 0.5,
          1e-9
        );

        const topLeftArc = new CircularArc(
          new Vector2(0, 5),
          new Vector2(-5, 5).normalized().times(5),
          new Vector2(-5, 0)
        );
        expect(topLeftArc.angles().startAngle).to.roughlyEqual(
          Math.PI * 0.5,
          1e-9
        );
        expect(topLeftArc.angles().middleAngle).to.roughlyEqual(
          Math.PI * 0.75,
          1e-9
        );
        expect(topLeftArc.angles().endAngle).to.roughlyEqual(Math.PI, 1e-9);

        const bottomLeftArc = new CircularArc(
          new Vector2(-5, 0),
          new Vector2(-5, -5).normalized().times(5),
          new Vector2(0, -5)
        );
        expect(bottomLeftArc.angles().startAngle).to.roughlyEqual(
          Math.PI,
          1e-9
        );
        expect(bottomLeftArc.angles().middleAngle).to.roughlyEqual(
          Math.PI + Math.PI * 0.25,
          1e-9
        );
        expect(bottomLeftArc.angles().endAngle).to.roughlyEqual(
          Math.PI + Math.PI * 0.5,
          1e-9
        );

        const bottomRightArc = new CircularArc(
          new Vector2(0, -5),
          new Vector2(5, -5).normalized().times(5),
          new Vector2(5, 0)
        );
        expect(bottomRightArc.angles().startAngle).to.roughlyEqual(
          Math.PI + Math.PI * 0.5,
          1e-9
        );
        expect(bottomRightArc.angles().middleAngle).to.roughlyEqual(
          Math.PI + Math.PI * 0.75,
          1e-9
        );
        expect(bottomRightArc.angles().endAngle).to.roughlyEqual(0.0, 1e-9);
      });
    });
    describe('angleDistance', () => {
      it('returns the expected values in simple cases', () => {
        const arc = new CircularArc(
          new Vector2(5, 0),
          new Vector2(5, 5).normalized().times(5),
          new Vector2(0, 5)
        );
        const angles = arc.angles();

        const startToMiddle = arc.angleDistance(
          angles.startAngle,
          angles.middleAngle
        );
        expect(startToMiddle).to.roughlyEqual(Math.PI * 0.25, 1e-9);

        const middleToEnd = arc.angleDistance(
          angles.middleAngle,
          angles.endAngle
        );
        expect(middleToEnd).to.roughlyEqual(Math.PI * 0.25, 1e-9);

        const startToEnd = arc.angleDistance(
          angles.startAngle,
          angles.endAngle
        );
        expect(startToEnd).to.roughlyEqual(Math.PI * 0.5, 1e-9);

        const endToStart = arc.angleDistance(
          angles.endAngle,
          angles.startAngle
        );
        expect(endToStart).to.roughlyEqual(Math.PI + Math.PI * 0.5, 1e-9);

        const middleToStart = arc.angleDistance(
          angles.middleAngle,
          angles.startAngle
        );
        expect(middleToStart).to.roughlyEqual(Math.PI + Math.PI * 0.75, 1e-9);
      });
    });
    describe('clockwise', () => {
      it('returns the expected values in simple cases', () => {
        const counterClockwiseArc = new CircularArc(
          new Vector2(5, 0),
          new Vector2(5, 5).normalized().times(5),
          new Vector2(0, 5)
        );
        const counterClockwiseAngles = counterClockwiseArc.angles();
        expect(counterClockwiseArc.clockwise(counterClockwiseAngles)).to.equal(
          false
        );

        const clockwiseArc = new CircularArc(
          new Vector2(0, 5),
          new Vector2(5, 5).normalized().times(5),
          new Vector2(5, 0)
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
          new Vector2(0, 5)
        );
        const zeroZero = arcAroundZeroZero.centerOfCircle();
        expect(zeroZero.equals(new Vector2(0, 0))).to.equal(true);

        const arcAroundTwoTwo = new CircularArc(
          new Vector2(7, 2),
          new Vector2(5, 5).normalized().times(5).add(new Vector2(2, 2)),
          new Vector2(2, 7)
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
          new Vector2(0, 5)
        );

        const coords = arc.boundingCoords(
          arc.centerOfCircle(),
          5.0,
          arc.angles().startAngle,
          arc.angles().endAngle,
          arc.clockwise(arc.angles())
        );
        expect(coords.length).to.equal(3);

        const halfCircle = new CircularArc(
          new Vector2(5, -5).normalized().times(5),
          new Vector2(5, 5).normalized().times(5),
          new Vector2(-5, 5).normalized().times(5)
        );
        const halfCircleCoords = halfCircle.boundingCoords(
          halfCircle.centerOfCircle(),
          5.0,
          halfCircle.angles().startAngle,
          halfCircle.angles().endAngle,
          halfCircle.clockwise(halfCircle.angles())
        );
        expect(halfCircleCoords.length).to.equal(4);
      });
    });
  });
});
