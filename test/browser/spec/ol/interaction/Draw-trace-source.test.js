import Feature from '../../../../../src/ol/Feature.js';
import CircularString from '../../../../../src/ol/geom/CircularString.js';
import LineString from '../../../../../src/ol/geom/LineString.js';
import Draw from '../../../../../src/ol/interaction/Draw.js';
import TraceSource from '../../../../../src/ol/interaction/TraceSource.js';
import VectorLayer from '../../../../../src/ol/layer/Vector.js';
import Map from '../../../../../src/ol/Map.js';
import MapBrowserEvent from '../../../../../src/ol/MapBrowserEvent.js';
import VectorSource from '../../../../../src/ol/source/Vector.js';
import View from '../../../../../src/ol/View.js';

describe('ol/interaction/Draw with TraceSource', function () {
  let map, target, source, traceSource;

  const width = 100;
  const height = 100;

  beforeEach(function (done) {
    target = document.createElement('div');
    const style = target.style;
    style.position = 'absolute';
    style.left = '-1000px';
    style.top = '-1000px';
    style.width = width + 'px';
    style.height = height + 'px';
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
    traceSource = new TraceSource({features: source.getFeatures()});
    map = new Map({
      target: target,
      layers: [new VectorLayer({source: source})],
      view: new View({center: [0, 0], resolution: 1}),
    });
    map.once('postrender', function () {
      done();
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

  // Helper: simulate a map-browser pointer event at offsets from the map center.
  // x and y are coordinate units, which equal pixels because resolution is 1.
  function simulateEvent(type, x, y) {
    const viewport = map.getViewport();
    const position = viewport.getBoundingClientRect();
    const event = {
      type: type,
      target: viewport.firstChild,
      clientX: position.left + x + width / 2,
      clientY: position.top + y + height / 2,
      shiftKey: false,
      preventDefault: function () {},
      pointerType: 'mouse',
      pointerId: 0,
    };
    const simulatedEvent = new MapBrowserEvent(type, map, event);
    map.handleMapBrowserEvent(simulatedEvent);
    return simulatedEvent;
  }

  describe('vertex-snap lifecycle', function () {
    let draw;

    beforeEach(function () {
      // Two adjacent line features sharing vertex [0, 0].
      // Features are 40-unit wide so that midpoints (20 units from nearest
      // vertex) fall outside the default 12-pixel snap tolerance at
      // resolution=1, making "non-vertex" clicks genuinely non-vertex.
      source.clear();
      source.addFeatures([
        new Feature(
          new LineString([
            [-40, 0],
            [0, 0],
          ]),
        ),
        new Feature(
          new LineString([
            [0, 0],
            [40, 0],
          ]),
        ),
      ]);
      traceSource = new TraceSource({
        features: source.getFeatures(),
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
      // Start drawing at [0, 30] — 30 units above the line, clear of all
      // vertices (minimum vertex distance ≈ 30 > snap-tolerance 12).
      simulateEvent('pointermove', 0, -30);
      simulateEvent('pointerdown', 0, -30);
      simulateEvent('pointerup', 0, -30);
      // Click at map [0, 0] (the shared junction vertex) to enter trace mode.
      simulateEvent('pointermove', 0, 0);
      simulateEvent('pointerdown', 0, 0);
      simulateEvent('pointerup', 0, 0);
      expect(starts).to.have.length(1);
      expect(starts[0].traceSourceSubGeometryKind).to.be(undefined);
    });

    it('fires a trace event with traceSourceSubGeometryKind when an edge becomes active', function () {
      const events = [];
      draw.on('trace', (e) => events.push(e));

      simulateEvent('pointermove', 0, -30);
      simulateEvent('pointerdown', 0, -30);
      simulateEvent('pointerup', 0, -30);
      simulateEvent('pointermove', 0, 0);
      simulateEvent('pointerdown', 0, 0);
      simulateEvent('pointerup', 0, 0);

      // Cursor moves along the second segment; stays within 6px of the
      // last downPx_ so shouldHandle_ remains true and updateTrace_ runs.
      simulateEvent('pointermove', 5, 0);

      expect(events.length).to.be.greaterThan(0);
      expect(events[events.length - 1].traceSourceSubGeometryKind).to.be(
        'LineString',
      );
    });

    it('ignores non-vertex clicks during trace (trace stays active)', function () {
      const ends = [];
      draw.on('traceend', (e) => ends.push(e));

      simulateEvent('pointermove', 0, -30);
      simulateEvent('pointerdown', 0, -30);
      simulateEvent('pointerup', 0, -30);
      simulateEvent('pointermove', 0, 0);
      simulateEvent('pointerdown', 0, 0);
      simulateEvent('pointerup', 0, 0);

      // Click at map [20, 0] — midpoint between the two vertices at [0,0]
      // and [40,0], 20 units from each (> snap-tolerance 12). NOT a vertex.
      simulateEvent('pointermove', 20, 0);
      simulateEvent('pointerdown', 20, 0);
      simulateEvent('pointerup', 20, 0);

      expect(ends).to.have.length(0);
    });

    it('ends trace on a click at a snapped vertex', function () {
      const ends = [];
      draw.on('traceend', (e) => ends.push(e));

      simulateEvent('pointermove', 0, -30);
      simulateEvent('pointerdown', 0, -30);
      simulateEvent('pointerup', 0, -30);
      simulateEvent('pointermove', 0, 0);
      simulateEvent('pointerdown', 0, 0);
      simulateEvent('pointerup', 0, 0);

      simulateEvent('pointermove', 40, 0);
      simulateEvent('pointerdown', 40, 0);
      simulateEvent('pointerup', 40, 0);

      expect(ends).to.have.length(1);
    });
  });

  describe('exit on CircularString arc throughpoint', function () {
    // Regression: the Snap interaction can land downCoordinate_ on a
    // CircularString throughpoint (the mid control-point [bx,by,mx,my,ex,ey]).
    // Throughpoints are NOT graph vertices in TraceSource — only arc
    // start/end vertices are.  The direct getNearestVertex check therefore
    // fails, and the trace would silently refuse to exit.
    //
    // Fix: if the active edge is a CircularString and the click is within
    // snap tolerance of the arc's throughpoint, exit at the nearer of the
    // arc's endpoint vertices.
    let draw;

    beforeEach(function () {
      source.clear();
      // Feature A: LineString ending at [0,0] — entry point for the trace.
      source.addFeature(new Feature(new LineString([[-40, 0], [0, 0]])));
      // Feature B: CircularString with start=[0,0], throughpoint=[20,15],
      // end=[40,0].  Both graph vertices ([0,0] and [40,0]) are ≈25 units
      // from the throughpoint [20,15] — well outside the default
      // exitTolerance of 12 — so the direct getNearestVertex check will
      // NOT find them when the click is at the throughpoint.
      source.addFeature(
        new Feature(new CircularString([[0, 0], [20, 15], [40, 0]])),
      );
      traceSource = new TraceSource({
        features: source.getFeatures(),
      });
      draw = new Draw({
        source: new VectorSource(),
        type: 'LineString',
        trace: true,
        traceSource: traceSource,
      });
      map.addInteraction(draw);
    });

    it('fires traceend when click lands on a throughpoint of the active arc', function () {
      const ends = [];
      draw.on('traceend', (e) => ends.push(e));

      // Start drawing at [0, 30] — clear of all vertices (≥ 25 units away).
      simulateEvent('pointermove', 0, -30);
      simulateEvent('pointerdown', 0, -30);
      simulateEvent('pointerup', 0, -30);

      // Click at [0,0] — a graph vertex shared by both features — to enter
      // the trace.
      simulateEvent('pointermove', 0, 0);
      simulateEvent('pointerdown', 0, 0);
      simulateEvent('pointerup', 0, 0);

      // Move onto the CircularString arc so it becomes the active edge.
      // Screen offset (20, -15) → map coordinate [20, 15] = throughpoint.
      simulateEvent('pointermove', 20, -15);

      // Click at the throughpoint — a point ON the arc but NOT a graph vertex.
      // Before the fix: getNearestVertex fails, traceend never fires.
      // After the fix: throughpoint fallback fires, trace exits at the
      //   nearer arc-endpoint vertex.
      simulateEvent('pointerdown', 20, -15);
      simulateEvent('pointerup', 20, -15);

      expect(ends).to.have.length(1);
    });
  });
});
