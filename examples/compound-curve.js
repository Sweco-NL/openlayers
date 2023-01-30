import Map from "../src/ol/Map.js";
import View from "../src/ol/View.js";
import { OSM, Vector as VectorSource } from "../src/ol/source.js";
import { Tile as TileLayer, Vector as VectorLayer } from "../src/ol/layer.js";
import { Fill, Stroke, Style, Text } from "ol/style.js";
import WKT from "ol/format/WKT.js";

const raster = new TileLayer({
  source: new OSM(),
});

const wktStrings = [
  `COMPOUNDCURVE(
     CIRCULARSTRING(1 2, 2 4, 4 2),
     LINESTRING(4 2, 5 4, 4 5),
     CIRCULARSTRING(4 5, 3 6, 4 8)
  )`, // XY
  `COMPOUNDCURVE(
     CIRCULARSTRING(11 2, 12 4, 14 2),
     LINESTRING(14 2, 15 4, 14 5),
     CIRCULARSTRING(14 5, 13 6, 14 8),
     LINESTRING(14 8, 18 4, 18 0, 11 2)
  )`, // XY closed
  `COMPOUNDCURVE(
     CIRCULARSTRING Z(21 2 2, 22 4 2, 24 2 2),
     LINESTRING Z(24 2 2, 25 4 2, 24 5 2),
     CIRCULARSTRING Z(24 5 2, 23 6 2, 24 8 2)
   )`, // XYZ
  `COMPOUNDCURVE(
     CIRCULARSTRING Z(31 2 3, 32 4 3, 34 2 3),
     LINESTRING Z(34 2 3, 35 4 3, 34 5 3),
     CIRCULARSTRING Z(34 5 3, 33 6 3, 34 8 3),
     LINESTRING Z(34 8 3, 38 4 3, 38 0 3, 31 2 3)
  )`, // XYZ closed
];

const wkt = new WKT();

// const format = new WKB();

const features = wktStrings.map((s) => {
  return wkt.readFeature(s, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857",
  });
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

const vector = new VectorLayer({
  source: new VectorSource({
    features: features,
  }),
});

const map = new Map({
  layers: [raster, vector],
  target: "map",
  view: new View({
    center: [0, 0],
    zoom: 4,
  }),
});
