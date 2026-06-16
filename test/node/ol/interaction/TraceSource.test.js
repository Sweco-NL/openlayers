import Collection from '../../../../src/ol/Collection.js';
import Feature from '../../../../src/ol/Feature.js';
import LineString from '../../../../src/ol/geom/LineString.js';
import TraceSource from '../../../../src/ol/interaction/TraceSource.js';
import expect from '../../expect.js';

describe('ol/interaction/TraceSource.js', function () {
  describe('constructor', function () {
    it('accepts an array of features', function () {
      const f = new Feature(
        new LineString([
          [0, 0],
          [1, 1],
        ]),
      );
      const ts = new TraceSource({features: [f]});
      expect(ts.getFeatures()).to.eql([f]);
    });

    it('accepts a Collection of features', function () {
      const f = new Feature(
        new LineString([
          [0, 0],
          [1, 1],
        ]),
      );
      const collection = new Collection([f]);
      const ts = new TraceSource({features: collection});
      expect(ts.getFeatures()).to.eql([f]);
    });

    it('defaults exteriorOnly to true', function () {
      const ts = new TraceSource({features: []});
      expect(ts.getExteriorOnly()).to.be(true);
    });

    it('respects exteriorOnly: false', function () {
      const ts = new TraceSource({features: [], exteriorOnly: false});
      expect(ts.getExteriorOnly()).to.be(false);
    });

    it('returns a defensive copy from getFeatures()', function () {
      const f = new Feature(
        new LineString([
          [0, 0],
          [1, 1],
        ]),
      );
      const ts = new TraceSource({features: [f]});
      const out = ts.getFeatures();
      out.push(
        new Feature(
          new LineString([
            [2, 2],
            [3, 3],
          ]),
        ),
      );
      expect(ts.getFeatures()).to.have.length(1);
    });

    it('reflects the live Collection at the time getFeatures() is called', function () {
      const f1 = new Feature(
        new LineString([
          [0, 0],
          [1, 1],
        ]),
      );
      const f2 = new Feature(
        new LineString([
          [2, 2],
          [3, 3],
        ]),
      );
      const c = new Collection([f1]);
      const ts = new TraceSource({features: c});
      expect(ts.getFeatures()).to.have.length(1);
      c.push(f2);
      expect(ts.getFeatures()).to.have.length(2);
    });

    it('throws when constructed without features', function () {
      expect(function () {
        new TraceSource({});
      }).to.throwException(/TraceSource requires options.features/);
    });
  });
});
