/**
 * @module ol/geom/flat/tolerances
 */

/**
 * Named, dimensioned tolerance constants for the flat curve/arc geometry
 * routines. Centralizing these avoids the "magic literal" problem where the
 * same numeric value was reused for physically different quantities (squared
 * distance vs. radians vs. a dimensionless parametric fraction), which made the
 * thresholds impossible to reason about or tune safely.
 *
 * Constants are grouped by dimension. **Do not** substitute a constant from one
 * group for another — a squared-distance threshold and an angular threshold are
 * not interchangeable even when they happen to share a numeric value.
 *
 * Scale note: this is a CRS-agnostic library, so coordinate-unit thresholds
 * (the `*_SQ` distance groups and the meter-based self-intersection defaults)
 * are inherently scale-dependent. Prefer the scale-invariant checks
 * (`COLLINEAR_SIN`, the parametric fractions, the angular tolerances) where a
 * choice exists, and inject a resolution-derived tolerance from the interaction
 * layer rather than relying on the meter-based geometry defaults.
 */

/**
 * Squared distance (coordinate-units²) below which two points are treated as
 * coincident — e.g. an arc whose begin and end coincide is a full circle, and
 * two control points this close are the same vertex. Corresponds to a linear
 * separation of 1e-6 units.
 * @type {number}
 */
export const COINCIDENT_POINT_SQ = 1e-12;

/**
 * Linear distance (coordinate-units) below which two vertices are treated as
 * the same point when matching control points by coordinate. This is the
 * square root of {@link COINCIDENT_POINT_SQ}.
 * @type {number}
 */
export const VERTEX_MATCH_DISTANCE = 1e-6;

/**
 * Squared length (coordinate-units²) below which a chord/segment between two
 * control points is treated as zero-length (coincident endpoints) when
 * computing a circle center. Slightly looser than {@link COINCIDENT_POINT_SQ}
 * because the perpendicular-bisector construction is more sensitive to
 * near-degenerate segments than a plain point-equality test.
 * @type {number}
 */
export const COINCIDENT_SEGMENT_SQ = 1e-10;

/**
 * Squared length (coordinate-units²) below which a line segment is treated as a
 * degenerate zero-length segment in line/arc intersection. Deliberately tiny so
 * only truly degenerate input is rejected.
 * @type {number}
 */
export const ZERO_LENGTH_SEGMENT_SQ = 1e-20;

/**
 * Scale-invariant collinearity threshold: the sine of the angle between the two
 * perpendicular bisectors used to locate a circle center. When
 * `|sin(theta)|` is below this value the three points are treated as collinear
 * (no finite circle). Because it is normalized by the segment lengths it
 * behaves identically at any coordinate scale — unlike the raw cross-product
 * (area) comparison it replaces, which silently failed to detect collinearity
 * for large-magnitude coordinates.
 * @type {number}
 */
export const COLLINEAR_SIN = 1e-10;

/**
 * Absolute value of the 2x2 determinant below which two line segments are
 * treated as parallel in the line/line crossing routine. This quantity is an
 * area and is therefore scale-dependent; it is retained (rather than
 * normalized) because the routine only runs on interaction-scale sketch
 * coordinates. Prefer {@link COLLINEAR_SIN} for scale-invariant collinearity.
 * @type {number}
 */
export const PARALLEL_DETERMINANT = 1e-10;

/**
 * Dimensionless parametric epsilon used to exclude shared endpoints when a
 * crossing is expressed as a fraction `t` along a segment (a true interior
 * crossing satisfies `PARAMETRIC_EPSILON < t < 1 - PARAMETRIC_EPSILON`).
 * @type {number}
 */
export const PARAMETRIC_EPSILON = 1e-9;

/**
 * Dimensionless fraction of a segment/chord length within which a crossing is
 * considered "at" a shared endpoint (0.5%). Catches near-vertex artifacts on
 * large geometries where the squared-distance test alone is too coarse.
 * @type {number}
 */
export const ENDPOINT_PARAMETRIC_FRACTION = 0.005;

/**
 * Square of {@link ENDPOINT_PARAMETRIC_FRACTION} (2.5e-5). Used when the
 * proximity test is expressed as a squared distance relative to a squared chord
 * length, so the fraction must also be squared to stay dimensionless.
 * @type {number}
 */
export const ENDPOINT_PARAMETRIC_FRACTION_SQ = 25e-6;

/**
 * Default angular tolerance (radians) for testing whether an angle lies within
 * an arc's sweep.
 * @type {number}
 */
export const ANGULAR_EPSILON = 1e-7;

/**
 * Very tight angular tolerance (radians) used to exclude an axis-aligned arc
 * extreme that coincides with the arc's start/end angle when computing the
 * arc's bounding coordinates. Distinct from {@link ANGULAR_EPSILON}: this only
 * discards extremes that sit essentially exactly on an endpoint, so it must stay
 * far smaller than the general sweep tolerance.
 * @type {number}
 */
export const ARC_EXTREME_ANGULAR_EPSILON = 1e-10;

/**
 * Upper bound (radians) on the adaptive angular tolerance used when matching a
 * crossing against a short arc's sweep.
 * @type {number}
 */
export const MAX_ARC_ANGULAR_TOLERANCE = 0.01;

/**
 * Fraction of an arc's sweep used as its adaptive angular tolerance (capped by
 * {@link MAX_ARC_ANGULAR_TOLERANCE}). Dimensionless.
 * @type {number}
 */
export const ARC_SWEEP_TOLERANCE_FRACTION = 0.05;

/**
 * Absolute distance (coordinate-units) epsilon used in circle/circle
 * intersection for the containment/tangency branch comparisons. Scale-dependent
 * but only exercised on interaction-scale coordinates.
 * @type {number}
 */
export const DISTANCE_EPSILON = 1e-9;

/**
 * Absolute difference (coordinate-units) below which two radii are treated as
 * equal (concentric same-radius arcs) in circle/circle intersection.
 * @type {number}
 */
export const RADIUS_MATCH_EPSILON = 1e-6;

/**
 * Arc radius (coordinate-units) above which an arc is treated as a straight
 * line (near-infinite radius / degenerate curvature).
 * @type {number}
 */
export const DEGENERATE_ARC_RADIUS = 1e9;

/**
 * Default squared-distance threshold (meters², i.e. a 2 m linear tolerance) for
 * detecting crossings when a caller does not supply one. Meter-based and
 * therefore only appropriate for projected data near unit scale — interaction
 * callers should inject a resolution-derived value instead.
 * @type {number}
 */
export const DEFAULT_CROSSING_EPSILON_SQ = 4;

/**
 * Default squared-distance threshold (coordinate-units²) for treating two arcs
 * as the same arc / for endpoint exclusion when a caller does not supply one.
 * @type {number}
 */
export const DEFAULT_SAME_ARC_TOLERANCE_SQ = 1e-4;
