import Map from '../src/ol/Map.js';
import View from '../src/ol/View.js';
import {click} from '../src/ol/events/condition.js';
import WKT from '../src/ol/format/WKT.js';
import LineString from '../src/ol/geom/LineString.js';
import Point from '../src/ol/geom/Point.js';
import Select from '../src/ol/interaction/Select.js';
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

const outerColor = '#0064c8';
const holeColor = '#c83232';

const wktStrings = [
  // curvePolygon with CompoundCurve outer ring and circular hole
  'CURVEPOLYGON(COMPOUNDCURVE(CIRCULARSTRING(0 0, 2 4, 4 0), (4 0, 0 0)), CIRCULARSTRING(1 1, 2 2, 3 1, 2 0.5, 1 1))',
  // curvePolygon with a single CircularString ring (full circle)
  'CURVEPOLYGON(CIRCULARSTRING(8 2, 10 4, 12 2, 10 0, 8 2))',
  // geometryCollection mixing standard and curve types
  'GEOMETRYCOLLECTION(POINT(16 2), LINESTRING(17 0, 18 3, 19 1), CIRCULARSTRING(21 0, 22 2, 23 0))',
];

const labels = ['CurvePolygon + hole', 'Circular ring', 'Mixed collection'];

/**
 * Annotates a single ring (CircularString, CompoundCurve, or LinearRing)
 * with center markers, radius lines, and winding arrows.
 * @param {import("../src/ol/geom/SimpleGeometry.js").default} ring The ring geometry.
 * @param {string} color Stroke colour for this ring.
 * @param {string} ringLabel Label like "outer" or "hole 1".
 * @return {Array<Style>} Styles for this ring.
 */
function annotateRing(ring, color, ringLabel) {
  const styles = [];
  const type = ring.getType();

  // ring stroke
  styles.push(
    new Style({
      geometry: ring,
      stroke: new Stroke({color: color, width: 2}),
    }),
  );

  // ring label at midpoint
  if (typeof ring.getCoordinateAt === 'function') {
    const mid = ring.getCoordinateAt(0.5);
    styles.push(
      new Style({
        geometry: new Point(mid),
        text: new Text({
          text: ringLabel,
          font: '10px sans-serif',
          offsetY: -12,
          fill: new Fill({color: color}),
          backgroundFill: new Fill({color: 'rgba(255,255,255,0.85)'}),
          padding: [1, 3, 1, 3],
        }),
      }),
    );
  }

  // arc annotations for CircularString rings
  if (type === 'CircularString') {
    for (let i = 0; i < ring.arcCount(); i++) {
      const center = ring.flatCenterOfCircle(i);
      const coords = ring.getCoordinates();
      const start = coords[i * 2];
      const radius = Math.sqrt(
        (center[0] - start[0]) ** 2 + (center[1] - start[1]) ** 2,
      );

      // center crosshair
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

      // radius line
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
    }

    // winding direction arrow at the first arc's mid control point
    const coords = ring.getCoordinates();
    if (coords.length >= 3) {
      const p0 = coords[0];
      const p1 = coords[1];
      const p2 = coords[2];
      const center0 = ring.flatCenterOfCircle(0);
      const cw =
        (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]) <
        0;
      const rAngle = Math.atan2(p1[1] - center0[1], p1[0] - center0[0]);
      const tangent = cw ? rAngle - Math.PI / 2 : rAngle + Math.PI / 2;
      styles.push(
        new Style({
          geometry: new Point(p1),
          image: new RegularShape({
            points: 3,
            radius: 6,
            rotation: -tangent + Math.PI / 2,
            fill: new Fill({color: color}),
            stroke: new Stroke({color: '#fff', width: 1}),
          }),
        }),
      );
    }
  }

  // arc annotations for CompoundCurve rings
  if (type === 'CompoundCurve') {
    const subGeoms = ring.getGeometries();
    for (let s = 0; s < subGeoms.length; s++) {
      const sub = subGeoms[s];
      if (sub.getType() === 'CircularString') {
        for (let i = 0; i < sub.arcCount(); i++) {
          const center = sub.flatCenterOfCircle(i);
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
        }
      }
    }

    // winding direction arrow - use first arc sub-geometry's mid point
    for (let s2 = 0; s2 < subGeoms.length; s2++) {
      const sub2 = subGeoms[s2];
      if (sub2.getType() === 'CircularString') {
        const subCoords = sub2.getCoordinates();
        if (subCoords.length >= 3) {
          const p0 = subCoords[0];
          const p1 = subCoords[1];
          const p2 = subCoords[2];
          const c = sub2.flatCenterOfCircle(0);
          const cw =
            (p1[0] - p0[0]) * (p2[1] - p0[1]) -
              (p1[1] - p0[1]) * (p2[0] - p0[0]) <
            0;
          const rAngle = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
          const tangent = cw ? rAngle - Math.PI / 2 : rAngle + Math.PI / 2;
          styles.push(
            new Style({
              geometry: new Point(p1),
              image: new RegularShape({
                points: 3,
                radius: 6,
                rotation: -tangent + Math.PI / 2,
                fill: new Fill({color: color}),
                stroke: new Stroke({color: '#fff', width: 1}),
              }),
            }),
          );
        }
        break;
      }
    }
  }

  return styles;
}

/**
 * Builds annotation styles for a CurvePolygon or GeometryCollection.
 * @param {import("../src/ol/Feature.js").default} feature The feature.
 * @param {number} featureIndex Feature index for label lookup.
 * @return {Array<Style>} The style array.
 */
function createPolygonStyles(feature, featureIndex) {
  const geom = feature.getGeometry();
  const type = geom.getType();
  const styles = [];

  if (type === 'CurvePolygon') {
    // fill
    styles.push(
      new Style({
        fill: new Fill({color: 'rgba(0, 100, 200, 0.2)'}),
        stroke: new Stroke({color: 'transparent', width: 0}),
      }),
    );

    // annotate each ring
    const rings = geom.getRings();
    for (let r = 0; r < rings.length; r++) {
      const color = r === 0 ? outerColor : holeColor;
      const label = r === 0 ? 'outer' : 'hole ' + r;
      styles.push(...annotateRing(rings[r], color, label));
    }
  } else if (type === 'GeometryCollection') {
    // style each sub-geometry of the collection
    const geoms = geom.getGeometries();
    for (let g = 0; g < geoms.length; g++) {
      const sub = geoms[g];
      styles.push(
        new Style({
          geometry: sub,
          stroke: new Stroke({color: '#4daf4a', width: 3}),
          image: new CircleStyle({
            radius: 5,
            fill: new Fill({color: '#4daf4a'}),
            stroke: new Stroke({color: '#fff', width: 1}),
          }),
        }),
      );
      // arc centers for any CircularString sub-geometries
      if (sub.getType() === 'CircularString') {
        for (let i = 0; i < sub.arcCount(); i++) {
          const center = sub.flatCenterOfCircle(i);
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
        }
      }
    }
  }

  // feature label
  styles.push(
    new Style({
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

  return styles;
}

const selectedStyle = new Style({
  fill: new Fill({color: 'rgba(0, 170, 255, 0.4)'}),
  stroke: new Stroke({color: '#fff', width: 3}),
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({color: 'rgba(0, 170, 255, 0.8)'}),
    stroke: new Stroke({color: '#fff', width: 2}),
  }),
});

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
    return createPolygonStyles(feature, feature.get('index'));
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

const select = new Select({
  condition: click,
  style: selectedStyle,
});

map.addInteraction(select);

select.on('select', function (e) {
  document.getElementById('status').innerHTML =
    '&nbsp;' + e.target.getFeatures().getLength() + ' selected features';
});
