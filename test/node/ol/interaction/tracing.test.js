import Feature from '../../../../src/ol/Feature.js';
import CircularString from '../../../../src/ol/geom/CircularString.js';
import CompoundCurve from '../../../../src/ol/geom/CompoundCurve.js';
import CurvePolygon from '../../../../src/ol/geom/CurvePolygon.js';
import LineString from '../../../../src/ol/geom/LineString.js';
import MultiLineString from '../../../../src/ol/geom/MultiLineString.js';
import MultiPolygon from '../../../../src/ol/geom/MultiPolygon.js';
import Polygon from '../../../../src/ol/geom/Polygon.js';
import {
  coordinatesEqualXY,
  getTraceTargetUpdate,
  getTraceTargets,
  isTraceTargetVertexIndex,
} from '../../../../src/ol/interaction/tracing.js';
import expect from '../../expect.js';

describe('ol/interaction/tracing.js', function () {
  describe('getTraceTargetUpdate()', function () {
    it('does not switch from an outer ring to a non-shared inner ring', function () {
      const outer = new CircularString([
        [-3000000, 1000000],
        [-1500000, 2500000],
        [0, 1000000],
        [-1500000, -500000],
        [-3000000, 1000000],
      ]);
      const inner = new CircularString([
        [-1500000, 1600000],
        [-1900000, 1550000],
        [-2100000, 1200000],
        [-2150000, 550000],
        [-1500000, 300000],
        [-1100000, 500000],
        [-900000, 1000000],
        [-1050000, 1450000],
        [-1500000, 1600000],
      ]);
      const feature = new Feature(new CurvePolygon([outer, inner]));

      const outerTarget = getTraceTargets([-3000000, 1000000], [feature])[0];
      const innerTarget = getTraceTargets([-2100000, 1200000], [feature])[0];
      outerTarget.endIndex = outerTarget.startIndex + 1;

      const update = getTraceTargetUpdate(
        [-2100000, 1200000],
        {
          active: true,
          startCoord: [-3000000, 1000000],
          targets: [outerTarget, innerTarget],
          targetIndex: 0,
        },
        {
          getPixelFromCoordinate(coordinate) {
            return coordinate;
          },
        },
        10,
      );

      expect(update.index).to.be(0);
    });
  });

  describe('isTraceTargetVertexIndex()', function () {
    it('does not treat CircularString midpoint controls as trace pivot vertices', function () {
      const ring = new CircularString([
        [0, 0],
        [50, 50],
        [100, 0],
        [50, -50],
        [0, 0],
      ]);
      const feature = new Feature(new CurvePolygon([ring]));

      const midpointTargets = getTraceTargets([50, -50], [feature]);
      expect(midpointTargets.length).to.be(1);
      expect(
        isTraceTargetVertexIndex(
          midpointTargets[0],
          midpointTargets[0].startIndex,
        ),
      ).to.be(false);

      const endpointTargets = getTraceTargets([100, 0], [feature]);
      expect(endpointTargets.length).to.be(1);
      expect(
        isTraceTargetVertexIndex(
          endpointTargets[0],
          endpointTargets[0].startIndex,
        ),
      ).to.be(true);
    });

    it('treats LineString vertices in CompoundCurve targets as trace pivot vertices', function () {
      const curve = new CompoundCurve([
        new CircularString([
          [0, 0],
          [50, 50],
          [100, 0],
        ]),
        new LineString([
          [100, 0],
          [150, 0],
          [150, 50],
        ]),
      ]);
      const feature = new Feature(curve);

      const targets = getTraceTargets([150, 0], [feature]);
      expect(targets.length).to.be(1);
      expect(isTraceTargetVertexIndex(targets[0], targets[0].startIndex)).to.be(
        true,
      );
    });
  });

  describe('source attribution on trace targets', function () {
    it('attaches feature and geometry to LineString targets', function () {
      const line = new LineString([
        [0, 0],
        [10, 0],
        [10, 10],
      ]);
      const feature = new Feature(line);
      const targets = getTraceTargets([10, 0], [feature]);
      expect(targets.length).to.be(1);
      expect(targets[0].feature).to.be(feature);
      expect(targets[0].geometry).to.be(line);
      expect(targets[0].ringIndex).to.be(undefined);
    });

    it('attaches the MultiLineString itself to MultiLineString targets', function () {
      const mls = new MultiLineString([
        [
          [0, 0],
          [10, 0],
        ],
        [
          [20, 0],
          [30, 0],
        ],
      ]);
      const feature = new Feature(mls);
      const targets = getTraceTargets([10, 0], [feature]);
      expect(targets.length).to.be(1);
      expect(targets[0].feature).to.be(feature);
      expect(targets[0].geometry).to.be(mls);
      expect(targets[0].ringIndex).to.be(undefined);
    });

    it('attaches top-level Polygon geometry and ringIndex to Polygon targets', function () {
      const poly = new Polygon([
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [2, 2],
          [4, 2],
          [4, 4],
          [2, 4],
          [2, 2],
        ],
      ]);
      const feature = new Feature(poly);
      const outerTargets = getTraceTargets([10, 0], [feature]);
      expect(outerTargets.length).to.be(1);
      expect(outerTargets[0].feature).to.be(feature);
      expect(outerTargets[0].geometry).to.be(poly);
      expect(outerTargets[0].ringIndex).to.be(0);
      const innerTargets = getTraceTargets([4, 2], [feature]);
      expect(innerTargets[0].ringIndex).to.be(1);
    });

    it('attaches the MultiPolygon itself to MultiPolygon targets', function () {
      const mp = new MultiPolygon([
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
        [
          [
            [20, 0],
            [30, 0],
            [30, 10],
            [20, 10],
            [20, 0],
          ],
        ],
      ]);
      const feature = new Feature(mp);
      const targets = getTraceTargets([10, 0], [feature]);
      expect(targets.length).to.be(1);
      expect(targets[0].geometry).to.be(mp);
      expect(targets[0].ringIndex).to.be(undefined);
    });

    it('attaches ring geometry and ringIndex to CurvePolygon targets', function () {
      const outer = new CircularString([
        [0, 0],
        [10, 10],
        [20, 0],
        [10, -10],
        [0, 0],
      ]);
      const inner = new LineString([
        [4, 0],
        [8, 4],
        [12, 0],
        [8, -4],
        [4, 0],
      ]);
      const cp = new CurvePolygon([outer, inner]);
      const feature = new Feature(cp);
      const outerTargets = getTraceTargets([0, 0], [feature]);
      expect(outerTargets.length).to.be(1);
      expect(outerTargets[0].geometry).to.be(outer);
      expect(outerTargets[0].ringIndex).to.be(0);
      const innerTargets = getTraceTargets([4, 0], [feature]);
      expect(innerTargets[0].geometry).to.be(inner);
      expect(innerTargets[0].ringIndex).to.be(1);
    });

    it('attaches the CompoundCurve itself to CompoundCurve targets', function () {
      const curve = new CompoundCurve([
        new CircularString([
          [0, 0],
          [50, 50],
          [100, 0],
        ]),
        new LineString([
          [100, 0],
          [150, 0],
        ]),
      ]);
      const feature = new Feature(curve);
      const targets = getTraceTargets([150, 0], [feature]);
      expect(targets.length).to.be(1);
      expect(targets[0].geometry).to.be(curve);
      expect(targets[0].ringIndex).to.be(undefined);
    });
  });

  describe('coordinatesEqualXY()', function () {
    it('returns true for exact-equal coordinates', function () {
      expect(coordinatesEqualXY([1, 2], [1, 2])).to.be(true);
    });
    it('returns false for unequal coordinates', function () {
      expect(coordinatesEqualXY([1, 2], [1, 2.0000001])).to.be(false);
    });
    it('ignores Z/M components', function () {
      expect(coordinatesEqualXY([1, 2, 3], [1, 2, 99])).to.be(true);
    });
  });

  describe('bit-exact tessellation endpoint invariant', function () {
    // The whole trace topology rests on tessellate() emitting arc control
    // points *verbatim* (the j===0 / j===numSeg / j===midStep branches copy the
    // stored flat coordinates rather than recomputing them). getTraceVertexIndices_
    // then matches them with coordinatesEqualXY (exact ===). If a future change
    // recomputes endpoints instead of copying, vertexIndices silently empties and
    // trace target switching stops. These tests fail loudly if that invariant breaks.

    // Two exact semicircles: arc 1 center (10,0) r=10 up, arc 2 center (30,0) r=10 down.
    const controlPoints = [
      [0, 0],
      [10, 10],
      [20, 0],
      [30, -10],
      [40, 0],
    ];
    const arcEndpoints = [
      [0, 0],
      [20, 0],
      [40, 0],
    ];

    it('emits every control point verbatim (strict === in the flat output)', function () {
      const curve = new CircularString(controlPoints);
      const flat = curve.tessellate();
      for (const [px, py] of controlPoints) {
        let found = false;
        for (let i = 0; i < flat.length; i += 2) {
          // Strict equality on purpose: coordinatesEqualXY relies on it.
          if (flat[i] === px && flat[i + 1] === py) {
            found = true;
            break;
          }
        }
        expect(found).to.be(true);
      }
      // First and last emitted coordinates are exactly the first/last control points.
      expect(flat[0]).to.be(0);
      expect(flat[1]).to.be(0);
      expect(flat[flat.length - 2]).to.be(40);
      expect(flat[flat.length - 1]).to.be(0);
    });

    it('produces non-empty vertexIndices that land exactly on arc endpoints', function () {
      const curve = new CircularString(controlPoints);
      const feature = new Feature(curve);
      // Click exactly on an arc endpoint, which lies on the tessellated polyline.
      const targets = getTraceTargets([20, 0], [feature]);
      expect(targets.length).to.be(1);
      const target = targets[0];
      expect(target.vertexIndices).to.be.an('array');
      expect(target.vertexIndices.length).to.be.greaterThan(0);
      for (const index of target.vertexIndices) {
        const coord = target.coordinates[index];
        const onEndpoint = arcEndpoints.some(
          ([px, py]) => coord[0] === px && coord[1] === py,
        );
        expect(onEndpoint).to.be(true);
      }
    });
  });
});
