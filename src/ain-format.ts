/**
 * AIN formatting — single source of truth for how the engine's AIN value is
 * put in front of a user.
 *
 * The engine returns `ain` on the 0.0 – 1.0 scale with 6 decimals. Clients may
 * display it on a 0 – 100 scale, but must NOT round it to an integer: that
 * throws away 4 of the 6 decimals the engine computed and contradicts the
 * determinism/reproducibility guarantee.
 *
 *   correct : (ain * 100).toFixed(2)  ->  "93.24"
 *   wrong   : Math.round(ain * 100)   ->  93
 */

/** Number of decimals kept when an AIN value is rendered on the 0–100 scale. */
export const AIN_DISPLAY_DECIMALS = 2;

/**
 * Engine AIN (0.0 – 1.0) -> 0 – 100 scale, numeric, WITHOUT losing precision.
 * Use for comparisons, thresholds and anything stored/serialized.
 */
export function ainScale(ain: number): number {
  return ain * 100;
}

/**
 * Render a value already on the 0 – 100 scale, keeping decimals.
 * `fmtAin(93.2415)` -> `"93.24"`
 */
export function fmtAin(scaled: number): string {
  return scaled.toFixed(AIN_DISPLAY_DECIMALS);
}

/**
 * Engine AIN (0.0 – 1.0) -> display string on the 0 – 100 scale.
 * `ainPct(0.932415)` -> `"93.24"`
 */
export function ainPct(ain: number): string {
  return fmtAin(ainScale(ain));
}
