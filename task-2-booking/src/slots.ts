import type { Booking, Master, Service } from './types.ts';
import { fromMinutes, toMinutes, weekday, overlaps, TZ_OFFSET } from './time.ts';
import { now } from './clock.ts';
import { isDate } from '../../shared/time.ts';

export const SLOT_STEP_MIN = 15;
export const CLEANUP_MIN = 7;

export function getSlots(master: Master, service: Service, date: string, bookings: Booking[]): string[] {
  if (!isDate(date) || !service.masterIds.includes(master.id) || service.durationMin <= 0) return [];
  const day = master.schedule[weekday(date)];
  if (!day) return [];
  const midnight = Date.parse(`${date}T00:00:00${TZ_OFFSET}`);
  const current = now().getTime();
  const busy = bookings.filter((b) => b.masterId === master.id && b.status === 'active')
    .map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) + CLEANUP_MIN * 60000 }));
  const result: string[] = [];
  for (let t = toMinutes(day.from); t + service.durationMin <= toMinutes(day.to); t += SLOT_STEP_MIN) {
    const local = { start: t, end: t + service.durationMin };
    const start = midnight + t * 60000;
    const occupied = { start, end: midnight + (local.end + CLEANUP_MIN) * 60000 };
    if (start <= current) continue;
    if (day.breaks.some((pause) => overlaps(local, { start: toMinutes(pause.from), end: toMinutes(pause.to) }))) continue;
    if (busy.some((booking) => overlaps(occupied, booking))) continue;
    result.push(fromMinutes(t));
  }
  return result;
}
