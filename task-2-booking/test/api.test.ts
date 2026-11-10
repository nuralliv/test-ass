import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBookingServer } from '../src/server.ts';
import { bookingRepo } from '../src/store.ts';
import { normalizePhone, parseStart } from '../src/booking.ts';
import { listen, close } from '../../shared/test-server.ts';

test('phone normalization accepts Kazakhstan mobile formats and rejects other numbers', () => {
  for (const phone of ['+7 701 234 56 78', '87012345678', '8 (701) 234-56-78', '77012345678']) {
    assert.equal(normalizePhone(phone), '+77012345678');
  }
  for (const phone of [null, 87012345678, '+79991234567', '+77271234567', '+17012345678', '7012345678', 'abc87012345678', '+87012345678']) {
    assert.throws(() => normalizePhone(phone));
  }
});

test('start requires a real date and explicit timezone', () => {
  const expected = Date.parse('2030-11-18T10:00:00Z');
  for (const start of ['2030-11-18T15:00:00+05:00', '2030-11-18T10:00Z', '2030-11-18T05:00:00-0500']) {
    assert.equal(parseStart(start), expected);
  }
  for (const start of ['2030-11-18T10:00:00', '2030-02-30T10:00:00Z', '2030-11-18T24:00Z', '2030-11-18T10:61Z', '2030-11-18T10:00+05:99', '', null]) {
    assert.throws(() => parseStart(start));
  }
});

test('booking HTTP API: validation, concurrency and cancellation', async (t) => {
  const originalNow = process.env.NOW;
  process.env.NOW = '2030-11-17T00:00:00Z';
  t.after(() => {
    if (originalNow === undefined) delete process.env.NOW;
    else process.env.NOW = originalNow;
  });
  const server = createBookingServer();
  const base = await listen(server);
  t.after(() => close(server));
  const index = await fetch(base);
  assert.equal(index.status, 200);
  assert.equal((await index.json()).service, 'booking');
  const input = { masterId: 'm-1', serviceId: 's-cut', start: '2030-11-18T15:00:00+05:00', clientPhone: '8 (701) 234-56-78' };
  const post = (body: unknown) => fetch(`${base}/bookings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const cancel = (id: string) => fetch(`${base}/bookings/${id}`, { method: 'DELETE' });

  await t.test('slots validate queries and respect existing bookings and breaks', async () => {
    const response = await fetch(`${base}/masters/m-1/slots?serviceId=s-cut&date=2030-11-18`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.masterId, 'm-1');
    assert.ok(!body.slots.includes('11:00'));
    assert.ok(body.slots.includes('11:15'));
    assert.ok(!body.slots.includes('14:00'));
    assert.ok(body.slots.includes('15:00'));
    for (const query of ['', '?date=2030-11-18', '?serviceId=s-cut', '?serviceId=s-cut&date=2030-02-30', '?serviceId=s-mani&date=2030-11-18']) {
      assert.equal((await fetch(`${base}/masters/m-1/slots${query}`)).status, 400);
    }
    assert.equal((await fetch(`${base}/masters/missing/slots?serviceId=s-cut&date=2030-11-18`)).status, 404);
    assert.equal((await fetch(`${base}/masters/m-1/slots?serviceId=missing&date=2030-11-18`)).status, 404);
  });

  await t.test('bad requests return 400 and unavailable slots return 409', async () => {
    assert.equal((await fetch(`${base}/bookings`, { method: 'POST', body: '{' })).status, 400);
    for (const body of [null, [], {}, { ...input, clientPhone: '123' }, { ...input, start: '2030-11-18' }]) {
      assert.equal((await post(body)).status, 400);
    }
    assert.equal((await post({ ...input, masterId: 'missing' })).status, 404);
    assert.equal((await post({ ...input, serviceId: 'missing' })).status, 404);
    assert.equal((await post({ ...input, serviceId: 's-mani' })).status, 400);
    for (const start of ['2030-11-18T15:01:00+05:00', '2030-11-18T15:00:01+05:00', '2030-11-18T15:00:00.001+05:00', '2030-11-18T14:00:00+05:00', '2030-11-18T10:00:00+05:00']) {
      const response = await post({ ...input, start });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: 'slot_unavailable' });
    }
  });

  let createdId = '';
  await t.test('eight simultaneous requests create exactly one booking', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => post(input)));
    assert.equal(responses.filter((r) => r.status === 201).length, 1);
    assert.equal(responses.filter((r) => r.status === 409).length, 7);
    for (const response of responses) {
      const body = await response.json();
      if (response.status === 409) assert.deepEqual(body, { error: 'slot_unavailable' });
      else {
        createdId = body.id;
        assert.equal(body.start, '2030-11-18T10:00:00.000Z');
        assert.equal(body.end, '2030-11-18T11:00:00.000Z');
        assert.equal(body.clientPhone, '+77012345678');
        assert.equal(body.status, 'active');
      }
    }
    const saved = await bookingRepo.listByMaster('m-1');
    assert.equal(saved.filter((b) => b.start === '2030-11-18T10:00:00.000Z' && b.status === 'active').length, 1);
  });

  await t.test('cancellation rejects less than two hours, permits exactly two, and is idempotent', async () => {
    process.env.NOW = '2030-11-18T08:00:00.001Z';
    const tooLate = await cancel(createdId);
    assert.equal(tooLate.status, 409);
    assert.deepEqual(await tooLate.json(), { error: 'too_late' });
    process.env.NOW = '2030-11-18T08:00:00Z';
    const cancelled = await cancel(createdId);
    assert.equal(cancelled.status, 200);
    const body = await cancelled.json();
    assert.equal(body.status, 'cancelled');
    process.env.NOW = '2030-11-18T11:00:00Z';
    const repeated = await cancel(createdId);
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), body);
    assert.equal((await cancel('missing')).status, 404);
    process.env.NOW = '2030-11-17T00:00:00Z';
    assert.equal((await post(input)).status, 201);
  });

  await t.test('overlapping starts also serialize and locks release after conflicts', async () => {
    const responses = await Promise.all([
      post({ ...input, start: '2030-11-19T10:00:00+05:00' }),
      post({ ...input, start: '2030-11-19T10:15:00+05:00' }),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await post({ ...input, start: '2030-11-19T12:00:00+05:00' })).status, 201);
  });
});
