/** 500 → "500 m", 5000 → "5 km". */
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${metres} m` : `${metres / 1000} km`;
}
