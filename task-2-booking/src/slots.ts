import type { Booking, Master, Service } from './types.ts';
import { fromMinutes, toMinutes, weekday } from './time.ts';

export const SLOT_STEP_MIN = 15;

// Свободные слоты мастера на дату, 'HH:mm' по Алматы
export function getSlots(master: Master, service: Service, date: string, bookings: Booking[]): string[] {
  const day = master.schedule[weekday(date)];
  if (!day) return [];

  const result: string[] = [];
  const end = toMinutes(day.to);
  for (let t = toMinutes(day.from); t + service.durationMin <= end; t += SLOT_STEP_MIN) {
    result.push(fromMinutes(t));
  }

  // TODO: перерывы, существующие записи, прошедшее время
  return result;
}
