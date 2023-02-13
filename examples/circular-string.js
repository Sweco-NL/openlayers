import Map from "../src/ol/Map.js";
import View from "../src/ol/View.js";
import { OSM, Vector as VectorSource } from "../src/ol/source.js";
import { Tile as TileLayer, Vector as VectorLayer } from "../src/ol/layer.js";
import { Fill, Stroke, Style, Text } from "ol/style.js";
import WKT from "ol/format/WKT.js";

const raster = new TileLayer({
  source: new OSM(),
});

const wkt = [
  "CIRCULARSTRING(1 2, 2 4, 4 2, 5 4, 4 5, 3 6, 4 8)", // XY
  "CIRCULARSTRING(11 2, 12 4, 14 2, 15 4, 14 5, 13 6, 14 8, 12 8, 14 8)", // XY + full circle
  "CIRCULARSTRING(21 2, 22 4, 24 2, 25 4, 24 5, 23 6, 24 8, 22 8, 24 8, 26 9, 28 6)", // XY + full circle and some
  "CIRCULARSTRING Z(31 2 2, 32 4 2, 34 2 2, 35 4 2, 34 5 2, 33 6 2, 34 8 2, 32 8 2, 34 8 2, 36 9 2, 38 6 2)", // XYZ  + full circle and some
  "CIRCULARSTRING(41 2, 42 4, 44 2, 45 4, 44 5, 43 6, 44 8, 48 4, 41 2)", // XY closed
];

const formatWkt = new WKT();

const features = wkt.map((s) => {
  return formatWkt.readFeature(s, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857",
  });
});

const vector = new VectorLayer({
  source: new VectorSource({
    features: features,
  }),
});

features.forEach((feature, i) => {
  feature.setStyle(
    new Style({
      stroke: new Stroke({
        color: "red",
        width: 2,
      }),
      text: new Text({
        text: "Feature" + i,
        fill: new Fill({
          color: "black",
        }),
        stroke: new Stroke({
          color: "white",
          width: 2,
        }),
      }),
    })
  );
});

const map = new Map({
  layers: [raster, vector],
  target: "map",
  view: new View({
    center: [0, 0],
    zoom: 4,
  }),
});
