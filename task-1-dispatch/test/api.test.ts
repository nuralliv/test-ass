import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDispatchServer } from '../src/server.ts';
import { assignments } from '../src/store.ts';
import { listen, close } from '../../shared/test-server.ts';

test('dispatch HTTP API: idempotency, capacity and Almaty dates', async (t) => {
  assignments.clear();
  const server = createDispatchServer();
  const base = await listen(server);
  t.after(() => close(server));
  const index = await fetch(base);
  assert.equal(index.status, 200);
  assert.equal((await index.json()).service, 'dispatch');
  const assign = async (id: string) => {
    const response = await fetch(`${base}/orders/${id}/assign`, { method: 'POST' });
    return { status: response.status, body: await response.json() };
  };
  const responses = await Promise.all(Array.from({ length: 8 }, () => assign('o-101')));
  for (const response of responses) assert.deepEqual(response, {
    status: 200, body: { orderId: 'o-101', branchId: 'b-ala-1', rule: 'pickup_point' },
  });
  assert.equal((await assign('o-109')).body.branchId, 'b-ala-1');
  assert.equal((await assign('o-110')).body.branchId, 'b-ala-1');
  assert.deepEqual((await assign('o-111')).body, { orderId: 'o-111', branchId: 'b-ala-2', rule: 'geo' });
  assert.equal((await assign('o-112')).body.branchId, 'b-ala-1');
  assert.equal((await assign('o-113')).body.branchId, 'b-ala-1');
  const load = await fetch(`${base}/branches/b-ala-1/load?date=2026-11-16`);
  assert.equal(load.status, 200);
  assert.deepEqual(await load.json(), { branchId: 'b-ala-1', date: '2026-11-16', assigned: 3, limit: 3 });
  for (const date of ['2026-11-15', '2026-11-17']) {
    const response = await fetch(`${base}/branches/b-ala-1/load?date=${date}`);
    assert.equal((await response.json()).assigned, 1);
  }
  for (const suffix of ['', '?date=2026-02-29', '?date=2026-11-31', '?date=bad']) {
    assert.equal((await fetch(`${base}/branches/b-ala-1/load${suffix}`)).status, 400);
  }
  assert.equal((await fetch(`${base}/branches/missing/load?date=2026-11-16`)).status, 404);
  assert.equal((await assign('missing')).status, 404);
  assert.equal((await fetch(`${base}/orders/o-101`)).status, 200);
  assert.equal((await fetch(`${base}/orders/missing`)).status, 404);
  assert.equal((await fetch(`${base}/branches`)).status, 200);
});
