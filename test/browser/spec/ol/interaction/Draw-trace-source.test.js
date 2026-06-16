import Feature from '../../../../../src/ol/Feature.js';
import LineString from '../../../../../src/ol/geom/LineString.js';
import Draw from '../../../../../src/ol/interaction/Draw.js';
import TraceSource from '../../../../../src/ol/interaction/TraceSource.js';
import VectorLayer from '../../../../../src/ol/layer/Vector.js';
import Map from '../../../../../src/ol/Map.js';
import VectorSource from '../../../../../src/ol/source/Vector.js';
import View from '../../../../../src/ol/View.js';

describe('ol/interaction/Draw with TraceSource', function () {
  let map, target, source, traceSource;

  beforeEach(function () {
    target = document.createElement('div');
    target.style.width = '100px';
    target.style.height = '100px';
    document.body.appendChild(target);
    source = new VectorSource({
      features: [
        new Feature(
          new LineString([
            [0, 0],
            [1, 1],
          ]),
        ),
      ],
    });
    traceSource = new TraceSource({features: source.getFeaturesCollection()});
    map = new Map({
      target: target,
      layers: [new VectorLayer({source: source})],
      view: new View({center: [0, 0], resolution: 1}),
    });
  });

  afterEach(function () {
    map.dispose();
    document.body.removeChild(target);
  });

  describe('option wiring', function () {
    it('accepts a TraceSource via traceSource option', function () {
      const draw = new Draw({
        source: source,
        type: 'LineString',
        trace: true,
        traceSource: traceSource,
      });
      expect(draw.getTraceSource()).to.be(traceSource);
    });

    it('still accepts a VectorSource via traceSource option', function () {
      const draw = new Draw({
        source: source,
        type: 'LineString',
        trace: true,
        traceSource: source,
      });
      expect(draw.getTraceSource()).to.be(source);
    });
  });

  // Helper: simulate a pointer event sequence at a map pixel position.
  function simulateEvent(type, x, y) {
    const evt = document.createEvent('MouseEvents');
    evt.initMouseEvent(
      type,
      true,
      true,
      window,
      0,
      0,
      0,
      x,
      y,
      false,
      false,
      false,
      false,
      0,
      null,
    );
    const viewport = map.getViewport();
    viewport.dispatchEvent(evt);
  }

  describe('vertex-snap lifecycle', function () {
    let draw;

    beforeEach(function () {
      // Two adjacent line features sharing vertex [1, 1].
      source.clear();
      source.addFeatures([
        new Feature(
          new LineString([
            [0, 0],
            [1, 1],
          ]),
        ),
        new Feature(
          new LineString([
            [1, 1],
            [2, 0],
          ]),
        ),
      ]);
      traceSource = new TraceSource({
        features: source.getFeaturesCollection(),
      });
      draw = new Draw({
        source: new VectorSource(),
        type: 'LineString',
        trace: true,
        traceSource: traceSource,
      });
      map.addInteraction(draw);
    });

    it('fires tracestart with no traceSourceSubGeometryKind at a junction', function () {
      const starts = [];
      draw.on('tracestart', (e) => starts.push(e));
      // Click at [0,0] to start drawing.
      simulateEvent('pointermove', 0, 0);
      simulateEvent('pointerdown', 0, 0);
      simulateEvent('pointerup', 0, 0);
      // Click near [1,1] to enter trace mode.
      simulateEvent('pointermove', 1, 1);
      simulateEvent('pointerdown', 1, 1);
      simulateEvent('pointerup', 1, 1);
      expect(starts).to.have.length(1);
      expect(starts[0].traceSourceSubGeometryKind).to.be(undefined);
    });

    it('fires a trace event with traceSourceSubGeometryKind when an edge becomes active', function () {
      const events = [];
      draw.on('trace', (e) => events.push(e));

      simulateEvent('pointermove', 0, 0);
      simulateEvent('pointerdown', 0, 0);
      simulateEvent('pointerup', 0, 0);
      simulateEvent('pointermove', 1, 1);
      simulateEvent('pointerdown', 1, 1);
      simulateEvent('pointerup', 1, 1);

      // Cursor moves toward [2,0]; should resolve to the second segment.
      simulateEvent('pointermove', 1.5, 0.5);

      expect(events.length).to.be.greaterThan(0);
      expect(events[events.length - 1].traceSourceSubGeometryKind).to.be(
        'LineString',
      );
    });

    it('ignores non-vertex clicks during trace (trace stays active)', function () {
      const ends = [];
      draw.on('traceend', (e) => ends.push(e));

      simulateEvent('pointermove', 0, 0);
      simulateEvent('pointerdown', 0, 0);
      simulateEvent('pointerup', 0, 0);
      simulateEvent('pointermove', 1, 1);
      simulateEvent('pointerdown', 1, 1);
      simulateEvent('pointerup', 1, 1);

      // Click NOT on a vertex.
      simulateEvent('pointermove', 1.3, 0.7);
      simulateEvent('pointerdown', 1.3, 0.7);
      simulateEvent('pointerup', 1.3, 0.7);

      expect(ends).to.have.length(0);
    });

    it('ends trace on a click at a snapped vertex', function () {
      const ends = [];
      draw.on('traceend', (e) => ends.push(e));

      simulateEvent('pointermove', 0, 0);
      simulateEvent('pointerdown', 0, 0);
      simulateEvent('pointerup', 0, 0);
      simulateEvent('pointermove', 1, 1);
      simulateEvent('pointerdown', 1, 1);
      simulateEvent('pointerup', 1, 1);

      simulateEvent('pointermove', 2, 0);
      simulateEvent('pointerdown', 2, 0);
      simulateEvent('pointerup', 2, 0);

      expect(ends).to.have.length(1);
    });
  });
});
