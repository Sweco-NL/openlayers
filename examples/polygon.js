import GeoJSON from '../src/ol/format/GeoJSON.js';
import Map from '../src/ol/Map.js';
import VectorLayer from '../src/ol/layer/Vector.js';
import VectorSource from '../src/ol/source/Vector.js';
import View from '../src/ol/View.js';
import {Fill, Stroke, Style} from '../src/ol/style.js';

const blue = new Style({
  stroke: new Stroke({
    color: 'blue',
    width: 3,
  }),
  fill: new Fill({
    color: 'rgba(0, 0, 255, 1)',
  }),
});

const red = new Style({
  stroke: new Stroke({
    color: 'red',
    width: 3,
  }),
  fill: new Fill({
    color: 'rgba(255, 0, 0, 1)',
  }),
});

const geojsonObject = {
  'type': 'FeatureCollection',
  'crs': {
    'type': 'name',
    'properties': {
      'name': 'EPSG:3857',
    },
  },
  'features': [
    {
      'type': 'Feature',
      'geometry': {
        'type': 'Polygon',
        'coordinates': [
          [
            [-5e6, 6e6],
            [-5e6, 8e6],
            [-3e6, 8e6],
            [-3e6, 6e6],
            [-5e6, 6e6],
          ],
        ],
      },
    },
    {
      'type': 'Feature',
      'geometry': {
        'type': 'Polygon',
        'coordinates': [
          [
            [-2e6, 6e6],
            [-2e6, 8e6],
            [0, 8e6],
            [0, 6e6],
            [-2e6, 6e6],
          ],
        ],
      },
    },
  ],
};

const source = new VectorSource({
  features: new GeoJSON().readFeatures(geojsonObject),
});

const features = source.getFeatures();
features[0].setStyle(red);
features[1].setStyle(blue);

const layer = new VectorLayer({
  source: source,
});

const map = new Map({
  layers: [layer],
  target: 'map',
  view: new View({
    center: [0, 3000000],
    zoom: 2,
  }),
});
