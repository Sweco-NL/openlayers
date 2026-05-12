import {isEmpty} from '../../../../src/ol/extent.js';
import CircularString from '../../../../src/ol/geom/CircularString.js';
import expect from '../../expect.js';

describe('ol/geom/CircularString.js', function () {
  it('cannot be constructed with a null geometry', function () {
    expect(function () {
      return new CircularString(null);
    }).to.throwException();
  });

  describe('construct empty', function () {
    let cs;
    beforeEach(function () {
      cs = new CircularString([]);
    });

    it('defaults to layout XY', function () {
      expect(cs.getLayout()).to.be('XY');
    });

    it('has empty coordinates', function () {
      expect(cs.getCoordinates()).to.be.empty();
    });

    it('has an empty extent', function () {
      expect(isEmpty(cs.getExtent())).to.be(true);
    });

    it('has empty flat coordinates', function () {
      expect(cs.getFlatCoordinates()).to.be.empty();
    });

    it('has the expected stride', function () {
      expect(cs.getStride()).to.be(2);
    });

    it('reports 0 arcs', function () {
      expect(cs.arcCount()).to.be(0);
    });

    it('has empty drawable flat coordinates', function () {
      expect(cs.getDrawableFlatCoordinates()).to.be.empty();
    });
  });

  describe('construct with 2D coordinates', function () {
    let cs;
    beforeEach(function () {
      // quarter circle from (5,0) through (~3.54, ~3.54) to (0,5)
      cs = new CircularString([
        [5, 0],
        [(Math.SQRT2 / 2) * 5, (Math.SQRT2 / 2) * 5],
        [0, 5],
      ]);
    });

    it('has the expected layout', function () {
      expect(cs.getLayout()).to.be('XY');
    });

    it('has the expected type', function () {
      expect(cs.getType()).to.be('CircularString');
    });

    it('has the expected coordinates', function () {
      const coords = cs.getCoordinates();
      expect(coords.length).to.be(3);
      expect(coords[0]).to.eql([5, 0]);
      expect(coords[2]).to.eql([0, 5]);
    });

    it('has the expected extent', function () {
      const extent = cs.getExtent();
      expect(extent[0]).to.be.lessThan(0.01);
      expect(extent[1]).to.be.lessThan(0.01);
      expect(extent[2]).to.be.greaterThan(4.99);
      expect(extent[3]).to.be.greaterThan(4.99);
    });

    it('has the expected flat coordinates', function () {
      const flat = cs.getFlatCoordinates();
      expect(flat.length).to.be(6);
      expect(flat[0]).to.be(5);
      expect(flat[1]).to.be(0);
    });

    it('has the expected stride', function () {
      expect(cs.getStride()).to.be(2);
    });

    it('reports 1 arc', function () {
      expect(cs.arcCount()).to.be(1);
    });

    it('produces drawable flat coordinates', function () {
      const drawable = cs.getDrawableFlatCoordinates();
      expect(drawable.length).to.be(8);
      expect(drawable[0]).to.be(5);
      expect(drawable[1]).to.be(0);
      expect(drawable[6]).to.be(0);
      expect(drawable[7]).to.be(5);
      expect(Math.abs(drawable[4])).to.be.lessThan(0.01);
      expect(Math.abs(drawable[5])).to.be.lessThan(0.01);
    });

    describe('#getFirstCoordinate', function () {
      it('returns the first coordinate', function () {
        expect(cs.getFirstCoordinate()).to.eql([5, 0]);
      });
    });

    describe('#getLastCoordinate', function () {
      it('returns the last coordinate', function () {
        expect(cs.getLastCoordinate()).to.eql([0, 5]);
      });
    });

    describe('#getCoordinateAt', function () {
      it('returns the first point when fraction is 0', function () {
        expect(cs.getCoordinateAt(0)).to.eql([5, 0]);
      });

      it('returns the last point when fraction is 1', function () {
        expect(cs.getCoordinateAt(1)).to.eql([0, 5]);
      });

      it('returns a midpoint when fraction is 0.5', function () {
        const mid = cs.getCoordinateAt(0.5);
        expect(mid).to.be.an(Array);
        expect(mid.length).to.be(2);
      });
    });

    describe('#clone', function () {
      it('returns a complete copy', function () {
        const clone = cs.clone();
        expect(clone).to.be.a(CircularString);
        expect(clone.getType()).to.be('CircularString');
        expect(clone.getCoordinates()).to.eql(cs.getCoordinates());
        expect(clone.getCoordinates()).not.to.be(cs.getCoordinates());
      });

      it('preserves layout', function () {
        const clone = cs.clone();
        expect(clone.getLayout()).to.be(cs.getLayout());
      });
    });

    describe('#getFlatMidpoint', function () {
      it('returns a flat midpoint', function () {
        const midpoint = cs.getFlatMidpoint();
        expect(midpoint).to.be.an(Array);
        expect(midpoint.length).to.be(2);
      });
    });

    describe('#flatCenterOfCircle', function () {
      it('returns center for arc 0', function () {
        const center = cs.flatCenterOfCircle(0);
        expect(center).to.be.an(Array);
        expect(center.length).to.be(2);
        expect(Math.abs(center[0])).to.be.lessThan(0.01);
        expect(Math.abs(center[1])).to.be.lessThan(0.01);
      });
    });

    describe('#closestPointXY', function () {
      it('returns a close distance for a point on the curve', function () {
        const closestPoint = [0, 0];
        const sqDist = cs.closestPointXY(5, 0, closestPoint, Infinity);
        expect(sqDist).to.be.lessThan(0.01);
      });
    });

    describe('#applyTransform', function () {
      it('updates coordinates after transform', function () {
        cs.applyTransform(function (input, output, dimension) {
          const dim = dimension || 2;
          for (let i = 0, ii = input.length; i < ii; i += dim) {
            output[i] = input[i] * 2;
            output[i + 1] = input[i + 1] * 2;
          }
          return output;
        });
        const coords = cs.getCoordinates();
        expect(coords[0][0]).to.roughlyEqual(10, 1e-9);
        expect(coords[0][1]).to.roughlyEqual(0, 1e-9);
        expect(coords[2][0]).to.roughlyEqual(0, 1e-9);
        expect(coords[2][1]).to.roughlyEqual(10, 1e-9);
      });
    });
  });

  describe('construct with 3D coordinates', function () {
    let cs;
    beforeEach(function () {
      cs = new CircularString([
        [5, 0, 10],
        [(Math.SQRT2 / 2) * 5, (Math.SQRT2 / 2) * 5, 20],
        [0, 5, 30],
      ]);
    });

    it('has the expected layout', function () {
      expect(cs.getLayout()).to.be('XYZ');
    });

    it('has the expected coordinates', function () {
      const coords = cs.getCoordinates();
      expect(coords[0]).to.eql([5, 0, 10]);
      expect(coords[2]).to.eql([0, 5, 30]);
    });

    it('has the expected extent', function () {
      const extent = cs.getExtent();
      expect(extent[0]).to.be.lessThan(0.01);
      expect(extent[2]).to.be.greaterThan(4.99);
    });

    it('has the expected flat coordinates', function () {
      expect(cs.getFlatCoordinates().length).to.be(9);
    });

    it('has the expected stride', function () {
      expect(cs.getStride()).to.be(3);
    });
  });

  describe('construct with 3D coordinates and layout XYM', function () {
    let cs;
    beforeEach(function () {
      cs = new CircularString(
        [
          [5, 0, 100],
          [(Math.SQRT2 / 2) * 5, (Math.SQRT2 / 2) * 5, 200],
          [0, 5, 300],
        ],
        'XYM',
      );
    });

    it('has the expected layout', function () {
      expect(cs.getLayout()).to.be('XYM');
    });

    it('has the expected coordinates', function () {
      const coords = cs.getCoordinates();
      expect(coords[0]).to.eql([5, 0, 100]);
      expect(coords[2]).to.eql([0, 5, 300]);
    });

    it('has the expected extent', function () {
      const extent = cs.getExtent();
      expect(extent[0]).to.be.lessThan(0.01);
      expect(extent[2]).to.be.greaterThan(4.99);
    });

    it('has the expected flat coordinates', function () {
      expect(cs.getFlatCoordinates().length).to.be(9);
    });

    it('has the expected stride', function () {
      expect(cs.getStride()).to.be(3);
    });
  });

  describe('construct with 4D coordinates', function () {
    let cs;
    beforeEach(function () {
      cs = new CircularString([
        [5, 0, 10, 100],
        [(Math.SQRT2 / 2) * 5, (Math.SQRT2 / 2) * 5, 20, 200],
        [0, 5, 30, 300],
      ]);
    });

    it('has the expected layout', function () {
      expect(cs.getLayout()).to.be('XYZM');
    });

    it('has the expected coordinates', function () {
      const coords = cs.getCoordinates();
      expect(coords[0]).to.eql([5, 0, 10, 100]);
      expect(coords[2]).to.eql([0, 5, 30, 300]);
    });

    it('has the expected extent', function () {
      const extent = cs.getExtent();
      expect(extent[0]).to.be.lessThan(0.01);
      expect(extent[2]).to.be.greaterThan(4.99);
    });

    it('has the expected flat coordinates', function () {
      expect(cs.getFlatCoordinates().length).to.be(12);
    });

    it('has the expected stride', function () {
      expect(cs.getStride()).to.be(4);
    });
  });

  describe('#scale()', function () {
    it('scales a circular string', function () {
      // full circle centered at origin: extent is [-5,-5,5,5], center is (0,0)
      const cs = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      cs.scale(2);
      const coords = cs.getCoordinates();
      expect(coords[0][0]).to.roughlyEqual(10, 1e-9);
      expect(coords[0][1]).to.roughlyEqual(0, 1e-9);
      expect(coords[1][0]).to.roughlyEqual(-10, 1e-9);
      expect(coords[1][1]).to.roughlyEqual(0, 1e-9);
    });

    it('accepts sx and sy', function () {
      const cs = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      cs.scale(2, 3);
      const coords = cs.getCoordinates();
      expect(coords[0][0]).to.roughlyEqual(10, 1e-9);
      expect(coords[0][1]).to.roughlyEqual(0, 1e-9);
      expect(coords[1][0]).to.roughlyEqual(-10, 1e-9);
      expect(coords[1][1]).to.roughlyEqual(0, 1e-9);
    });

    it('accepts an anchor', function () {
      const cs = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      cs.scale(2, 2, [5, 0]);
      const coords = cs.getCoordinates();
      // anchor at (5,0), so that point stays fixed
      expect(coords[0][0]).to.roughlyEqual(5, 1e-9);
      expect(coords[0][1]).to.roughlyEqual(0, 1e-9);
    });
  });

  describe('construct with two arcs (5 points)', function () {
    let cs;
    beforeEach(function () {
      cs = new CircularString([
        [5, 0],
        [(Math.SQRT2 / 2) * 5, (Math.SQRT2 / 2) * 5],
        [0, 5],
        [(-Math.SQRT2 / 2) * 5, (Math.SQRT2 / 2) * 5],
        [-5, 0],
      ]);
    });

    it('reports 2 arcs', function () {
      expect(cs.arcCount()).to.be(2);
    });

    it('produces drawable coords for 2 arcs', function () {
      const drawable = cs.getDrawableFlatCoordinates();
      // 2 arcs: 2 * 6 + 2 = 14
      expect(drawable.length).to.be(14);
    });

    it('computes extent covering half circle', function () {
      const extent = cs.getExtent();
      expect(extent[0]).to.be.lessThan(-4.99);
      expect(extent[2]).to.be.greaterThan(4.99);
      expect(extent[3]).to.be.greaterThan(4.99);
    });
  });

  describe('full circle', function () {
    let cs;
    beforeEach(function () {
      cs = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
    });

    it('reports 1 arc', function () {
      expect(cs.arcCount()).to.be(1);
    });

    it('computes a full-circle extent', function () {
      const extent = cs.getExtent();
      expect(extent[0]).to.be.lessThan(-4.99);
      expect(extent[1]).to.be.lessThan(-4.99);
      expect(extent[2]).to.be.greaterThan(4.99);
      expect(extent[3]).to.be.greaterThan(4.99);
    });
  });

  describe('arcCount edge cases', function () {
    it('returns 0 for fewer than 3 points', function () {
      const cs = new CircularString([
        [0, 0],
        [1, 1],
      ]);
      expect(cs.arcCount()).to.be(0);
    });

    it('returns 1 for exactly 3 points', function () {
      const cs = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      expect(cs.arcCount()).to.be(1);
    });

    it('returns 2 for 5 points', function () {
      const cs = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
        [3, -1],
        [4, 0],
      ]);
      expect(cs.arcCount()).to.be(2);
    });

    it('returns 3 for 7 points', function () {
      const cs = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
        [3, -1],
        [4, 0],
        [5, 1],
        [6, 0],
      ]);
      expect(cs.arcCount()).to.be(3);
    });
  });

  describe('#getLength()', function () {
    it('returns the arc length of a semicircle', function () {
      // semicircle of radius 5 centered at origin: (5,0) -> (0,5) -> (-5,0)
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      // length should be pi * r = pi * 5
      expect(cs.getLength()).to.roughlyEqual(Math.PI * 5, 1e-9);
    });

    it('returns the arc length of a full circle', function () {
      const cs = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      // length should be 2pi * r = 2pi * 5
      expect(cs.getLength()).to.roughlyEqual(2 * Math.PI * 5, 1e-9);
    });

    it('returns the sum of arc lengths for a multi-arc', function () {
      const cs = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
        [3, -1],
        [4, 0],
      ]);
      expect(cs.getLength()).to.be.greaterThan(0);
    });
  });

  describe('#getCoordinateAt()', function () {
    it('returns the start point at fraction 0', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      expect(cs.getCoordinateAt(0)).to.eql([5, 0]);
    });

    it('returns the end point at fraction 1', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      expect(cs.getCoordinateAt(1)).to.eql([-5, 0]);
    });

    it('returns a point on the arc at fraction 0.5', function () {
      // semicircle from (5,0) through (0,5) to (-5,0), center at origin
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const mid = cs.getCoordinateAt(0.5);
      // midpoint should be at (0, 5) - the top of the semicircle
      expect(mid[0]).to.roughlyEqual(0, 1e-9);
      expect(mid[1]).to.roughlyEqual(5, 1e-9);
    });

    it('returns a point on the circle for a full circle', function () {
      const cs = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const pt = cs.getCoordinateAt(0.25);
      // quarter way around a full circle from (5,0) CCW
      const dist = Math.sqrt(pt[0] * pt[0] + pt[1] * pt[1]);
      expect(dist).to.roughlyEqual(5, 1e-9);
    });
  });

  describe('#closestPointXY()', function () {
    it('finds closest point on a semicircle', function () {
      // semicircle from (5,0) through (0,5) to (-5,0), centered at origin
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const closest = [0, 0];
      cs.closestPointXY(0, 10, closest, Infinity);
      // closest point to (0, 10) on a semicircle of radius 5 is (0, 5)
      expect(closest[0]).to.roughlyEqual(0, 1e-9);
      expect(closest[1]).to.roughlyEqual(5, 1e-9);
    });

    it('returns endpoint when projection is outside arc range', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const closest = [0, 0];
      cs.closestPointXY(0, -10, closest, Infinity);
      // point (0, -10) is below the arc; closest should be one of the endpoints
      const distToStart = Math.sqrt(
        (closest[0] - 5) ** 2 + (closest[1] - 0) ** 2,
      );
      const distToEnd = Math.sqrt(
        (closest[0] + 5) ** 2 + (closest[1] - 0) ** 2,
      );
      expect(Math.min(distToStart, distToEnd)).to.be.lessThan(1e-9);
    });
  });

  describe('#intersectsExtent()', function () {
    it('returns true when extent intersects the arc', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      // extent around the top of the arc
      expect(cs.intersectsExtent([-1, 4, 1, 6])).to.be(true);
    });

    it('returns false when extent is outside', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      // extent well below the arc
      expect(cs.intersectsExtent([-1, -10, 1, -8])).to.be(false);
    });

    it('returns true when extent contains a control point', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      expect(cs.intersectsExtent([4, -1, 6, 1])).to.be(true);
    });
  });

  describe('#rotate()', function () {
    it('updates drawable coordinates after rotation', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      cs.rotate(Math.PI / 2, [0, 0]);
      const coords = cs.getCoordinates();
      // (5,0) rotated 90 deg CCW -> (0,5)
      expect(coords[0][0]).to.roughlyEqual(0, 1e-9);
      expect(coords[0][1]).to.roughlyEqual(5, 1e-9);
      // drawable coordinates should also be updated
      const drawable = cs.getDrawableFlatCoordinates();
      expect(drawable[0]).to.roughlyEqual(0, 1e-9);
    });
  });

  describe('#translate()', function () {
    it('updates drawable coordinates after translation', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      cs.translate(10, 20);
      const coords = cs.getCoordinates();
      expect(coords[0][0]).to.roughlyEqual(15, 1e-9);
      expect(coords[0][1]).to.roughlyEqual(20, 1e-9);
      // drawable coordinates should also be updated (not stale)
      const drawable = cs.getDrawableFlatCoordinates();
      expect(drawable[0]).to.roughlyEqual(15, 1e-9);
    });
  });

  describe('#forEachArc()', function () {
    it('calls callback once per arc with start, mid, end', function () {
      const cs = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
        [3, -1],
        [4, 0],
      ]);
      const segments = [];
      cs.forEachArc(function (start, mid, end) {
        segments.push({start, mid, end});
      });
      expect(segments.length).to.be(2);
      expect(segments[0].start[0]).to.be(0);
      expect(segments[0].mid[0]).to.be(1);
      expect(segments[0].end[0]).to.be(2);
      expect(segments[1].start[0]).to.be(2);
      expect(segments[1].end[0]).to.be(4);
    });

    it('returns false when no callback returns truthy', function () {
      const cs = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const ret = cs.forEachArc(function () {});
      expect(ret).to.be(false);
    });

    it('returns truthy callback value early', function () {
      const cs = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
        [3, -1],
        [4, 0],
      ]);
      let count = 0;
      const ret = cs.forEachArc(function () {
        count++;
        return 'stop';
      });
      expect(ret).to.be('stop');
      expect(count).to.be(1);
    });
  });

  describe('#forEachSegment()', function () {
    it('calls callback with 2-arg tessellated segments', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const segments = [];
      cs.forEachSegment(function (start, end) {
        segments.push({start: start.slice(), end: end.slice()});
      });
      // tessellate() produces 36 segments per arc by default
      expect(segments.length).to.be(36);
      // each segment has 2 coords (start and end)
      expect(segments[0].start.length).to.be(2);
      expect(segments[0].end.length).to.be(2);
      // first segment starts at first control point
      expect(segments[0].start[0]).to.roughlyEqual(5, 1e-9);
      expect(segments[0].start[1]).to.roughlyEqual(0, 1e-9);
    });

    it('returns false when no callback returns truthy', function () {
      const cs = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const ret = cs.forEachSegment(function () {});
      expect(ret).to.be(false);
    });

    it('returns truthy callback value early', function () {
      const cs = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      let count = 0;
      const ret = cs.forEachSegment(function () {
        count++;
        return 'stop';
      });
      expect(ret).to.be('stop');
      expect(count).to.be(1);
    });
  });

  describe('#tessellate()', function () {
    it('produces dense coordinates for a semicircle', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const flat = cs.tessellate(36);
      // stride 2, 37 points (36 segments + 1)
      expect(flat.length).to.be(74);
      // starts at (5, 0)
      expect(flat[0]).to.roughlyEqual(5, 1e-9);
      expect(flat[1]).to.roughlyEqual(0, 1e-9);
      // ends at (-5, 0)
      expect(flat[flat.length - 2]).to.roughlyEqual(-5, 1e-9);
      expect(flat[flat.length - 1]).to.roughlyEqual(0, 1e-9);
    });

    it('returns empty array for empty CircularString', function () {
      const cs = new CircularString([]);
      expect(cs.tessellate().length).to.be(0);
    });

    it('all tessellated points lie on the circle', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const flat = cs.tessellate();
      for (let i = 0; i < flat.length; i += 2) {
        const dist = Math.sqrt(flat[i] * flat[i] + flat[i + 1] * flat[i + 1]);
        expect(dist).to.roughlyEqual(5, 1e-6);
      }
    });

    it('produces segments for snap interaction', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const flat = cs.tessellate();
      // each consecutive pair of points forms a segment suitable for Snap
      const segmentCount = flat.length / 2 - 1;
      expect(segmentCount).to.be(36);
    });

    it('includes exact control point coordinates', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const flat = cs.tessellate();
      // Start point: exact control coordinate (no trig round-trip)
      expect(flat[0]).to.be(5);
      expect(flat[1]).to.be(0);
      // End point: exact control coordinate
      expect(flat[flat.length - 2]).to.be(-5);
      expect(flat[flat.length - 1]).to.be(0);
      // Through-point (0, 5) must appear as an exact vertex
      let foundMid = false;
      for (let i = 0; i < flat.length; i += 2) {
        if (flat[i] === 0 && flat[i + 1] === 5) {
          foundMid = true;
          break;
        }
      }
      expect(foundMid).to.be(true);
    });

    it('includes through-points for multi-arc geometry', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
        [0, -5],
        [5, 0],
      ]);
      const flat = cs.tessellate();
      // Through-point of arc 0: (0, 5)
      let found1 = false;
      for (let i = 0; i < flat.length; i += 2) {
        if (flat[i] === 0 && flat[i + 1] === 5) {
          found1 = true;
          break;
        }
      }
      expect(found1).to.be(true);
      // Through-point of arc 1: (0, -5)
      let found3 = false;
      for (let i = 0; i < flat.length; i += 2) {
        if (flat[i] === 0 && flat[i + 1] === -5) {
          found3 = true;
          break;
        }
      }
      expect(found3).to.be(true);
    });
  });

  describe('degenerate arcs', function () {
    it('handles collinear points without crashing', function () {
      const cs = new CircularString([
        [0, 0],
        [1, 0],
        [2, 0],
      ]);
      expect(cs.getType()).to.be('CircularString');
      // should not throw
      const extent = cs.getExtent();
      expect(extent).to.be.an(Array);
    });

    it('handles coincident points without crashing', function () {
      const cs = new CircularString([
        [5, 5],
        [5, 5],
        [5, 5],
      ]);
      expect(cs.getType()).to.be('CircularString');
      const extent = cs.getExtent();
      expect(extent).to.be.an(Array);
    });

    it('tessellates collinear points as a straight line', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 0],
        [10, 0],
      ]);
      const flat = cs.tessellate();
      // degenerate arc falls back to straight-line endpoints
      expect(flat.length).to.be(4);
      expect(flat[0]).to.roughlyEqual(0, 1e-9);
      expect(flat[1]).to.roughlyEqual(0, 1e-9);
      expect(flat[2]).to.roughlyEqual(10, 1e-9);
      expect(flat[3]).to.roughlyEqual(0, 1e-9);
    });

    it('closestPointXY does not throw for collinear arc', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 0],
        [10, 0],
      ]);
      const closest = [0, 0];
      // should not throw; may return Infinity for degenerate arcs
      const dist = cs.closestPointXY(5, 5, closest, Infinity);
      expect(typeof dist).to.be('number');
    });

    it('intersectsExtent works for collinear arc', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 0],
        [10, 0],
      ]);
      expect(cs.intersectsExtent([4, -1, 6, 1])).to.be(true);
      expect(cs.intersectsExtent([20, 20, 30, 30])).to.be(false);
    });

    it('getLength returns a finite value for collinear arc', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 0],
        [10, 0],
      ]);
      const len = cs.getLength();
      expect(isFinite(len)).to.be(true);
      expect(len).to.be.greaterThan(0);
    });
  });

  describe('containsXY', function () {
    it('returns false for a point not on the arc', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      expect(cs.containsXY(100, 100)).to.be(false);
    });
  });

  describe('getSimplifiedGeometry', function () {
    it('returns the same instance', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      expect(cs.getSimplifiedGeometry(1)).to.be(cs);
    });
  });

  describe('setCoordinates', function () {
    it('updates coordinates', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      cs.setCoordinates([
        [1, 1],
        [6, 6],
        [11, 1],
      ]);
      const coords = cs.getCoordinates();
      expect(coords[0][0]).to.be(1);
      expect(coords[0][1]).to.be(1);
      expect(coords[2][0]).to.be(11);
      expect(coords[2][1]).to.be(1);
    });

    it('updates extent', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      const extentBefore = cs.getExtent().slice();
      cs.setCoordinates([
        [100, 100],
        [105, 105],
        [110, 100],
      ]);
      const extentAfter = cs.getExtent();
      expect(extentAfter[0]).to.be.greaterThan(extentBefore[2]);
    });

    it('fires a change event', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      let changed = false;
      cs.on('change', function () {
        changed = true;
      });
      cs.setCoordinates([
        [1, 1],
        [6, 6],
        [11, 1],
      ]);
      expect(changed).to.be(true);
    });
  });

  describe('arcExtent', function () {
    it('returns a valid extent for a single arc', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      const extent = cs.arcExtent(0);
      expect(extent).to.be.an(Array);
      expect(extent.length).to.be(4);
      // extent must contain all three control points
      expect(extent[0]).to.be.lessThan(0 + 1e-9);
      expect(extent[1]).to.be.lessThan(0 + 1e-9);
      expect(extent[2]).to.be.greaterThan(10 - 1e-9);
      expect(extent[3]).to.be.greaterThan(5 - 1e-9);
    });

    it('returns a square extent for a full circle', function () {
      const cs = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const extent = cs.arcExtent(0);
      // full circle centered at origin with radius 5
      expect(extent[0]).to.roughlyEqual(-5, 1e-6);
      expect(extent[1]).to.roughlyEqual(-5, 1e-6);
      expect(extent[2]).to.roughlyEqual(5, 1e-6);
      expect(extent[3]).to.roughlyEqual(5, 1e-6);
    });

    it('returns valid extents for multi-arc geometry', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
        [15, -5],
        [20, 0],
      ]);
      const extent0 = cs.arcExtent(0);
      const extent1 = cs.arcExtent(1);
      expect(extent0).to.be.an(Array);
      expect(extent1).to.be.an(Array);
      // first arc is in upper half, second in lower half
      expect(extent0[3]).to.be.greaterThan(0);
      expect(extent1[1]).to.be.lessThan(0);
    });
  });

  describe('exact math: getLength', function () {
    it('semicircle (r=5) has length π×5', function () {
      // semicircle centered at origin with radius 5
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      expect(cs.getLength()).to.roughlyEqual(Math.PI * 5, 1e-3);
    });

    it('full circle (r=5) has length 2π×5', function () {
      const cs = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      expect(cs.getLength()).to.roughlyEqual(2 * Math.PI * 5, 1e-3);
    });

    it('quarter arc (r=5) has length πr/2', function () {
      const cs = new CircularString([
        [5, 0],
        [5 * Math.cos(Math.PI / 4), 5 * Math.sin(Math.PI / 4)],
        [0, 5],
      ]);
      expect(cs.getLength()).to.roughlyEqual((Math.PI * 5) / 2, 1e-3);
    });
  });

  describe('exact math: getCoordinateAt', function () {
    it('quarter position on semicircle', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      // At 0.25 along a CCW semicircle from (5,0) to (-5,0) through (0,5)
      // that's 45° -> (5cos45, 5sin45)
      const coord = cs.getCoordinateAt(0.25);
      const expected = [5 * Math.cos(Math.PI / 4), 5 * Math.sin(Math.PI / 4)];
      expect(coord[0]).to.roughlyEqual(expected[0], 1e-2);
      expect(coord[1]).to.roughlyEqual(expected[1], 1e-2);
    });
  });

  describe('exact math: closestPointXY', function () {
    it('point outside circle, closest is on arc', function () {
      // semicircle radius 5 centered at origin
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const closest = [NaN, NaN];
      cs.closestPointXY(10, 0, closest, Infinity);
      // closest point on arc to (10,0) is (5,0)
      expect(closest[0]).to.roughlyEqual(5, 1e-2);
      expect(closest[1]).to.roughlyEqual(0, 1e-2);
    });

    it('point at center, closest is on arc at radius distance', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const closest = [NaN, NaN];
      const dist2 = cs.closestPointXY(0, 0, closest, Infinity);
      // distance from center to arc = radius = 5
      expect(Math.sqrt(dist2)).to.roughlyEqual(5, 1e-1);
    });
  });

  describe('exact math: intersectsExtent', function () {
    it('extent straddling arc intersects', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      // extent that covers the top of the arc
      expect(cs.intersectsExtent([-1, 4, 1, 6])).to.be(true);
    });

    it('extent far away does not intersect', function () {
      const cs = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      expect(cs.intersectsExtent([100, 100, 200, 200])).to.be(false);
    });
  });
});
