export const ALMATY_OFFSET_MS = 5 * 60 * 60 * 1000;

export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function almatyDate(timestamp: string | number): string {
  const ms = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  return new Date(ms + ALMATY_OFFSET_MS).toISOString().slice(0, 10);
}
