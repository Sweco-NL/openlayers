/**
 * @module ol/render/canvas/CircularStringBuilder
 */
import CanvasBuilder from './Builder.js';
import CanvasInstruction, {
  beginPathInstruction,
  closePathInstruction,
  fillInstruction,
  strokeInstruction,
} from './Instruction.js';
import GeometryType from '../../geom/GeometryType.js';

class CanvasCircularStringBuilder extends CanvasBuilder {
  /**
   * @param {number} tolerance Tolerance.
   * @param {import("../../extent.js").Extent} maxExtent Maximum extent.
   * @param {number} resolution Resolution.
   * @param {number} pixelRatio Pixel ratio.
   */
  constructor(tolerance, maxExtent, resolution, pixelRatio) {
    super(tolerance, maxExtent, resolution, pixelRatio);
  }

  /**
   * Adds instructions for drawing the provided circular string geometry.
   * @param {import("../../geom/CircularString.js").default} circularStringGeometry
   * The given geometry.
   * @param {import("../../Feature.js").FeatureLike} feature The given feature.
   */
  drawCircularString(circularStringGeometry, feature) {
    const state = this.state;
    const strokeStyle = state.strokeStyle;
    const lineWidth = state.lineWidth;
    if (strokeStyle === undefined || lineWidth === undefined) {
      return;
    }
    this.updateStrokeStyle(state, this.applyStroke);
    this.beginGeometry(circularStringGeometry, feature);
    this.appendCircularStringInstruction(
      circularStringGeometry.getDrawableFlatCoordinates()
    );
    this.endGeometry(feature);
  }

  /**
   * Adds instructions for drawing the provided compound curve geometry.
   * @param {import("../../geom/CompoundCurve.js").default} compoundCurveGeometry
   * The given geometry.
   * @param {import("../../Feature.js").FeatureLike} feature The given feature.
   */
  drawCompoundCurve(compoundCurveGeometry, feature) {
    const state = this.state;
    const strokeStyle = state.strokeStyle;
    const lineWidth = state.lineWidth;
    if (strokeStyle === undefined || lineWidth === undefined) {
      return;
    }
    this.updateStrokeStyle(state, this.applyStroke);
    this.beginGeometry(compoundCurveGeometry, feature);
    this.appendCompoundCurveInstructions(compoundCurveGeometry);
    this.endGeometry(feature);
  }

  /**
   * Adds instructions for drawing the provided curve polygon geometry.
   * @param {import("../../geom/CurvePolygon.js").default} curvePolygonGeometry
   * The given geometry.
   * @param {import("../../Feature.js").FeatureLike} feature The given feature.
   */
  drawCurvePolygon(curvePolygonGeometry, feature) {
    const state = this.state;
    const fillStyle = state.fillStyle;
    const strokeStyle = state.strokeStyle;
    if (fillStyle === undefined && strokeStyle === undefined) {
      return;
    }
    this.setFillStrokeStyles();
    this.beginGeometry(curvePolygonGeometry, feature);
    this.appendCurvePolygonInstructions(curvePolygonGeometry);
    this.endGeometry(feature);
  }

  /**
   * Appends the drawing instructions for drawing the given curve polygon
   * geometry to the list of instructions.
   * @param {import("../../geom/CurvePolygon.js").default} curvePolygonGeometry Curve Polygon.
   * @private
   */
  appendCurvePolygonInstructions(curvePolygonGeometry) {
    const state = this.state;
    const fill = state.fillStyle !== undefined;
    const stroke = state.strokeStyle !== undefined;
    curvePolygonGeometry.getRings().forEach((ring) => {
      // eslint-disable-next-line default-case
      switch (ring.getType()) {
        case GeometryType.LINE_STRING:
          this.appendLineStringInstruction(
            ring.getFlatCoordinates(),
            ring.getStride()
          );
          break;
        case GeometryType.CIRCULAR_STRING:
          this.appendCircularStringInstruction(
            /** @type {import("../../geom/CircularString.js").default} **/ (
              ring
            ).getDrawableFlatCoordinates()
          );
          break;
        case GeometryType.COMPOUND_CURVE:
          this.appendCompoundCurveInstructions(
            /** @type {import("../../geom/CompoundCurve.js").default} */ (ring)
          );
          break;
      }
      if (stroke) {
        this.instructions.push(closePathInstruction);
      }
    });
    if (fill) {
      this.instructions.push(fillInstruction);
    }
    if (stroke) {
      this.instructions.push(strokeInstruction);
    }
  }

  /**
   * Appends the drawing instructions for drawing the given compound curve
   * geometry to the list of instructions.
   * @param {import("../../geom/CompoundCurve.js").default} compoundCurveGeometry
   * The compound curve geometry for which to append instructions.
   * @private
   */
  appendCompoundCurveInstructions(compoundCurveGeometry) {
    let geometryFlatCoords = [];
    compoundCurveGeometry.getGeometries().forEach((geometry, index) => {
      const startIndex =
        index > 0 ? this.coordinates.length - 2 : this.coordinates.length;
      // eslint-disable-next-line default-case
      switch (geometry.getType()) {
        case GeometryType.CIRCULAR_STRING:
          const circularString =
            /** @type {import("../../geom/CircularString.js").default} **/ (
              geometry
            );
          geometryFlatCoords =
            index > 0
              ? circularString.getDrawableFlatCoordinates().slice(2)
              : circularString.getDrawableFlatCoordinates();
          this.appendCircularStringInstruction(geometryFlatCoords, startIndex);
          break;
        case GeometryType.LINE_STRING:
          geometryFlatCoords =
            index > 0
              ? geometry.getFlatCoordinates().slice(geometry.getStride())
              : geometry.getFlatCoordinates();
          this.appendLineStringInstruction(
            geometryFlatCoords,
            geometry.getStride(),
            startIndex
          );
          break;
      }
    });
  }

  /**
   * Appends a circular string instruction given the string's coordinates. The
   * coordinates are appended as well. They are expected to contain start,
   * middle, center of circle, and end coordinates for each arc in this
   * specific order.
   * @param {Array<number>} flatCoordinates The string's coordinates.
   * @param {number} startIndex The coordinate start index of the
   * MOVE_TO_ARC_TO instruction.
   * @private
   */
  appendCircularStringInstruction(
    flatCoordinates,
    startIndex = this.coordinates.length
  ) {
    const endIndex = this.appendCoordinates(flatCoordinates, 2);
    this.instructions.push([
      CanvasInstruction.MOVE_TO_ARC_TO,
      startIndex,
      endIndex,
    ]);
  }

  /**
   * Appends a line string instruction given the string's coordinates. The
   * coordinates are appended as well.
   * @param {Array<number>} flatCoordinates The line string's coordinates.
   * @param {number} stride The coordinates' stride.
   * @param {number} startIndex The coordinate start index of the
   * MOVE_TO_LINE_TO instruction.
   * @private
   */
  appendLineStringInstruction(
    flatCoordinates,
    stride,
    startIndex = this.coordinates.length
  ) {
    const endIndex = this.appendCoordinates(flatCoordinates, stride);
    this.instructions.push([
      CanvasInstruction.MOVE_TO_LINE_TO,
      startIndex,
      endIndex,
    ]);
  }

  /**
   * Appends the provided coordinates with the given stride to the list of
   * coordinates used for drawing.
   * @param {Array<number>} flatCoordinates The given coordinates.
   * @param {number} stride The given stride.
   * @return {number} The coordinates array's new length.
   * @private
   */
  appendCoordinates(flatCoordinates, stride) {
    const coordinates = this.coordinates;
    const length = flatCoordinates.length;
    let myEnd = this.coordinates.length;
    for (let i = 0; i < length; i += stride) {
      coordinates[myEnd++] = flatCoordinates[i];
      coordinates[myEnd++] = flatCoordinates[i + 1];
    }
    return myEnd;
  }

  /**
   * @private
   */
  setFillStrokeStyles() {
    const state = this.state;
    const fillStyle = state.fillStyle;
    if (fillStyle !== undefined) {
      this.updateFillStyle(state, this.createFill);
    }
    if (state.strokeStyle !== undefined) {
      this.updateStrokeStyle(state, this.applyStroke);
    }
  }

  /**
   * @return {import("../canvas.js").SerializableInstructions} the serializable instructions.
   */
  finish() {
    const state = this.state;
    if (
      state.lastStroke !== undefined &&
      state.lastStroke !== this.coordinates.length
    ) {
      this.instructions.push(strokeInstruction);
    }
    this.reverseHitDetectionInstructions();
    this.state = null;
    return super.finish();
  }

  /**
   * @param {import("../canvas.js").FillStrokeState} state State.
   */
  applyStroke(state) {
    if (
      state.lastStroke !== undefined &&
      state.lastStroke !== this.coordinates.length
    ) {
      this.instructions.push(strokeInstruction);
      state.lastStroke = this.coordinates.length;
    }
    state.lastStroke = 0;
    super.applyStroke(state);
    this.instructions.push(beginPathInstruction);
  }
}

export default CanvasCircularStringBuilder;
