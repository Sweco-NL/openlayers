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
  });
});
