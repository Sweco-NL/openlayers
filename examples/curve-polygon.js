import Map from "../src/ol/Map.js";
import View from "../src/ol/View.js";
import WKB from "../src/ol/format/WKB.js";
import { Fill, Stroke, Style } from "../src/ol/style.js";
import { OSM, Vector as VectorSource } from "../src/ol/source.js";
import { Tile as TileLayer, Vector as VectorLayer } from "../src/ol/layer.js";
import { click } from "ol/events/condition";
import Select from "ol/interaction/Select";

const raster = new TileLayer({
  source: new OSM(),
});

const wkb = [
  // CURVEPOLYGON(
  //   COMPOUNDCURVE(
  //     CIRCULARSTRING(1 2, 2 4, 4 2),
  //     (4 2, 5 4, 4 5),
  //     CIRCULARSTRING(4 5, 3 6, 4 8),
  //     (4 8, 8 4, 8 -2, 2 -2, 1 2)
  //   ),
  //   CIRCULARSTRING(1.5 2.5, 2 3, 3 1.5, 2 1, 1.5 2.5),
  //   CIRCULARSTRING(2 0, 3 0, 2 0),
  //   (7 1, 6 2, 5 1, 7 1)
  // ) // XY
  "010a00000004000000010900000004000000010800000003000000000000000000f03f000000000000004000000000000000400000000000001040000000000000104000000000000000400102000000030000000000000000001040000000000000004000000000000014400000000000001040000000000000104000000000000014400108000000030000000000000000001040000000000000144000000000000008400000000000001840000000000000104000000000000020400102000000050000000000000000001040000000000000204000000000000020400000000000001040000000000000204000000000000000c0000000000000004000000000000000c0000000000000f03f0000000000000040010800000005000000000000000000f83f0000000000000440000000000000004000000000000008400000000000000840000000000000f83f0000000000000040000000000000f03f000000000000f83f00000000000004400108000000030000000000000000000040000000000000000000000000000008400000000000000000000000000000004000000000000000000102000000040000000000000000001c40000000000000f03f000000000000184000000000000000400000000000001440000000000000f03f0000000000001c40000000000000f03f",

  // CURVEPOLYGON(
  //   COMPOUNDCURVE(
  //     CIRCULARSTRING(11 2 1, 12 4 1, 14 2 1),
  //     (14 2 1, 15 4 1, 14 5 1),
  //     CIRCULARSTRING(14 5 1, 13 6 1, 14 8 1),
  //     (14 8 1, 18 4 1, 18 -2 1, 12 -2 1, 11 2 1)
  //   ),
  //   CIRCULARSTRING(11.5 2.5 1, 12 3 1, 13 1.5 1, 12 1 1, 11.5 2.5 1),
  //   CIRCULARSTRING(12 0 1, 13 0 1, 12 0 1),
  //   (17 1 1, 16 2 1, 15 1 1, 17 1 1)
  // ) // XYZ
  "01f20300000400000001f10300000400000001f00300000300000000000000000026400000000000000040000000000000f03f00000000000028400000000000001040000000000000f03f0000000000002c400000000000000040000000000000f03f01ea030000030000000000000000002c400000000000000040000000000000f03f0000000000002e400000000000001040000000000000f03f0000000000002c400000000000001440000000000000f03f01f0030000030000000000000000002c400000000000001440000000000000f03f0000000000002a400000000000001840000000000000f03f0000000000002c400000000000002040000000000000f03f01ea030000050000000000000000002c400000000000002040000000000000f03f00000000000032400000000000001040000000000000f03f000000000000324000000000000000c0000000000000f03f000000000000284000000000000000c0000000000000f03f00000000000026400000000000000040000000000000f03f01f00300000500000000000000000027400000000000000440000000000000f03f00000000000028400000000000000840000000000000f03f0000000000002a40000000000000f83f000000000000f03f0000000000002840000000000000f03f000000000000f03f00000000000027400000000000000440000000000000f03f01f00300000300000000000000000028400000000000000000000000000000f03f0000000000002a400000000000000000000000000000f03f00000000000028400000000000000000000000000000f03f01ea030000040000000000000000003140000000000000f03f000000000000f03f00000000000030400000000000000040000000000000f03f0000000000002e40000000000000f03f000000000000f03f0000000000003140000000000000f03f000000000000f03f",
];

const format = new WKB();

const features = wkb.map((wkb) => {
  return format.readFeature(wkb, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:3857",
  });
});

features[0].setStyle(
  new Style({
    fill: new Fill({
      color: "#0000FF",
    }),
    stroke: new Stroke({
      color: "#FF0000",
      width: 4,
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
    zoom: 4,
  }),
});

const selected = new Style({
  fill: new Fill({
    color: "#00aaff",
  }),
  stroke: new Stroke({
    color: "rgba(255, 255, 255, 0.7)",
    width: 2,
  }),
});

// select interaction working on "click"
const selectClick = new Select({
  condition: click,
  style: selected,
});

map.addInteraction(selectClick);

selectClick.on("select", function (e) {
  console.log(e);
  document.getElementById("status").innerHTML =
    "&nbsp;" +
    e.target.getFeatures().getLength() +
    " selected features (last operation selected " +
    e.selected.length +
    " and deselected " +
    e.deselected.length +
    " features)";
});
