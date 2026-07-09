import {spy as sinonSpy} from 'sinon';
import {isEmpty} from '../../../../src/ol/extent.js';
import CircularString from '../../../../src/ol/geom/CircularString.js';
import CompoundCurve from '../../../../src/ol/geom/CompoundCurve.js';
import LineString from '../../../../src/ol/geom/LineString.js';
import Point from '../../../../src/ol/geom/Point.js';
import expect from '../../expect.js';

describe('ol/geom/CompoundCurve.js', function () {
  describe('construct with arc + line', function () {
    let cc;
    let arc, line;
    beforeEach(function () {
      arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      line = new LineString([
        [2, 0],
        [3, 1],
      ]);
      cc = new CompoundCurve([arc, line]);
    });

    it('has the expected type', function () {
      expect(cc.getType()).to.be('CompoundCurve');
    });

    it('has the expected layout', function () {
      expect(cc.getLayout()).to.be('XY');
    });

    it('has the expected coordinates (junction deduplicated)', function () {
      const coords = cc.getCoordinates();
      expect(coords.length).to.be(4);
      expect(coords[0]).to.eql([0, 0]);
      expect(coords[3]).to.eql([3, 1]);
    });

    it('has the expected extent', function () {
      const extent = cc.getExtent();
      expect(extent[0]).to.be.lessThan(0.01);
      expect(extent[2]).to.be.greaterThan(2.99);
    });

    it('has the expected flat coordinates', function () {
      const flat = cc.getFlatCoordinates();
      expect(flat.length).to.be(8);
      expect(flat[0]).to.be(0);
      expect(flat[1]).to.be(0);
      expect(flat[6]).to.be(3);
      expect(flat[7]).to.be(1);
    });

    it('has the expected stride', function () {
      expect(cc.getStride()).to.be(2);
    });

    it('returns sub-geometries', function () {
      const geoms = cc.getGeometries();
      expect(geoms.length).to.be(2);
      expect(geoms[0].getType()).to.be('CircularString');
      expect(geoms[1].getType()).to.be('LineString');
    });

    describe('#getFirstCoordinate', function () {
      it('returns the first coordinate', function () {
        expect(cc.getFirstCoordinate()).to.eql([0, 0]);
      });
    });

    describe('#getLastCoordinate', function () {
      it('returns the last coordinate', function () {
        expect(cc.getLastCoordinate()).to.eql([3, 1]);
      });
    });

    describe('#getCoordinateAt', function () {
      it('returns the first point when fraction is 0', function () {
        expect(cc.getCoordinateAt(0)).to.eql([0, 0]);
      });

      it('returns the last point when fraction is 1', function () {
        expect(cc.getCoordinateAt(1)).to.eql([3, 1]);
      });

      it('returns a midpoint when fraction is 0.5', function () {
        const mid = cc.getCoordinateAt(0.5);
        expect(mid).to.be.an(Array);
        expect(mid.length).to.be(2);
      });
    });

    describe('#clone', function () {
      it('returns a complete copy', function () {
        const clone = cc.clone();
        expect(clone).to.be.a(CompoundCurve);
        expect(clone.getType()).to.be('CompoundCurve');
        expect(clone.getGeometries().length).to.be(2);
        expect(clone.getGeometries()).not.to.be(cc.getGeometries());
        expect(clone.getCoordinates()).to.eql(cc.getCoordinates());
      });

      it('preserves layout', function () {
        const clone = cc.clone();
        expect(clone.getLayout()).to.be(cc.getLayout());
      });
    });

    describe('#reverse', function () {
      it('reverses coordinates and sub-geometry order', function () {
        const coordsBefore = cc.getCoordinates();
        cc.reverse();
        const coordsAfter = cc.getCoordinates();
        expect(coordsAfter[0]).to.eql(coordsBefore[coordsBefore.length - 1]);
        expect(coordsAfter[coordsAfter.length - 1]).to.eql(coordsBefore[0]);
        const geoms = cc.getGeometries();
        expect(geoms[0].getType()).to.be('LineString');
        expect(geoms[1].getType()).to.be('CircularString');
      });
    });

    describe('#getFlatMidpoint', function () {
      it('returns a flat midpoint', function () {
        const midpoint = cc.getFlatMidpoint();
        expect(midpoint).to.be.an(Array);
        expect(midpoint.length).to.be(2);
      });
    });

    describe('#closestPointXY', function () {
      it('returns a close distance for a point on the curve', function () {
        const closestPoint = [0, 0];
        const sqDist = cc.closestPointXY(0, 0, closestPoint, Infinity);
        expect(sqDist).to.be.lessThan(0.01);
      });
    });

    describe('#applyTransform', function () {
      it('updates coordinates after transform', function () {
        cc.applyTransform(function (input, output, dimension) {
          const dim = dimension || 2;
          for (let i = 0, ii = input.length; i < ii; i += dim) {
            output[i] = input[i] * 2;
            output[i + 1] = input[i + 1] * 2;
          }
          return output;
        });
        const coords = cc.getCoordinates();
        expect(coords[0]).to.eql([0, 0]);
        expect(coords[3][0]).to.roughlyEqual(6, 1e-9);
        expect(coords[3][1]).to.roughlyEqual(2, 1e-9);
      });
    });
  });

  describe('construct with 3D coordinates', function () {
    let cc;
    beforeEach(function () {
      const arc = new CircularString([
        [0, 0, 10],
        [1, 1, 20],
        [2, 0, 30],
      ]);
      const line = new LineString([
        [2, 0, 30],
        [3, 1, 40],
      ]);
      cc = new CompoundCurve([arc, line], 'XYZ');
    });

    it('has the expected layout', function () {
      expect(cc.getLayout()).to.be('XYZ');
    });

    it('has the expected coordinates', function () {
      const coords = cc.getCoordinates();
      expect(coords[0]).to.eql([0, 0, 10]);
      expect(coords[3]).to.eql([3, 1, 40]);
    });

    it('has the expected flat coordinates', function () {
      expect(cc.getFlatCoordinates().length).to.be(12);
    });

    it('has the expected stride', function () {
      expect(cc.getStride()).to.be(3);
    });
  });

  describe('construct with 3D coordinates and layout XYM', function () {
    let cc;
    beforeEach(function () {
      const arc = new CircularString(
        [
          [0, 0, 100],
          [1, 1, 200],
          [2, 0, 300],
        ],
        'XYM',
      );
      const line = new LineString(
        [
          [2, 0, 300],
          [3, 1, 400],
        ],
        'XYM',
      );
      cc = new CompoundCurve([arc, line], 'XYM');
    });

    it('has the expected layout', function () {
      expect(cc.getLayout()).to.be('XYM');
    });

    it('has the expected coordinates', function () {
      const coords = cc.getCoordinates();
      expect(coords[0]).to.eql([0, 0, 100]);
      expect(coords[3]).to.eql([3, 1, 400]);
    });

    it('has the expected flat coordinates', function () {
      expect(cc.getFlatCoordinates().length).to.be(12);
    });

    it('has the expected stride', function () {
      expect(cc.getStride()).to.be(3);
    });
  });

  describe('construct with 4D coordinates', function () {
    let cc;
    beforeEach(function () {
      const arc = new CircularString([
        [0, 0, 10, 100],
        [1, 1, 20, 200],
        [2, 0, 30, 300],
      ]);
      const line = new LineString([
        [2, 0, 30, 300],
        [3, 1, 40, 400],
      ]);
      cc = new CompoundCurve([arc, line], 'XYZM');
    });

    it('has the expected layout', function () {
      expect(cc.getLayout()).to.be('XYZM');
    });

    it('has the expected coordinates', function () {
      const coords = cc.getCoordinates();
      expect(coords[0]).to.eql([0, 0, 10, 100]);
      expect(coords[3]).to.eql([3, 1, 40, 400]);
    });

    it('has the expected flat coordinates', function () {
      expect(cc.getFlatCoordinates().length).to.be(16);
    });

    it('has the expected stride', function () {
      expect(cc.getStride()).to.be(4);
    });
  });

  describe('#scale()', function () {
    it('scales a compound curve', function () {
      const arc = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      const line = new LineString([
        [10, 0],
        [15, 5],
      ]);
      const cc = new CompoundCurve([arc, line]);
      cc.scale(2);
      const coords = cc.getCoordinates();
      expect(coords[0][0]).to.roughlyEqual(-7.5, 1e-9);
      expect(coords[3][0]).to.roughlyEqual(22.5, 1e-9);
    });
  });

  describe('#getLength()', function () {
    it('returns the total length of arc + line', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      const arcLength = arc.getLength();
      const lineLength = line.getLength();
      expect(cc.getLength()).to.roughlyEqual(arcLength + lineLength, 1e-9);
    });
  });

  describe('#getCoordinateAt() arc-aware', function () {
    it('returns a point that lies on the arc portion', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      // at a small fraction, the point should be on the arc
      const arcLen = arc.getLength();
      const totalLen = cc.getLength();
      // fraction that maps to the midpoint of the arc sub-geometry
      const frac = (arcLen * 0.5) / totalLen;
      const pt = cc.getCoordinateAt(frac);
      const arcMid = arc.getCoordinateAt(0.5);
      expect(pt[0]).to.roughlyEqual(arcMid[0], 1e-6);
      expect(pt[1]).to.roughlyEqual(arcMid[1], 1e-6);
    });
  });

  describe('#intersectsExtent()', function () {
    it('returns true when extent intersects a sub-geometry', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      expect(cc.intersectsExtent([0.5, 0.5, 1.5, 1.5])).to.be(true);
    });

    it('returns false when extent is outside', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      expect(cc.intersectsExtent([10, 10, 20, 20])).to.be(false);
    });
  });

  describe('#rotate()', function () {
    it('keeps sub-geometries in sync', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      cc.rotate(Math.PI, [0, 0]);
      const subCoords = cc.getGeometries()[0].getCoordinates();
      expect(subCoords[0][0]).to.roughlyEqual(0, 1e-9);
      expect(subCoords[0][1]).to.roughlyEqual(0, 1e-9);
      // flatCoordinates should match the sub-geometry coordinates
      const flat = cc.getFlatCoordinates();
      expect(flat[0]).to.roughlyEqual(subCoords[0][0], 1e-9);
    });
  });

  describe('#translate()', function () {
    it('keeps sub-geometries in sync', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      cc.translate(10, 20);
      const subCoords = cc.getGeometries()[0].getCoordinates();
      expect(subCoords[0][0]).to.roughlyEqual(10, 1e-9);
      expect(subCoords[0][1]).to.roughlyEqual(20, 1e-9);
      const flat = cc.getFlatCoordinates();
      expect(flat[0]).to.roughlyEqual(10, 1e-9);
      expect(flat[1]).to.roughlyEqual(20, 1e-9);
    });
  });

  describe('#forEachSegment()', function () {
    it('iterates tessellated 2-arg segments across all sub-geometries', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      const segments = [];
      cc.forEachSegment(function (start, end) {
        segments.push({start: start.slice(), end: end.slice()});
      });
      expect(segments.length).to.be.greaterThan(2);
      expect(segments[0].start.length).to.be(2);
      expect(segments[0].end.length).to.be(2);
    });
  });

  describe('#forEachCurveSegment()', function () {
    it('iterates curved and linear segments', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      let count = 0;
      cc.forEachCurveSegment(function () {
        count++;
      });
      expect(count).to.be(2);
    });
  });

  describe('#getGeometries()', function () {
    it('returns cloned copies', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 1],
      ]);
      const cc = new CompoundCurve([arc, line]);
      const geoms1 = cc.getGeometries();
      const geoms2 = cc.getGeometries();
      expect(geoms1).not.to.be(geoms2);
      expect(geoms1[0]).not.to.be(geoms2[0]);
      expect(geoms1[0].getCoordinates()).to.eql(geoms2[0].getCoordinates());
    });

    it('returns clones that do not affect the original', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 1],
      ]);
      const cc = new CompoundCurve([arc, line]);
      const geoms = cc.getGeometries();
      geoms[0].setCoordinates([
        [99, 99],
        [100, 100],
        [101, 99],
      ]);
      // internal should be unchanged
      expect(cc.getGeometriesArray()[0].getCoordinates()[0]).to.eql([0, 0]);
    });
  });

  describe('#getGeometriesArray()', function () {
    it('returns the internal array directly', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 1],
      ]);
      const cc = new CompoundCurve([arc, line]);
      expect(cc.getGeometriesArray()).to.be(cc.getGeometriesArray());
    });
  });

  describe('#setGeometries()', function () {
    let cc, arc, line;
    beforeEach(function () {
      arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      line = new LineString([
        [2, 0],
        [3, 1],
      ]);
      cc = new CompoundCurve([arc, line]);
    });

    it('fires a change event', function () {
      const listener = sinonSpy();
      cc.on('change', listener);
      cc.setGeometries([arc, line]);
      expect(listener.calledOnce).to.be(true);
    });

    it('clones input geometries', function () {
      const newArc = new CircularString([
        [10, 10],
        [11, 11],
        [12, 10],
      ]);
      cc.setGeometries([newArc]);
      // mutate the input after set
      newArc.setCoordinates([
        [99, 99],
        [100, 100],
        [101, 99],
      ]);
      // internal should not be affected
      expect(cc.getGeometriesArray()[0].getCoordinates()[0]).to.eql([10, 10]);
    });

    it('updates the extent', function () {
      cc.getExtent();
      const newArc = new CircularString([
        [100, 100],
        [101, 101],
        [102, 100],
      ]);
      cc.setGeometries([newArc]);
      const extent2 = cc.getExtent();
      expect(extent2[0]).to.be.greaterThan(99);
      expect(extent2[0]).to.be.lessThan(extent2[2]);
    });
  });

  describe('#setGeometriesArray()', function () {
    it('fires a change event', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const cc = new CompoundCurve([arc]);
      const listener = sinonSpy();
      cc.on('change', listener);
      cc.setGeometriesArray([arc]);
      expect(listener.calledOnce).to.be(true);
    });
  });

  describe('change event propagation', function () {
    let cc, arc, line;
    beforeEach(function () {
      arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      line = new LineString([
        [2, 0],
        [3, 1],
      ]);
      cc = new CompoundCurve([arc, line]);
    });

    it('fires a change event when a sub-geometry changes', function (done) {
      cc.on('change', function () {
        done();
      });
      line.setCoordinates([
        [2, 0],
        [4, 2],
      ]);
    });

    it('deregisters old components', function () {
      const newArc = new CircularString([
        [10, 10],
        [11, 11],
        [12, 10],
      ]);
      cc.setGeometries([newArc]);
      cc.on('change', function () {
        expect().fail();
      });
      // modifying old component should not fire change
      line.setCoordinates([
        [2, 0],
        [5, 5],
      ]);
    });

    it('registers new components', function (done) {
      const newLine = new LineString([
        [10, 10],
        [20, 20],
      ]);
      cc.setGeometriesArray([newLine]);
      cc.on('change', function () {
        done();
      });
      newLine.setCoordinates([
        [10, 10],
        [30, 30],
      ]);
    });
  });

  describe('#transform()', function () {
    it('transforms all sub-geometries', function () {
      const arc = new CircularString([
        [10, 20],
        [11, 21],
        [12, 20],
      ]);
      const line = new LineString([
        [12, 20],
        [13, 21],
      ]);
      const cc = new CompoundCurve([arc, line]);
      cc.transform('EPSG:4326', 'EPSG:3857');

      const geoms = cc.getGeometries();
      const arcCoords = geoms[0].getCoordinates();
      expect(arcCoords[0][0]).to.roughlyEqual(1113194.9, 1);
      expect(arcCoords[0][1]).to.roughlyEqual(2273030.92, 1);

      const lineCoords = geoms[1].getCoordinates();
      expect(lineCoords[1][0]).to.roughlyEqual(1447153.38, 1);
      expect(lineCoords[1][1]).to.roughlyEqual(2391878.59, 1);
    });
  });

  describe('#tessellate()', function () {
    it('produces dense coordinates for arc + line', function () {
      const arc = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const line = new LineString([
        [-5, 0],
        [-5, -5],
      ]);
      const cc = new CompoundCurve([arc, line]);
      const flat = cc.tessellate();
      // at least the tessellated arc points + 1 line point
      expect(flat.length).to.be.greaterThan(4);
      expect(flat.length % 2).to.be(0);
      expect(flat[0]).to.roughlyEqual(5, 1e-9);
      expect(flat[1]).to.roughlyEqual(0, 1e-9);
      expect(flat[flat.length - 2]).to.roughlyEqual(-5, 1e-9);
      expect(flat[flat.length - 1]).to.roughlyEqual(-5, 1e-9);
    });

    it('produces segments for snap interaction', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      const flat = cc.tessellate();
      const segmentCount = flat.length / 2 - 1;
      // arc produces 36 segments, line produces 1
      expect(segmentCount).to.be.greaterThan(35);
    });
  });

  describe('with degenerate arc sub-geometry', function () {
    it('handles collinear arc in compound curve', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 0],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 1],
      ]);
      const cc = new CompoundCurve([arc, line]);
      expect(cc.getExtent()).to.be.an(Array);
      expect(cc.getLength()).to.be.greaterThan(0);
    });
  });

  describe('containsXY', function () {
    it('returns false for a point far from the curve', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      expect(cc.containsXY(100, 100)).to.be(false);
    });
  });

  describe('getSimplifiedGeometry', function () {
    it('returns the same instance', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const cc = new CompoundCurve([arc]);
      expect(cc.getSimplifiedGeometry(1)).to.be(cc);
    });
  });

  describe('construct empty', function () {
    let cc;
    beforeEach(function () {
      cc = new CompoundCurve([]);
    });

    it('has an empty extent', function () {
      expect(isEmpty(cc.getExtent())).to.be(true);
    });

    it('has empty coordinates', function () {
      expect(cc.getCoordinates()).to.eql([]);
    });

    it('has zero length', function () {
      expect(cc.getLength()).to.be(0);
    });

    it('returns non-null coordinates (matching base contract)', function () {
      expect(cc.getFirstCoordinate()).to.eql([]);
      expect(cc.getLastCoordinate()).to.eql([]);
      const coord = cc.getCoordinateAt(0.5);
      expect(coord).not.to.be(null);
      expect(coord.every(Number.isNaN)).to.be(true);
    });
  });

  describe('clone', function () {
    it('creates a deep copy', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      const cloned = cc.clone();
      expect(cloned).not.to.be(cc);
      expect(cloned.getType()).to.be('CompoundCurve');
      const origGeoms = cc.getGeometriesArray();
      const clonedGeoms = cloned.getGeometriesArray();
      expect(clonedGeoms.length).to.be(origGeoms.length);
      for (let i = 0; i < origGeoms.length; ++i) {
        expect(clonedGeoms[i]).not.to.be(origGeoms[i]);
      }
    });
  });

  describe('type validation', function () {
    it('throws when constructing with an invalid geometry type', function () {
      const point = new Point([0, 0]);
      expect(function () {
        new CompoundCurve([/** @type {*} */ (point)]);
      }).to.throwException(/must be CircularString or LineString/);
    });

    it('throws when setGeometriesArray receives invalid type', function () {
      const cc = new CompoundCurve([]);
      const point = new Point([0, 0]);
      expect(function () {
        cc.setGeometriesArray([/** @type {*} */ (point)]);
      }).to.throwException(/must be CircularString or LineString/);
    });

    it('accepts CircularString and LineString', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      // should not throw
      const cc = new CompoundCurve([arc, line]);
      expect(cc.getGeometriesArray().length).to.be(2);
    });
  });

  describe('layout validation', function () {
    it('throws when children have mismatched layouts', function () {
      const arc = new CircularString([
        [0, 0, 10],
        [1, 1, 20],
        [2, 0, 30],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      expect(function () {
        new CompoundCurve([arc, line]);
      }).to.throwException(/layout mismatch/);
    });

    it('accepts children with matching layouts', function () {
      const arc = new CircularString([
        [0, 0, 10],
        [1, 1, 20],
        [2, 0, 30],
      ]);
      const line = new LineString([
        [2, 0, 30],
        [3, 0, 40],
      ]);
      const cc = new CompoundCurve([arc, line]);
      expect(cc.getLayout()).to.be('XYZ');
    });
  });

  describe('contiguity validation', function () {
    it('throws when a sub-geometry does not start at the previous end', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [5, 5],
        [6, 5],
      ]);
      expect(function () {
        new CompoundCurve([arc, line]);
      }).to.throwException(/not contiguous|gap|contiguous/i);
    });

    it('throws when setGeometriesArray receives disjoint sub-geometries', function () {
      const cc = new CompoundCurve([]);
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const line = new LineString([
        [5, 5],
        [6, 5],
      ]);
      expect(function () {
        cc.setGeometriesArray([arc, line]);
      }).to.throwException(/contiguous/i);
    });

    it('throws when appendGeometry breaks contiguity', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const cc = new CompoundCurve([arc]);
      const line = new LineString([
        [5, 5],
        [6, 5],
      ]);
      expect(function () {
        cc.appendGeometry(line);
      }).to.throwException(/contiguous/i);
    });

    it('accepts contiguous sub-geometries and appends', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      const cc = new CompoundCurve([arc]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      // should not throw
      cc.appendGeometry(line);
      expect(cc.getGeometriesArray().length).to.be(2);
    });
  });

  describe('exact math: getLength', function () {
    it('equals arc length + line length', function () {
      // semicircle r=5 + horizontal line of length 10
      const arc = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const line = new LineString([
        [-5, 0],
        [-15, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      const expected = Math.PI * 5 + 10;
      expect(cc.getLength()).to.roughlyEqual(expected, 1e-2);
    });
  });

  describe('exact math: getCoordinateAt', function () {
    it('returns start at fraction 0', function () {
      const arc = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const line = new LineString([
        [-5, 0],
        [-15, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      const coord = cc.getCoordinateAt(0);
      expect(coord[0]).to.roughlyEqual(5, 1e-9);
      expect(coord[1]).to.roughlyEqual(0, 1e-9);
    });

    it('returns end at fraction 1', function () {
      const arc = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const line = new LineString([
        [-5, 0],
        [-15, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      const coord = cc.getCoordinateAt(1);
      expect(coord[0]).to.roughlyEqual(-15, 1e-9);
      expect(coord[1]).to.roughlyEqual(0, 1e-9);
    });
  });

  describe('exact math: single sub-geometry', function () {
    it('works with a single CircularString', function () {
      const arc = new CircularString([
        [5, 0],
        [0, 5],
        [-5, 0],
      ]);
      const cc = new CompoundCurve([arc]);
      expect(cc.getLength()).to.roughlyEqual(Math.PI * 5, 1e-2);
      expect(cc.getType()).to.be('CompoundCurve');
    });

    it('works with a single LineString', function () {
      const line = new LineString([
        [0, 0],
        [3, 4],
      ]);
      const cc = new CompoundCurve([line]);
      expect(cc.getLength()).to.roughlyEqual(5, 1e-9);
    });
  });

  describe('cache invalidation', function () {
    it('getFlatCoordinates updates after sub-geometry modification', function () {
      const line = new LineString([
        [0, 0],
        [10, 0],
      ]);
      const cc = new CompoundCurve([line]);
      const flat1 = cc.getFlatCoordinates();
      expect(flat1[2]).to.be(10);

      line.setCoordinates([
        [0, 0],
        [20, 0],
      ]);
      const flat2 = cc.getFlatCoordinates();
      expect(flat2[2]).to.be(20);
    });

    it('getFlatCoordinates updates after setGeometries', function () {
      const line1 = new LineString([
        [0, 0],
        [5, 0],
      ]);
      const cc = new CompoundCurve([line1]);
      expect(cc.getFlatCoordinates().length).to.be(4);

      const arc = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      cc.setGeometries([arc]);
      const flat = cc.getFlatCoordinates();
      expect(flat.length).to.be.greaterThan(4);
    });

    it('getFlatCoordinates updates after CircularString sub-geometry changes', function () {
      const arc = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      const cc = new CompoundCurve([arc]);
      cc.getFlatCoordinates();

      arc.setCoordinates([
        [0, 0],
        [10, 10],
        [20, 0],
      ]);
      const flat2 = cc.getFlatCoordinates();
      // New arc is larger, tessellation may differ
      expect(flat2[flat2.length - 2]).to.be(20);
    });
  });
});
