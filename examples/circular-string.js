import Map from '../src/ol/Map.js';
import View from '../src/ol/View.js';
import WKT from '../src/ol/format/WKT.js';
import LineString from '../src/ol/geom/LineString.js';
import Point from '../src/ol/geom/Point.js';
import TileLayer from '../src/ol/layer/Tile.js';
import VectorLayer from '../src/ol/layer/Vector.js';
import OSM from '../src/ol/source/OSM.js';
import VectorSource from '../src/ol/source/Vector.js';
import CircleStyle from '../src/ol/style/Circle.js';
import Fill from '../src/ol/style/Fill.js';
import RegularShape from '../src/ol/style/RegularShape.js';
import Stroke from '../src/ol/style/Stroke.js';
import Style from '../src/ol/style/Style.js';
import Text from '../src/ol/style/Text.js';

const format = new WKT();

const wktStrings = [
  // simple arc: three points define a single circular arc
  'CIRCULARSTRING(0 0, 1 2, 2 0)',
  // multi-arc chain: each group of three consecutive points adds an arc
  'CIRCULARSTRING(5 0, 6 2, 7 0, 8 -1, 9 0)',
  // full circle: start equals end, middle is the diametrically opposite point
  'CIRCULARSTRING(12 0, 14 2, 16 0, 14 -2, 12 0)',
  // near-collinear arc: points almost on a line produce very large radii
  'CIRCULARSTRING(19 0, 20 0.05, 21 0)',
];

const labels = [
  'Simple arc (3 pts)',
  'Multi-arc chain (5 pts)',
  'Full circle',
  'Near-collinear',
];

const colors = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3'];

/**
 * Returns the direction (CW/CCW) of an arc from its three control points.
 * @param {Array<number>} p0 Start coordinate.
 * @param {Array<number>} p1 Middle coordinate.
 * @param {Array<number>} p2 End coordinate.
 * @return {boolean} True if clockwise.
 */
function isClockwise(p0, p1, p2) {
  const cross =
    (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
  return cross < 0;
}

/**
 * Builds an array of Style objects that annotate a CircularString with
 * center markers, radius lines, control points, and direction arrows.
 * @param {import("../src/ol/Feature.js").default} feature The feature.
 * @param {number} featureIndex Index into the colors/labels arrays.
 * @return {Array<Style>} The style array.
 */
function createAnnotationStyles(feature, featureIndex) {
  const geom = feature.getGeometry();
  const color = colors[featureIndex];
  const coords = geom.getCoordinates();
  const styles = [];

  styles.push(
    new Style({
      stroke: new Stroke({color: color, width: 3}),
    }),
  );

  styles.push(
    new Style({
      geometry: new Point(geom.getCoordinateAt(0.5)),
      text: new Text({
        text: labels[featureIndex],
        font: 'bold 12px sans-serif',
        offsetY: -16,
        fill: new Fill({color: '#333'}),
        backgroundFill: new Fill({color: 'rgba(255,255,255,0.85)'}),
        padding: [2, 4, 2, 4],
      }),
    }),
  );

  for (let j = 0; j < coords.length; j++) {
    styles.push(
      new Style({
        geometry: new Point(coords[j]),
        image: new CircleStyle({
          radius: 4,
          fill: new Fill({color: '#fff'}),
          stroke: new Stroke({color: color, width: 2}),
        }),
        text: new Text({
          text: 'P' + (j + 1),
          font: '10px sans-serif',
          offsetY: 14,
          fill: new Fill({color: '#666'}),
        }),
      }),
    );
  }

  for (let i = 0; i < geom.arcCount(); i++) {
    const center = geom.flatCenterOfCircle(i);
    const start = coords[i * 2];
    const radius = Math.sqrt(
      (center[0] - start[0]) ** 2 + (center[1] - start[1]) ** 2,
    );
    const mid = coords[i * 2 + 1];
    const end = coords[i * 2 + 2];
    const cw = isClockwise(start, mid, end);

    // center-of-circle crosshair
    styles.push(
      new Style({
        geometry: new Point(center),
        image: new RegularShape({
          points: 4,
          radius: 6,
          radius2: 0,
          angle: Math.PI / 4,
          stroke: new Stroke({color: '#c00', width: 1.5}),
        }),
        text: new Text({
          text: 'C',
          font: 'bold 10px sans-serif',
          offsetX: 10,
          offsetY: -8,
          fill: new Fill({color: '#c00'}),
        }),
      }),
    );

    // dashed radius line from center to arc start
    styles.push(
      new Style({
        geometry: new LineString([center, start]),
        stroke: new Stroke({
          color: 'rgba(0,0,0,0.3)',
          width: 1,
          lineDash: [4, 4],
        }),
      }),
    );

    // radius measurement label at the midpoint of the radius line
    const radiusMid = [(center[0] + start[0]) / 2, (center[1] + start[1]) / 2];
    const radiusText =
      radius > 100 ? 'r=' + radius.toFixed(0) : 'r=' + radius.toFixed(2);
    styles.push(
      new Style({
        geometry: new Point(radiusMid),
        text: new Text({
          text: radiusText,
          font: '10px sans-serif',
          offsetY: -8,
          fill: new Fill({color: '#333'}),
          backgroundFill: new Fill({color: 'rgba(255,255,255,0.8)'}),
          padding: [1, 3, 1, 3],
        }),
      }),
    );

    // direction arrow at the arc midpoint (mid control point)
    // tangent at mid is perpendicular to the radius (center->mid)
    const rAngle = Math.atan2(mid[1] - center[1], mid[0] - center[0]);
    // CW -> tangent = rAngle - pi/2, CCW -> tangent = rAngle + pi/2
    const tangentAngle = cw ? rAngle - Math.PI / 2 : rAngle + Math.PI / 2;

    styles.push(
      new Style({
        geometry: new Point(mid),
        image: new RegularShape({
          points: 3,
          radius: 7,
          rotation: -tangentAngle + Math.PI / 2,
          fill: new Fill({color: color}),
          stroke: new Stroke({color: '#fff', width: 1}),
        }),
        text: new Text({
          text: cw ? 'CW' : 'CCW',
          font: '9px sans-serif',
          offsetY: 14,
          fill: new Fill({color: '#666'}),
        }),
      }),
    );
  }

  return styles;
}

const features = [];
for (let i = 0; i < wktStrings.length; i++) {
  const feature = format.readFeature(wktStrings[i]);
  feature.set('index', i);
  features.push(feature);
}

const vectorSource = new VectorSource({features: features});

const vectorLayer = new VectorLayer({
  source: vectorSource,
  style: function (feature) {
    return createAnnotationStyles(feature, feature.get('index'));
  },
});

const map = new Map({
  layers: [new TileLayer({source: new OSM()}), vectorLayer],
  target: 'map',
  view: new View({
    center: [0, 0],
    zoom: 2,
  }),
});

map.getView().fit(vectorSource.getExtent(), {padding: [50, 50, 50, 50]});
