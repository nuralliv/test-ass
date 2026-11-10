import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getSlots } from '../src/slots.ts';
import { overlaps, toMinutes } from '../src/time.ts';
import type { Booking, Master, Service } from '../src/types.ts';

const originalNow = process.env.NOW;
beforeEach(() => { process.env.NOW = '2030-11-17T00:00:00Z'; });
afterEach(() => {
  if (originalNow === undefined) delete process.env.NOW;
  else process.env.NOW = originalNow;
});

const day = { from: '10:00', to: '13:00', breaks: [] };

const master: Master = {
  id: 'm-1',
  name: 'Тест',
  schedule: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: null, sun: null },
};

const cut: Service = { id: 's-cut', name: 'Стрижка', durationMin: 60, masterIds: ['m-1'] };

const range = (from: string, to: string) => ({ start: toMinutes(from), end: toMinutes(to) });

test('overlaps: пересекающиеся интервалы', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('10:30', '11:30')), true);
});

test('overlaps: запись сразу после другой не пересекается', () => {
  assert.equal(overlaps(range('10:00', '11:00'), range('11:00', '12:00')), false);
});

test('getSlots: свободный день', () => {
  const slots = getSlots(master, cut, '2030-11-18', []);
  assert.deepEqual(slots, ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45', '12:00']);
});

test('getSlots: выходной', () => {
  assert.deepEqual(getSlots(master, cut, '2030-11-23', []), []);
});

test('getSlots: слот не пересекает перерыв', () => {
  const withBreak = { ...master, schedule: { ...master.schedule, mon: { ...day, breaks: [{ from: '11:00', to: '12:00' }] } } };
  assert.deepEqual(getSlots(withBreak, cut, '2030-11-18', []), ['10:00', '12:00']);
});

const booking: Booking = {
  id: 'existing', masterId: 'm-1', serviceId: 's-cut',
  start: '2030-11-18T05:00:00Z', end: '2030-11-18T06:00:00Z',
  clientPhone: '+77012345678', status: 'active',
};

test('getSlots: занятое время не выдаётся, отменённые записи не мешают', () => {
  assert.deepEqual(getSlots(master, cut, '2030-11-18', [booking]), ['11:15', '11:30', '11:45', '12:00']);
  assert.equal(getSlots(master, cut, '2030-11-18', [{ ...booking, status: 'cancelled' }]).length, 9);
  assert.equal(getSlots(master, cut, '2030-11-18', [{ ...booking, masterId: 'other' }]).length, 9);
});

test('getSlots: прошедшее время не выдаётся', () => {
  process.env.NOW = '2030-11-18T06:00:00Z';
  assert.deepEqual(getSlots(master, cut, '2030-11-18', []), ['11:15', '11:30', '11:45', '12:00']);
});

test('cleanup is required before a later existing booking too', () => {
  const later = { ...booking, start: '2030-11-18T06:00:00Z', end: '2030-11-18T07:00:00Z' };
  assert.deepEqual(getSlots(master, cut, '2030-11-18', [later]), []);
});

test('seven-minute boundary and bookings crossing local midnight', () => {
  const previous = { ...booking, start: '2030-11-17T18:00:00Z', end: '2030-11-18T04:53:00Z' };
  assert.ok(getSlots(master, cut, '2030-11-18', [previous]).includes('10:00'));
  assert.ok(!getSlots(master, cut, '2030-11-18', [{ ...previous, end: '2030-11-18T04:54:00Z' }]).includes('10:00'));
});
