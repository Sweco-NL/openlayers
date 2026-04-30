/**
 * @module ol/render/canvas/CurveBuilder
 */
import {
  defaultFillStyle,
  defaultLineDash,
  defaultLineDashOffset,
  defaultStrokeStyle,
} from '../canvas.js';
import CanvasBuilder from './Builder.js';
import CanvasInstruction, {
  beginPathInstruction,
  closePathInstruction,
  fillInstruction,
  strokeInstruction,
} from './Instruction.js';

class CanvasCurveBuilder extends CanvasBuilder {
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
   * @param {number} [index] Render order index.
   * @override
   */
  drawCircularString(circularStringGeometry, feature, index) {
    const state = this.state;
    const strokeStyle = state.strokeStyle;
    const lineWidth = state.lineWidth;
    if (strokeStyle === undefined || lineWidth === undefined) {
      return;
    }
    this.updateStrokeStyle(state, this.applyStroke);
    this.beginGeometry(circularStringGeometry, feature, index);
    this.hitDetectionInstructions.push(
      [
        CanvasInstruction.SET_STROKE_STYLE,
        defaultStrokeStyle,
        state.lineWidth,
        state.lineCap,
        state.lineJoin,
        state.miterLimit,
        defaultLineDash,
        defaultLineDashOffset,
      ],
      beginPathInstruction,
    );
    this.instructions.push(beginPathInstruction);
    this.appendCircularStringInstruction(
      circularStringGeometry.getDrawableFlatCoordinates(),
    );
    this.instructions.push(strokeInstruction);
    this.hitDetectionInstructions.push(strokeInstruction);
    this.endGeometry(feature);
  }

  /**
   * Adds instructions for drawing the provided compound curve geometry.
   * @param {import("../../geom/CompoundCurve.js").default} compoundCurveGeometry
   * The given geometry.
   * @param {import("../../Feature.js").FeatureLike} feature The given feature.
   * @param {number} [index] Render order index.
   * @override
   */
  drawCompoundCurve(compoundCurveGeometry, feature, index) {
    const state = this.state;
    const strokeStyle = state.strokeStyle;
    const lineWidth = state.lineWidth;
    if (strokeStyle === undefined || lineWidth === undefined) {
      return;
    }
    this.updateStrokeStyle(state, this.applyStroke);
    this.beginGeometry(compoundCurveGeometry, feature, index);
    this.hitDetectionInstructions.push(
      [
        CanvasInstruction.SET_STROKE_STYLE,
        defaultStrokeStyle,
        state.lineWidth,
        state.lineCap,
        state.lineJoin,
        state.miterLimit,
        defaultLineDash,
        defaultLineDashOffset,
      ],
      beginPathInstruction,
    );
    this.instructions.push(beginPathInstruction);
    this.appendCompoundCurveInstructions(compoundCurveGeometry);
    this.instructions.push(strokeInstruction);
    this.hitDetectionInstructions.push(strokeInstruction);
    this.endGeometry(feature);
  }

  /**
   * Adds instructions for drawing the provided curve polygon geometry.
   * @param {import("../../geom/CurvePolygon.js").default} curvePolygonGeometry
   * The given geometry.
   * @param {import("../../Feature.js").FeatureLike} feature The given feature.
   * @param {number} [index] Render order index.
   * @override
   */
  drawCurvePolygon(curvePolygonGeometry, feature, index) {
    const state = this.state;
    const fillStyle = state.fillStyle;
    const strokeStyle = state.strokeStyle;
    if (fillStyle === undefined && strokeStyle === undefined) {
      return;
    }
    this.setFillStrokeStyles();
    this.beginGeometry(curvePolygonGeometry, feature, index);
    this.instructions.push(beginPathInstruction);
    this.hitDetectionInstructions.push(beginPathInstruction);
    this.hitDetectionInstructions.push([
      CanvasInstruction.SET_FILL_STYLE,
      defaultFillStyle,
    ]);
    this.appendCurvePolygonInstructions(curvePolygonGeometry);
    this.endGeometry(feature);
  }

  /**
   * Appends the drawing instructions for drawing the given curve polygon
   * geometry to the list of instructions.
   * @private
   * @param {import("../../geom/CurvePolygon.js").default} curvePolygonGeometry Curve Polygon.
   */
  appendCurvePolygonInstructions(curvePolygonGeometry) {
    const state = this.state;
    const fill = state.fillStyle !== undefined;
    const stroke = state.strokeStyle !== undefined;
    const rings = curvePolygonGeometry.getRings();
    for (let i = 0, ii = rings.length; i < ii; ++i) {
      const ring = rings[i];
      // eslint-disable-next-line default-case
      switch (ring.getType()) {
        case 'LineString':
          this.appendLineStringInstruction(
            ring.getFlatCoordinates(),
            ring.getStride(),
          );
          break;
        case 'CircularString':
          this.appendCircularStringInstruction(
            /** @type {import("../../geom/CircularString.js").default} */ (
              ring
            ).getDrawableFlatCoordinates(),
          );
          break;
        case 'CompoundCurve':
          this.appendCompoundCurveInstructions(
            /** @type {import("../../geom/CompoundCurve.js").default} */ (ring),
          );
          break;
      }
      if (stroke) {
        this.instructions.push(closePathInstruction);
        this.hitDetectionInstructions.push(closePathInstruction);
      }
    }
    if (fill) {
      this.instructions.push(fillInstruction);
      this.hitDetectionInstructions.push(fillInstruction);
    }
    if (stroke) {
      this.instructions.push(strokeInstruction);
      this.hitDetectionInstructions.push(strokeInstruction);
    }
  }

  /**
   * Appends the drawing instructions for drawing the given compound curve
   * geometry to the list of instructions.
   * @private
   * @param {import("../../geom/CompoundCurve.js").default} compoundCurveGeometry
   * The compound curve geometry for which to append instructions.
   */
  appendCompoundCurveInstructions(compoundCurveGeometry) {
    let geometryFlatCoords = [];
    const geometries = compoundCurveGeometry.getGeometriesArray();
    for (let i = 0, ii = geometries.length; i < ii; ++i) {
      const geometry = geometries[i];
      const moveTo = i === 0;
      const startIndex =
        i > 0 ? this.coordinates.length - 2 : this.coordinates.length;
      // eslint-disable-next-line default-case
      switch (geometry.getType()) {
        case 'CircularString': {
          const circularString =
            /** @type {import("../../geom/CircularString.js").default} */ (
              geometry
            );
          geometryFlatCoords =
            i > 0
              ? circularString.getDrawableFlatCoordinates().slice(2)
              : circularString.getDrawableFlatCoordinates();
          this.appendCircularStringInstruction(
            geometryFlatCoords,
            startIndex,
            moveTo,
          );
          break;
        }
        case 'LineString':
          geometryFlatCoords =
            i > 0
              ? geometry.getFlatCoordinates().slice(geometry.getStride())
              : geometry.getFlatCoordinates();
          this.appendLineStringInstruction(
            geometryFlatCoords,
            geometry.getStride(),
            startIndex,
            moveTo,
          );
          break;
      }
    }
  }

  /**
   * Appends a circular string instruction given the string's coordinates. The
   * coordinates are appended as well. They are expected to contain start,
   * middle, center of circle, and end coordinates for each arc in this
   * specific order.
   * @private
   * @param {Array<number>} flatCoordinates The string's coordinates.
   * @param {number} startIndex The coordinate start index of the
   * MOVE_TO_ARC_TO instruction.
   * @param {boolean} moveTo Whether to emit a MOVE_TO_ARC_TO or ARC_TO.
   */
  appendCircularStringInstruction(
    flatCoordinates,
    startIndex = this.coordinates.length,
    moveTo = true,
  ) {
    const endIndex = this.appendCoordinates(flatCoordinates, 2);
    // choose the correct instruction
    const instructionType = moveTo
      ? CanvasInstruction.MOVE_TO_ARC_TO
      : CanvasInstruction.ARC_TO;
    const instruction = [instructionType, startIndex, endIndex];
    this.instructions.push(instruction);
    this.hitDetectionInstructions.push(instruction);
  }

  /**
   * Appends a line string instruction given the string's coordinates. The
   * coordinates are appended as well.
   * @private
   * @param {Array<number>} flatCoordinates The line string's coordinates.
   * @param {number} stride The coordinates' stride.
   * @param {number} startIndex The coordinate start index of the
   * MOVE_TO_LINE_TO instruction.
   * @param {boolean} moveTo Whether to emit a MOVE_TO_LINE_TO or LINE_TO.
   */
  appendLineStringInstruction(
    flatCoordinates,
    stride,
    startIndex = this.coordinates.length,
    moveTo = true,
  ) {
    const endIndex = this.appendCoordinates(flatCoordinates, stride);
    // choose the correct instruction
    const instructionType = moveTo
      ? CanvasInstruction.MOVE_TO_LINE_TO
      : CanvasInstruction.LINE_TO;
    const instruction = [instructionType, startIndex, endIndex];
    this.instructions.push(instruction);
    this.hitDetectionInstructions.push(instruction);
  }

  /**
   * Appends the provided coordinates with the given stride to the list of
   * coordinates used for drawing.
   * @private
   * @param {Array<number>} flatCoordinates The given coordinates.
   * @param {number} stride The given stride.
   * @return {number} The coordinates array's new length.
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
   * @override
   * @return {import("../canvas.js").SerializableInstructions} the serializable instructions.
   */
  finish() {
    const state = this.state;
    if (
      state.lastStroke !== undefined &&
      state.lastStroke !== this.coordinates.length
    ) {
      this.instructions.push(strokeInstruction);
      this.hitDetectionInstructions.push(strokeInstruction);
    }
    this.reverseHitDetectionInstructions();
    this.state = null;
    return super.finish();
  }

  /**
   * @override
   * @param {import("../canvas.js").FillStrokeState} state State.
   */
  applyStroke(state) {
    if (
      state.lastStroke !== undefined &&
      state.lastStroke !== this.coordinates.length
    ) {
      this.instructions.push(strokeInstruction);
      this.hitDetectionInstructions.push(strokeInstruction);
      state.lastStroke = this.coordinates.length;
    }
    state.lastStroke = 0;
    super.applyStroke(state);
  }
}

export default CanvasCurveBuilder;
