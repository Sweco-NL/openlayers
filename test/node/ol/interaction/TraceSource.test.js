import Collection from '../../../../src/ol/Collection.js';
import Feature from '../../../../src/ol/Feature.js';
import LineString from '../../../../src/ol/geom/LineString.js';
import Polygon from '../../../../src/ol/geom/Polygon.js';
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

  describe('graph building (vertices)', function () {
    it('unifies shared vertices across two LineString features', function () {
      // Two lines sharing the point [1, 1].
      const a = new Feature(
        new LineString([
          [0, 0],
          [1, 1],
        ]),
      );
      const b = new Feature(
        new LineString([
          [1, 1],
          [2, 2],
        ]),
      );
      const ts = new TraceSource({features: [a, b]});
      // Three distinct vertices: [0,0], [1,1] (shared), [2,2].
      expect(ts.getVertexCount()).to.be(3);
    });

    it('counts every distinct vertex across two disjoint LineStrings', function () {
      const a = new Feature(
        new LineString([
          [0, 0],
          [1, 1],
        ]),
      );
      const b = new Feature(
        new LineString([
          [10, 10],
          [11, 11],
        ]),
      );
      const ts = new TraceSource({features: [a, b]});
      expect(ts.getVertexCount()).to.be(4);
    });

    it('treats a Polygon ring as a closed sequence of vertices', function () {
      // Polygon with 4 distinct vertices; the closing coord equals the first.
      const ring = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ];
      const f = new Feature(new Polygon([ring]));
      const ts = new TraceSource({features: [f]});
      expect(ts.getVertexCount()).to.be(4);
    });

    it('excludes interior polygon rings by default', function () {
      const outer = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ];
      const hole = [
        [2, 2],
        [4, 2],
        [4, 4],
        [2, 4],
        [2, 2],
      ];
      const f = new Feature(new Polygon([outer, hole]));
      const ts = new TraceSource({features: [f]});
      expect(ts.getVertexCount()).to.be(4);
    });

    it('includes interior polygon rings when exteriorOnly is false', function () {
      const outer = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ];
      const hole = [
        [2, 2],
        [4, 2],
        [4, 4],
        [2, 4],
        [2, 2],
      ];
      const f = new Feature(new Polygon([outer, hole]));
      const ts = new TraceSource({features: [f], exteriorOnly: false});
      expect(ts.getVertexCount()).to.be(8);
    });

    it('handles a Polygon with no rings without throwing', function () {
      const f = new Feature(new Polygon([]));
      const ts = new TraceSource({features: [f]});
      expect(ts.getVertexCount()).to.be(0);
    });
  });

  describe('graph building (edges)', function () {
    it('creates one edge per LineString segment', function () {
      const f = new Feature(
        new LineString([
          [0, 0],
          [1, 1],
          [2, 2],
        ]),
      );
      const ts = new TraceSource({features: [f]});
      expect(ts.getEdgeCount()).to.be(2);
    });

    it('creates one edge per Polygon ring segment', function () {
      const f = new Feature(
        new Polygon([
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ]),
      );
      const ts = new TraceSource({features: [f]});
      // 4 sides of the square.
      expect(ts.getEdgeCount()).to.be(4);
    });

    it('LineString edges carry kind="LineString" and a segmentIndex', function () {
      const f = new Feature(
        new LineString([
          [0, 0],
          [1, 1],
          [2, 2],
        ]),
      );
      const ts = new TraceSource({features: [f]});
      const edges = ts.getEdges();
      expect(edges).to.have.length(2);
      expect(edges[0].kind).to.be('LineString');
      expect(edges[0].subGeometry).to.be(f.getGeometry());
      expect(edges[0].segmentIndex).to.be(0);
      expect(edges[1].segmentIndex).to.be(1);
    });

    it('edges reference the shared vertex when two LineStrings meet', function () {
      const a = new Feature(
        new LineString([
          [0, 0],
          [1, 1],
        ]),
      );
      const b = new Feature(
        new LineString([
          [1, 1],
          [2, 2],
        ]),
      );
      const ts = new TraceSource({features: [a, b]});
      const edges = ts.getEdges();
      expect(edges).to.have.length(2);
      // Vertex with coord [1,1] should appear as endVertex of edge 0 and startVertex of edge 1.
      expect(edges[0].endVertex.coordinate).to.eql([1, 1]);
      expect(edges[1].startVertex.coordinate).to.eql([1, 1]);
      expect(edges[0].endVertex).to.be(edges[1].startVertex);
    });
  });
});
