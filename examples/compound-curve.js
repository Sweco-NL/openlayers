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

// color palette for sub-geometry types
const arcColor = '#e41a1c';
const lineColor = '#888';

/**
 * Returns true if the arc defined by three points winds clockwise.
 * @param {Array<number>} p0 Start.
 * @param {Array<number>} p1 Mid.
 * @param {Array<number>} p2 End.
 * @return {boolean} True if clockwise.
 */
function isClockwise(p0, p1, p2) {
  return (
    (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]) < 0
  );
}

const wktStrings = [
  // open compound: arc -> line -> arc
  'COMPOUNDCURVE(CIRCULARSTRING(0 0, 1 2, 3 2), (3 2, 4 0), CIRCULARSTRING(4 0, 5 -1, 6 0))',
  // closed compound: arc -> line forming a boundary
  'COMPOUNDCURVE(CIRCULARSTRING(10 0, 12 3, 14 0), (14 0, 10 0))',
];

const labels = ['Open: arc -> line -> arc', 'Closed boundary'];

/**
 * Builds annotation styles for a CompoundCurve feature, colouring each
 * sub-geometry individually and marking the join points between them.
 * @param {import("../src/ol/Feature.js").default} feature The feature.
 * @param {number} featureIndex Index for label lookup.
 * @return {Array<Style>} The style array.
 */
function createCompoundStyles(feature, featureIndex) {
  const geom = feature.getGeometry();
  const subGeoms = geom.getGeometries();
  const styles = [];
  let segmentIndex = 1;

  for (let i = 0; i < subGeoms.length; i++) {
    const sub = subGeoms[i];
    const isArc = sub.getType() === 'CircularString';
    const color = isArc ? arcColor : lineColor;
    const dash = isArc ? undefined : [6, 4];
    const typeLabel = isArc ? 'Arc' : 'Line';

    styles.push(
      new Style({
        geometry: sub,
        stroke: new Stroke({color: color, width: 3, lineDash: dash}),
      }),
    );

    const subCoords = sub.getCoordinates();
    const midIdx = Math.floor(subCoords.length / 2);
    styles.push(
      new Style({
        geometry: new Point(subCoords[midIdx]),
        text: new Text({
          text: '12345'[segmentIndex - 1] + typeLabel,
          font: '11px sans-serif',
          offsetY: -14,
          fill: new Fill({color: color}),
          backgroundFill: new Fill({color: 'rgba(255,255,255,0.85)'}),
          padding: [1, 3, 1, 3],
        }),
      }),
    );

    if (isArc) {
      const arcCoords = sub.getCoordinates();
      for (let a = 0; a < sub.arcCount(); a++) {
        const center = sub.flatCenterOfCircle(a);
        const start = arcCoords[a * 2];
        const radius = Math.sqrt(
          (center[0] - start[0]) ** 2 + (center[1] - start[1]) ** 2,
        );

        styles.push(
          new Style({
            geometry: new Point(center),
            image: new RegularShape({
              points: 4,
              radius: 5,
              radius2: 0,
              angle: Math.PI / 4,
              stroke: new Stroke({color: '#c00', width: 1.5}),
            }),
          }),
        );

        styles.push(
          new Style({
            geometry: new LineString([center, start]),
            stroke: new Stroke({
              color: 'rgba(0,0,0,0.25)',
              width: 1,
              lineDash: [3, 3],
            }),
          }),
        );

        // radius label
        const rMid = [(center[0] + start[0]) / 2, (center[1] + start[1]) / 2];
        styles.push(
          new Style({
            geometry: new Point(rMid),
            text: new Text({
              text: 'r=' + radius.toFixed(2),
              font: '10px sans-serif',
              offsetY: -8,
              fill: new Fill({color: '#333'}),
              backgroundFill: new Fill({color: 'rgba(255,255,255,0.8)'}),
              padding: [1, 3, 1, 3],
            }),
          }),
        );

        // direction arrow at the arc midpoint (mid control point)
        const mid = arcCoords[a * 2 + 1];
        const end = arcCoords[a * 2 + 2];
        const cw = isClockwise(start, mid, end);
        // tangent at mid is perpendicular to the radius (center->mid)
        const rAngle = Math.atan2(mid[1] - center[1], mid[0] - center[0]);
        // CW -> tangent = rAngle - pi/2, CCW -> tangent = rAngle + pi/2
        const tangent = cw ? rAngle - Math.PI / 2 : rAngle + Math.PI / 2;
        styles.push(
          new Style({
            geometry: new Point(mid),
            image: new RegularShape({
              points: 3,
              radius: 7,
              rotation: -tangent + Math.PI / 2,
              fill: new Fill({color: arcColor}),
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
    }

    segmentIndex++;
  }

  // join-point diamond markers between sub-geometries
  for (let i = 0; i < subGeoms.length - 1; i++) {
    const subCoords = subGeoms[i].getCoordinates();
    const joinPt = subCoords[subCoords.length - 1];
    styles.push(
      new Style({
        geometry: new Point(joinPt),
        image: new RegularShape({
          points: 4,
          radius: 7,
          angle: Math.PI / 4,
          fill: new Fill({color: '#ffd700'}),
          stroke: new Stroke({color: '#333', width: 1}),
        }),
        text: new Text({
          text: 'join',
          font: '9px sans-serif',
          offsetY: 14,
          fill: new Fill({color: '#666'}),
        }),
      }),
    );
  }

  // feature label
  styles.push(
    new Style({
      geometry: new Point(geom.getCoordinateAt(0.5)),
      text: new Text({
        text: labels[featureIndex],
        font: 'bold 12px sans-serif',
        offsetY: -22,
        fill: new Fill({color: '#333'}),
        backgroundFill: new Fill({color: 'rgba(255,255,255,0.85)'}),
        padding: [2, 4, 2, 4],
      }),
    }),
  );

  // control points
  const allCoords = geom.getCoordinates();
  for (let j = 0; j < allCoords.length; j++) {
    styles.push(
      new Style({
        geometry: new Point(allCoords[j]),
        image: new CircleStyle({
          radius: 3,
          fill: new Fill({color: '#fff'}),
          stroke: new Stroke({color: '#333', width: 1.5}),
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
    return createCompoundStyles(feature, feature.get('index'));
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
