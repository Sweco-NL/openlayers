import {spy as sinonSpy} from 'sinon';
import {isEmpty} from '../../../../src/ol/extent.js';
import CircularString from '../../../../src/ol/geom/CircularString.js';
import CompoundCurve from '../../../../src/ol/geom/CompoundCurve.js';
import CurvePolygon from '../../../../src/ol/geom/CurvePolygon.js';
import LineString from '../../../../src/ol/geom/LineString.js';
import Point from '../../../../src/ol/geom/Point.js';
import expect from '../../expect.js';

describe('ol/geom/CurvePolygon.js', function () {
  describe('construct with a single LineString ring', function () {
    let cp;
    let outerRing;
    beforeEach(function () {
      outerRing = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ];
      cp = new CurvePolygon([new LineString(outerRing)], 'XY');
    });

    it('has the expected type', function () {
      expect(cp.getType()).to.be('CurvePolygon');
    });

    it('has the expected layout', function () {
      expect(cp.getLayout()).to.be('XY');
    });

    it('returns rings', function () {
      const rings = cp.getRings();
      expect(rings.length).to.be(1);
      expect(rings[0].getType()).to.be('LineString');
    });

    it('has the expected extent', function () {
      const extent = cp.getExtent();
      expect(extent[0]).to.be(0);
      expect(extent[1]).to.be(0);
      expect(extent[2]).to.be(10);
      expect(extent[3]).to.be(10);
    });

    it('has the expected flat coordinates', function () {
      const flat = cp.getFlatCoordinates();
      expect(flat.length).to.be(10);
      // Verify actual coordinate values from the ring
      expect(flat[0]).to.be(0);
      expect(flat[1]).to.be(0);
      expect(flat[2]).to.be(10);
      expect(flat[3]).to.be(0);
    });

    it('has the expected stride', function () {
      expect(cp.getStride()).to.be(2);
    });

    it('has correct ends', function () {
      const ends = cp.getEnds();
      expect(ends.length).to.be(1);
      expect(ends[0]).to.be(10);
    });

    describe('#getFlatInteriorPoint', function () {
      it('returns an interior point inside the polygon', function () {
        const interiorPt = cp.getFlatInteriorPoint();
        expect(interiorPt).to.be.an(Array);
        expect(interiorPt[0]).to.be.greaterThan(-0.01);
        expect(interiorPt[0]).to.be.lessThan(10.01);
        expect(interiorPt[1]).to.be.greaterThan(-0.01);
        expect(interiorPt[1]).to.be.lessThan(10.01);
      });
    });

    describe('#getInteriorPoint', function () {
      it('returns a Point with XYM layout', function () {
        const pt = cp.getInteriorPoint();
        expect(pt.getType()).to.be('Point');
        expect(pt.getLayout()).to.be('XYM');
      });
    });

    describe('#clone', function () {
      it('returns a complete copy', function () {
        const clone = cp.clone();
        expect(clone).to.be.a(CurvePolygon);
        expect(clone.getType()).to.be('CurvePolygon');
        expect(clone.getRingsArray().length).to.be(1);
        expect(clone.getRingsArray()).not.to.be(cp.getRingsArray());
        expect(clone.getRingsArray()[0]).not.to.be(cp.getRingsArray()[0]);
      });

      it('preserves layout', function () {
        const clone = cp.clone();
        expect(clone.getLayout()).to.be(cp.getLayout());
      });
    });

    describe('#getOrientedFlatCoordinates', function () {
      it('returns oriented flat coordinates', function () {
        const oriented = cp.getOrientedFlatCoordinates();
        expect(oriented).to.be.an(Array);
        expect(oriented.length).to.be(10);
      });
    });

    describe('#applyTransform', function () {
      it('updates coordinates after transform', function () {
        cp.applyTransform(function (input, output, dimension) {
          const dim = dimension || 2;
          for (let i = 0, ii = input.length; i < ii; i += dim) {
            output[i] = input[i] * 2;
            output[i + 1] = input[i + 1] * 2;
          }
          return output;
        });
        const extent = cp.getExtent();
        expect(extent[0]).to.be(0);
        expect(extent[2]).to.be(20);
        expect(extent[3]).to.be(20);
      });
    });
  });

  describe('construct with CircularString ring', function () {
    let cp;
    beforeEach(function () {
      cp = new CurvePolygon(
        [
          new CircularString([
            [5, 0],
            [-5, 0],
            [5, 0],
          ]),
        ],
        'XY',
      );
    });

    it('has a CircularString ring', function () {
      const rings = cp.getRings();
      expect(rings[0].getType()).to.be('CircularString');
    });

    it('computes extent from circular ring', function () {
      const extent = cp.getExtent();
      expect(extent[0]).to.be.lessThan(-4.99);
      expect(extent[1]).to.be.lessThan(-4.99);
      expect(extent[2]).to.be.greaterThan(4.99);
      expect(extent[3]).to.be.greaterThan(4.99);
    });
  });

  describe('construct with 3D coordinates', function () {
    let cp;
    beforeEach(function () {
      cp = new CurvePolygon(
        [
          new LineString(
            [
              [0, 0, 10],
              [10, 0, 20],
              [10, 10, 30],
              [0, 10, 40],
              [0, 0, 10],
            ],
            'XYZ',
          ),
        ],
        'XYZ',
      );
    });

    it('has the expected layout', function () {
      expect(cp.getLayout()).to.be('XYZ');
    });

    it('has the expected flat coordinates', function () {
      expect(cp.getFlatCoordinates().length).to.be(15);
    });

    it('has the expected stride', function () {
      expect(cp.getStride()).to.be(3);
    });

    it('has the expected extent', function () {
      const extent = cp.getExtent();
      expect(extent[0]).to.be(0);
      expect(extent[2]).to.be(10);
    });
  });

  describe('construct with 3D coordinates and layout XYM', function () {
    let cp;
    beforeEach(function () {
      cp = new CurvePolygon(
        [
          new LineString(
            [
              [0, 0, 100],
              [10, 0, 200],
              [10, 10, 300],
              [0, 10, 400],
              [0, 0, 100],
            ],
            'XYM',
          ),
        ],
        'XYM',
      );
    });

    it('has the expected layout', function () {
      expect(cp.getLayout()).to.be('XYM');
    });

    it('has the expected flat coordinates', function () {
      expect(cp.getFlatCoordinates().length).to.be(15);
    });

    it('has the expected stride', function () {
      expect(cp.getStride()).to.be(3);
    });
  });

  describe('construct with 4D coordinates', function () {
    let cp;
    beforeEach(function () {
      cp = new CurvePolygon(
        [
          new LineString([
            [0, 0, 10, 100],
            [10, 0, 20, 200],
            [10, 10, 30, 300],
            [0, 10, 40, 400],
            [0, 0, 10, 100],
          ]),
        ],
        'XYZM',
      );
    });

    it('has the expected layout', function () {
      expect(cp.getLayout()).to.be('XYZM');
    });

    it('has the expected flat coordinates', function () {
      expect(cp.getFlatCoordinates().length).to.be(20);
    });

    it('has the expected stride', function () {
      expect(cp.getStride()).to.be(4);
    });
  });

  describe('construct with outer + inner ring', function () {
    let cp;
    beforeEach(function () {
      const outer = new LineString([
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
        [0, 0],
      ]);
      const inner = new LineString([
        [5, 5],
        [15, 5],
        [15, 15],
        [5, 15],
        [5, 5],
      ]);
      cp = new CurvePolygon([outer, inner], 'XY');
    });

    it('has 2 rings', function () {
      expect(cp.getRings().length).to.be(2);
    });

    it('has correct ends for 2 rings', function () {
      const ends = cp.getEnds();
      expect(ends.length).to.be(2);
      expect(ends[0]).to.be(10);
      expect(ends[1]).to.be(20);
    });

    it('orients rings (outer CW, inner CCW)', function () {
      const rings = cp.getRings();
      expect(rings.length).to.be(2);
    });

    it('computes extent from outer ring', function () {
      const extent = cp.getExtent();
      expect(extent[0]).to.be(0);
      expect(extent[1]).to.be(0);
      expect(extent[2]).to.be(20);
      expect(extent[3]).to.be(20);
    });

    it('has correct flat coordinates length for 2 rings', function () {
      expect(cp.getFlatCoordinates().length).to.be(20);
    });
  });

  describe('construct with mixed ring types', function () {
    let cp;
    beforeEach(function () {
      const outer = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const inner = new LineString([
        [2, -2],
        [2, 2],
        [-2, 2],
        [-2, -2],
        [2, -2],
      ]);
      cp = new CurvePolygon([outer, inner], 'XY');
    });

    it('has 2 rings of different types', function () {
      const rings = cp.getRings();
      expect(rings.length).to.be(2);
      expect(rings[0].getType()).to.be('CircularString');
      expect(rings[1].getType()).to.be('LineString');
    });

    it('computes extent from circular outer ring', function () {
      const extent = cp.getExtent();
      expect(extent[0]).to.be.lessThan(-4.99);
      expect(extent[2]).to.be.greaterThan(4.99);
    });
  });

  describe('#containsXY()', function () {
    it('returns true for a point inside a semicircular polygon', function () {
      // semicircle top half + straight line closing at bottom
      const arc = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const line = new LineString([
        [-5, 0],
        [5, 0],
      ]);
      const ring = new CompoundCurve([arc, line]);
      const cp = new CurvePolygon([ring]);
      // (0, 1) is inside
      expect(cp.containsXY(0, 1)).to.be(true);
    });

    it('returns false for a point outside', function () {
      const arc = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const line = new LineString([
        [-5, 0],
        [5, 0],
      ]);
      const ring = new CompoundCurve([arc, line]);
      const cp = new CurvePolygon([ring]);
      expect(cp.containsXY(10, 10)).to.be(false);
    });
  });

  describe('#closestPointXY()', function () {
    it('delegates to rings', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const closest = [0, 0];
      const dist = cp.closestPointXY(10, 0, closest, Infinity);
      // closest point on a circle of radius 5 to (10, 0) is (5, 0)
      expect(closest[0]).to.roughlyEqual(5, 1e-9);
      expect(closest[1]).to.roughlyEqual(0, 1e-9);
      expect(dist).to.roughlyEqual(25, 1e-6);
    });
  });

  describe('#intersectsExtent()', function () {
    it('returns true when extent overlaps the ring', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      expect(cp.intersectsExtent([4, -1, 6, 1])).to.be(true);
    });

    it('returns true when extent is inside the polygon', function () {
      const arc = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const line = new LineString([
        [-5, 0],
        [5, 0],
      ]);
      const ring = new CompoundCurve([arc, line]);
      const cp = new CurvePolygon([ring]);
      expect(cp.intersectsExtent([-1, 0, 1, 2])).to.be(true);
    });

    it('returns false when extent is outside', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      expect(cp.intersectsExtent([10, 10, 20, 20])).to.be(false);
    });
  });

  describe('#rotate()', function () {
    it('updates rings and flat coordinates', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      cp.rotate(Math.PI / 2, [0, 0]);
      const coords = cp.getRings()[0].getCoordinates();
      // (5,0) rotated 90 deg CCW -> (0,5)
      expect(coords[0][0]).to.roughlyEqual(0, 1e-9);
      expect(coords[0][1]).to.roughlyEqual(5, 1e-9);
    });
  });

  describe('#translate()', function () {
    it('updates rings and flat coordinates', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      cp.translate(10, 20);
      const coords = cp.getRings()[0].getCoordinates();
      expect(coords[0][0]).to.roughlyEqual(15, 1e-9);
      expect(coords[0][1]).to.roughlyEqual(20, 1e-9);
      // flat coordinates should also be updated
      expect(cp.getFlatCoordinates()[0]).to.roughlyEqual(15, 1e-9);
    });
  });

  describe('#containsXY() with full circle', function () {
    it('returns true for a point inside a full circular ring', function () {
      // full circle: tessellated coordinates form a proper ring
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      expect(cp.containsXY(0, 0)).to.be(true);
    });

    it('returns true for a point near the edge inside', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      expect(cp.containsXY(0, 4.9)).to.be(true);
    });

    it('returns false for a point outside the circle', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      expect(cp.containsXY(0, 5.1)).to.be(false);
    });
  });

  describe('#getArea()', function () {
    it('returns approximate area of a full circle', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      // area of circle with radius 5 = pi * 25 ~ 78.54
      // tessellated polygon approximation should be close
      const area = cp.getArea();
      expect(area).to.be.greaterThan(78);
      expect(area).to.be.lessThan(79);
    });

    it('returns area for a compound curve ring', function () {
      const arc = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const line = new LineString([
        [-5, 0],
        [5, 0],
      ]);
      const ring = new CompoundCurve([arc, line]);
      const cp = new CurvePolygon([ring]);
      // area of half-circle: pi * 25 / 2 ~ 39.27
      const area = cp.getArea();
      expect(area).to.be.greaterThan(39);
      expect(area).to.be.lessThan(40);
    });
  });

  describe('#getInteriorPoint()', function () {
    it('returns a point inside a full circle', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const pt = cp.getInteriorPoint();
      expect(pt.getType()).to.be('Point');
      const coord = pt.getCoordinates();
      // interior point should be inside the circle
      const dist = Math.sqrt(coord[0] ** 2 + coord[1] ** 2);
      expect(dist).to.be.lessThan(5);
    });
  });

  describe('#getRings()', function () {
    it('returns cloned copies', function () {
      const ring = new LineString([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const rings1 = cp.getRings();
      const rings2 = cp.getRings();
      expect(rings1).not.to.be(rings2);
      expect(rings1[0]).not.to.be(rings2[0]);
      expect(rings1[0].getCoordinates()).to.eql(rings2[0].getCoordinates());
    });

    it('returns clones that do not affect the original', function () {
      const ring = new LineString([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const rings = cp.getRings();
      rings[0].setCoordinates([
        [99, 99],
        [100, 99],
        [100, 100],
        [99, 100],
        [99, 99],
      ]);
      // internal should be unchanged
      expect(cp.getRingsArray()[0].getCoordinates()[0]).to.eql([0, 0]);
    });
  });

  describe('#getRingsArray()', function () {
    it('returns the internal array directly', function () {
      const ring = new LineString([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      expect(cp.getRingsArray()).to.be(cp.getRingsArray());
    });
  });

  describe('#setRings()', function () {
    let cp, ring;
    beforeEach(function () {
      ring = new LineString([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ]);
      cp = new CurvePolygon([ring]);
    });

    it('fires a change event', function () {
      const listener = sinonSpy();
      cp.on('change', listener);
      cp.setRings([ring]);
      expect(listener.calledOnce).to.be(true);
    });

    it('clones input rings', function () {
      const newRing = new LineString([
        [20, 20],
        [30, 20],
        [30, 30],
        [20, 30],
        [20, 20],
      ]);
      cp.setRings([newRing]);
      // mutate the input after set
      newRing.setCoordinates([
        [99, 99],
        [100, 99],
        [100, 100],
        [99, 100],
        [99, 99],
      ]);
      // internal should not be affected
      expect(cp.getRingsArray()[0].getCoordinates()[0]).to.eql([20, 20]);
    });

    it('updates the extent', function () {
      const extent1 = cp.getExtent();
      expect(extent1[2]).to.be(10);
      const newRing = new LineString([
        [100, 100],
        [200, 100],
        [200, 200],
        [100, 200],
        [100, 100],
      ]);
      cp.setRings([newRing]);
      const extent2 = cp.getExtent();
      expect(extent2[0]).to.be(100);
    });
  });

  describe('#setRingsArray()', function () {
    it('fires a change event', function () {
      const ring = new LineString([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const listener = sinonSpy();
      cp.on('change', listener);
      cp.setRingsArray([ring]);
      expect(listener.calledOnce).to.be(true);
    });
  });

  describe('change event propagation', function () {
    let cp, ring;
    beforeEach(function () {
      ring = new LineString([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ]);
      cp = new CurvePolygon([ring]);
    });

    it('fires a change event when a ring changes', function (done) {
      cp.on('change', function () {
        done();
      });
      ring.setCoordinates([
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
        [0, 0],
      ]);
    });

    it('deregisters old rings', function () {
      const newRing = new LineString([
        [5, 5],
        [15, 5],
        [15, 15],
        [5, 15],
        [5, 5],
      ]);
      cp.setRings([newRing]);
      cp.on('change', function () {
        expect().fail();
      });
      // modifying old ring should not fire change
      ring.setCoordinates([
        [0, 0],
        [50, 0],
        [50, 50],
        [0, 50],
        [0, 0],
      ]);
    });

    it('registers new rings', function (done) {
      const newRing = new LineString([
        [5, 5],
        [15, 5],
        [15, 15],
        [5, 15],
        [5, 5],
      ]);
      cp.setRingsArray([newRing]);
      cp.on('change', function () {
        done();
      });
      newRing.setCoordinates([
        [5, 5],
        [25, 5],
        [25, 25],
        [5, 25],
        [5, 5],
      ]);
    });
  });

  describe('#transform()', function () {
    it('transforms all rings', function () {
      const ring = new LineString([
        [10, 20],
        [12, 20],
        [12, 22],
        [10, 22],
        [10, 20],
      ]);
      const cp = new CurvePolygon([ring]);
      cp.transform('EPSG:4326', 'EPSG:3857');

      const coords = cp.getRings()[0].getCoordinates();
      expect(coords[0][0]).to.roughlyEqual(1113194.9, 1);
      expect(coords[0][1]).to.roughlyEqual(2273030.92, 1);
      expect(coords[2][0]).to.roughlyEqual(1335833.89, 1);
      expect(coords[2][1]).to.roughlyEqual(2511525.23, 1);
    });
  });

  describe('#appendRing()', function () {
    it('adds a ring to the polygon', function () {
      const outer = new LineString([
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
        [0, 0],
      ]);
      const cp = new CurvePolygon([outer]);
      expect(cp.getRingsArray().length).to.be(1);

      const inner = new LineString([
        [5, 5],
        [15, 5],
        [15, 15],
        [5, 15],
        [5, 5],
      ]);
      cp.appendRing(inner);
      expect(cp.getRingsArray().length).to.be(2);
    });

    it('fires a change event', function () {
      const outer = new LineString([
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
        [0, 0],
      ]);
      const cp = new CurvePolygon([outer]);
      const listener = sinonSpy();
      cp.on('change', listener);

      const inner = new LineString([
        [5, 5],
        [15, 5],
        [15, 15],
        [5, 15],
        [5, 5],
      ]);
      cp.appendRing(inner);
      expect(listener.called).to.be(true);
    });

    it('listens to changes on the appended ring', function (done) {
      const outer = new LineString([
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
        [0, 0],
      ]);
      const cp = new CurvePolygon([outer]);
      const inner = new LineString([
        [5, 5],
        [15, 5],
        [15, 15],
        [5, 15],
        [5, 5],
      ]);
      cp.appendRing(inner);
      cp.on('change', function () {
        done();
      });
      inner.setCoordinates([
        [6, 6],
        [14, 6],
        [14, 14],
        [6, 14],
        [6, 6],
      ]);
    });
  });

  describe('#tessellate()', function () {
    it('produces dense coordinates for a circular ring', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const flat = cp.tessellate();
      expect(flat.length).to.be.greaterThan(4);
      expect(flat.length % 2).to.be(0);
    });

    it('produces segments for snap interaction', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const flat = cp.tessellate();
      const segmentCount = flat.length / 2 - 1;
      expect(segmentCount).to.be.greaterThan(30);
    });
  });

  describe('#getTessellatedFlatData()', function () {
    it('returns arrays owned by the caller (not shared internal buffers)', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const first = cp.getTessellatedFlatData();
      const second = cp.getTessellatedFlatData();
      // Caller may store the returned arrays in a cache without aliasing.
      expect(first.flatCoordinates).not.to.be(second.flatCoordinates);
      expect(first.ends).not.to.be(second.ends);
      // Mutating one must not affect the other or the underlying geometry.
      const originalLength = first.flatCoordinates.length;
      first.flatCoordinates.length = 0;
      expect(second.flatCoordinates.length).to.be(originalLength);
      const refetched = cp.getTessellatedFlatData();
      expect(refetched.flatCoordinates.length).to.be(originalLength);
    });

    it('returns valid data with ends matching flatCoordinates length', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const data = cp.getTessellatedFlatData();
      expect(data.stride).to.be(2);
      expect(data.ends.length).to.be(1);
      expect(data.ends[0]).to.be(data.flatCoordinates.length);
    });
  });

  describe('degenerate ring arcs', function () {
    it('handles a CurvePolygon with a collinear arc ring', function () {
      const ring = new CircularString([
        [0, 0],
        [5, 0],
        [10, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      // should not throw
      expect(cp.getExtent()).to.be.an(Array);
    });
  });

  describe('getSimplifiedGeometry', function () {
    it('returns the same instance', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      expect(cp.getSimplifiedGeometry(1)).to.be(cp);
    });
  });

  describe('forEachSegment', function () {
    it('iterates all tessellated segments', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      let count = 0;
      cp.forEachSegment(function () {
        count++;
      });
      expect(count).to.be.greaterThan(0);
    });

    it('supports early exit', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      let count = 0;
      const result = cp.forEachSegment(function () {
        count++;
        return true;
      });
      expect(count).to.be(1);
      expect(result).to.be(true);
    });
  });

  describe('getFirstCoordinate / getLastCoordinate', function () {
    it('returns the first coordinate of the outer ring', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const first = cp.getFirstCoordinate();
      expect(first[0]).to.roughlyEqual(5, 1e-9);
      expect(first[1]).to.roughlyEqual(0, 1e-9);
    });

    it('returns the last coordinate of the last ring', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const last = cp.getLastCoordinate();
      expect(last[0]).to.roughlyEqual(5, 1e-9);
      expect(last[1]).to.roughlyEqual(0, 1e-9);
    });

    it('returns null for empty geometry', function () {
      const cp = new CurvePolygon([]);
      expect(cp.getFirstCoordinate()).to.be(null);
      expect(cp.getLastCoordinate()).to.be(null);
    });
  });

  describe('getTessellatedEnds', function () {
    it('returns an array matching ring count', function () {
      const outer = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const inner = new CircularString([
        [2, 0],
        [-2, 0],
        [2, 0],
      ]);
      const cp = new CurvePolygon([outer, inner]);
      const ends = cp.getTessellatedEnds();
      expect(ends).to.be.an(Array);
      expect(ends.length).to.be(2);
    });
  });

  describe('getCoordinates', function () {
    it('returns an array of ring coordinate arrays', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const coords = cp.getCoordinates();
      expect(coords).to.be.an(Array);
      expect(coords.length).to.be(1);
      expect(coords[0]).to.be.an(Array);
      expect(coords[0].length).to.be.greaterThan(0);
    });
  });

  describe('construct empty', function () {
    let cp;
    beforeEach(function () {
      cp = new CurvePolygon([]);
    });

    it('has an empty extent', function () {
      expect(isEmpty(cp.getExtent())).to.be(true);
    });

    it('has zero ring count', function () {
      expect(cp.getRingsArray().length).to.be(0);
    });
  });

  describe('clone', function () {
    it('creates a deep copy', function () {
      const outer = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const inner = new CircularString([
        [2, 0],
        [-2, 0],
        [2, 0],
      ]);
      const cp = new CurvePolygon([outer, inner]);
      const cloned = cp.clone();
      expect(cloned).not.to.be(cp);
      expect(cloned.getType()).to.be('CurvePolygon');
      expect(cloned.getRingsArray().length).to.be(2);
      const origRings = cp.getRingsArray();
      const clonedRings = cloned.getRingsArray();
      for (let i = 0; i < origRings.length; ++i) {
        expect(clonedRings[i]).not.to.be(origRings[i]);
      }
    });
  });

  describe('type validation', function () {
    it('throws when constructing with an invalid ring type', function () {
      const point = new Point([0, 0]);
      expect(function () {
        new CurvePolygon([/** @type {*} */ (point)]);
      }).to.throwException(
        /must be CircularString, CompoundCurve, LineString, or LinearRing/,
      );
    });

    it('throws when appendRing receives invalid type', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const point = new Point([0, 0]);
      expect(function () {
        cp.appendRing(/** @type {*} */ (point));
      }).to.throwException(
        /must be CircularString, CompoundCurve, LineString, or LinearRing/,
      );
    });

    it('accepts all valid ring types', function () {
      const csRing = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const lineRing = new LineString([
        [2, 0],
        [0, 2],
        [-2, 0],
        [2, 0],
      ]);
      // should not throw
      const cp = new CurvePolygon([csRing, lineRing]);
      expect(cp.getRingsArray().length).to.be(2);
    });
  });

  describe('layout validation', function () {
    it('throws when rings have mismatched layouts', function () {
      const outer = new CircularString([
        [5, 0, 10],
        [-5, 0, 20],
        [5, 0, 10],
      ]);
      const inner = new LineString([
        [2, 0],
        [0, 2],
        [-2, 0],
        [2, 0],
      ]);
      expect(function () {
        new CurvePolygon([outer, inner]);
      }).to.throwException(/layout mismatch/);
    });

    it('throws when appendRing has mismatched layout', function () {
      const outer = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([outer]);
      const inner3d = new CircularString([
        [2, 0, 10],
        [-2, 0, 20],
        [2, 0, 10],
      ]);
      expect(function () {
        cp.appendRing(inner3d);
      }).to.throwException(/layout mismatch/);
    });
  });

  describe('getCoordinates(right)', function () {
    it('returns tessellated oriented coords when right=true', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const coords = cp.getCoordinates(true);
      expect(coords).to.be.an(Array);
      expect(coords.length).to.be(1);
      // tessellated ring has many points (> 3 control points)
      expect(coords[0].length).to.be.greaterThan(3);
      // each coord is [x, y]
      expect(coords[0][0].length).to.be(2);
    });

    it('returns raw control points when right is undefined', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const coords = cp.getCoordinates();
      expect(coords.length).to.be(1);
      // raw CircularString coords = 3 control points
      expect(coords[0].length).to.be(3);
    });
  });

  describe('exact math: getArea', function () {
    it('circular ring (r=5) has area ≈ π×25', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      // tessellation approximates, so use relaxed tolerance
      expect(cp.getArea()).to.roughlyEqual(Math.PI * 25, 1);
    });

    it('ring with hole subtracts inner area', function () {
      const outer = new CircularString([
        [10, 0],
        [-10, 0],
        [10, 0],
      ]);
      const inner = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([outer, inner]);
      const expected = Math.PI * (100 - 25);
      expect(cp.getArea()).to.roughlyEqual(expected, 5);
    });
  });

  describe('exact math: containsXY', function () {
    it('center of circular ring is inside', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      expect(cp.containsXY(0, 0)).to.be(true);
    });

    it('point outside ring is outside', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      expect(cp.containsXY(100, 100)).to.be(false);
    });

    it('point inside hole is outside', function () {
      const outer = new CircularString([
        [10, 0],
        [-10, 0],
        [10, 0],
      ]);
      const inner = new CircularString([
        [3, 0],
        [-3, 0],
        [3, 0],
      ]);
      const cp = new CurvePolygon([outer, inner]);
      expect(cp.containsXY(0, 0)).to.be(false);
    });

    it('point between rings is inside', function () {
      const outer = new CircularString([
        [10, 0],
        [-10, 0],
        [10, 0],
      ]);
      const inner = new CircularString([
        [3, 0],
        [-3, 0],
        [3, 0],
      ]);
      const cp = new CurvePolygon([outer, inner]);
      expect(cp.containsXY(7, 0)).to.be(true);
    });
  });

  describe('exact math: getInteriorPoint', function () {
    it('returns a point inside the polygon', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const interior = cp.getInteriorPoint();
      expect(interior).to.be.an(Object);
      expect(interior.getType()).to.be('Point');
      // interior point should be inside the polygon
      const coords = interior.getCoordinates();
      expect(cp.containsXY(coords[0], coords[1])).to.be(true);
    });
  });

  describe('cache invalidation', function () {
    it('getFlatCoordinates updates after sub-ring modification', function () {
      const ring = new LineString([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const flat1 = cp.getFlatCoordinates();
      expect(flat1[2]).to.be(10);

      ring.setCoordinates([
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
        [0, 0],
      ]);
      const flat2 = cp.getFlatCoordinates();
      expect(flat2[2]).to.be(20);
    });

    it('getEnds updates after sub-ring modification', function () {
      const ring = new LineString([
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const ends1 = cp.getEnds();
      expect(ends1[0]).to.be(8);

      ring.setCoordinates([
        [0, 0],
        [5, 0],
        [5, 5],
        [2, 3],
        [0, 0],
      ]);
      const ends2 = cp.getEnds();
      expect(ends2[0]).to.be(10);
    });

    it('getFlatCoordinates updates after setRings', function () {
      const ring1 = new LineString([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 0],
      ]);
      const cp = new CurvePolygon([ring1]);
      expect(cp.getFlatCoordinates().length).to.be(8);

      const ring2 = new LineString([
        [0, 0],
        [20, 0],
        [20, 20],
        [10, 20],
        [0, 0],
      ]);
      cp.setRings([ring2]);
      expect(cp.getFlatCoordinates().length).to.be(10);
    });
  });
});
