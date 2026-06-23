/**
 * @module ol/interaction/Draw
 */
import Feature from '../Feature.js';
import MapBrowserEvent from '../MapBrowserEvent.js';
import MapBrowserEventType from '../MapBrowserEventType.js';
import {
  distance,
  squaredDistance as squaredCoordinateDistance,
} from '../coordinate.js';
import Event from '../events/Event.js';
import EventType from '../events/EventType.js';
import {
  always,
  never,
  noModifierKeys,
  shiftKeyOnly,
} from '../events/condition.js';
import {
  boundingExtent,
  getBottomLeft,
  getBottomRight,
  getTopLeft,
  getTopRight,
} from '../extent.js';
import {FALSE, TRUE} from '../functions.js';
import Circle from '../geom/Circle.js';
import LineString from '../geom/LineString.js';
import MultiLineString from '../geom/MultiLineString.js';
import MultiPoint from '../geom/MultiPoint.js';
import MultiPolygon from '../geom/MultiPolygon.js';
import Point from '../geom/Point.js';
import Polygon, {fromCircle, makeRegular} from '../geom/Polygon.js';
import {getStrideForLayout} from '../geom/SimpleGeometry.js';
import VectorLayer from '../layer/Vector.js';
import {fromUserCoordinate, getUserProjection} from '../proj.js';
import VectorSource from '../source/Vector.js';
import {createEditingStyle} from '../style/Style.js';
import PointerInteraction from './Pointer.js';
import InteractionProperty from './Property.js';
import {
  getCoordinate,
  getTraceTargetUpdate,
  getTraceTargets,
  interpolateCoordinate,
  isTraceTargetVertexIndex,
} from './tracing.js';

/**
 * @typedef {Object} Options
 * @property {import("../geom/Geometry.js").Type} type Geometry type of
 * the geometries being drawn with this instance.
 * @property {number} [clickTolerance=6] The maximum distance in pixels between
 * "down" and "up" for a "up" event to be considered a "click" event and
 * actually add a point/vertex to the geometry being drawn.  The default of `6`
 * was chosen for the draw interaction to behave correctly on mouse as well as
 * on touch devices.
 * @property {import("../Collection.js").default<Feature>} [features]
 * Destination collection for the drawn features.
 * @property {VectorSource} [source] Destination source for
 * the drawn features.
 * @property {number} [dragVertexDelay=500] Delay in milliseconds after pointerdown
 * before the current vertex can be dragged to its exact position.
 * @property {number} [snapTolerance=12] Pixel distance for snapping to the
 * drawing finish. Must be greater than `0`.
 * @property {boolean} [stopClick=false] Stop click, singleclick, and
 * doubleclick events from firing during drawing.
 * @property {number} [maxPoints] The number of points that can be drawn before
 * a polygon ring or line string is finished. By default there is no
 * restriction.
 * @property {number} [minPoints] The number of points that must be drawn
 * before a polygon ring or line string can be finished. Default is `3` for
 * polygon rings and `2` for line strings.
 * @property {import("../events/condition.js").Condition} [finishCondition] A function
 * that takes a {@link module:ol/MapBrowserEvent~MapBrowserEvent} and returns a
 * boolean to indicate whether the drawing can be finished. Not used when drawing
 * POINT or MULTI_POINT geometries.
 * @property {import("../style/Style.js").StyleLike|import("../style/flat.js").FlatStyleLike} [style]
 * Style for sketch features. The draw interaction can have up to three sketch features, depending on the mode.
 * It will always contain a feature with a `Point` geometry that corresponds to the current cursor position.
 * If the mode is `LineString` or `Polygon`, and there is at least one drawn point, it will also contain a feature with
 * a `LineString` geometry that corresponds to the line between the already drawn points and the current cursor position.
 * If the mode is `Polygon`, and there is at least one drawn point, it will also contain a feature with a `Polygon`
 * geometry that corresponds to the polygon between the already drawn points and the current cursor position
 * (note that this polygon has only two points if only one point is drawn).
 * If the mode is `Circle`, and there is one point drawn, it will also contain a feature with a `Circle` geometry whose
 * center is the drawn point and the radius is determined by the distance between the drawn point and the cursor.
 * @property {GeometryFunction} [geometryFunction]
 * Function that is called when a geometry's coordinates are updated.
 * @property {string} [geometryName] Geometry name to use for features created
 * by the draw interaction.
 * @property {import("../events/condition.js").Condition} [condition] A function that
 * takes a {@link module:ol/MapBrowserEvent~MapBrowserEvent} and returns a
 * boolean to indicate whether that event should be handled.
 * By default {@link module:ol/events/condition.noModifierKeys}, i.e. a click,
 * adds a vertex or deactivates freehand drawing.
 * @property {boolean} [freehand=false] Operate in freehand mode for lines,
 * polygons, and circles.  This makes the interaction always operate in freehand
 * mode and takes precedence over any `freehandCondition` option.
 * @property {import("../events/condition.js").Condition} [freehandCondition]
 * Condition that activates freehand drawing for lines and polygons. This
 * function takes a {@link module:ol/MapBrowserEvent~MapBrowserEvent} and
 * returns a boolean to indicate whether that event should be handled. The
 * default is {@link module:ol/events/condition.shiftKeyOnly}, meaning that the
 * Shift key activates freehand drawing.
 * @property {boolean|import("../events/condition.js").Condition} [trace=false] Trace a portion of another geometry.
 * Ignored when in freehand mode.
 * @property {boolean} [traceBacktracking=true] Allow tracing to remove
 * previously traced coordinates when the pointer moves backward along the
 * current trace target or switches to another target.
 * @property {VectorSource | import("./TraceSource.js").default} [traceSource] Source for
 * features to trace. Pass a `VectorSource` for OL's classic trace behavior (one ring picked
 * at click time, limited shared-vertex pivots). Pass a `TraceSource` for the vertex-only-exit
 * trace lifecycle with seamless multi-feature hopping along shared vertices and a continuous
 * `trace` event reporting active sub-geometry changes. Defaults to the interaction's
 * `source` when tracing is active and `traceSource` is omitted.
 * @property {boolean} [wrapX=false] Wrap the world horizontally on the sketch
 * overlay.
 * @property {import("../geom/Geometry.js").GeometryLayout} [geometryLayout='XY'] Layout of the
 * feature geometries created by the draw interaction.
 */

/**
 * Coordinate type when drawing points.
 * @typedef {import("../coordinate.js").Coordinate} PointCoordType
 */

/**
 * @typedef {import('./tracing.js').LineCoordType} LineCoordType
 */

/**
 * Coordinate type when drawing polygons.
 * @typedef {Array<Array<import("../coordinate.js").Coordinate>>} PolyCoordType
 */

/**
 * Types used for drawing coordinates.
 * @typedef {PointCoordType|LineCoordType|PolyCoordType} SketchCoordType
 */

/** @typedef {import('./tracing.js').TraceState} TraceState */

/** @typedef {import('./tracing.js').TraceTarget} TraceTarget */

/**
 * Function that takes an array of coordinates and an optional existing geometry
 * and a projection as arguments, and returns a geometry. The optional existing
 * geometry is the geometry that is returned when the function is called without
 * a second argument.
 * @typedef {function(!SketchCoordType, import("../geom/SimpleGeometry.js").default,
 *     import("../proj/Projection.js").default):
 *     import("../geom/SimpleGeometry.js").default} GeometryFunction
 */

/**
 * @typedef {'Point' | 'LineString' | 'Polygon' | 'Circle'} Mode
 * Draw mode.  This collapses multi-part geometry types with their single-part
 * cousins.
 */

/**
 * @enum {string}
 */
const DrawEventType = {
  /**
   * Triggered upon feature draw start
   * @event DrawEvent#drawstart
   * @api
   */
  DRAWSTART: 'drawstart',
  /**
   * Triggered upon feature draw end
   * @event DrawEvent#drawend
   * @api
   */
  DRAWEND: 'drawend',
  /**
   * Triggered upon feature draw abortion
   * @event DrawEvent#drawabort
   * @api
   */
  DRAWABORT: 'drawabort',
  /**
   * Triggered when tracing along an existing feature begins
   * @event DrawEvent#tracestart
   * @api
   */
  TRACESTART: 'tracestart',
  /**
   * Triggered when tracing along an existing feature ends
   * @event DrawEvent#traceend
   * @api
   */
  TRACEEND: 'traceend',
  /**
   * Triggered between `tracestart` and `traceend` whenever the active trace edge
   * changes (cursor crossed onto a different graph edge or off all edges). Only
   * dispatched when `traceSource` is a `TraceSource` (vertex-only-exit lifecycle).
   * Payload includes `traceSourceSubGeometryKind` so applications can stamp
   * segment-type breaks without re-deriving topology.
   * @event DrawEvent#trace
   * @api
   */
  TRACE: 'trace',
};

/**
 * @classdesc
 * Events emitted by {@link module:ol/interaction/Draw~Draw} instances are
 * instances of this type.
 */
export class DrawEvent extends Event {
  /**
   * @param {DrawEventType} type Type.
   * @param {Feature} feature The feature drawn.
   * @param {import("../coordinate.js").Coordinate} [opt_coordinate] Coordinate associated with the event.
   * @param {TraceTarget|{feature: Feature, geometry: import("../geom/SimpleGeometry.js").default | import("../geom/CompoundCurve.js").default, ringIndex: (number|undefined), startIndex: (number|undefined), endIndex: (number|undefined), subGeometryKind: ('CircularString'|'LineString')}} [opt_traceTarget] Source-side trace target snapshot. When provided
   * (typically on `traceend`), populates the `traceSource*` and `trace*Index` fields below.
   */
  constructor(type, feature, opt_coordinate, opt_traceTarget) {
    super(type);

    /**
     * The feature being drawn.
     * @type {Feature}
     * @api
     */
    this.feature = feature;

    /**
     * The coordinate associated with this event (e.g. trace start/end coordinate).
     * @type {import("../coordinate.js").Coordinate|undefined}
     * @api
     */
    this.coordinate = opt_coordinate;

    /**
     * The source feature being traced. Populated on `traceend` events when a trace target
     * was committed (cursor moved enough during the trace). Undefined on non-trace events
     * and on `tracestart` (since the trace target is not committed until the cursor moves).
     * @type {Feature|undefined}
     * @api
     */
    this.traceSourceFeature = opt_traceTarget
      ? opt_traceTarget.feature
      : undefined;

    /**
     * The smallest geometry instance corresponding to the trace target.
     *
     * - `LineString` features → the `LineString` itself.
     * - `CurvePolygon` features → the specific ring (`CircularString`, `CompoundCurve`,
     *   or `LineString`); use `traceSourceRingIndex` to know which ring.
     * - `Polygon` features → the top-level `Polygon` (rings are not separate geometry
     *   instances); use `traceSourceRingIndex` to know which ring.
     * - `CompoundCurve` / `CircularString` features → the geometry itself.
     * - `MultiLineString` / `MultiPolygon` features → the top-level multi-geometry
     *   (sub-components are not attributed because their instances are cloned per
     *   accessor call and would not be stable).
     *
     * Undefined on non-trace events and on `tracestart`.
     * @type {import("../geom/SimpleGeometry.js").default | import("../geom/CompoundCurve.js").default | undefined}
     * @api
     */
    this.traceSourceGeometry = opt_traceTarget
      ? opt_traceTarget.geometry
      : undefined;

    /**
     * For `Polygon` and `CurvePolygon` sources, the index of the ring being traced
     * (0 for the outer ring, 1+ for interior rings/holes). Undefined for line-shaped
     * sources, for `MultiPolygon` (where polygon identity is not attributed), and on
     * non-trace / `tracestart` events.
     * @type {number|undefined}
     * @api
     */
    this.traceSourceRingIndex = opt_traceTarget
      ? opt_traceTarget.ringIndex
      : undefined;

    /**
     * Position in the source target coordinates where the trace began, expressed as a
     * fractional index (whole part = vertex index, fractional part = position along the
     * following segment). Index values for rings may be negative or larger than the
     * coordinate count (they wrap). Undefined on non-trace events and on `tracestart`.
     * @type {number|undefined}
     * @api
     */
    this.traceStartIndex = opt_traceTarget
      ? opt_traceTarget.startIndex
      : undefined;

    /**
     * Position in the source target coordinates where the trace ended, expressed as a
     * fractional index. For closed-ring sources, `traceEndIndex - traceStartIndex` equal
     * to (a multiple of) the ring's coordinate count indicates a full-ring traversal.
     * Undefined on non-trace events and on `tracestart`.
     * @type {number|undefined}
     * @api
     */
    this.traceEndIndex = opt_traceTarget ? opt_traceTarget.endIndex : undefined;

    /**
     * Canonical sub-geometry kind (`'CircularString'` or `'LineString'`) of the
     * currently active trace edge. Defined on `trace` events and (when known) on
     * `traceend`; undefined on non-trace events, on `tracestart`, and on `trace`
     * events fired before the cursor has resolved an edge.
     * @type {('CircularString'|'LineString')|undefined}
     * @api
     */
    this.traceSourceSubGeometryKind = opt_traceTarget
      ? /** @type {{subGeometryKind?: ('CircularString'|'LineString')}} */ (
          opt_traceTarget
        ).subGeometryKind
      : undefined;

    /**
     * For `CircularString` edges, the 0-based index of the arc triplet within
     * the subGeometry being traced. Two arcs sharing the same `CircularString`
     * sub-geometry have different `arcIndex` values. Undefined for `LineString`
     * edges and on non-trace / `tracestart` events.
     * @type {number|undefined}
     * @api
     */
    this.traceSourceArcIndex = opt_traceTarget
      ? /** @type {{arcIndex?: number}} */ (opt_traceTarget).arcIndex
      : undefined;
  }
}

/**
 * @param {Array<TraceTarget>} targets Existing trace targets.
 * @param {TraceTarget} candidate Candidate target.
 * @return {boolean} The candidate target is already represented.
 */
function hasEquivalentTraceTarget(targets, candidate) {
  const candidateStart = interpolateCoordinate(
    candidate.coordinates,
    candidate.startIndex,
  );
  for (let i = 0, ii = targets.length; i < ii; ++i) {
    const target = targets[i];
    if (
      target.ring !== candidate.ring ||
      target.coordinates.length !== candidate.coordinates.length
    ) {
      continue;
    }
    let equal = true;
    for (let j = 0, jj = target.coordinates.length; j < jj; ++j) {
      const a = target.coordinates[j];
      const b = candidate.coordinates[j];
      if (a[0] !== b[0] || a[1] !== b[1]) {
        equal = false;
        break;
      }
    }
    if (equal) {
      const targetStart = interpolateCoordinate(
        target.coordinates,
        target.startIndex,
      );
      if (
        targetStart[0] !== candidateStart[0] ||
        targetStart[1] !== candidateStart[1]
      ) {
        continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * @param {TraceTarget} target Trace target.
 * @param {import("../coordinate.js").Coordinate} coordinate Coordinate.
 * @return {number|null} Whole target index at the coordinate, or null.
 */
function getTraceVertexIndexAtCoordinate(target, coordinate) {
  const coordinates = target.coordinates;
  for (let i = 0, ii = coordinates.length; i < ii; ++i) {
    const candidate = coordinates[i];
    if (
      candidate[0] === coordinate[0] &&
      candidate[1] === coordinate[1] &&
      isTraceTargetVertexIndex(target, i)
    ) {
      return i;
    }
  }
  return null;
}

/**
 * @param {TraceTarget} target Trace target.
 * @param {import("../coordinate.js").Coordinate} coordinate Coordinate.
 * @return {boolean} The target starts at the coordinate.
 */
function traceTargetStartsAtCoordinate(target, coordinate) {
  if (!isTraceTargetVertexIndex(target, target.startIndex)) {
    return false;
  }
  const start = interpolateCoordinate(target.coordinates, target.startIndex);
  return start[0] === coordinate[0] && start[1] === coordinate[1];
}

/**
 * @param {TraceTarget} oldTarget Currently traced target.
 * @param {TraceTarget} newTarget Candidate target.
 * @param {import("../coordinate.js").Coordinate} coordinate Current coordinate.
 * @return {boolean} The candidate pivots at a shared target vertex.
 */
function isTraceVertexPivot(oldTarget, newTarget, coordinate) {
  return (
    getTraceVertexIndexAtCoordinate(oldTarget, coordinate) !== null &&
    traceTargetStartsAtCoordinate(newTarget, coordinate)
  );
}

/**
 * @param {TraceTarget} target Trace target.
 * @param {number} endIndex Candidate end index.
 * @return {boolean} Candidate progress would move backward on the target.
 */
function isTraceBacktracking(target, endIndex) {
  const forward = target.endIndex >= target.startIndex;
  return forward ? endIndex < target.endIndex : endIndex > target.endIndex;
}

/**
 * @param {TraceTarget} oldTarget Currently traced target.
 * @param {TraceTarget} newTarget Candidate target.
 * @return {boolean} The current trace endpoint is the candidate start vertex.
 */
function isStoredSharedTraceVertex(oldTarget, newTarget) {
  if (
    !isTraceTargetVertexIndex(oldTarget, oldTarget.endIndex) ||
    !isTraceTargetVertexIndex(newTarget, newTarget.startIndex)
  ) {
    return false;
  }
  const oldEnd = interpolateCoordinate(
    oldTarget.coordinates,
    oldTarget.endIndex,
  );
  const newStart = interpolateCoordinate(
    newTarget.coordinates,
    newTarget.startIndex,
  );
  return squaredCoordinateDistance(oldEnd, newStart) === 0;
}

/**
 * Find the graph vertex shared by an in-progress trace edge `top` and a new
 * candidate edge `b`, preferring the vertex of `top.edge` that the cursor
 * is currently closer to. Returning the *far* shared vertex would force the
 * walk to retract every traced point on `top.edge` before the new edge takes
 * over -- the junction-crossing line-disappear bug.
 *
 * The cursor proxy is `top.endIndex` along `top.tessellation`: the cursor
 * is on the start side when `endIndex` is closer to 0, otherwise on the end
 * side. When only one endpoint is shared, that one is returned.
 *
 * @param {{edge: import("./TraceSource.js").TraceEdge, tessellation: Array<import("../coordinate.js").Coordinate>, startIndex: number, endIndex: number, pointsAdded: number}} top Current edge progress.
 * @param {import("./TraceSource.js").TraceEdge} b Candidate new edge.
 * @return {?import("./TraceSource.js").TraceVertex} Shared vertex or null.
 */
function findSharedTraceVertexNear(top, b) {
  const a = top.edge;
  const startShared =
    a.startVertex === b.startVertex || a.startVertex === b.endVertex;
  const endShared =
    a.endVertex === b.startVertex || a.endVertex === b.endVertex;
  if (!startShared && !endShared) {
    return null;
  }
  if (startShared && !endShared) {
    return a.startVertex;
  }
  if (!startShared && endShared) {
    return a.endVertex;
  }
  // Both endpoints of `top.edge` are shared with `b` (e.g. a closed
  // single-segment loop, or two parallel edges between the same vertices).
  // Prefer the side the cursor is currently closer to.
  const lastIdx = top.tessellation.length - 1;
  const distToStart = top.endIndex;
  const distToEnd = lastIdx - top.endIndex;
  return distToStart <= distToEnd ? a.startVertex : a.endVertex;
}

/***
 * @template Return
 * @typedef {import("../Observable.js").OnSignature<import("../Observable.js").EventTypes, import("../events/Event.js").default, Return> &
 *   import("../Observable.js").OnSignature<import("../ObjectEventType.js").Types|
 *     'change:active', import("../Object.js").ObjectEvent, Return> &
 *   import("../Observable.js").OnSignature<'drawabort'|'drawend'|'drawstart', DrawEvent, Return> &
 *   import("../Observable.js").CombinedOnSignature<import("../Observable.js").EventTypes|import("../ObjectEventType.js").Types|
 *     'change:active'|'drawabort'|'drawend'|'drawstart', Return>} DrawOnSignature
 */

/**
 * @classdesc
 * Interaction for drawing feature geometries.
 *
 * @fires DrawEvent
 * @api
 */
class Draw extends PointerInteraction {
  /**
   * @param {Options} options Options.
   */
  constructor(options) {
    const pointerOptions = /** @type {import("./Pointer.js").Options} */ (
      options
    );
    if (!pointerOptions.stopDown) {
      pointerOptions.stopDown = FALSE;
    }

    super(pointerOptions);

    /***
     * @type {DrawOnSignature<import("../events.js").EventsKey>}
     */
    this.on;

    /***
     * @type {DrawOnSignature<import("../events.js").EventsKey>}
     */
    this.once;

    /***
     * @type {DrawOnSignature<void>}
     */
    this.un;

    /**
     * @type {Options}
     * @private
     */
    this.options_ = options;

    /**
     * @type {boolean}
     * @private
     */
    this.shouldHandle_ = false;

    /**
     * @type {import("../pixel.js").Pixel}
     * @private
     */
    this.downPx_ = null;

    /**
     * @type {import("../coordinate.js").Coordinate|null}
     * @private
     */
    this.downCoordinate_ = null;

    /**
     * @type {ReturnType<typeof setTimeout>}
     * @private
     */
    this.downTimeout_;

    /**
     * @type {number|undefined}
     * @private
     */
    this.lastDragTime_;

    /**
     * Pointer type of the last pointermove event
     * @type {string}
     * @private
     */
    this.pointerType_;

    /**
     * @type {boolean}
     * @private
     */
    this.freehand_ = false;

    /**
     * Target source for drawn features.
     * @type {VectorSource|null}
     * @private
     */
    this.source_ = options.source ? options.source : null;

    /**
     * Target collection for drawn features.
     * @type {import("../Collection.js").default<Feature>|null}
     * @private
     */
    this.features_ = options.features ? options.features : null;

    /**
     * Pixel distance for snapping.
     * @type {number}
     * @private
     */
    this.snapTolerance_ = options.snapTolerance ? options.snapTolerance : 12;

    /**
     * Geometry type.
     * @type {import("../geom/Geometry.js").Type}
     * @private
     */
    this.type_ = /** @type {import("../geom/Geometry.js").Type} */ (
      options.type
    );

    /**
     * Drawing mode (derived from geometry type.
     * @type {Mode}
     * @private
     */
    this.mode_ = getMode(this.type_);

    /**
     * Stop click, singleclick, and doubleclick events from firing during drawing.
     * Default is `false`.
     * @type {boolean}
     * @private
     */
    this.stopClick_ = !!options.stopClick;

    /**
     * Ignore the next up event. This is set to `true` when a drag event is encountered,
     * e.g. when the user pans the map while drawing. In this case, we do not want to bail
     * out of tracing.
     * @type {boolean}
     * @private
     */
    this.ignoreNextUpEvent_ = false;

    /**
     * The number of points that must be drawn before a polygon ring or line
     * string can be finished.  The default is 3 for polygon rings and 2 for
     * line strings.
     * @type {number}
     * @private
     */
    this.minPoints_ = options.minPoints
      ? options.minPoints
      : this.mode_ === 'Polygon'
        ? 3
        : 2;

    /**
     * The number of points that can be drawn before a polygon ring or line string
     * is finished. The default is no restriction.
     * @type {number}
     * @private
     */
    this.maxPoints_ =
      this.mode_ === 'Circle'
        ? 2
        : options.maxPoints
          ? options.maxPoints
          : Infinity;

    /**
     * A function to decide if a potential finish coordinate is permissible
     * @private
     * @type {import("../events/condition.js").Condition}
     */
    this.finishCondition_ = options.finishCondition
      ? options.finishCondition
      : TRUE;

    /**
     * @private
     * @type {import("../geom/Geometry.js").GeometryLayout}
     */
    this.geometryLayout_ = options.geometryLayout
      ? options.geometryLayout
      : 'XY';

    let geometryFunction = options.geometryFunction;
    if (!geometryFunction) {
      const mode = this.mode_;
      if (mode === 'Circle') {
        /**
         * @param {!LineCoordType} coordinates The coordinates.
         * @param {import("../geom/SimpleGeometry.js").default|undefined} geometry Optional geometry.
         * @param {import("../proj/Projection.js").default} projection The view projection.
         * @return {import("../geom/SimpleGeometry.js").default} A geometry.
         */
        geometryFunction = (coordinates, geometry, projection) => {
          const circle = geometry
            ? /** @type {Circle} */ (geometry)
            : new Circle([NaN, NaN]);
          const center = fromUserCoordinate(coordinates[0], projection);
          const squaredLength = squaredCoordinateDistance(
            center,
            fromUserCoordinate(coordinates[coordinates.length - 1], projection),
          );
          circle.setCenterAndRadius(
            center,
            Math.sqrt(squaredLength),
            this.geometryLayout_,
          );
          const userProjection = getUserProjection();
          if (userProjection) {
            circle.transform(projection, userProjection);
          }
          return circle;
        };
      } else {
        let Constructor;
        if (mode === 'Point') {
          Constructor = Point;
        } else if (mode === 'LineString') {
          Constructor = LineString;
        } else if (mode === 'Polygon') {
          Constructor = Polygon;
        }
        /**
         * @param {!LineCoordType} coordinates The coordinates.
         * @param {import("../geom/SimpleGeometry.js").default|undefined} geometry Optional geometry.
         * @param {import("../proj/Projection.js").default} projection The view projection.
         * @return {import("../geom/SimpleGeometry.js").default} A geometry.
         */
        geometryFunction = (coordinates, geometry, projection) => {
          if (geometry) {
            if (mode === 'Polygon') {
              if (coordinates[0].length) {
                // Add a closing coordinate to match the first
                geometry.setCoordinates(
                  [coordinates[0].concat([coordinates[0][0]])],
                  this.geometryLayout_,
                );
              } else {
                geometry.setCoordinates([], this.geometryLayout_);
              }
            } else {
              geometry.setCoordinates(coordinates, this.geometryLayout_);
            }
          } else {
            geometry = new Constructor(coordinates, this.geometryLayout_);
          }
          return geometry;
        };
      }
    }

    /**
     * @type {GeometryFunction}
     * @private
     */
    this.geometryFunction_ = geometryFunction;

    /**
     * @type {number}
     * @private
     */
    this.dragVertexDelay_ =
      options.dragVertexDelay !== undefined ? options.dragVertexDelay : 500;

    /**
     * Finish coordinate for the feature (first point for polygons, last point for
     * linestrings).
     * @type {import("../coordinate.js").Coordinate}
     * @private
     */
    this.finishCoordinate_ = null;

    /**
     * Sketch feature.
     * @type {Feature<import('../geom/SimpleGeometry.js').default>}
     * @private
     */
    this.sketchFeature_ = null;

    /**
     * Sketch point.
     * @type {Feature<Point>}
     * @private
     */
    this.sketchPoint_ = null;

    /**
     * Sketch coordinates. Used when drawing a line or polygon.
     * @type {SketchCoordType}
     * @private
     */
    this.sketchCoords_ = null;

    /**
     * Sketch line. Used when drawing polygon.
     * @type {Feature<LineString>}
     * @private
     */
    this.sketchLine_ = null;

    /**
     * Sketch line coordinates. Used when drawing a polygon or circle.
     * @type {LineCoordType}
     * @private
     */
    this.sketchLineCoords_ = null;

    /**
     * Squared tolerance for handling up events.  If the squared distance
     * between a down and up event is greater than this tolerance, up events
     * will not be handled.
     * @type {number}
     * @private
     */
    this.squaredClickTolerance_ = options.clickTolerance
      ? options.clickTolerance * options.clickTolerance
      : 36;

    /**
     * Draw overlay where our sketch features are drawn.
     * @type {VectorLayer}
     * @private
     */
    this.overlay_ = new VectorLayer({
      source: new VectorSource({
        useSpatialIndex: false,
        wrapX: options.wrapX ? options.wrapX : false,
      }),
      style: options.style ? options.style : getDefaultStyleFunction(),
      updateWhileInteracting: true,
    });

    /**
     * Name of the geometry attribute for newly created features.
     * @type {string|undefined}
     * @private
     */
    this.geometryName_ = options.geometryName;

    /**
     * @private
     * @type {import("../events/condition.js").Condition}
     */
    this.condition_ = options.condition ? options.condition : noModifierKeys;

    /**
     * @private
     * @type {import("../events/condition.js").Condition}
     */
    this.freehandCondition_;
    if (options.freehand) {
      this.freehandCondition_ = always;
    } else {
      this.freehandCondition_ = options.freehandCondition
        ? options.freehandCondition
        : shiftKeyOnly;
    }

    /**
     * @type {import("../events/condition.js").Condition}
     * @private
     */
    this.traceCondition_;
    this.setTrace(options.trace || false);

    /**
     * @type {TraceState & {mode?: 'traceSource', activeEdge?: import("./TraceSource.js").TraceEdge|null}}
     * @private
     */
    this.traceState_ = {active: false};

    /**
     * Ordered record of all TraceSource edges committed during the current draw
     * session. Each entry corresponds to one completed trace and contains the
     * edges that contributed coordinates to the sketch, in traversal order.
     * Cleared when a new sketch starts. Populated by deactivateTracePrimitive_.
     * @private
     * @type {Array<Array<{edge: import("./TraceSource.js").TraceEdge, pointsAdded: number}>>}
     */
    this.committedTraceEdges_ = [];

    /**
     * @type {boolean}
     * @private
     */
    this.traceBacktracking_ = options.traceBacktracking !== false;

    /**
     * @type {VectorSource | import("./TraceSource.js").default | null}
     * @private
     */
    this.traceSource_ = options.traceSource || options.source || null;

    this.addChangeListener(InteractionProperty.ACTIVE, this.updateState_);
  }

  /**
   * Toggle tracing mode or set a tracing condition.
   *
   * @param {boolean|import("../events/condition.js").Condition} trace A boolean to toggle tracing mode or an event
   *     condition that will be checked when a feature is clicked to determine if tracing should be active.
   */
  setTrace(trace) {
    let condition;
    if (!trace) {
      condition = never;
    } else if (trace === true) {
      condition = always;
    } else {
      condition = trace;
    }
    this.traceCondition_ = condition;
  }

  /**
   * Remove the interaction from its current map and attach it to the new map.
   * Subclasses may set up event handlers to get notified about changes to
   * the map here.
   * @param {import("../Map.js").default} map Map.
   * @override
   */
  setMap(map) {
    super.setMap(map);
    this.updateState_();
  }

  /**
   * Set whether the drawing is done in freehand mode.
   *
   * @param {boolean} freehand Freehand drawing.
   * @api
   */
  setFreehand(freehand) {
    this.freehand_ = freehand;
    if (this.freehand_) {
      this.freehandCondition_ = always;
    } else {
      this.freehandCondition_ =
        this.options_ && this.options_.freehandCondition
          ? this.options_.freehandCondition
          : shiftKeyOnly;
    }
  }

  /**
   * Get the overlay layer that this interaction renders sketch features to.
   * @return {VectorLayer} Overlay layer.
   * @api
   */
  getOverlay() {
    return this.overlay_;
  }

  /**
   * Get the source used to look up features for tracing.
   * @return {VectorSource | import("./TraceSource.js").default | null} The active trace source, or null when no source is configured.
   * @api
   */
  getTraceSource() {
    return this.traceSource_;
  }

  /**
   * Get if this interaction is in freehand mode.
   * @return {boolean} Freehand drawing.
   * @api
   */
  getFreehand() {
    return this.freehand_;
  }

  /**
   * Handles the {@link module:ol/MapBrowserEvent~MapBrowserEvent map browser event} and may actually draw or finish the drawing.
   * @param {import("../MapBrowserEvent.js").default<PointerEvent>} event Map browser event.
   * @return {boolean} `false` to stop event propagation.
   * @api
   * @override
   */
  handleEvent(event) {
    if (event.originalEvent.type === EventType.CONTEXTMENU) {
      // Avoid context menu for long taps when drawing on mobile
      event.originalEvent.preventDefault();
    }
    this.freehand_ = this.mode_ !== 'Point' && this.freehandCondition_(event);
    let move = event.type === MapBrowserEventType.POINTERMOVE;
    let pass = true;
    if (
      !this.freehand_ &&
      this.lastDragTime_ &&
      event.type === MapBrowserEventType.POINTERDRAG
    ) {
      const now = Date.now();
      if (now - this.lastDragTime_ >= this.dragVertexDelay_) {
        this.downPx_ = event.pixel;
        this.shouldHandle_ = !this.freehand_;
        move = true;
      } else {
        this.lastDragTime_ = undefined;
      }
      if (this.shouldHandle_ && this.downTimeout_ !== undefined) {
        clearTimeout(this.downTimeout_);
        this.downTimeout_ = undefined;
      }
    }
    if (
      this.freehand_ &&
      event.type === MapBrowserEventType.POINTERDRAG &&
      this.sketchFeature_ !== null
    ) {
      this.addToDrawing_(event.coordinate);
      pass = false;
    } else if (
      this.freehand_ &&
      event.type === MapBrowserEventType.POINTERDOWN
    ) {
      pass = false;
    } else if (move && this.getPointerCount() < 2) {
      pass = event.type === MapBrowserEventType.POINTERMOVE;
      if (pass && this.freehand_) {
        this.handlePointerMove_(event);
        if (this.shouldHandle_) {
          // Avoid page scrolling when freehand drawing on mobile
          event.originalEvent.preventDefault();
        }
      } else if (
        event.originalEvent.pointerType === 'mouse' ||
        (event.type === MapBrowserEventType.POINTERDRAG &&
          this.downTimeout_ === undefined)
      ) {
        this.handlePointerMove_(event);
      }
    } else if (event.type === MapBrowserEventType.DBLCLICK) {
      pass = false;
    }

    return super.handleEvent(event) && pass;
  }

  /**
   * Handle pointer down events.
   * @param {import("../MapBrowserEvent.js").default<PointerEvent>} event Event.
   * @return {boolean} If the event was consumed.
   * @override
   */
  handleDownEvent(event) {
    this.shouldHandle_ = !this.freehand_;

    if (this.freehand_) {
      this.downPx_ = event.pixel;
      if (!this.finishCoordinate_) {
        this.startDrawing_(event.coordinate);
      }
      return true;
    }

    if (!this.condition_(event)) {
      this.lastDragTime_ = undefined;
      return false;
    }

    this.lastDragTime_ = Date.now();
    this.downCoordinate_ = event.coordinate.slice();
    this.downTimeout_ = setTimeout(() => {
      this.handlePointerMove_(
        new MapBrowserEvent(
          MapBrowserEventType.POINTERMOVE,
          event.map,
          event.originalEvent,
          false,
          event.frameState,
        ),
      );
    }, this.dragVertexDelay_);
    this.downPx_ = event.pixel;
    return true;
  }

  /**
   * @private
   */
  deactivateTrace_() {
    if (this.traceState_.active) {
      const coord = this.traceState_.startCoord;
      // Snapshot the committed target (if any) before clearing trace state so
      // the traceend event can expose source-side context to listeners.
      const committedTarget =
        this.traceState_.targetIndex !== undefined &&
        this.traceState_.targetIndex !== -1
          ? this.traceState_.targets[this.traceState_.targetIndex]
          : undefined;
      this.traceState_ = {active: false};
      this.dispatchEvent(
        new DrawEvent(
          DrawEventType.TRACEEND,
          this.sketchFeature_,
          coord,
          committedTarget,
        ),
      );
    } else {
      this.traceState_ = {active: false};
    }
  }

  /**
   * Duck-type check: the configured `traceSource` is a `TraceSource` (vertex-only-exit
   * lifecycle) rather than a `VectorSource` (classic).
   * @return {boolean} The trace source is the new primitive.
   * @private
   */
  isTraceSourcePrimitive_() {
    return (
      this.traceSource_ !== null &&
      typeof (
        /** @type {{getActiveEdge?: Function}} */ (this.traceSource_)
          .getActiveEdge
      ) === 'function'
    );
  }

  /**
   * Convert the snap tolerance (in pixels) to coordinate-space units at the cursor.
   * @param {import("../MapBrowserEvent.js").default} event Event.
   * @return {number} Tolerance in coordinate units.
   * @private
   */
  snapToleranceInCoordinates_(event) {
    const map = this.getMap();
    const a = map.getCoordinateFromPixel([event.pixel[0], event.pixel[1]]);
    const b = map.getCoordinateFromPixel([
      event.pixel[0] + this.snapTolerance_,
      event.pixel[1],
    ]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Activate or deactivate trace state based on a browser event.
   * @param {import("../MapBrowserEvent.js").default} event Event.
   * @private
   */
  toggleTraceState_(event) {
    if (!this.traceSource_ || !this.traceCondition_(event)) {
      return;
    }

    if (this.isTraceSourcePrimitive_()) {
      this.toggleTraceStatePrimitive_(event);
      return;
    }

    if (this.traceState_.active) {
      this.deactivateTrace_();
      return;
    }

    const map = this.getMap();
    const lowerLeft = map.getCoordinateFromPixel([
      event.pixel[0] - this.snapTolerance_,
      event.pixel[1] + this.snapTolerance_,
    ]);
    const upperRight = map.getCoordinateFromPixel([
      event.pixel[0] + this.snapTolerance_,
      event.pixel[1] - this.snapTolerance_,
    ]);
    const extent = boundingExtent([lowerLeft, upperRight]);
    const features = /** @type {VectorSource} */ (
      this.traceSource_
    ).getFeaturesInExtent(extent);
    if (features.length === 0) {
      return;
    }

    const targets = getTraceTargets(event.coordinate, features);
    if (targets.length) {
      this.traceState_ = {
        active: true,
        startCoord: event.coordinate.slice(),
        targets: targets,
        targetIndex: -1,
      };
      this.dispatchEvent(
        new DrawEvent(
          DrawEventType.TRACESTART,
          this.sketchFeature_,
          event.coordinate.slice(),
        ),
      );
    }
  }

  /**
   * Activate or deactivate trace state when `traceSource` is a `TraceSource`.
   * @param {import("../MapBrowserEvent.js").default} event Event.
   * @private
   */
  toggleTraceStatePrimitive_(event) {
    if (this.traceState_.active) {
      this.deactivateTracePrimitive_(event);
      return;
    }
    const tolerance = this.snapToleranceInCoordinates_(event);
    const traceSource = /** @type {import("./TraceSource.js").default} */ (
      this.traceSource_
    );
    const hit = traceSource.getNearestVertex(event.coordinate, tolerance);
    if (!hit) {
      // Click is not on a graph vertex; do not start tracing.
      return;
    }
    this.traceState_ = {
      active: true,
      mode: 'traceSource',
      startCoord: hit.vertex.coordinate.slice(),
      activeEdge: null,
      entryVertex: hit.vertex,
      edgeStack: [],
    };
    this.dispatchEvent(
      new DrawEvent(
        DrawEventType.TRACESTART,
        this.sketchFeature_,
        hit.vertex.coordinate.slice(),
      ),
    );
  }

  /**
   * @param {import("../MapBrowserEvent.js").default} event Event.
   * @private
   */
  deactivateTracePrimitive_(event) {
    const activeEdge = this.traceState_.activeEdge;
    // Snapshot edges that contributed coords so getCanonicalCoordinates can
    // replace tessellated arc points with exact source control points.
    const edgeStack = this.traceState_.edgeStack || [];
    const committed = edgeStack
      .filter((entry) => entry.pointsAdded > 0)
      .map((entry) => ({edge: entry.edge, pointsAdded: entry.pointsAdded}));
    if (committed.length > 0) {
      this.committedTraceEdges_.push(committed);
    }
    this.traceState_ = {active: false};
    this.dispatchEvent(
      new DrawEvent(
        DrawEventType.TRACEEND,
        this.sketchFeature_,
        event.coordinate.slice(),
        activeEdge
          ? {
              feature: activeEdge.feature,
              geometry: activeEdge.subGeometry,
              ringIndex: activeEdge.ringIndex,
              startIndex: undefined,
              endIndex: undefined,
              subGeometryKind: activeEdge.kind,
            }
          : undefined,
      ),
    );
  }

  /**
   * Replace tessellated arc coordinates in a sketch coordinate array with the
   * exact control points from the traced source geometries.
   *
   * During tracing, arc edges are rendered as polyline tessellations (many
   * points). At `drawend`, calling this method converts each committed arc
   * segment back to its canonical `[start, mid, end]` triplet using the
   * source `CircularString`'s actual control points. `LineString` edges are
   * passed through unchanged (their `pointsAdded` coords are correct already).
   *
   * The method works backwards through the committed edge list so that each
   * splice operation does not shift the offset of edges not yet processed.
   *
   * @param {Array<import("../coordinate.js").Coordinate>} rawCoords Raw sketch
   *   coordinates as produced by the draw interaction (e.g. from
   *   `lastSketchCoordinates` or `feature.getGeometry().getCoordinates()`).
   * @return {Array<import("../coordinate.js").Coordinate>} New coordinate array
   *   with arc tessellations replaced by exact source control points. The input
   *   array is not mutated.
   * @api
   */
  getCanonicalCoordinates(rawCoords) {
    if (!this.isTraceSourcePrimitive_() || this.committedTraceEdges_.length === 0) {
      return rawCoords.slice();
    }
    const traceSource =
      /** @type {import("./TraceSource.js").default} */ (this.traceSource_);

    // Flatten all committed trace sessions into one ordered list of
    // {edge, pointsAdded} entries. We need each entry's absolute offset
    // into rawCoords, so we walk forward once to build offsets, then
    // walk backward to splice (high→low keeps offsets stable).
    //
    // The sketch grows as: [freehand...] [traceEdge1pts...] [freehand...]
    // [traceEdge2pts...] ... but we only know how many points each edge
    // contributed, not their absolute positions. We derive offsets by
    // scanning rawCoords: for each edge we know exactly `pointsAdded` coords
    // were appended starting at the entry vertex. The entry vertex of the
    // first edge in a session is the last freehand/previous-edge coord;
    // each subsequent edge's entry is the exit vertex of the previous one.
    //
    // Simpler and correct: flatten the edgeStack sessions and, for each arc
    // edge, we know start = rawCoords[offset] and end = rawCoords[offset +
    // pointsAdded] where offset advances by pointsAdded across edges.
    //
    // We need the absolute start offset of the first edge across all sessions.
    // Since sessions are contiguous (trace1 immediately follows its freehand
    // entry, trace2 follows immediately, etc.), we can compute the total
    // tessellation points committed by all sessions and subtract from the
    // known end of the raw coord array (minus the freehand tail, which is 0
    // or more points after the last trace). This is fragile.
    //
    // Simpler approach: the entry vertex of the very first edge in each session
    // IS in rawCoords (it was the vertex clicked to start the trace). Walk
    // rawCoords to find it, then march forward through edges using pointsAdded.

    const result = rawCoords.slice();
    // Process all sessions in one flat reversed pass.
    const flat = [];
    for (const session of this.committedTraceEdges_) {
      for (const entry of session) {
        flat.push(entry);
      }
    }

    // Compute absolute offsets for each edge by walking rawCoords forward.
    // The entry vertex of the first edge in the very first session must exist
    // in rawCoords; we find it by matching startVertex.coordinate.
    if (flat.length === 0) {
      return result;
    }

    // Find the start of the first committed edge in rawCoords by scanning
    // for its startVertex coordinate.
    const firstEdge = flat[0].edge;
    const firstEntryCoord = firstEdge.startVertex.coordinate;
    let offset = -1;
    for (let i = 0; i < result.length; i++) {
      const c = result[i];
      if (
        Math.abs(c[0] - firstEntryCoord[0]) < 1e-9 &&
        Math.abs(c[1] - firstEntryCoord[1]) < 1e-9
      ) {
        offset = i;
        break;
      }
    }
    if (offset === -1) {
      // Entry vertex not found — return unchanged (safety fallback).
      return result;
    }

    // Compute the absolute [startOffset, endOffset] for each edge.
    /** @type {Array<{edge: import("./TraceSource.js").TraceEdge, startOff: number, endOff: number}>} */
    const resolved = [];
    let cur = offset;
    for (const {edge, pointsAdded} of flat) {
      resolved.push({edge, startOff: cur, endOff: cur + pointsAdded});
      cur += pointsAdded;
    }

    // Splice arc edges back-to-front (so earlier offsets stay valid).
    for (let i = resolved.length - 1; i >= 0; i--) {
      const {edge, startOff, endOff} = resolved[i];
      if (edge.kind !== 'CircularString') {
        continue;
      }
      const ctrlPts = traceSource.getEdgeControlPoints(edge);
      // ctrlPts = [start, mid, end].  start and end are already in result at
      // startOff and endOff (placed there by appendCoordinates / Snap);
      // only the single mid throughpoint needs to replace the interior
      // tessellation points.
      // Interior positions: startOff+1 .. endOff-1  →  interiorCount items.
      // Using interiorCount-1 (the previous value) left one tessellation point
      // at endOff-1, producing a spurious 2-pt LineString segment.
      const interiorCount = endOff - startOff - 1;
      if (interiorCount <= 0) {
        continue;
      }
      result.splice(startOff + 1, interiorCount, ctrlPts[1]);

      // appendCoordinates (trace walk) places the arc endpoint at the last
      // tessellation position (raw[endOff]).  The vertex-only-exit handler
      // then calls addToDrawing_ which pushes the same vertex a second time
      // (raw[endOff+1]).  After the interior splice those two copies end up
      // adjacent at result[startOff+2] and result[startOff+3].  Remove the
      // extra copy so the post-trace user segment starts cleanly.
      const newEnd = startOff + 2;
      if (
        newEnd + 1 < result.length &&
        result[newEnd][0] === result[newEnd + 1][0] &&
        result[newEnd][1] === result[newEnd + 1][1]
      ) {
        result.splice(newEnd + 1, 1);
      }
    }

    return result;
  }

  /**
   * Add trace targets available at the current pointer coordinate.  This lets
   * from the original trace start.
   * @param {import("../MapBrowserEvent.js").default} event Event.
   * @private
   */
  addTraceTargetsAtCoordinate_(event) {
    const traceState = this.traceState_;
    if (!this.traceSource_ || !traceState.active || !traceState.targets) {
      return;
    }

    const map = this.getMap();
    const lowerLeft = map.getCoordinateFromPixel([
      event.pixel[0] - this.snapTolerance_,
      event.pixel[1] + this.snapTolerance_,
    ]);
    const upperRight = map.getCoordinateFromPixel([
      event.pixel[0] + this.snapTolerance_,
      event.pixel[1] - this.snapTolerance_,
    ]);
    const extent = boundingExtent([lowerLeft, upperRight]);
    const features = /** @type {VectorSource} */ (
      this.traceSource_
    ).getFeaturesInExtent(extent);
    if (features.length === 0) {
      return;
    }

    const targets = getTraceTargets(event.coordinate, features);
    for (let i = 0, ii = targets.length; i < ii; ++i) {
      const target = targets[i];
      if (!isTraceTargetVertexIndex(target, target.startIndex)) {
        continue;
      }
      if (traceState.targetIndex !== -1) {
        const currentTarget = traceState.targets[traceState.targetIndex];
        if (!isTraceVertexPivot(currentTarget, target, event.coordinate)) {
          continue;
        }
      }
      if (!hasEquivalentTraceTarget(traceState.targets, target)) {
        traceState.targets.push(target);
      }
    }
  }

  /**
   * @param {TraceTarget} target The trace target.
   * @param {number} endIndex The new end index of the trace.
   * @private
   */
  addOrRemoveTracedCoordinates_(target, endIndex) {
    // three cases to handle:
    //  1. traced in the same direction and points need adding
    //  2. traced in the same direction and points need removing
    //  3. traced in a new direction
    const previouslyForward = target.startIndex <= target.endIndex;
    const currentlyForward = target.startIndex <= endIndex;
    if (previouslyForward === currentlyForward) {
      // same direction
      if (
        (previouslyForward && endIndex > target.endIndex) ||
        (!previouslyForward && endIndex < target.endIndex)
      ) {
        // case 1 - add new points
        this.addTracedCoordinates_(target, target.endIndex, endIndex);
      } else if (
        (previouslyForward && endIndex < target.endIndex) ||
        (!previouslyForward && endIndex > target.endIndex)
      ) {
        // case 2 - remove old points
        this.removeTracedCoordinates_(endIndex, target.endIndex);
      }
    } else {
      // case 3 - remove old points, add new points
      this.removeTracedCoordinates_(target.startIndex, target.endIndex);
      this.addTracedCoordinates_(target, target.startIndex, endIndex);
    }
  }

  /**
   * @param {number} fromIndex The start index.
   * @param {number} toIndex The end index.
   * @private
   */
  removeTracedCoordinates_(fromIndex, toIndex) {
    if (fromIndex === toIndex) {
      return;
    }

    let remove = 0;
    if (fromIndex < toIndex) {
      const start = Math.ceil(fromIndex);
      let end = Math.floor(toIndex);
      if (end === toIndex) {
        end -= 1;
      }
      remove = end - start + 1;
    } else {
      const start = Math.floor(fromIndex);
      let end = Math.ceil(toIndex);
      if (end === toIndex) {
        end += 1;
      }
      remove = start - end + 1;
    }

    if (remove > 0) {
      this.removeLastPoints_(remove);
    }
  }

  /**
   * @param {TraceTarget} target The trace target.
   * @param {number} fromIndex The start index.
   * @param {number} toIndex The end index.
   * @private
   */
  addTracedCoordinates_(target, fromIndex, toIndex) {
    if (fromIndex === toIndex) {
      return;
    }

    const coordinates = [];
    if (fromIndex < toIndex) {
      // forward trace
      const start = Math.ceil(fromIndex);
      let end = Math.floor(toIndex);
      if (end === toIndex) {
        // if end is snapped to a vertex, it will be added later
        end -= 1;
      }
      for (let i = start; i <= end; ++i) {
        coordinates.push(getCoordinate(target.coordinates, i));
      }
    } else {
      // reverse trace
      const start = Math.floor(fromIndex);
      let end = Math.ceil(toIndex);
      if (end === toIndex) {
        end += 1;
      }
      for (let i = start; i >= end; --i) {
        coordinates.push(getCoordinate(target.coordinates, i));
      }
    }
    if (coordinates.length) {
      this.appendCoordinates(coordinates);
    }
  }

  /**
   * Update the trace.
   * @param {import("../MapBrowserEvent.js").default} event Event.
   * @private
   */
  updateTrace_(event) {
    const traceState = this.traceState_;
    if (!traceState.active) {
      return;
    }

    if (this.isTraceSourcePrimitive_()) {
      this.updateTracePrimitive_(event);
      return;
    }

    this.addTraceTargetsAtCoordinate_(event);

    if (traceState.targetIndex === -1) {
      // check if we are ready to pick a target
      const startPx = event.map.getPixelFromCoordinate(traceState.startCoord);
      if (distance(startPx, event.pixel) < this.snapTolerance_) {
        return;
      }
    }

    const updatedTraceTarget = getTraceTargetUpdate(
      event.coordinate,
      traceState,
      this.getMap(),
      this.snapTolerance_,
    );
    let updatedTraceTargetIndex = updatedTraceTarget.index;
    let updatedTraceTargetEndIndex = updatedTraceTarget.endIndex;
    if (!this.traceBacktracking_ && traceState.targetIndex !== -1) {
      const target = traceState.targets[traceState.targetIndex];
      if (updatedTraceTargetIndex === traceState.targetIndex) {
        if (isTraceBacktracking(target, updatedTraceTarget.endIndex)) {
          updatedTraceTargetEndIndex = target.endIndex;
        }
      }
    }

    let blockedBacktrackingPivot = false;
    if (traceState.targetIndex !== updatedTraceTargetIndex) {
      // target changed
      if (traceState.targetIndex !== -1) {
        const oldTarget = traceState.targets[traceState.targetIndex];
        const newTarget = traceState.targets[updatedTraceTargetIndex];
        if (isTraceVertexPivot(oldTarget, newTarget, event.coordinate)) {
          const pivotIndex = getTraceVertexIndexAtCoordinate(
            oldTarget,
            event.coordinate,
          );
          if (
            !this.traceBacktracking_ &&
            isTraceBacktracking(oldTarget, pivotIndex)
          ) {
            updatedTraceTargetEndIndex = oldTarget.endIndex;
            updatedTraceTargetIndex = traceState.targetIndex;
            blockedBacktrackingPivot = true;
          } else {
            this.addOrRemoveTracedCoordinates_(oldTarget, pivotIndex);
            oldTarget.endIndex = pivotIndex;
          }
        } else if (isStoredSharedTraceVertex(oldTarget, newTarget)) {
          // The candidate was discovered at the previous shared vertex update,
          // and the old target has already advanced to that vertex.
        } else if (!this.traceBacktracking_) {
          // Keep coordinates traced on the old target. This prevents a later
          // intersection with an existing trace from snapping back and erasing
          // the path after the intersection.
        } else {
          // remove points added during previous trace
          this.removeTracedCoordinates_(
            oldTarget.startIndex,
            oldTarget.endIndex,
          );
        }
      }
      // add points for the new target
      if (!blockedBacktrackingPivot) {
        const newTarget = traceState.targets[updatedTraceTargetIndex];
        this.addTracedCoordinates_(
          newTarget,
          newTarget.startIndex,
          updatedTraceTargetEndIndex,
        );
      }
    } else {
      // target stayed the same
      const target = traceState.targets[traceState.targetIndex];
      this.addOrRemoveTracedCoordinates_(target, updatedTraceTargetEndIndex);
    }

    // modify the state with updated info
    traceState.targetIndex = updatedTraceTargetIndex;
    const target = traceState.targets[traceState.targetIndex];
    target.endIndex = updatedTraceTargetEndIndex;

    // update event coordinate and pixel to match end point of final segment
    const coordinate = interpolateCoordinate(
      target.coordinates,
      target.endIndex,
    );
    const pixel = this.getMap().getPixelFromCoordinate(coordinate);
    event.coordinate = coordinate;
    event.pixel = [Math.round(pixel[0]), Math.round(pixel[1])];
  }

  /**
   * Update active edge and fire continuous `trace` events when `traceSource` is a `TraceSource`.
   * Also handles vertex-snap, cursor-hugging onto the active edge, and committing
   * traversed vertices into the sketch so the user sees the boundary being followed.
   * @param {import("../MapBrowserEvent.js").default} event Event.
   * @private
   */
  updateTracePrimitive_(event) {
    const traceState = this.traceState_;
    if (!traceState.active) {
      return;
    }
    const tolerance = this.snapToleranceInCoordinates_(event);
    const traceSource = /** @type {import("./TraceSource.js").default} */ (
      this.traceSource_
    );

    // 1. Vertex snap: if cursor is within tolerance of a graph vertex, use that
    //    vertex's coordinate when resolving the active edge.
    //    Graph-walk constraint: while a trace is in progress (activeEdge is
    //    non-null) only the active edge's two endpoints are eligible snap
    //    targets. Otherwise the cursor would visibly hop onto vertices of
    //    disconnected features whenever it passed within snap tolerance,
    //    even though the active edge itself correctly stays put. When there
    //    is no active edge yet (entry/initial state) any vertex is eligible
    //    so the trace can start anywhere on the graph.
    const rawHit = traceSource.getNearestVertex(event.coordinate, tolerance);
    let vertexHit = rawHit;
    const prevActive = traceState.activeEdge;
    if (rawHit && prevActive) {
      const v = rawHit.vertex;
      if (v !== prevActive.startVertex && v !== prevActive.endVertex) {
        vertexHit = null;
      }
    }
    const sample = vertexHit
      ? vertexHit.vertex.coordinate.slice()
      : event.coordinate;

    // 2. Resolve active edge (sticky-closest semantics live in TraceSource).
    const newEdge = traceSource.getActiveEdge(
      sample,
      tolerance,
      traceState.activeEdge,
    );

    // 3. Edge transition: maintain the trace-history stack (one entry per
    //    edge traversed since `tracestart`). Three branches:
    //    a) BACKTRACK — newEdge is the previous edge in the stack: pop the
    //       top, removing its appended points from the sketch.
    //    a2) DEEP BACKTRACK — newEdge already exists further back in the
    //       stack (not just at prev). This happens when the cursor
    //       oscillates at a busy junction, pushing multiple redundant
    //       entries for the same edge objects. A one-step pop would leave
    //       the stack with a broken chain — later entries may share no
    //       vertex with their new predecessors, making getActiveEdge's
    //       graph-walk constraint physically unable to return the predecessor
    //       edge. Fix: pop everything above the earlier occurrence at once,
    //       undoing all their accumulated points in a single call.
    //    b) ADVANCE — newEdge is fresh: complete the current top to its
    //       shared-vertex endpoint, then push a new entry for newEdge.
    //    c) INITIAL — stack was empty: just push the first entry.
    if (newEdge !== traceState.activeEdge) {
      const stack = traceState.edgeStack;
      const top = stack.length > 0 ? stack[stack.length - 1] : null;
      const prev = stack.length > 1 ? stack[stack.length - 2] : null;
      if (newEdge && prev && prev.edge === newEdge) {
        // (a) BACKTRACK: pop top, undo its appended points.
        const popped = stack.pop();
        if (popped.pointsAdded > 0) {
          this.removeLastPoints_(popped.pointsAdded);
        }
        // The new top resumes — its endIndex remains at the just-vacated
        // shared vertex's index (set when this edge was finalized below).
      } else if (newEdge) {
        // (a2) DEEP BACKTRACK: newEdge already exists deeper than prev.
        // Search from just below prev downward (most-recent first).
        let deepIdx = -1;
        for (let k = stack.length - 3; k >= 0; --k) {
          if (stack[k].edge === newEdge) {
            deepIdx = k;
            break;
          }
        }
        if (deepIdx >= 0) {
          // Pop everything above deepIdx, removing all their sketch points.
          let totalRemove = 0;
          for (let k = deepIdx + 1; k < stack.length; ++k) {
            totalRemove += stack[k].pointsAdded;
          }
          stack.splice(deepIdx + 1);
          if (totalRemove > 0) {
            this.removeLastPoints_(totalRemove);
          }
          // stack[deepIdx] is now the top; its endIndex is frozen at the
          // shared-vertex position it was advanced to when its (now-popped)
          // successor was first pushed. The walk in step 4 will retract it
          // further as the cursor moves backward.
        } else {
          // (b) ADVANCE or (c) INITIAL: complete current top, push new entry.
          let entryVertex = null;
          if (top) {
            // Pick the shared vertex closest to the cursor's current position
            // on `top.edge` (i.e. the side of `top.edge` we're crossing off
            // from). Falling back to declaration order makes the walk retract
            // all the way back to the wrong endpoint when both endpoints
            // happen to neighbour `newEdge`, which visibly destroys the
            // sketch right before the new edge takes over -- the
            // junction-crossing line-disappear bug.
            const shared = findSharedTraceVertexNear(top, newEdge);
            if (shared) {
              const sharedIndexOld =
                shared === top.edge.startVertex
                  ? 0
                  : top.tessellation.length - 1;
              this.advancePrimitiveTraceProgress_(top, sharedIndexOld);
              entryVertex = shared;
            }
          }
          if (!entryVertex) {
            entryVertex =
              this.pickPrimitiveTraceEntryVertex_(newEdge, sample) ||
              newEdge.startVertex;
          }
          // Use the default ~5° angular step for arc tessellation (no
          // tolerance arg). The snap tolerance is for sticky-edge resolution
          // and vertex-hit distance, not for how smoothly the trace hugs an
          // arc; passing it here yielded coarse 4-segment arcs that visibly
          // deviated from the source by ~one snap radius.
          const tess = traceSource.tessellateEdge(newEdge);
          const startIndex =
            entryVertex === newEdge.startVertex ? 0 : tess.length - 1;
          stack.push({
            edge: newEdge,
            tessellation: tess,
            startIndex: startIndex,
            endIndex: startIndex,
            pointsAdded: 0,
          });
        }
      }
      // If newEdge is null we keep the current stack untouched (cursor wandered
      // off the graph; sticky-closest should normally avoid this).
      traceState.activeEdge = newEdge;
      this.dispatchEvent(
        new DrawEvent(
          DrawEventType.TRACE,
          this.sketchFeature_,
          (vertexHit ? vertexHit.vertex.coordinate : event.coordinate).slice(),
          newEdge
            ? {
                feature: newEdge.feature,
                geometry: newEdge.subGeometry,
                ringIndex: newEdge.ringIndex,
                startIndex: undefined,
                endIndex: undefined,
                subGeometryKind: newEdge.kind,
                arcIndex: newEdge.arcIndex,
              }
            : undefined,
        ),
      );
    }

    // 4. Walk tessellation: project cursor onto the active (top) edge's
    //    polyline and advance/retract the sketch to match.
    const stack = traceState.edgeStack;
    const top = stack.length > 0 ? stack[stack.length - 1] : null;
    let snappedCoord;
    if (vertexHit && top && top.edge === traceState.activeEdge) {
      // Snap to a tessellation endpoint when the vertex is one of this
      // edge's endpoints.
      const edge = top.edge;
      if (vertexHit.vertex === edge.startVertex) {
        this.advancePrimitiveTraceProgress_(top, 0);
      } else if (vertexHit.vertex === edge.endVertex) {
        this.advancePrimitiveTraceProgress_(top, top.tessellation.length - 1);
      } else {
        // No tolerance arg: see comment at the tessellateEdge call above.
        const proj = traceSource.projectOnEdgeTessellation(
          edge,
          event.coordinate,
        );
        this.advancePrimitiveTraceProgress_(top, proj.fractionalIndex);
      }
      snappedCoord = vertexHit.vertex.coordinate.slice();
    } else if (top) {
      const proj = traceSource.projectOnEdgeTessellation(
        top.edge,
        event.coordinate,
      );
      this.advancePrimitiveTraceProgress_(top, proj.fractionalIndex);
      snappedCoord = proj.coordinate;
    } else if (vertexHit) {
      snappedCoord = vertexHit.vertex.coordinate.slice();
    } else {
      snappedCoord = event.coordinate.slice();
    }

    // 5. Update the event so subsequent modifyDrawing_ / sketch-point logic
    //    sees the snapped coordinate.
    event.coordinate = snappedCoord;
    const map = this.getMap();
    if (map) {
      const pixel = map.getPixelFromCoordinate(snappedCoord);
      if (pixel) {
        event.pixel = [Math.round(pixel[0]), Math.round(pixel[1])];
      }
    }
  }

  /**
   * Pick the entry vertex of a TraceSource edge that is closest to a sample
   * coordinate. Used when there is no previously active edge to share a
   * vertex with (e.g. the very first pointer move after `tracestart`).
   * @param {import("./TraceSource.js").TraceEdge} edge The edge.
   * @param {import("../coordinate.js").Coordinate} sample Sample coordinate.
   * @return {import("./TraceSource.js").TraceVertex|null} Closest endpoint.
   * @private
   */
  pickPrimitiveTraceEntryVertex_(edge, sample) {
    const entry = this.traceState_.entryVertex;
    if (entry === edge.startVertex || entry === edge.endVertex) {
      return entry;
    }
    const sx = edge.startVertex.coordinate;
    const ex = edge.endVertex.coordinate;
    const ds =
      (sample[0] - sx[0]) * (sample[0] - sx[0]) +
      (sample[1] - sx[1]) * (sample[1] - sx[1]);
    const de =
      (sample[0] - ex[0]) * (sample[0] - ex[0]) +
      (sample[1] - ex[1]) * (sample[1] - ex[1]);
    return ds <= de ? edge.startVertex : edge.endVertex;
  }

  /**
   * Advance (or retract) per-edge trace progress along a tessellated polyline,
   * appending or removing intermediate sketch coordinates to match. This
   * mirrors classic-mode `addOrRemoveTracedCoordinates_` but operates on a
   * `TraceSource` edge's polyline approximation.
   *
   * The integer walk uses inclusive endpoints: when the new fractional index
   * is exactly an integer (i.e. the cursor sits exactly on a tessellation
   * vertex), that vertex is appended. This makes the walk land cleanly on
   * shared graph vertices during edge transitions.
   *
   * @param {{edge: import("./TraceSource.js").TraceEdge, tessellation: Array<import("../coordinate.js").Coordinate>, startIndex: number, endIndex: number, pointsAdded: number}} progress Progress state.
   * @param {number} newEndIndex New fractional index along the tessellation.
   * @private
   */
  advancePrimitiveTraceProgress_(progress, newEndIndex) {
    const prevEndIndex = progress.endIndex;
    if (newEndIndex === prevEndIndex) {
      return;
    }
    // For TraceSource edges the entry is always at index 0 or N-1 (always
    // an endpoint vertex). Direction of travel is fully determined by which
    // endpoint is the start.
    const goingForward = progress.startIndex === 0;
    if (goingForward) {
      if (newEndIndex > prevEndIndex) {
        // Add forward: walk integers (floor(prevEnd)+1) .. floor(newEnd).
        const start = Math.floor(prevEndIndex) + 1;
        const end = Math.floor(newEndIndex);
        if (end >= start) {
          const tess = progress.tessellation;
          const coords = [];
          for (let i = start; i <= end; ++i) {
            coords.push(tess[i].slice());
          }
          this.appendCoordinates(coords);
          progress.pointsAdded += coords.length;
        }
      } else {
        // Remove forward: integers (floor(newEnd)+1) .. floor(prevEnd).
        const start = Math.floor(newEndIndex) + 1;
        const end = Math.floor(prevEndIndex);
        const remove = end - start + 1;
        if (remove > 0) {
          this.removeLastPoints_(remove);
          progress.pointsAdded -= remove;
        }
      }
    } else {
      // backward: startIndex = N-1, walk from high to low.
      if (newEndIndex < prevEndIndex) {
        // Add backward: walk integers (ceil(prevEnd)-1) down to ceil(newEnd).
        const high = Math.ceil(prevEndIndex) - 1;
        const low = Math.ceil(newEndIndex);
        if (high >= low) {
          const tess = progress.tessellation;
          const coords = [];
          for (let i = high; i >= low; --i) {
            coords.push(tess[i].slice());
          }
          this.appendCoordinates(coords);
          progress.pointsAdded += coords.length;
        }
      } else {
        // Remove backward: integers (ceil(newEnd)-1) down to ceil(prevEnd).
        const high = Math.ceil(newEndIndex) - 1;
        const low = Math.ceil(prevEndIndex);
        const remove = high - low + 1;
        if (remove > 0) {
          this.removeLastPoints_(remove);
          progress.pointsAdded -= remove;
        }
      }
    }
    progress.endIndex = newEndIndex;
  }

  /**
   * Handle drag events.
   * @param {import("../MapBrowserEvent.js").default<PointerEvent>} event Event.
   * @override
   */
  handleDragEvent(event) {
    this.ignoreNextUpEvent_ = true;
    super.handleDragEvent(event);
  }

  /**
   * Handle pointer up events.
   * @param {import("../MapBrowserEvent.js").default<PointerEvent>} event Event.
   * @return {boolean} If the event was consumed.
   * @override
   */
  handleUpEvent(event) {
    let pass = true;

    if (this.getPointerCount() === 0) {
      if (this.downTimeout_) {
        clearTimeout(this.downTimeout_);
        this.downTimeout_ = undefined;
      }

      this.handlePointerMove_(event);
      const tracing = this.traceState_.active;
      let clickEvent = event;
      if (
        this.traceSource_ &&
        this.downCoordinate_ &&
        this.traceCondition_(event)
      ) {
        clickEvent = new MapBrowserEvent(
          event.type,
          event.map,
          event.originalEvent,
          false,
          event.frameState,
        );
        clickEvent.coordinate = this.downCoordinate_.slice();
        clickEvent.pixel = this.downPx_.slice();
      }
      if (!this.ignoreNextUpEvent_ || !this.traceState_.active) {
        if (this.isTraceSourcePrimitive_() && this.traceState_.active) {
          // Vertex-only exit: ignore clicks that don't snap to a graph vertex.
          const exitTolerance = this.snapToleranceInCoordinates_(clickEvent);
          const exitTraceSource =
            /** @type {import("./TraceSource.js").default} */ (
              this.traceSource_
            );
          let hit = exitTraceSource.getNearestVertex(
            clickEvent.coordinate,
            exitTolerance,
          );
          // The Snap interaction may land the click on a CircularString
          // throughpoint (the mid control-point of an arc triplet). These
          // lie exactly on the arc geometry but are NOT graph vertices, so
          // getNearestVertex finds nothing and the exit silently fails.
          // If the active edge is a CircularString arc and the click
          // coordinate falls within tolerance of the arc's throughpoint,
          // advance trace progress to the nearer endpoint vertex and exit
          // there so canonical arc control-point replacement stays intact.
          if (!hit) {
            const activeEdge = this.traceState_.activeEdge;
            if (activeEdge && activeEdge.kind === 'CircularString') {
              const circular =
                /** @type {import("../geom/CircularString.js").default} */ (
                  activeEdge.subGeometry
                );
              const arcCoords = circular.getCoordinates();
              const arcIdx = /** @type {number} */ (activeEdge.arcIndex);
              // Throughpoint is the middle coordinate of the arc triplet
              // (index arcIdx*2+1 in the full coordinates array).
              const mid = arcCoords[arcIdx * 2 + 1];
              if (mid) {
                const dmx = clickEvent.coordinate[0] - mid[0];
                const dmy = clickEvent.coordinate[1] - mid[1];
                if (dmx * dmx + dmy * dmy <= exitTolerance * exitTolerance) {
                  // Click is at the throughpoint. Exit at the nearer of the
                  // arc's two endpoint vertices (which ARE graph vertices).
                  const sv = activeEdge.startVertex;
                  const ev = activeEdge.endVertex;
                  const dsx = clickEvent.coordinate[0] - sv.coordinate[0];
                  const dsy = clickEvent.coordinate[1] - sv.coordinate[1];
                  const dex = clickEvent.coordinate[0] - ev.coordinate[0];
                  const dey = clickEvent.coordinate[1] - ev.coordinate[1];
                  const nearest =
                    dsx * dsx + dsy * dsy <= dex * dex + dey * dey
                      ? sv
                      : ev;
                  const stack = this.traceState_.edgeStack;
                  const top =
                    stack && stack.length > 0 ? stack[stack.length - 1] : null;
                  if (top) {
                    const targetIndex =
                      nearest === activeEdge.startVertex
                        ? 0
                        : top.tessellation.length - 1;
                    this.advancePrimitiveTraceProgress_(top, targetIndex);
                  }
                  clickEvent.coordinate = nearest.coordinate.slice();
                  hit = {vertex: nearest, squaredDistance: 0};
                }
              }
            }
          }
          if (hit) {
            this.toggleTraceState_(clickEvent);
          }
        } else {
          this.toggleTraceState_(clickEvent);
        }
      }

      if (this.shouldHandle_) {
        const startingToDraw = !this.finishCoordinate_;
        if (startingToDraw) {
          this.startDrawing_(clickEvent.coordinate);
        }
        if (!startingToDraw && this.freehand_) {
          this.finishDrawing();
        } else if (
          !this.freehand_ &&
          (!startingToDraw || this.mode_ === 'Point')
        ) {
          if (this.atFinish_(clickEvent.pixel, tracing)) {
            if (this.finishCondition_(clickEvent)) {
              this.finishDrawing();
            }
          } else {
            this.addToDrawing_(clickEvent.coordinate);
          }
        }
        pass = false;
      } else if (this.freehand_) {
        this.abortDrawing();
      }
    }
    this.downCoordinate_ = null;
    this.ignoreNextUpEvent_ = false;

    if (!pass && this.stopClick_) {
      event.preventDefault();
    }
    return pass;
  }

  /**
   * Handle move events.
   * @param {import("../MapBrowserEvent.js").default<PointerEvent>} event A move event.
   * @private
   */
  handlePointerMove_(event) {
    this.pointerType_ = event.originalEvent.pointerType;
    if (
      this.downPx_ &&
      ((!this.freehand_ && this.shouldHandle_) ||
        (this.freehand_ && !this.shouldHandle_))
    ) {
      const downPx = this.downPx_;
      const clickPx = event.pixel;
      const dx = downPx[0] - clickPx[0];
      const dy = downPx[1] - clickPx[1];
      const squaredDistance = dx * dx + dy * dy;
      this.shouldHandle_ = this.freehand_
        ? squaredDistance > this.squaredClickTolerance_
        : squaredDistance <= this.squaredClickTolerance_;
      if (!this.shouldHandle_) {
        return;
      }
    }

    if (!this.finishCoordinate_) {
      this.createOrUpdateSketchPoint_(event.coordinate.slice());
      return;
    }

    this.updateTrace_(event);
    this.modifyDrawing_(event.coordinate);
  }

  /**
   * Determine if an event is within the snapping tolerance of the start coord.
   * @param {import("../pixel.js").Pixel} pixel Pixel.
   * @param {boolean} [tracing] Drawing in trace mode (only stop if at the starting point).
   * @return {boolean} The event is within the snapping tolerance of the start.
   * @private
   */
  atFinish_(pixel, tracing) {
    let at = false;
    if (this.sketchFeature_) {
      let potentiallyDone = false;
      let potentiallyFinishCoordinates = [this.finishCoordinate_];
      const mode = this.mode_;
      if (mode === 'Point') {
        at = true;
      } else if (mode === 'Circle') {
        at = this.sketchCoords_.length === 2;
      } else if (mode === 'LineString') {
        potentiallyDone =
          !tracing && this.sketchCoords_.length > this.minPoints_;
      } else if (mode === 'Polygon') {
        const sketchCoords = /** @type {PolyCoordType} */ (this.sketchCoords_);
        potentiallyDone = sketchCoords[0].length > this.minPoints_;
        potentiallyFinishCoordinates = [
          sketchCoords[0][0],
          sketchCoords[0][sketchCoords[0].length - 2],
        ];
        if (tracing) {
          potentiallyFinishCoordinates = [sketchCoords[0][0]];
        } else {
          potentiallyFinishCoordinates = [
            sketchCoords[0][0],
            sketchCoords[0][sketchCoords[0].length - 2],
          ];
        }
      }
      if (potentiallyDone) {
        const map = this.getMap();
        for (let i = 0, ii = potentiallyFinishCoordinates.length; i < ii; i++) {
          const finishCoordinate = potentiallyFinishCoordinates[i];
          const finishPixel = map.getPixelFromCoordinate(finishCoordinate);
          const dx = pixel[0] - finishPixel[0];
          const dy = pixel[1] - finishPixel[1];
          const snapTolerance = this.freehand_ ? 1 : this.snapTolerance_;
          at = Math.sqrt(dx * dx + dy * dy) <= snapTolerance;
          if (at) {
            this.finishCoordinate_ = finishCoordinate;
            break;
          }
        }
      }
    }
    return at;
  }

  /**
   * @param {import("../coordinate.js").Coordinate} coordinates Coordinate.
   * @private
   */
  createOrUpdateSketchPoint_(coordinates) {
    if (!this.sketchPoint_) {
      this.sketchPoint_ = new Feature(new Point(coordinates));
      this.updateSketchFeatures_();
    } else {
      const sketchPointGeom = this.sketchPoint_.getGeometry();
      sketchPointGeom.setCoordinates(coordinates);
    }
  }

  /**
   * @param {import("../geom/Polygon.js").default} geometry Polygon geometry.
   * @private
   */
  createOrUpdateCustomSketchLine_(geometry) {
    if (!this.sketchLine_) {
      this.sketchLine_ = new Feature();
    }
    const ring = geometry.getLinearRing(0);
    let sketchLineGeom = this.sketchLine_.getGeometry();
    if (!sketchLineGeom) {
      sketchLineGeom = new LineString(
        ring.getFlatCoordinates(),
        ring.getLayout(),
      );
      this.sketchLine_.setGeometry(sketchLineGeom);
    } else {
      sketchLineGeom.setFlatCoordinates(
        ring.getLayout(),
        ring.getFlatCoordinates(),
      );
      sketchLineGeom.changed();
    }
  }

  /**
   * Start the drawing.
   * @param {import("../coordinate.js").Coordinate} start Start coordinate.
   * @private
   */
  startDrawing_(start) {
    const projection = this.getMap().getView().getProjection();
    const stride = getStrideForLayout(this.geometryLayout_);
    this.committedTraceEdges_ = [];
    while (start.length < stride) {
      start.push(0);
    }
    this.finishCoordinate_ = start;
    if (this.mode_ === 'Point') {
      this.sketchCoords_ = start.slice();
    } else if (this.mode_ === 'Polygon') {
      this.sketchCoords_ = [[start.slice(), start.slice()]];
      this.sketchLineCoords_ = this.sketchCoords_[0];
    } else {
      this.sketchCoords_ = [start.slice(), start.slice()];
    }
    if (this.sketchLineCoords_) {
      this.sketchLine_ = new Feature(new LineString(this.sketchLineCoords_));
    }
    const geometry = this.geometryFunction_(
      this.sketchCoords_,
      undefined,
      projection,
    );
    this.sketchFeature_ = new Feature();
    if (this.geometryName_) {
      this.sketchFeature_.setGeometryName(this.geometryName_);
    }
    this.sketchFeature_.setGeometry(geometry);
    this.updateSketchFeatures_();
    this.dispatchEvent(
      new DrawEvent(DrawEventType.DRAWSTART, this.sketchFeature_),
    );
  }

  /**
   * Modify the drawing.
   * @param {import("../coordinate.js").Coordinate} coordinate Coordinate.
   * @private
   */
  modifyDrawing_(coordinate) {
    const map = this.getMap();
    const geometry = this.sketchFeature_.getGeometry();
    const projection = map.getView().getProjection();
    const stride = getStrideForLayout(this.geometryLayout_);
    let coordinates, last;
    while (coordinate.length < stride) {
      coordinate.push(0);
    }
    if (this.mode_ === 'Point') {
      last = this.sketchCoords_;
    } else if (this.mode_ === 'Polygon') {
      coordinates = /** @type {PolyCoordType} */ (this.sketchCoords_)[0];
      last = coordinates[coordinates.length - 1];
      if (this.atFinish_(map.getPixelFromCoordinate(coordinate))) {
        // snap to finish
        coordinate = this.finishCoordinate_.slice();
      }
    } else {
      coordinates = this.sketchCoords_;
      last = coordinates[coordinates.length - 1];
    }
    last[0] = coordinate[0];
    last[1] = coordinate[1];
    this.geometryFunction_(
      /** @type {!LineCoordType} */ (this.sketchCoords_),
      geometry,
      projection,
    );
    if (this.sketchPoint_) {
      let sketchPointCoordinate;
      if (this.mode_ === 'Point') {
        sketchPointCoordinate = this.sketchCoords_;
      } else if (this.mode_ === 'Polygon') {
        const sketchCoords = /** @type {PolyCoordType} */ (this.sketchCoords_);
        sketchPointCoordinate = sketchCoords[0][sketchCoords[0].length - 1];
      } else {
        const sketchCoords = /** @type {LineCoordType} */ (this.sketchCoords_);
        sketchPointCoordinate = sketchCoords[sketchCoords.length - 1];
      }
      const sketchPointGeom = this.sketchPoint_.getGeometry();
      sketchPointGeom.setCoordinates(sketchPointCoordinate.slice());
    }
    if (geometry.getType() === 'Polygon' && this.mode_ !== 'Polygon') {
      this.createOrUpdateCustomSketchLine_(/** @type {Polygon} */ (geometry));
    } else if (this.sketchLineCoords_) {
      const sketchLineGeom = this.sketchLine_.getGeometry();
      sketchLineGeom.setCoordinates(this.sketchLineCoords_);
    }
    this.updateSketchFeatures_();
  }

  /**
   * Add a new coordinate to the drawing.
   * @param {!PointCoordType} coordinate Coordinate
   * @return {Feature<import("../geom/SimpleGeometry.js").default>} The sketch feature.
   * @private
   */
  addToDrawing_(coordinate) {
    const geometry = this.sketchFeature_.getGeometry();
    const projection = this.getMap().getView().getProjection();
    let done;
    let coordinates;
    const mode = this.mode_;
    if (mode === 'LineString' || mode === 'Circle') {
      this.finishCoordinate_ = coordinate.slice();
      coordinates = /** @type {LineCoordType} */ (this.sketchCoords_);
      if (coordinates.length >= this.maxPoints_) {
        if (this.freehand_) {
          coordinates.pop();
        } else {
          done = true;
        }
      }
      coordinates.push(coordinate.slice());
      this.geometryFunction_(coordinates, geometry, projection);
    } else if (mode === 'Polygon') {
      coordinates = /** @type {PolyCoordType} */ (this.sketchCoords_)[0];
      if (coordinates.length >= this.maxPoints_) {
        if (this.freehand_) {
          coordinates.pop();
        } else {
          done = true;
        }
      }
      coordinates.push(coordinate.slice());
      if (done) {
        this.finishCoordinate_ = coordinates[0];
      }
      this.geometryFunction_(this.sketchCoords_, geometry, projection);
    }
    this.createOrUpdateSketchPoint_(coordinate.slice());
    this.updateSketchFeatures_();
    if (done) {
      return this.finishDrawing();
    }
    return this.sketchFeature_;
  }

  /**
   * @param {number} n The number of points to remove.
   */
  removeLastPoints_(n) {
    if (!this.sketchFeature_) {
      return;
    }
    const geometry = this.sketchFeature_.getGeometry();
    const projection = this.getMap().getView().getProjection();
    const mode = this.mode_;
    for (let i = 0; i < n; ++i) {
      let coordinates;
      if (mode === 'LineString' || mode === 'Circle') {
        coordinates = /** @type {LineCoordType} */ (this.sketchCoords_);
        coordinates.splice(-2, 1);
        if (coordinates.length >= 2) {
          this.finishCoordinate_ = coordinates[coordinates.length - 2].slice();
          const finishCoordinate = this.finishCoordinate_.slice();
          coordinates[coordinates.length - 1] = finishCoordinate;
          this.createOrUpdateSketchPoint_(finishCoordinate);
        }
        this.geometryFunction_(coordinates, geometry, projection);
        if (geometry.getType() === 'Polygon' && this.sketchLine_) {
          this.createOrUpdateCustomSketchLine_(
            /** @type {Polygon} */ (geometry),
          );
        }
      } else if (mode === 'Polygon') {
        coordinates = /** @type {PolyCoordType} */ (this.sketchCoords_)[0];
        coordinates.splice(-2, 1);
        const sketchLineGeom = this.sketchLine_.getGeometry();
        if (coordinates.length >= 2) {
          const finishCoordinate = coordinates[coordinates.length - 2].slice();
          coordinates[coordinates.length - 1] = finishCoordinate;
          this.createOrUpdateSketchPoint_(finishCoordinate);
        }
        sketchLineGeom.setCoordinates(coordinates);
        this.geometryFunction_(this.sketchCoords_, geometry, projection);
      }

      if (coordinates.length === 1) {
        this.abortDrawing();
        break;
      }
    }

    this.updateSketchFeatures_();
  }

  /**
   * Remove last point of the feature currently being drawn. Does not do anything when
   * drawing POINT or MULTI_POINT geometries.
   * @api
   */
  removeLastPoint() {
    this.removeLastPoints_(1);
  }

  /**
   * Stop drawing and add the sketch feature to the target layer.
   * The {@link module:ol/interaction/Draw~DrawEventType.DRAWEND} event is
   * dispatched before inserting the feature.
   * @return {Feature<import("../geom/SimpleGeometry.js").default>|null} The drawn feature.
   * @api
   */
  finishDrawing() {
    const sketchFeature = this.abortDrawing_();
    if (!sketchFeature) {
      return null;
    }
    let coordinates = this.sketchCoords_;
    const geometry = sketchFeature.getGeometry();
    const projection = this.getMap().getView().getProjection();
    if (this.mode_ === 'LineString') {
      // remove the redundant last point
      coordinates.pop();
      this.geometryFunction_(coordinates, geometry, projection);
    } else if (this.mode_ === 'Polygon') {
      // remove the redundant last point in ring
      /** @type {PolyCoordType} */ (coordinates)[0].pop();
      this.geometryFunction_(coordinates, geometry, projection);
      coordinates = geometry.getCoordinates();
    }

    // cast multi-part geometries
    if (this.type_ === 'MultiPoint') {
      sketchFeature.setGeometry(
        new MultiPoint([/** @type {PointCoordType} */ (coordinates)]),
      );
    } else if (this.type_ === 'MultiLineString') {
      sketchFeature.setGeometry(
        new MultiLineString([/** @type {LineCoordType} */ (coordinates)]),
      );
    } else if (this.type_ === 'MultiPolygon') {
      sketchFeature.setGeometry(
        new MultiPolygon([/** @type {PolyCoordType} */ (coordinates)]),
      );
    }

    // First dispatch event to allow full set up of feature
    this.dispatchEvent(new DrawEvent(DrawEventType.DRAWEND, sketchFeature));

    // Then insert feature
    if (this.features_) {
      this.features_.push(sketchFeature);
    }
    if (this.source_) {
      this.source_.addFeature(sketchFeature);
    }
    return sketchFeature;
  }

  /**
   * Stop drawing without adding the sketch feature to the target layer.
   * @return {Feature<import("../geom/SimpleGeometry.js").default>|null} The sketch feature (or null if none).
   * @private
   */
  abortDrawing_() {
    this.finishCoordinate_ = null;
    const sketchFeature = this.sketchFeature_;
    this.sketchFeature_ = null;
    this.sketchPoint_ = null;
    this.sketchLine_ = null;
    this.overlay_.getSource().clear(true);
    this.deactivateTrace_();
    return sketchFeature;
  }

  /**
   * Stop drawing without adding the sketch feature to the target layer.
   * @api
   */
  abortDrawing() {
    const sketchFeature = this.abortDrawing_();
    if (sketchFeature) {
      this.dispatchEvent(new DrawEvent(DrawEventType.DRAWABORT, sketchFeature));
    }
  }

  /**
   * Append coordinates to the end of the geometry that is currently being drawn.
   * This can be used when drawing LineStrings or Polygons. Coordinates will
   * either be appended to the current LineString or the outer ring of the current
   * Polygon. If no geometry is being drawn, a new one will be created.
   * @param {!LineCoordType} coordinates Linear coordinates to be appended to
   * the coordinate array.
   * @api
   */
  appendCoordinates(coordinates) {
    const mode = this.mode_;
    const newDrawing = !this.sketchFeature_;
    if (newDrawing) {
      this.startDrawing_(coordinates[0]);
    }
    /** @type {LineCoordType} */
    let sketchCoords;
    if (mode === 'LineString' || mode === 'Circle') {
      sketchCoords = /** @type {LineCoordType} */ (this.sketchCoords_);
    } else if (mode === 'Polygon') {
      sketchCoords =
        this.sketchCoords_ && this.sketchCoords_.length
          ? /** @type {PolyCoordType} */ (this.sketchCoords_)[0]
          : [];
    } else {
      return;
    }

    if (newDrawing) {
      sketchCoords.shift();
    }

    // Remove last coordinate from sketch drawing (this coordinate follows cursor position)
    sketchCoords.pop();

    // Append coordinate list
    for (let i = 0; i < coordinates.length; i++) {
      this.addToDrawing_(coordinates[i]);
    }

    const ending = coordinates[coordinates.length - 1];
    // Duplicate last coordinate for sketch drawing (cursor position)
    this.sketchFeature_ = this.addToDrawing_(ending);
    this.modifyDrawing_(ending);
  }

  /**
   * Initiate draw mode by starting from an existing geometry which will
   * receive new additional points. This only works on features with
   * `LineString` geometries, where the interaction will extend lines by adding
   * points to the end of the coordinates array.
   * This will change the original feature, instead of drawing a copy.
   *
   * The function will dispatch a `drawstart` event.
   *
   * @param {!Feature<LineString>} feature Feature to be extended.
   * @api
   */
  extend(feature) {
    const geometry = feature.getGeometry();
    const lineString = geometry;
    this.sketchFeature_ = feature;
    this.sketchCoords_ = lineString.getCoordinates();
    const last = this.sketchCoords_[this.sketchCoords_.length - 1];
    this.finishCoordinate_ = last.slice();
    this.sketchCoords_.push(last.slice());
    this.sketchPoint_ = new Feature(new Point(last));
    this.updateSketchFeatures_();
    this.dispatchEvent(
      new DrawEvent(DrawEventType.DRAWSTART, this.sketchFeature_),
    );
  }

  /**
   * Redraw the sketch features.
   * @private
   */
  updateSketchFeatures_() {
    const sketchFeatures = [];
    if (this.sketchFeature_) {
      sketchFeatures.push(this.sketchFeature_);
    }
    if (this.sketchLine_) {
      sketchFeatures.push(this.sketchLine_);
    }
    if (this.sketchPoint_) {
      sketchFeatures.push(this.sketchPoint_);
    }
    const overlaySource = this.overlay_.getSource();
    overlaySource.clear(true);
    overlaySource.addFeatures(sketchFeatures);
  }

  /**
   * @private
   */
  updateState_() {
    const map = this.getMap();
    const active = this.getActive();
    if (!map || !active) {
      this.abortDrawing();
    }
    this.overlay_.setMap(active ? map : null);
  }
}

/**
 * @return {import("../style/Style.js").StyleFunction} Styles.
 */
function getDefaultStyleFunction() {
  const styles = createEditingStyle();
  return function (feature, resolution) {
    return styles[feature.getGeometry().getType()];
  };
}

/**
 * Create a `geometryFunction` for `type: 'Circle'` that will create a regular
 * polygon with a user specified number of sides and start angle instead of a
 * {@link import("../geom/Circle.js").Circle} geometry.
 * @param {number} [sides] Number of sides of the regular polygon.
 *     Default is 32.
 * @param {number} [angle] Angle of the first point in counter-clockwise
 *     radians. 0 means East.
 *     Default is the angle defined by the heading from the center of the
 *     regular polygon to the current pointer position.
 * @return {GeometryFunction} Function that draws a polygon.
 * @api
 */
export function createRegularPolygon(sides, angle) {
  return function (coordinates, geometry, projection) {
    const center = fromUserCoordinate(
      /** @type {LineCoordType} */ (coordinates)[0],
      projection,
    );
    const end = fromUserCoordinate(
      /** @type {LineCoordType} */ (coordinates)[coordinates.length - 1],
      projection,
    );
    const radius = Math.sqrt(squaredCoordinateDistance(center, end));
    geometry = geometry || fromCircle(new Circle(center), sides);

    let internalAngle = angle;
    if (!angle && angle !== 0) {
      const x = end[0] - center[0];
      const y = end[1] - center[1];
      internalAngle = Math.atan2(y, x);
    }
    makeRegular(
      /** @type {Polygon} */ (geometry),
      center,
      radius,
      internalAngle,
    );

    const userProjection = getUserProjection();
    if (userProjection) {
      geometry.transform(projection, userProjection);
    }
    return geometry;
  };
}

/**
 * Create a `geometryFunction` that will create a box-shaped polygon (aligned
 * with the coordinate system axes).  Use this with the draw interaction and
 * `type: 'Circle'` to return a box instead of a circle geometry.
 * @return {GeometryFunction} Function that draws a box-shaped polygon.
 * @api
 */
export function createBox() {
  return function (coordinates, geometry, projection) {
    const extent = boundingExtent(
      /** @type {LineCoordType} */ ([
        coordinates[0],
        coordinates[coordinates.length - 1],
      ]).map(function (coordinate) {
        return fromUserCoordinate(coordinate, projection);
      }),
    );
    const boxCoordinates = [
      [
        getBottomLeft(extent),
        getBottomRight(extent),
        getTopRight(extent),
        getTopLeft(extent),
        getBottomLeft(extent),
      ],
    ];
    if (geometry) {
      geometry.setCoordinates(boxCoordinates);
    } else {
      geometry = new Polygon(boxCoordinates);
    }
    const userProjection = getUserProjection();
    if (userProjection) {
      geometry.transform(projection, userProjection);
    }
    return geometry;
  };
}

/**
 * Get the drawing mode.  The mode for multi-part geometries is the same as for
 * their single-part cousins.
 * @param {import("../geom/Geometry.js").Type} type Geometry type.
 * @return {Mode} Drawing mode.
 */
function getMode(type) {
  switch (type) {
    case 'Point':
    case 'MultiPoint':
      return 'Point';
    case 'LineString':
    case 'MultiLineString':
      return 'LineString';
    case 'Polygon':
    case 'MultiPolygon':
      return 'Polygon';
    case 'Circle':
      return 'Circle';
    default:
      throw new Error('Invalid type: ' + type);
  }
}

export default Draw;
