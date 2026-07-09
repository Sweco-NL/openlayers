import Feature from '../src/ol/Feature.js';
import Map from '../src/ol/Map.js';
import View from '../src/ol/View.js';
import WKT from '../src/ol/format/WKT.js';
import CircularString from '../src/ol/geom/CircularString.js';
import CompoundCurve from '../src/ol/geom/CompoundCurve.js';
import CurvePolygon from '../src/ol/geom/CurvePolygon.js';
import LineString from '../src/ol/geom/LineString.js';
import Point from '../src/ol/geom/Point.js';
import Modify from '../src/ol/interaction/Modify.js';
import TileLayer from '../src/ol/layer/Tile.js';
import VectorLayer from '../src/ol/layer/Vector.js';
import OSM from '../src/ol/source/OSM.js';
import VectorSource from '../src/ol/source/Vector.js';
import CircleStyle from '../src/ol/style/Circle.js';
import Fill from '../src/ol/style/Fill.js';
import Stroke from '../src/ol/style/Stroke.js';
import Style from '../src/ol/style/Style.js';
import Text from '../src/ol/style/Text.js';

const format = new WKT();
const wktOutput = document.getElementById('wkt');

const features = [
  new Feature({
    geometry: new CircularString([
      [0, 0],
      [2, 4],
      [4, 0],
      [6, -4],
      [8, 0],
    ]),
    name: 'CircularString',
  }),
  new Feature({
    geometry: new CompoundCurve([
      new CircularString([
        [12, 0],
        [14, 3],
        [16, 0],
      ]),
      new LineString([
        [16, 0],
        [20, 0],
      ]),
    ]),
    name: 'CompoundCurve',
  }),
  new Feature({
    geometry: new CurvePolygon([
      new CircularString([
        [26, 0],
        [30, 4],
        [34, 0],
        [30, -4],
        [26, 0],
      ]),
    ]),
    name: 'CurvePolygon',
  }),
  new Feature({
    geometry: new CurvePolygon([
      new CompoundCurve([
        new CircularString([
          [40, -4],
          [44, 4],
          [48, -4],
        ]),
        new LineString([
          [48, -4],
          [40, -4],
        ]),
      ]),
      new CircularString([
        [42, -2],
        [44, 1],
        [46, -2],
        [44, -3],
        [42, -2],
      ]),
    ]),
    name: 'CurvePolygon + hole',
  }),
];

const stroke = new Stroke({color: '#0064c8', width: 3});
const fill = new Fill({color: 'rgba(0, 100, 200, 0.15)'});

function styleFunction(feature) {
  const geom = feature.getGeometry();
  const coords = geom.getCoordinates ? geom.getCoordinates() : [];
  const flat = Array.isArray(coords[0]?.[0]) ? coords.flat() : coords;
  const styles = [new Style({stroke, fill})];
  for (const c of flat) {
    if (Array.isArray(c) && c.length >= 2) {
      styles.push(
        new Style({
          geometry: new Point(c),
          image: new CircleStyle({
            radius: 5,
            fill: new Fill({color: '#ff6600'}),
            stroke: new Stroke({color: '#fff', width: 1.5}),
          }),
        }),
      );
    }
  }
  styles.push(
    new Style({
      text: new Text({
        text: feature.get('name') || '',
        font: 'bold 12px sans-serif',
        offsetY: -18,
        fill: new Fill({color: '#333'}),
        backgroundFill: new Fill({color: 'rgba(255,255,255,0.8)'}),
        padding: [2, 4, 2, 4],
      }),
    }),
  );
  return styles;
}

const source = new VectorSource({features});

const map = new Map({
  target: 'map',
  layers: [
    new TileLayer({source: new OSM()}),
    new VectorLayer({source, style: styleFunction}),
  ],
  view: new View({projection: 'EPSG:4326'}),
});

map.getView().fit(source.getExtent(), {padding: [100, 60, 100, 60]});

const modify = new Modify({source});
map.addInteraction(modify);

modify.on('modifyend', (e) => {
  wktOutput.value = e.features
    .getArray()
    .map((f) => format.writeFeature(f))
    .join('\n');
});
