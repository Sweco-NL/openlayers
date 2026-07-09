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

    it('fires tracestart with no trace payload at a junction', function () {
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
      expect(starts[0].trace).to.be(undefined);
    });

    it('fires a trace event with trace.subGeometryKind when an edge becomes active', function () {
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
      expect(events[events.length - 1].trace.subGeometryKind).to.be(
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
      source.addFeature(
        new Feature(
          new LineString([
            [-40, 0],
            [0, 0],
          ]),
        ),
      );
      // Feature B: CircularString with start=[0,0], throughpoint=[20,15],
      // end=[40,0].  Both graph vertices ([0,0] and [40,0]) are ≈25 units
      // from the throughpoint [20,15] — well outside the default
      // exitTolerance of 12 — so the direct getNearestVertex check will
      // NOT find them when the click is at the throughpoint.
      source.addFeature(
        new Feature(
          new CircularString([
            [0, 0],
            [20, 15],
            [40, 0],
          ]),
        ),
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

  describe('trace entry anchors to graph vertex (rogue-arc regression)', function () {
    // Regression: the trace-entry click is only required to fall WITHIN vertex
    // tolerance of a graph vertex — it need not be exactly on it, and a Snap
    // interaction can re-land it on a non-vertex point. That off-vertex
    // coordinate used to be committed verbatim at the entry index. Because
    // canonicalizeTraceRun_ skips the entry vertex (assuming it is already the
    // exact graph vertex) and builds the first canonical arc from the next
    // control points, an off-vertex entry produced a wild, near-collinear
    // "rogue arc" that does not exist on the traced geometry.
    //
    // Fix: toggleTraceStatePrimitive_ forces the committed entry coordinate
    // onto hit.vertex.coordinate; canonicalizeTraceRun_ additionally heals the
    // seam as a belt-and-braces contract.
    let draw;

    beforeEach(function () {
      source.clear();
      // Feature A: LineString ending at [0,0] — the trace-entry vertex.
      source.addFeature(
        new Feature(
          new LineString([
            [-40, 0],
            [0, 0],
          ]),
        ),
      );
      // Feature B: CircularString start=[0,0], throughpoint=[20,15], end=[40,0].
      source.addFeature(
        new Feature(
          new CircularString([
            [0, 0],
            [20, 15],
            [40, 0],
          ]),
        ),
      );
      traceSource = new TraceSource({features: source.getFeatures()});
      draw = new Draw({
        source: new VectorSource(),
        type: 'LineString',
        trace: true,
        traceSource: traceSource,
      });
      map.addInteraction(draw);
    });

    it('commits the exact vertex when entry click is off-vertex within tolerance', function () {
      const ends = [];
      draw.on('traceend', (e) => ends.push(e));

      // Start drawing clear of all vertices.
      simulateEvent('pointermove', 0, -30);
      simulateEvent('pointerdown', 0, -30);
      simulateEvent('pointerup', 0, -30);

      // Enter trace with a click at map [5,5] — 7 units from vertex [0,0],
      // inside the 12-unit vertex tolerance but NOT on the vertex.
      simulateEvent('pointermove', 5, -5);
      simulateEvent('pointerdown', 5, -5);
      simulateEvent('pointerup', 5, -5);

      // Move onto the arc throughpoint so the CircularString becomes active.
      simulateEvent('pointermove', 20, -15);

      // Exit the trace at end vertex [40,0].
      simulateEvent('pointermove', 40, 0);
      simulateEvent('pointerdown', 40, 0);
      simulateEvent('pointerup', 40, 0);

      expect(ends).to.have.length(1);

      const sketchFeature = draw.getOverlay().getSource().getFeatures()[0];
      const coords = sketchFeature.getGeometry().getCoordinates();
      // The off-vertex entry click [5,5] must NOT survive in the geometry.
      const hasOffVertex = coords.some((c) => c[0] === 5 && c[1] === 5);
      expect(hasOffVertex).to.be(false);
      // The exact graph vertex [0,0] must be present as the entry seam.
      const hasVertex = coords.some((c) => c[0] === 0 && c[1] === 0);
      expect(hasVertex).to.be(true);
    });

    it('commits the exact source arc triplet when the trace starts ON the feature (first draw action)', function () {
      const ends = [];
      draw.on('traceend', (e) => ends.push(e));

      // The user's reported scenario: the FIRST drawing click lands directly
      // on a vertex of the origin feature and immediately enters trace mode.
      // startDrawing_ then runs AFTER tracestart, so the entry vertex is the
      // sketch's point 0.
      simulateEvent('pointermove', 0, 0);
      simulateEvent('pointerdown', 0, 0);
      simulateEvent('pointerup', 0, 0);

      // Move onto the arc throughpoint so the CircularString becomes active.
      simulateEvent('pointermove', 20, -15);

      // Exit the trace at end vertex [40,0].
      simulateEvent('pointermove', 40, 0);
      simulateEvent('pointerdown', 40, 0);
      simulateEvent('pointerup', 40, 0);

      expect(ends).to.have.length(1);

      const sketchFeature = draw.getOverlay().getSource().getFeatures()[0];
      const coords = sketchFeature.getGeometry().getCoordinates();
      // The committed geometry must be EXACTLY the source arc's three control
      // points, in order — no tessellated samples, no rogue through-point.
      const committed = coords.filter(
        (c, i) =>
          i === 0 || c[0] !== coords[i - 1][0] || c[1] !== coords[i - 1][1],
      );
      expect(committed).to.eql([
        [0, 0],
        [20, 15],
        [40, 0],
      ]);
    });
  });

  describe('finishDrawing during an active trace (auto-close regression)', function () {
    // Regression: when a sketch auto-closes (or is otherwise finished) while a
    // trace is still active, finishDrawing() → abortDrawing_() → deactivateTrace_
    // used to dispatch TRACEEND WITHOUT canonicalizing the traced tail, because
    // abortDrawing_ nulls the sketch feature before deactivateTrace_ runs and
    // canonicalizeTraceRun_ no-ops without a live sketch. The committed geometry
    // therefore kept the raw tessellated trace-walk samples. Fix: finishDrawing
    // canonicalizes an active primitive trace before tearing the sketch down.
    let draw;

    beforeEach(function () {
      source.clear();
      source.addFeature(
        new Feature(
          new LineString([
            [-40, 0],
            [0, 0],
          ]),
        ),
      );
      source.addFeature(
        new Feature(
          new CircularString([
            [0, 0],
            [20, 15],
            [40, 0],
          ]),
        ),
      );
      traceSource = new TraceSource({features: source.getFeatures()});
      draw = new Draw({
        source: new VectorSource(),
        type: 'LineString',
        trace: true,
        traceSource: traceSource,
      });
      map.addInteraction(draw);
    });

    it('canonicalizes the traced arc when finishDrawing is called mid-trace', function () {
      const ends = [];
      draw.on('traceend', (e) => ends.push(e));

      // Start drawing clear of all vertices.
      simulateEvent('pointermove', 0, -30);
      simulateEvent('pointerdown', 0, -30);
      simulateEvent('pointerup', 0, -30);

      // Enter trace at vertex [0,0].
      simulateEvent('pointermove', 0, 0);
      simulateEvent('pointerdown', 0, 0);
      simulateEvent('pointerup', 0, 0);

      // Move onto the arc throughpoint so the CircularString becomes active
      // and the tessellated walk accumulates in the sketch tail.
      simulateEvent('pointermove', 20, -15);
      simulateEvent('pointermove', 40, 0);

      // Finish WITHOUT clicking to exit the trace (mimics an auto-close).
      const feature = draw.finishDrawing();

      // TRACEEND must have fired with canonical edges from the finish path.
      expect(ends).to.have.length(1);
      expect(ends[0].trace.canonicalEdges).to.be.an('array');

      const coords = feature.getGeometry().getCoordinates();
      // Deduplicate consecutive repeats (the moving tip may equal the exit
      // vertex) and assert the free start point followed by the exact source
      // arc triplet — no tessellation.
      const committed = coords.filter(
        (c, i) =>
          i === 0 || c[0] !== coords[i - 1][0] || c[1] !== coords[i - 1][1],
      );
      expect(committed).to.eql([
        [0, 30],
        [0, 0],
        [20, 15],
        [40, 0],
      ]);
    });
  });
});
