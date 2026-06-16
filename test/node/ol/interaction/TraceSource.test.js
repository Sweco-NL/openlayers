import Collection from '../../../../src/ol/Collection.js';
import Feature from '../../../../src/ol/Feature.js';
import CircularString from '../../../../src/ol/geom/CircularString.js';
import CompoundCurve from '../../../../src/ol/geom/CompoundCurve.js';
import CurvePolygon from '../../../../src/ol/geom/CurvePolygon.js';
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

  describe('graph building (curves)', function () {
    it('creates one edge per arc triplet on a CircularString feature', function () {
      // 5 coordinates = 2 arc triplets (coords [0..2] and [2..4]).
      const f = new Feature(
        new CircularString([
          [0, 0],
          [1, 1],
          [2, 0],
          [3, -1],
          [4, 0],
        ]),
      );
      const ts = new TraceSource({features: [f]});
      const arcEdges = ts.getEdges().filter((e) => e.kind === 'CircularString');
      expect(arcEdges).to.have.length(2);
      expect(arcEdges[0].subGeometry).to.be(f.getGeometry());
      expect(arcEdges[0].segmentIndex).to.be(undefined);
      expect(arcEdges[0].startVertex.coordinate).to.eql([0, 0]);
      expect(arcEdges[0].endVertex.coordinate).to.eql([2, 0]);
    });

    it('creates one edge per sub on a CompoundCurve feature', function () {
      const compound = new CompoundCurve([
        new CircularString([
          [0, 0],
          [1, 1],
          [2, 0],
        ]),
        new LineString([
          [2, 0],
          [3, 0],
        ]),
      ]);
      const f = new Feature(compound);
      const ts = new TraceSource({features: [f]});
      const edges = ts.getEdges();
      expect(edges).to.have.length(2);
      expect(edges[0].kind).to.be('CircularString');
      expect(edges[1].kind).to.be('LineString');
      expect(edges[0].endVertex).to.be(edges[1].startVertex);
    });

    it('walks each ring of a CurvePolygon', function () {
      const outer = new CircularString([
        [0, 0],
        [10, 10],
        [20, 0],
        [10, -10],
        [0, 0],
      ]);
      const f = new Feature(new CurvePolygon([outer]));
      const ts = new TraceSource({features: [f]});
      const arcEdges = ts.getEdges().filter((e) => e.kind === 'CircularString');
      expect(arcEdges).to.have.length(2);
    });

    it('excludes CurvePolygon interior rings by default', function () {
      const outer = new CircularString([
        [0, 0],
        [10, 10],
        [20, 0],
        [10, -10],
        [0, 0],
      ]);
      const inner = new CircularString([
        [5, 0],
        [8, 3],
        [11, 0],
        [8, -3],
        [5, 0],
      ]);
      const f = new Feature(new CurvePolygon([outer, inner]));
      const ts = new TraceSource({features: [f]});
      const arcEdges = ts.getEdges().filter((e) => e.kind === 'CircularString');
      expect(arcEdges).to.have.length(2); // only the 2 outer arc triplets
    });

    it('includes CurvePolygon interior rings when exteriorOnly is false', function () {
      const outer = new CircularString([
        [0, 0],
        [10, 10],
        [20, 0],
        [10, -10],
        [0, 0],
      ]);
      const inner = new CircularString([
        [5, 0],
        [8, 3],
        [11, 0],
        [8, -3],
        [5, 0],
      ]);
      const f = new Feature(new CurvePolygon([outer, inner]));
      const ts = new TraceSource({features: [f], exteriorOnly: false});
      const arcEdges = ts.getEdges().filter((e) => e.kind === 'CircularString');
      expect(arcEdges).to.have.length(4); // 2 outer + 2 inner
    });
  });

  describe('query API', function () {
    it('getNearestVertex returns null when no vertex is within tolerance', function () {
      const f = new Feature(
        new LineString([
          [0, 0],
          [10, 0],
        ]),
      );
      const ts = new TraceSource({features: [f]});
      const hit = ts.getNearestVertex([5, 5], 1);
      expect(hit).to.be(null);
    });

    it('getNearestVertex returns the closest vertex within tolerance', function () {
      const f = new Feature(
        new LineString([
          [0, 0],
          [10, 0],
        ]),
      );
      const ts = new TraceSource({features: [f]});
      const hit = ts.getNearestVertex([0.5, 0], 2);
      expect(hit).to.not.be(null);
      expect(hit.vertex.coordinate).to.eql([0, 0]);
      expect(hit.squaredDistance).to.be(0.25);
    });

    it('getActiveEdge returns the closest edge when no previous edge given', function () {
      const f = new Feature(
        new LineString([
          [0, 0],
          [10, 0],
          [10, 10],
        ]),
      );
      const ts = new TraceSource({features: [f]});
      const edge = ts.getActiveEdge([5, 1], 5, null);
      expect(edge).to.not.be(null);
      expect(edge.segmentIndex).to.be(0); // along the horizontal segment
    });

    it('getActiveEdge sticks to the previous edge when cursor sits on a shared vertex', function () {
      // Two segments meeting at [10, 0]. Cursor sits exactly on the shared vertex.
      const f = new Feature(
        new LineString([
          [0, 0],
          [10, 0],
          [10, 10],
        ]),
      );
      const ts = new TraceSource({features: [f]});
      const edges = ts.getEdges();
      const previous = edges[0]; // we walked in on segment 0
      const edge = ts.getActiveEdge([10, 0], 1, previous);
      expect(edge).to.be(previous); // sticky tie-break
    });

    it('getActiveEdge switches when cursor moves clearly closer to a different edge', function () {
      const f = new Feature(
        new LineString([
          [0, 0],
          [10, 0],
          [10, 10],
        ]),
      );
      const ts = new TraceSource({features: [f]});
      const edges = ts.getEdges();
      const previous = edges[0];
      const edge = ts.getActiveEdge([10, 5], 1, previous);
      expect(edge).to.be(edges[1]);
    });
  });

  describe('live updates', function () {
    it('invalidates the graph cache when a feature is added to the collection', function () {
      const collection = new Collection();
      const ts = new TraceSource({features: collection});
      expect(ts.getEdgeCount()).to.be(0);

      collection.push(
        new Feature(
          new LineString([
            [0, 0],
            [1, 1],
          ]),
        ),
      );
      expect(ts.getEdgeCount()).to.be(1);
    });

    it('invalidates the graph cache when a feature is removed', function () {
      const f = new Feature(
        new LineString([
          [0, 0],
          [1, 1],
        ]),
      );
      const collection = new Collection([f]);
      const ts = new TraceSource({features: collection});
      expect(ts.getEdgeCount()).to.be(1);

      collection.remove(f);
      expect(ts.getEdgeCount()).to.be(0);
    });

    it('does not invalidate when features is a plain array', function () {
      const arr = [
        new Feature(
          new LineString([
            [0, 0],
            [1, 1],
          ]),
        ),
      ];
      const ts = new TraceSource({features: arr});
      expect(ts.getEdgeCount()).to.be(1);
      arr.push(
        new Feature(
          new LineString([
            [2, 2],
            [3, 3],
          ]),
        ),
      );
      // Plain arrays are static; cache stays.
      expect(ts.getEdgeCount()).to.be(1);
    });

    it('dispose() detaches listeners (no throw on subsequent collection mutation)', function () {
      const collection = new Collection();
      const ts = new TraceSource({features: collection});
      ts.dispose();
      expect(function () {
        collection.push(
          new Feature(
            new LineString([
              [0, 0],
              [1, 1],
            ]),
          ),
        );
      }).to.not.throwException();
    });
  });
});
