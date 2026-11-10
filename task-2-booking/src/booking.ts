import { randomUUID } from 'node:crypto';
import { bookingRepo, masters, services } from './store.ts';
import { getSlots } from './slots.ts';
import { now } from './clock.ts';
import { TZ_OFFSET } from './time.ts';
import { almatyDate, isDate } from '../../shared/time.ts';
import { HttpError } from '../../shared/http.ts';
import type { Booking } from './types.ts';

const locks = new Map<string, Promise<void>>();
async function withMasterLock<T>(masterId: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(masterId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  locks.set(masterId, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (locks.get(masterId) === current) locks.delete(masterId);
  }
}

export function resolveService(masterId: string, serviceId: string) {
  const master = masters.find((m) => m.id === masterId);
  const service = services.find((s) => s.id === serviceId);
  if (!master) throw new HttpError(404, 'master_not_found');
  if (!service) throw new HttpError(404, 'service_not_found');
  if (!service.masterIds.includes(masterId)) throw new HttpError(400, 'service_not_supported');
  return { master, service };
}

export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' || !/^\+?[\d\s()-]+$/.test(value.trim())) throw new HttpError(400, 'invalid_phone');
  const digits = value.replace(/\D/g, '');
  if ((value.trim().startsWith('+') && !value.trim().startsWith('+7')) ||
      !/^[78](?:700|701|702|705|706|707|708|747|771|775|776|777|778)\d{7}$/.test(digits)) {
    throw new HttpError(400, 'invalid_phone');
  }
  return '+7' + digits.slice(1);
}

export function parseStart(value: unknown): number {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_start');
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})$/i.exec(value);
  if (!match || !isDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) {
    throw new HttpError(400, 'invalid_start');
  }
  const zone = match[6];
  if (zone.toUpperCase() !== 'Z') {
    const digits = zone.slice(1).replace(':', '');
    if (Number(digits.slice(0, 2)) > 23 || Number(digits.slice(2)) > 59) throw new HttpError(400, 'invalid_start');
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new HttpError(400, 'invalid_start');
  return timestamp;
}

export async function createBooking(input: unknown): Promise<Booking> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'invalid_body');
  const body = input as Record<string, unknown>;
  if (typeof body.masterId !== 'string' || !body.masterId || typeof body.serviceId !== 'string' || !body.serviceId) {
    throw new HttpError(400, 'invalid_body');
  }
  const { master, service } = resolveService(body.masterId, body.serviceId);
  const timestamp = parseStart(body.start);
  const clientPhone = normalizePhone(body.clientPhone);
  const date = almatyDate(timestamp);
  return withMasterLock(master.id, async () => {
    const bookings = await bookingRepo.listByMaster(master.id);
    const slots = getSlots(master, service, date, bookings);
    if (!slots.some((slot) => Date.parse(`${date}T${slot}:00${TZ_OFFSET}`) === timestamp)) {
      throw new HttpError(409, 'slot_unavailable');
    }
    const booking: Booking = {
      id: randomUUID(), masterId: master.id, serviceId: service.id,
      start: new Date(timestamp).toISOString(),
      end: new Date(timestamp + service.durationMin * 60000).toISOString(),
      clientPhone, status: 'active',
    };
    await bookingRepo.insert(booking);
    return booking;
  });
}

export async function cancelBooking(id: string): Promise<Booking> {
  const initial = await bookingRepo.get(id);
  if (!initial) throw new HttpError(404, 'booking_not_found');
  return withMasterLock(initial.masterId, async () => {
    const booking = await bookingRepo.get(id);
    if (!booking) throw new HttpError(404, 'booking_not_found');
    if (booking.status === 'cancelled') return booking;
    if (Date.parse(booking.start) - now().getTime() < 2 * 60 * 60 * 1000) throw new HttpError(409, 'too_late');
    await bookingRepo.update(id, { status: 'cancelled' });
    return { ...booking, status: 'cancelled' };
  });
}
