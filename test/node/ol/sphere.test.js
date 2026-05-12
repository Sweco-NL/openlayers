import CircularString from '../../../src/ol/geom/CircularString.js';
import CompoundCurve from '../../../src/ol/geom/CompoundCurve.js';
import CurvePolygon from '../../../src/ol/geom/CurvePolygon.js';
import LineString from '../../../src/ol/geom/LineString.js';
import {getArea, getLength} from '../../../src/ol/sphere.js';
import expect from '../expect.js';

describe('ol/sphere.js (curve geometries)', function () {
  describe('getLength()', function () {
    it('returns a finite length for a CircularString', function () {
      // semicircle of radius ~111km at equator
      const cs = new CircularString([
        [0, 0],
        [1, 0.5],
        [2, 0],
      ]);
      const length = getLength(cs, {projection: 'EPSG:4326'});
      expect(isFinite(length)).to.be(true);
      expect(length).to.be.greaterThan(0);
    });

    it('returns a finite length for a CompoundCurve', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 0.5],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      const length = getLength(cc, {projection: 'EPSG:4326'});
      expect(isFinite(length)).to.be(true);
      expect(length).to.be.greaterThan(0);
    });

    it('returns a finite length for a CurvePolygon', function () {
      const ring = new CircularString([
        [0, 0],
        [1, 0.5],
        [0, 1],
        [-1, 0.5],
        [0, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const length = getLength(cp, {projection: 'EPSG:4326'});
      expect(isFinite(length)).to.be(true);
      expect(length).to.be.greaterThan(0);
    });

    it('CircularString length exceeds chord length', function () {
      const cs = new CircularString([
        [0, 0],
        [1, 0.5],
        [2, 0],
      ]);
      const chord = new LineString([
        [0, 0],
        [2, 0],
      ]);
      const arcLength = getLength(cs, {projection: 'EPSG:4326'});
      const chordLength = getLength(chord, {projection: 'EPSG:4326'});
      expect(arcLength).to.be.greaterThan(chordLength);
    });
  });

  describe('getArea()', function () {
    it('returns zero area for a CircularString (line-like)', function () {
      const cs = new CircularString([
        [0, 0],
        [1, 0.5],
        [2, 0],
      ]);
      const area = getArea(cs, {projection: 'EPSG:4326'});
      expect(area).to.be(0);
    });

    it('returns zero area for a CompoundCurve (line-like)', function () {
      const arc = new CircularString([
        [0, 0],
        [1, 0.5],
        [2, 0],
      ]);
      const line = new LineString([
        [2, 0],
        [3, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      const area = getArea(cc, {projection: 'EPSG:4326'});
      expect(area).to.be(0);
    });

    it('returns a finite positive area for a CurvePolygon', function () {
      const ring = new CircularString([
        [0, 0],
        [1, 0.5],
        [0, 1],
        [-1, 0.5],
        [0, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const area = getArea(cp, {projection: 'EPSG:4326'});
      expect(isFinite(area)).to.be(true);
      expect(area).to.be.greaterThan(0);
    });

    it('CurvePolygon area is greater than inscribed rectangle', function () {
      // full circle centered at origin with radius ~1 degree
      const ring = new CircularString([
        [1, 0],
        [-1, 0],
        [1, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      // inscribed rectangle ~1.4 x 1.4 degrees
      const rect = new LineString([
        [0.7, -0.7],
        [0.7, 0.7],
        [-0.7, 0.7],
        [-0.7, -0.7],
        [0.7, -0.7],
      ]);
      const rectPoly = new CurvePolygon([rect]);
      const circleArea = getArea(cp, {projection: 'EPSG:4326'});
      const rectArea = getArea(rectPoly, {projection: 'EPSG:4326'});
      expect(circleArea).to.be.greaterThan(rectArea);
    });
  });
});
