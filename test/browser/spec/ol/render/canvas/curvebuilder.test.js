import Feature from '../../../../../../src/ol/Feature.js';
import CircularString from '../../../../../../src/ol/geom/CircularString.js';
import CompoundCurve from '../../../../../../src/ol/geom/CompoundCurve.js';
import CurvePolygon from '../../../../../../src/ol/geom/CurvePolygon.js';
import LineString from '../../../../../../src/ol/geom/LineString.js';
import BuilderGroup from '../../../../../../src/ol/render/canvas/BuilderGroup.js';
import ExecutorGroup from '../../../../../../src/ol/render/canvas/ExecutorGroup.js';
import {renderFeature} from '../../../../../../src/ol/renderer/vector.js';
import Fill from '../../../../../../src/ol/style/Fill.js';
import Stroke from '../../../../../../src/ol/style/Stroke.js';
import Style from '../../../../../../src/ol/style/Style.js';
import {create as createTransform} from '../../../../../../src/ol/transform.js';

describe('ol.render.canvas.CurveBuilder', function () {
  let context, builder, transform;
  let fillCount, strokeCount, beginPathCount, moveToCount, lineToCount;
  let arcCount, closePathCount;
  let sequence;

  /**
   * @param {BuilderGroup} builder The builder to get instructions from.
   */
  function execute(builder) {
    const executor = new ExecutorGroup(
      [-180, -90, 180, 90],
      1,
      1,
      false,
      builder.finish(),
    );
    executor.execute(context, 1, transform, 0, false);
  }

  beforeEach(function () {
    transform = createTransform();
    builder = new BuilderGroup(1, [-180, -90, 180, 90], 1, 1, false);
    sequence = [];
    fillCount = 0;
    strokeCount = 0;
    beginPathCount = 0;
    moveToCount = 0;
    lineToCount = 0;
    arcCount = 0;
    closePathCount = 0;
    context = {
      fill: function () {
        sequence.push('fill');
        fillCount++;
      },
      stroke: function () {
        sequence.push('stroke');
        strokeCount++;
      },
      beginPath: function () {
        sequence.push('beginPath');
        beginPathCount++;
      },
      moveTo: function () {
        sequence.push('moveTo');
        moveToCount++;
      },
      lineTo: function () {
        sequence.push('lineTo');
        lineToCount++;
      },
      arc: function () {
        sequence.push('arc');
        arcCount++;
      },
      closePath: function () {
        sequence.push('closePath');
        closePathCount++;
      },
      clip: function () {
        sequence.push('clip');
        // undo the beginPath, moveTo and lineTo counts for clipping
        beginPathCount--;
        moveToCount--;
        lineToCount -= 3;
      },
      setLineDash: function () {
        sequence.push('setLineDash');
      },
      save: function () {},
      restore: function () {},
      translate: function () {},
      rotate: function () {},
    };
  });

  describe('CircularString', function () {
    it('strokes a CircularString', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      const feature = new Feature(cs);
      const style = new Style({
        stroke: new Stroke({color: 'red', width: 2}),
      });
      renderFeature(builder, feature, style, 1);
      execute(builder);
      expect(beginPathCount).to.be(1);
      expect(moveToCount).to.be(1);
      expect(arcCount).to.be.greaterThan(0);
      expect(strokeCount).to.be(1);
    });

    it('does not fill a CircularString', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      const feature = new Feature(cs);
      const style = new Style({
        stroke: new Stroke({color: 'red', width: 2}),
      });
      renderFeature(builder, feature, style, 1);
      execute(builder);
      expect(fillCount).to.be(0);
    });

    it('does not render without a stroke style', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      const feature = new Feature(cs);
      const style = new Style({});
      renderFeature(builder, feature, style, 1);
      execute(builder);
      expect(beginPathCount).to.be(0);
      expect(arcCount).to.be(0);
      expect(strokeCount).to.be(0);
    });

    it('produces the correct operation sequence', function () {
      const cs = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      const feature = new Feature(cs);
      const style = new Style({
        stroke: new Stroke({color: 'red', width: 2}),
      });
      renderFeature(builder, feature, style, 1);
      execute(builder);
      const idx = {
        beginPath: sequence.indexOf('beginPath'),
        moveTo: sequence.indexOf('moveTo'),
        arc: sequence.indexOf('arc'),
        stroke: sequence.indexOf('stroke'),
      };
      expect(idx.beginPath).to.be.lessThan(idx.moveTo);
      expect(idx.moveTo).to.be.lessThan(idx.arc);
      expect(idx.arc).to.be.lessThan(idx.stroke);
    });
  });

  describe('CompoundCurve', function () {
    it('strokes a CompoundCurve with arc and line segments', function () {
      const arc = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      const line = new LineString([
        [10, 0],
        [20, 0],
      ]);
      const cc = new CompoundCurve([arc, line]);
      const feature = new Feature(cc);
      const style = new Style({
        stroke: new Stroke({color: 'blue', width: 1}),
      });
      renderFeature(builder, feature, style, 1);
      execute(builder);
      expect(beginPathCount).to.be(1);
      expect(arcCount).to.be.greaterThan(0);
      expect(lineToCount).to.be.greaterThan(0);
      expect(strokeCount).to.be(1);
    });

    it('handles mixed CS-LS-CS segments', function () {
      const arc1 = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      const line = new LineString([
        [10, 0],
        [15, 0],
      ]);
      const arc2 = new CircularString([
        [15, 0],
        [20, 5],
        [25, 0],
      ]);
      const cc = new CompoundCurve([arc1, line, arc2]);
      const feature = new Feature(cc);
      const style = new Style({
        stroke: new Stroke({color: 'blue', width: 1}),
      });
      renderFeature(builder, feature, style, 1);
      execute(builder);
      expect(arcCount).to.be.greaterThan(1);
      expect(lineToCount).to.be.greaterThan(0);
      expect(strokeCount).to.be(1);
    });
  });

  describe('CurvePolygon', function () {
    it('fills a CurvePolygon with fill-only style', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const feature = new Feature(cp);
      const style = new Style({
        fill: new Fill({color: 'green'}),
      });
      renderFeature(builder, feature, style, 1);
      execute(builder);
      expect(fillCount).to.be(1);
      expect(strokeCount).to.be(0);
      expect(arcCount).to.be.greaterThan(0);
    });

    it('strokes a CurvePolygon with stroke-only style', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const feature = new Feature(cp);
      const style = new Style({
        stroke: new Stroke({color: 'red', width: 1}),
      });
      renderFeature(builder, feature, style, 1);
      execute(builder);
      expect(strokeCount).to.be(1);
      expect(fillCount).to.be(0);
      expect(closePathCount).to.be.greaterThan(0);
    });

    it('fills and strokes a CurvePolygon', function () {
      const ring = new CircularString([
        [5, 0],
        [-5, 0],
        [5, 0],
      ]);
      const cp = new CurvePolygon([ring]);
      const feature = new Feature(cp);
      const style = new Style({
        fill: new Fill({color: 'green'}),
        stroke: new Stroke({color: 'red', width: 1}),
      });
      renderFeature(builder, feature, style, 1);
      execute(builder);
      expect(fillCount).to.be(1);
      expect(strokeCount).to.be(1);
    });

    it('emits closePath for each ring in a polygon with a hole', function () {
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
      const feature = new Feature(cp);
      const style = new Style({
        fill: new Fill({color: 'green'}),
        stroke: new Stroke({color: 'red', width: 1}),
      });
      renderFeature(builder, feature, style, 1);
      execute(builder);
      expect(closePathCount).to.be(2);
      expect(fillCount).to.be(1);
      expect(strokeCount).to.be(1);
    });

    it('handles a CurvePolygon with a CompoundCurve ring', function () {
      const arc = new CircularString([
        [0, 0],
        [5, 5],
        [10, 0],
      ]);
      const line = new LineString([
        [10, 0],
        [0, 0],
      ]);
      const ccRing = new CompoundCurve([arc, line]);
      const cp = new CurvePolygon([ccRing]);
      const feature = new Feature(cp);
      const style = new Style({
        fill: new Fill({color: 'green'}),
        stroke: new Stroke({color: 'red', width: 1}),
      });
      renderFeature(builder, feature, style, 1);
      execute(builder);
      expect(arcCount).to.be.greaterThan(0);
      expect(lineToCount).to.be.greaterThan(0);
      expect(fillCount).to.be(1);
      expect(strokeCount).to.be(1);
    });

    it('handles a CurvePolygon with a LineString ring', function () {
      const lsRing = new LineString([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ]);
      const cp = new CurvePolygon([lsRing]);
      const feature = new Feature(cp);
      const style = new Style({
        fill: new Fill({color: 'green'}),
        stroke: new Stroke({color: 'red', width: 1}),
      });
      renderFeature(builder, feature, style, 1);
      execute(builder);
      expect(arcCount).to.be(0);
      expect(lineToCount).to.be.greaterThan(0);
      expect(fillCount).to.be(1);
      expect(strokeCount).to.be(1);
    });
  });
});
