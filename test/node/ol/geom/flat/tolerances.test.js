import {
  ANGULAR_EPSILON,
  ARC_EXTREME_ANGULAR_EPSILON,
  ARC_SWEEP_TOLERANCE_FRACTION,
  COINCIDENT_POINT_SQ,
  COINCIDENT_SEGMENT_SQ,
  COLLINEAR_SIN,
  DEFAULT_CROSSING_EPSILON_SQ,
  DEFAULT_SAME_ARC_TOLERANCE_SQ,
  DEGENERATE_ARC_RADIUS,
  DISTANCE_EPSILON,
  ENDPOINT_PARAMETRIC_FRACTION,
  ENDPOINT_PARAMETRIC_FRACTION_SQ,
  MAX_ARC_ANGULAR_TOLERANCE,
  PARALLEL_DETERMINANT,
  PARAMETRIC_EPSILON,
  RADIUS_MATCH_EPSILON,
  VERTEX_MATCH_DISTANCE,
  ZERO_LENGTH_SEGMENT_SQ,
} from '../../../../../src/ol/geom/flat/tolerances.js';
import expect from '../../../expect.js';

describe('ol/geom/flat/tolerances.js', function () {
  // These assertions pin the centralized tolerance values so a future
  // "cleanup" cannot silently change a heuristic threshold, and document the
  // dimensional relationships between derived constants.

  it('pins the squared-distance (coordinate-units squared) group', function () {
    expect(COINCIDENT_POINT_SQ).to.be(1e-12);
    expect(COINCIDENT_SEGMENT_SQ).to.be(1e-10);
    expect(ZERO_LENGTH_SEGMENT_SQ).to.be(1e-20);
  });

  it('keeps VERTEX_MATCH_DISTANCE consistent with COINCIDENT_POINT_SQ', function () {
    expect(VERTEX_MATCH_DISTANCE * VERTEX_MATCH_DISTANCE).to.roughlyEqual(
      COINCIDENT_POINT_SQ,
      1e-24,
    );
  });

  it('pins the parametric (dimensionless) group', function () {
    expect(PARAMETRIC_EPSILON).to.be(1e-9);
    expect(ENDPOINT_PARAMETRIC_FRACTION).to.be(0.005);
    expect(ENDPOINT_PARAMETRIC_FRACTION_SQ).to.be(25e-6);
  });

  it('keeps ENDPOINT_PARAMETRIC_FRACTION_SQ as the square of the fraction', function () {
    expect(
      ENDPOINT_PARAMETRIC_FRACTION * ENDPOINT_PARAMETRIC_FRACTION,
    ).to.roughlyEqual(ENDPOINT_PARAMETRIC_FRACTION_SQ, 1e-12);
  });

  it('pins the angular (radians) group', function () {
    expect(ANGULAR_EPSILON).to.be(1e-7);
    expect(ARC_EXTREME_ANGULAR_EPSILON).to.be(1e-10);
    expect(MAX_ARC_ANGULAR_TOLERANCE).to.be(0.01);
    expect(ARC_SWEEP_TOLERANCE_FRACTION).to.be(0.05);
    expect(COLLINEAR_SIN).to.be(1e-10);
  });

  it('pins the absolute-distance / radius group', function () {
    expect(DISTANCE_EPSILON).to.be(1e-9);
    expect(RADIUS_MATCH_EPSILON).to.be(1e-6);
    expect(PARALLEL_DETERMINANT).to.be(1e-10);
    expect(DEGENERATE_ARC_RADIUS).to.be(1e9);
  });

  it('pins the caller-facing self-intersection defaults', function () {
    expect(DEFAULT_CROSSING_EPSILON_SQ).to.be(4);
    expect(DEFAULT_SAME_ARC_TOLERANCE_SQ).to.be(1e-4);
  });
});
