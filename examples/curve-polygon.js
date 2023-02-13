import Map from "ol/Map.js";
import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import View from "ol/View.js";
import { Fill, Stroke, Style, Text } from "ol/style.js";
import { Tile as TileLayer } from "../src/ol/layer.js";
import { OSM } from "../src/ol/source.js";
import Select from "ol/interaction/Select";
import { click } from "ol/events/condition";
import WKT from "ol/format/WKT.js";

const raster = new TileLayer({
  source: new OSM(),
});

const wktStrings = [
  `CURVEPOLYGON ZM(
    COMPOUNDCURVE ZM(
      CIRCULARSTRING ZM(1 2 3 4, 2 4 1 2, 4 2 2 4),
      LINESTRING ZM(4 2 5 4, 5 4 3 2, 4 5 4 2),
      CIRCULARSTRING ZM(4 5 5 4, 3 6 2 1, 4 8 4 2),
      LINESTRING ZM(4 8 3 2, 8 4 4 2, 8 -2 1 3, 2 -2 3 1, 1 2 4 5)
    ),
    CIRCULARSTRING ZM(1.5 2.5 4 2, 2 3 1 2, 3 1.5 5 4, 2 1 3 2, 1.5 2.5 2 3),
    CIRCULARSTRING ZM(2 0 4 2, 3 0 1 3, 2 0 5 4),
    LINESTRING ZM(7 1 3 2, 6 2 4 1, 5 1 5 4, 7 1 4 2)
    )`, // XYZM
  `CURVEPOLYGON(
    COMPOUNDCURVE(
      CIRCULARSTRING(23 6, 20 7, 24 8),
      LINESTRING(24 7, 24 11, 27 9),
      CIRCULARSTRING(27 9, 25 16, 26 18),
      LINESTRING(31 12, 33 8, 36 7),
      CIRCULARSTRING(36 7, 37 5, 41 2),
      LINESTRING(41 2, 26 7, 26 1),
      CIRCULARSTRING(26 1, 24 2, 21 1),
      LINESTRING(21 1, 18 0, 14 0),
      CIRCULARSTRING(14 0, 18 3, 23 5)
    )
  )`, // XY
];

const wkt = new WKT();

const features = wktStrings.map((s) =>
  wkt.readFeature(s, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857",
  })
);

features[0].setStyle(
  new Style({
    fill: new Fill({
      color: "#0000FF",
    }),
    stroke: new Stroke({
      color: "#FF0000",
      width: 1,
    }),
    text: new Text({
      font: "12px Calibri,sans-serif",
      overflow: true,
      placement: "point",
      fill: new Fill({
        color: "#000",
      }),
      stroke: new Stroke({
        color: "#fff",
        width: 3,
      }),
      text: "Feature 1",
    }),
  })
);

features[1].setStyle(
  new Style({
    fill: new Fill({
      color: "#FF0000",
    }),
    stroke: new Stroke({
      color: "#0000FF",
      width: 1,
    }),
    text: new Text({
      font: "12px Calibri,sans-serif",
      overflow: true,
      placement: "point",
      fill: new Fill({
        color: "#000",
      }),
      stroke: new Stroke({
        color: "#fff",
        width: 3,
      }),
      text: "Feature 2",
    }),
  })
);

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
    zoom: 2,
  }),
});

const selectedFeatureStyle = new Style({
  fill: new Fill({
    color: "#00aaff",
  }),
  stroke: new Stroke({
    color: "rgba(255, 255, 255, 0.7)",
    width: 2,
  }),
});
const selectClick = new Select({
  condition: click,
  style: selectedFeatureStyle,
});
map.addInteraction(selectClick);

selectClick.on("select", function (e) {
  document.getElementById("status").innerHTML =
    "&nbsp;" +
    e.target.getFeatures().getLength() +
    " selected features (last operation selected " +
    e.selected.length +
    " and deselected " +
    e.deselected.length +
    " features)";
});
