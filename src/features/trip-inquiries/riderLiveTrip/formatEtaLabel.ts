// Floors to a never-negative, never-"0 min" display: anything under a minute
// (including a stale/negative reading) reads as "Arriving now" instead.
export function formatEtaLabel(minutes: number): string {
  const rounded = Math.round(minutes);
  return rounded < 1 ? 'Arriving now' : `~${rounded} min`;
}
