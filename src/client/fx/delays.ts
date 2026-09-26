// OWNER: X3. Shot → impact timing shared by FX and audio (pure): a world impact lands when its tracer arrives, so the
// sparks, the bullet hole and the ricochet ping happen together, after the flash and the report.

/** Tracer flight speed (m/s, presets-weapons.tracer). */
export const TRACER_SPEED = 190;

/** Seconds from the shot to its visible impact for a tracer kind over `dist` m (tracer flight / spray arc), capped. */
export function impactDelay(tracer: string, dist: number): number {
  if (tracer === 'bullet') return Math.min(0.3, dist / TRACER_SPEED);
  if (tracer === 'water') return Math.min(0.6, dist / 22);
  return 0;
}
