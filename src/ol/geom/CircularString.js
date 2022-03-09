/**
 * @module ol/geom/CircularString
 */
import SimpleGeometry from './SimpleGeometry.js';
import {CircularArc, Vector2} from './flat/CircularArc.js';
import {assignClosestPoint, maxSquaredDelta} from './flat/closest.js';
import {
  closestSquaredDistanceXY,
  createOrUpdateFromFlatCoordinates,
} from '../extent.js';
import {deflateCoordinates} from './flat/deflate.js';

/**
 * @classdesc
 * CircularString geometry.
 *
 * @api
 */
class CircularString extends SimpleGeometry {
  /**
   * @param {Array<import("../coordinate.js").Coordinate>} coordinates Coordinates.
   * @param {import("../geom/Geometry.js").GeometryLayout} [opt_layout] Layout.
   */
  constructor(coordinates, opt_layout) {
    super();

    /**
     * @private
     * @type {number}
     */
    this.maxDelta_ = -1;

    /**
     * @private
     * @type {number}
     */
    this.maxDeltaRevision_ = -1;

    /**
     * @private
     * @type {Array<number>}
     */
    this.flatCenterOfCircleCoordinates = [];

    /**
     * @private
     * @type {Array<number>}
     */
    this.drawableFlatCoordinates = [];

    this.setCoordinates(coordinates, opt_layout);
  }

  /**
   * Updates internals. Called whenever the geometry's flat coordinates have
   * been changed.
   * @private
   */
  update() {
    this.updateFlatCenterOfCircleCoordinates();
    this.updateDrawableFlatCoordinates();
  }

  /**
   * Updates the center of circle for each arc in the string.
   * @private
   */
  updateFlatCenterOfCircleCoordinates() {
    const arcCount = this.arcCount();
    this.flatCenterOfCircleCoordinates = new Array(arcCount * 2);
    for (let i = 0; i < arcCount; ++i) {
      const arc = this.arc(i);
      const offset = i * 2;
      const center = arc.centerOfCircle();
      this.flatCenterOfCircleCoordinates[offset] = center.x;
      this.flatCenterOfCircleCoordinates[offset + 1] = center.y;
    }
  }

  /**
   * Constructs an array of flat coordinates which may be used for drawing
   * purposes. Apart from start, middle, and end coordinates this array
   * includes the coordinates for the center of circle for each arc.
   * @private
   */
  updateDrawableFlatCoordinates() {
    const arcCount = this.arcCount();
    this.drawableFlatCoordinates = new Array(
      this.getCoordinates().length * 2 + 2 * arcCount
    );
    const drawableCoords = this.drawableFlatCoordinates;
    const stride = this.getStride();
    const flatCoords = this.getFlatCoordinates();
    for (let i = 0; i < arcCount; ++i) {
      const offset = i * 6;
      const startX = i * stride * 2;
      const middleX = startX + stride;
      const endX = middleX + stride;
      // start coordinates
      drawableCoords[offset] = flatCoords[startX];
      drawableCoords[offset + 1] = flatCoords[startX + 1];
      // middle coordinates
      drawableCoords[offset + 2] = flatCoords[middleX];
      drawableCoords[offset + 3] = flatCoords[middleX + 1];
      // center of circle coordinates
      const centerOfCircle = this.flatCenterOfCircle(i);
      drawableCoords[offset + 4] = centerOfCircle[0];
      drawableCoords[offset + 5] = centerOfCircle[1];
      // end coordinates
      drawableCoords[offset + 6] = flatCoords[endX];
      drawableCoords[offset + 7] = flatCoords[endX + 1];
    }
  }

  /**
   * Returns the flat coordinates which may be used for drawing. Unlike the
   * regular flat coordinates this includes the center coordinates for each
   * circle of each arc.
   * @return {Array<number>} The flat coordinates.
   */
  getDrawableFlatCoordinates() {
    return this.drawableFlatCoordinates;
  }

  /**
   * Returns the center of circle for the arc at the given index. The returned
   * coordinates concern flat coordinates.
   * @param {number} arcIndex The given arc index.
   * @return {import("../coordinate.js").Coordinate} The center of circle.
   */
  flatCenterOfCircle(arcIndex) {
    const start = arcIndex * 2;
    return this.flatCenterOfCircleCoordinates.slice(start, start + 2);
  }

  /**
   * Apply a transform function to the coordinates of the geometry.
   * The geometry is modified in place.
   * If you do not want the geometry modified in place, first `clone()` it and
   * then use this function on the clone.
   * @param {import("../proj.js").TransformFunction} transformFn Transform function.
   * Called with a flat array of geometry coordinates.
   * @api
   */
  applyTransform(transformFn) {
    super.applyTransform(transformFn);
    this.update();
  }

  /**
   * Make a complete copy of the geometry.
   * @return {!CircularString} Clone.
   * @api
   */
  clone() {
    const circularString = new CircularString(
      this.coordinates.map((coords) => coords.slice()),
      this.layout
    );
    circularString.applyProperties(this);
    return circularString;
  }

  /**
   * @param {number} x X.
   * @param {number} y Y.
   * @param {import("../coordinate.js").Coordinate} closestPoint Closest point.
   * @param {number} minSquaredDistance Minimum squared distance.
   * @return {number} Minimum squared distance.
   */
  closestPointXY(x, y, closestPoint, minSquaredDistance) {
    if (minSquaredDistance < closestSquaredDistanceXY(this.getExtent(), x, y)) {
      return minSquaredDistance;
    }
    if (this.maxDeltaRevision_ !== this.getRevision()) {
      this.maxDelta_ = Math.sqrt(
        maxSquaredDelta(
          this.flatCoordinates,
          0,
          this.flatCoordinates.length,
          this.stride,
          0
        )
      );
      this.maxDeltaRevision_ = this.getRevision();
    }
    return assignClosestPoint(
      this.flatCoordinates,
      0,
      this.flatCoordinates.length,
      this.stride,
      this.maxDelta_,
      false,
      x,
      y,
      closestPoint,
      minSquaredDistance
    );
  }

  /**
   * Return the coordinates of the circular string.
   * @return {Array<import("../coordinate.js").Coordinate>} Coordinates.
   * @api
   */
  getCoordinates() {
    return this.coordinates;
  }

  /**
   * Get the type of this geometry.
   * @return {import("./Geometry.js").Type} Geometry type.
   * @api
   */
  getType() {
    return 'CircularString';
  }

  /**
   * Returns the amount of arcs of which this geometry consists.
   * @return {number} The amount of arcs.
   */
  arcCount() {
    return Math.floor(this.coordinates.length / 2);
  }

  /**
   * Constructs and returns a CircularArc object for the arc at the given
   * index.
   * @private
   * @param {number} index The arc's index.
   * @return {CircularArc} The constructed CircularArc.
   */
  arc(index) {
    const startX = this.stride * 2 * index;
    const middleX = startX + this.stride;
    const endX = startX + this.stride * 2;
    return new CircularArc(
      new Vector2(
        this.flatCoordinates[startX],
        this.flatCoordinates[startX + 1]
      ),
      new Vector2(
        this.flatCoordinates[middleX],
        this.flatCoordinates[middleX + 1]
      ),
      new Vector2(this.flatCoordinates[endX], this.flatCoordinates[endX + 1])
    );
  }

  /**
   * Computes and returns the flat bounding coordinates for the given arc.
   * @private
   * @param {CircularArc} arc The given arc.
   * @return {Array<number>} The computed bounding coordinates.
   */
  flatBoundingArcCoordinates(arc) {
    const boundingCoords = [];
    const center = arc.centerOfCircle();
    const radius = arc.radius(center);
    const angles = arc.angles(center);
    const clockwise = arc.clockwise(angles);
    arc
      .boundingCoords(
        center,
        radius,
        angles.startAngle,
        angles.endAngle,
        clockwise
      )
      .forEach((coords) => {
        boundingCoords.push(coords.x);
        boundingCoords.push(coords.y);
      });
    return boundingCoords;
  }

  /**
   * Computes and returns the flat bounding coordinates for the geometry as
   * a whole.
   * @private
   * @return {Array<number>} The computed bounding coordinates.
   */
  flatBoundingCoordinates() {
    let boundingCoords = [];
    const count = this.arcCount();
    for (let i = 0; i < count; ++i) {
      const arc = this.arc(i);
      boundingCoords = boundingCoords.concat(
        this.flatBoundingArcCoordinates(arc)
      );
    }
    return boundingCoords;
  }

  /**
   * @protected
   * @param {import("../extent.js").Extent} extent Extent.
   * @return {import("../extent.js").Extent} extent Extent.
   */
  computeExtent(extent) {
    const boundingCoords = this.flatBoundingCoordinates();
    return createOrUpdateFromFlatCoordinates(
      boundingCoords,
      0,
      boundingCoords.length,
      2,
      extent
    );
  }

  /**
   * Set the coordinates of the circular string.
   * @param {!Array<import("../coordinate.js").Coordinate>} coordinates Coordinates.
   * @param {import("../geom/Geometry.js").GeometryLayout} [opt_layout] Layout.
   * @api
   */
  setCoordinates(coordinates, opt_layout) {
    this.coordinates = coordinates;
    this.setLayout(opt_layout, coordinates, 1);
    if (!this.flatCoordinates) {
      this.flatCoordinates = [];
    }
    this.flatCoordinates.length = deflateCoordinates(
      this.flatCoordinates,
      0,
      coordinates,
      this.stride
    );
    this.update();
    this.changed();
  }
}

export default CircularString;
