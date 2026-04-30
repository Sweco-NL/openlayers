import Feature from '../src/ol/Feature.js';
import Map from '../src/ol/Map.js';
import View from '../src/ol/View.js';
import WKT from '../src/ol/format/WKT.js';
import CircularString from '../src/ol/geom/CircularString.js';
import CompoundCurve from '../src/ol/geom/CompoundCurve.js';
import CurvePolygon from '../src/ol/geom/CurvePolygon.js';
import LineString from '../src/ol/geom/LineString.js';
import Point from '../src/ol/geom/Point.js';
import Draw from '../src/ol/interaction/Draw.js';
import Modify from '../src/ol/interaction/Modify.js';
import Snap from '../src/ol/interaction/Snap.js';
import TileLayer from '../src/ol/layer/Tile.js';
import VectorLayer from '../src/ol/layer/Vector.js';
import OSM from '../src/ol/source/OSM.js';
import VectorSource from '../src/ol/source/Vector.js';
import CircleStyle from '../src/ol/style/Circle.js';
import Fill from '../src/ol/style/Fill.js';
import Stroke from '../src/ol/style/Stroke.js';
import Style from '../src/ol/style/Style.js';

const format = new WKT();
const statusEl = document.getElementById('status');
const modeEl = document.getElementById('segment-mode');
const wktEl = document.getElementById('wkt');
const typeSelect = document.getElementById('type');

function vertexDots(coords, color) {
  const styles = [];
  for (const c of coords) {
    if (Array.isArray(c) && c.length >= 2) {
      styles.push(
        new Style({
          geometry: new Point(c),
          image: new CircleStyle({
            radius: 4,
            fill: new Fill({color}),
            stroke: new Stroke({color: '#fff', width: 1.5}),
          }),
        }),
      );
    }
  }
  return styles;
}

function featureStyle(feature) {
  if (feature.get('_snapPoint')) {
    return null;
  }
  const geom = feature.getGeometry();
  const coords = geom.getCoordinates ? geom.getCoordinates() : [];
  const flat = Array.isArray(coords[0]?.[0]) ? coords.flat() : coords;
  return [
    new Style({
      stroke: new Stroke({color: '#0064c8', width: 3}),
      fill: new Fill({color: 'rgba(0, 100, 200, 0.12)'}),
    }),
    ...vertexDots(flat, '#0064c8'),
  ];
}

function sketchStyle(feature) {
  const geom = feature.getGeometry();
  if (geom.getType() === 'Point') {
    return new Style({
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({color: '#e41a1c'}),
      }),
    });
  }
  const coords = geom.getCoordinates ? geom.getCoordinates() : [];
  return [
    new Style({
      stroke: new Stroke({color: '#e41a1c', width: 2, lineDash: [6, 4]}),
    }),
    ...vertexDots(coords.slice(0, -1), '#e41a1c'),
  ];
}

const source = new VectorSource();
const map = new Map({
  layers: [
    new TileLayer({source: new OSM()}),
    new VectorLayer({source, style: featureStyle}),
  ],
  target: 'map',
  view: new View({center: [0, 0], zoom: 3}),
});

const modify = new Modify({source});
const snap = new Snap({source});
map.addInteraction(modify);
map.addInteraction(snap);

let draw = null;
let segmentBreaks = [];
let currentSegType = 'arc';
let drawing = false;
let snapFeature = null;
let startCoord = null;

function status(msg) {
  statusEl.textContent = msg;
}

function updateMode() {
  const m = typeSelect.value;
  if ((m === 'CompoundCurve' || m === 'CurvePolygon') && drawing) {
    modeEl.textContent =
      '[' + (currentSegType === 'arc' ? 'ARC' : 'LINE') + '] T=toggle';
  } else {
    modeEl.textContent = '';
  }
}

function updateWkt() {
  const feats = source.getFeatures().filter((f) => !f.get('_snapPoint'));
  wktEl.value = feats.map((f) => format.writeFeature(f)).join('\n');
}

function committedInSegment(totalCoords) {
  return totalCoords - 1 - segmentBreaks[segmentBreaks.length - 1].index;
}

function resetState() {
  segmentBreaks = [{index: 0, type: 'arc'}];
  currentSegType = 'arc';
  drawing = false;
  startCoord = null;
  if (snapFeature) {
    source.removeFeature(snapFeature);
    snapFeature = null;
  }
  updateMode();
}

// build sub-geometries from segment breaks + raw coords
// arc segments with even count are split into valid-arc + trailing line
// so that committed arcs don't flicker when the cursor makes count even
function buildSubGeometries(coords) {
  const geoms = [];
  for (let i = 0; i < segmentBreaks.length; i++) {
    const {index, type} = segmentBreaks[i];
    const end =
      i + 1 < segmentBreaks.length
        ? segmentBreaks[i + 1].index + 1
        : coords.length;
    const seg = coords.slice(index, end);
    if (seg.length < 2) {
      continue;
    }
    if (type === 'arc') {
      if (seg.length >= 3 && seg.length % 2 === 1) {
        geoms.push(new CircularString(seg));
      } else if (seg.length >= 4 && seg.length % 2 === 0) {
        const arc = seg.slice(0, -1);
        geoms.push(new CircularString(arc));
        geoms.push(new LineString([arc[arc.length - 1], seg[seg.length - 1]]));
      } else {
        geoms.push(new LineString(seg));
      }
    } else {
      geoms.push(new LineString(seg));
    }
  }
  return geoms;
}

function updatePointStatus(totalCoords) {
  const m = typeSelect.value;
  if (m !== 'CompoundCurve' && m !== 'CurvePolygon') {
    return;
  }
  const n = committedInSegment(totalCoords);
  const canClose = m === 'CurvePolygon' && totalCoords >= 4;
  const canToggle = currentSegType === 'arc' ? n >= 3 && n % 2 === 1 : n >= 2;
  const tips =
    (canToggle ? ' T=toggle.' : '') +
    (canClose ? ' Click start to close.' : '');

  if (currentSegType === 'arc') {
    if (n <= 1) {
      status('Next: arc curvature point.' + tips);
    } else if (n % 2 === 0) {
      status('Arc preview. Next: through-point.' + tips);
    } else {
      status('Arc committed. Next: curvature point.' + tips);
    }
  } else {
    status('LINE segment, ' + n + ' pts.' + tips);
  }
}

// finalize geometry on drawend - close rings, clean up arcs
function finalizeGeometry(feature) {
  const geom = feature.getGeometry();
  const mode = typeSelect.value;
  const coords = geom.getCoordinates();

  if (mode === 'CircularString') {
    if (coords.length >= 4 && coords.length % 2 === 0) {
      coords.pop();
      geom.setCoordinates(coords);
    }
    if (coords.length < 3) {
      setTimeout(() => source.removeFeature(feature), 0);
      return;
    }
  }

  if (mode === 'CurvePolygon' && coords.length >= 3) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coords.push(first.slice());
    }
    const subs = buildSubGeometries(coords);
    const ring =
      subs.length > 1
        ? new CompoundCurve(subs)
        : subs[0] || new LineString(coords);
    feature.setGeometry(new CurvePolygon([ring]));
  }

  if (mode === 'CompoundCurve' && coords.length >= 2) {
    const subs = buildSubGeometries(coords);
    if (subs.length === 1) {
      feature.setGeometry(subs[0]);
    } else if (subs.length > 1) {
      feature.setGeometry(new CompoundCurve(subs));
    }
  }
}

function addDrawInteraction() {
  if (draw) {
    map.removeInteraction(draw);
    draw = null;
  }
  resetState();

  const mode = typeSelect.value;
  if (mode === 'None') {
    status('Edit mode - drag vertices to modify, Alt+Click to delete.');
    return;
  }

  if (mode === 'CircularString') {
    draw = new Draw({
      source,
      type: 'LineString',
      style: sketchStyle,
      geometryFunction(coordinates, geometry) {
        if (!geometry) {
          return new CircularString(coordinates);
        }
        geometry.setCoordinates(coordinates);
        return geometry;
      },
      finishCondition() {
        const feat = draw.getOverlay().getSource().getFeatures()[0];
        if (!feat) {
          return false;
        }
        const c = feat.getGeometry().getCoordinates();
        // after finishDrawing pops cursor, count must be odd >= 3
        return c.length >= 4 && c.length % 2 === 0;
      },
    });
    status(
      'CircularString - click points (3, 5, 7, ...), double-click to finish.',
    );
  } else {
    // CompoundCurve or CurvePolygon
    const isCurvePolygon = mode === 'CurvePolygon';
    let prevCount = 0;
    let closing = false;

    draw = new Draw({
      source,
      type: 'LineString',
      style: sketchStyle,
      geometryFunction(coordinates, geometry) {
        const isNewPoint = coordinates.length > prevCount;
        prevCount = coordinates.length;

        // auto-close: when a new point snaps to start, finish the ring
        // needed because Draw.atFinish_ only checks last-clicked point
        if (
          isCurvePolygon &&
          isNewPoint &&
          !closing &&
          startCoord &&
          coordinates.length >= 4
        ) {
          const pt = coordinates[coordinates.length - 2];
          const tol = map.getView().getResolution() * 0.5;
          if (
            Math.abs(pt[0] - startCoord[0]) < tol &&
            Math.abs(pt[1] - startCoord[1]) < tol
          ) {
            closing = true;
            setTimeout(() => {
              if (draw && drawing) {
                draw.finishDrawing();
              }
              closing = false;
            }, 0);
          }
        }

        const geoms = buildSubGeometries(coordinates);
        if (!geometry) {
          return new CompoundCurve(
            geoms.length ? geoms : [new LineString(coordinates)],
          );
        }
        // mutate in-place - Draw ignores the return value after first call
        geometry.setGeometriesArray(
          geoms.length ? geoms : [new LineString(coordinates)],
        );
        if (isNewPoint && drawing) {
          updatePointStatus(coordinates.length);
        }
        return geometry;
      },
      finishCondition() {
        const feat = draw.getOverlay().getSource().getFeatures()[0];
        return feat && feat.getGeometry().getCoordinates().length >= 3;
      },
    });

    status(
      isCurvePolygon
        ? 'CurvePolygon - click to draw arc. T=toggle arc/line. Snap to start to close.'
        : 'CompoundCurve - click to draw arc. T=toggle arc/line. Double-click to finish.',
    );
  }

  draw.on('drawstart', (e) => {
    drawing = true;
    currentSegType = 'arc';
    segmentBreaks = [{index: 0, type: 'arc'}];
    updateMode();
    const coords = e.feature.getGeometry().getCoordinates();
    if (coords.length > 0) {
      startCoord = coords[0].slice();
      if (typeSelect.value === 'CurvePolygon') {
        snapFeature = new Feature({
          geometry: new Point(startCoord),
          _snapPoint: true,
        });
        source.addFeature(snapFeature);
      }
    }
  });

  draw.on('drawend', (e) => {
    drawing = false;
    finalizeGeometry(e.feature);
    resetState();
    setTimeout(updateWkt, 50);
  });

  draw.on('drawabort', () => {
    drawing = false;
    resetState();
  });

  map.addInteraction(draw);
  map.removeInteraction(snap);
  map.addInteraction(snap);
}

addDrawInteraction();

typeSelect.addEventListener('change', addDrawInteraction);

document.getElementById('undo').addEventListener('click', () => {
  if (!draw) {
    return;
  }
  draw.removeLastPoint();
  if (segmentBreaks.length > 1) {
    const feat = draw.getOverlay().getSource().getFeatures()[0];
    if (feat) {
      const coords = feat.getGeometry().getCoordinates();
      const last = segmentBreaks[segmentBreaks.length - 1];
      if (coords.length - 1 <= last.index) {
        segmentBreaks.pop();
        currentSegType = segmentBreaks[segmentBreaks.length - 1].type;
        updateMode();
      }
    }
  }
});

document.getElementById('clear').addEventListener('click', () => {
  source.clear();
  snapFeature = null;
  updateWkt();
  status('Cleared.');
});

// t key - toggle arc/line segment
document.addEventListener('keydown', (e) => {
  if (e.key !== 't' && e.key !== 'T') {
    return;
  }
  const m = typeSelect.value;
  if ((m !== 'CompoundCurve' && m !== 'CurvePolygon') || !draw || !drawing) {
    return;
  }
  const feat = draw.getOverlay().getSource().getFeatures()[0];
  if (!feat) {
    return;
  }
  const coords = feat.getGeometry().getCoordinates();
  const n = committedInSegment(coords.length);
  if (n < 2) {
    status('Need >= 2 points before toggling.');
    return;
  }
  if (currentSegType === 'arc' && n % 2 === 0) {
    status('Arc needs odd point count (3, 5, ...). Add one more point.');
    return;
  }
  currentSegType = currentSegType === 'arc' ? 'line' : 'arc';
  segmentBreaks.push({index: coords.length - 2, type: currentSegType});
  updateMode();
  status(
    currentSegType === 'arc'
      ? 'Switched to ARC. Next: curvature point.'
      : 'Switched to LINE. Click to add vertices.',
  );
});

modify.on('modifyend', updateWkt);
