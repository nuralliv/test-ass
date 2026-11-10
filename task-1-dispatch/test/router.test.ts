import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignBranch } from '../src/router.ts';
import { distanceKm } from '../src/geo.ts';
import { createDispatcher } from '../src/dispatch.ts';
import { isDate } from '../../shared/time.ts';
import type { Branch, Order } from '../src/types.ts';

const branch = (over: Partial<Branch>): Branch => ({
  id: 'b-1',
  storeId: 's-1',
  name: 'Филиал',
  city: 'Алматы',
  lat: 43.24,
  lon: 76.91,
  active: true,
  pickupPointIds: [],
  dailyLimit: 100,
  ...over,
});

const order = (over: Partial<Order>): Order => ({
  id: 'o-1',
  storeId: 's-1',
  city: 'Алматы',
  lat: 43.25,
  lon: 76.92,
  pickupPointId: null,
  manualBranchId: null,
  createdAt: '2026-11-16T06:00:00Z',
  ...over,
});

const almaty = branch({ id: 'b-ala', city: 'Алматы', lat: 43.2567, lon: 76.9286 });
const astana = branch({ id: 'b-ast', city: 'Астана', lat: 51.128, lon: 71.43 });

test('distanceKm: Алматы — Астана около 970 км', () => {
  const d = distanceKm(43.2389, 76.8897, 51.1694, 71.4491);
  assert.ok(Math.abs(d - 970) < 15, `получили ${d.toFixed(1)}`);
});

test('manual: заказ уходит в указанный филиал', () => {
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ast', rule: 'manual' });
});

test('manual: неактивный филиал пропускается', () => {
  const closed = { ...astana, active: false };
  const res = assignBranch(order({ manualBranchId: 'b-ast' }), [almaty, closed]);
  assert.notEqual(res.rule, 'manual');
});

test('single: у магазина один активный филиал', () => {
  const res = assignBranch(order({ city: 'Шымкент' }), [almaty]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'single' });
});

test('geo: выбирается ближайший филиал', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: 43.25, lon: 76.93 }), [almaty, astana]);
  assert.deepEqual(res, { orderId: 'o-1', branchId: 'b-ala', rule: 'geo' });
});

test('geo: без координат заказ не распределяется', () => {
  const res = assignBranch(order({ city: 'Конаев', lat: null, lon: null }), [almaty, astana]);
  assert.equal(res.rule, 'unassigned');
});

test('pickup_point: пункт выдачи закреплён за филиалом', () => {
  const pickup = { ...astana, pickupPointIds: ['pp'] };
  assert.deepEqual(assignBranch(order({ pickupPointId: 'pp' }), [almaty, pickup]),
    { orderId: 'o-1', branchId: 'b-ast', rule: 'pickup_point' });
});

test('city: в городе заказа один филиал магазина', () => {
  assert.equal(assignBranch(order({ lat: null, lon: null }), [almaty, astana]).rule, 'city');
});

test('geo: если в городе несколько филиалов, выбирается ближайший из них', () => {
  const closerOutside = branch({ id: 'outside', city: 'Другое', lat: 43.25, lon: 76.92 });
  const farther = branch({ id: 'farther', lat: 43.3 });
  assert.equal(assignBranch(order({}), [closerOutside, almaty, farther]).branchId, almaty.id);
});

test('лимит: заполненный филиал пропускается', () => {
  const nearby = branch({ id: 'nearby', city: 'Другое' });
  const result = assignBranch(order({}), [almaty, nearby], (id) => id === almaty.id ? 100 : 0);
  assert.deepEqual(result, { orderId: 'o-1', branchId: 'nearby', rule: 'geo' });
  assert.equal(assignBranch(order({}), [almaty, nearby], () => 100).rule, 'unassigned');
});

test('manual ignores capacity but never selects another store or an inactive branch', () => {
  assert.equal(assignBranch(order({ manualBranchId: astana.id }), [almaty, astana], () => 100).rule, 'manual');
  assert.equal(assignBranch(order({ manualBranchId: astana.id }), [almaty, { ...astana, storeId: 'other' }]).branchId, almaty.id);
  assert.equal(assignBranch(order({}), [{ ...almaty, active: false }]).rule, 'unassigned');
});

test('single precedes pickup; manual precedes single', () => {
  assert.equal(assignBranch(order({ pickupPointId: 'pp' }), [{ ...almaty, pickupPointIds: ['pp'] }]).rule, 'single');
  assert.equal(assignBranch(order({ manualBranchId: almaty.id }), [almaty]).rule, 'manual');
});

test('geo rejects distances beyond 42 km, including capacity fallback', () => {
  assert.equal(assignBranch(order({ city: 'other', lat: 44 }), [almaty, astana]).rule, 'too_far');
  assert.equal(assignBranch(order({}), [almaty, astana], (id) => id === almaty.id ? 100 : 0).rule, 'too_far');
  assert.equal(assignBranch(order({ lat: null, lon: null }), [almaty], () => 100).rule, 'unassigned');
});

test('dispatch caches assignments and counts manual assignments on the Almaty day', () => {
  const one = { ...almaty, dailyLimit: 1 };
  const inputs = [
    order({ id: 'a', createdAt: '2026-11-15T18:59:59Z' }),
    order({ id: 'b', createdAt: '2026-11-15T19:00:00Z' }),
    order({ id: 'c', manualBranchId: one.id }),
    order({ id: 'd' }),
  ];
  const dispatcher = createDispatcher([one], inputs);
  assert.equal(dispatcher.assign('a')?.branchId, one.id);
  const b = dispatcher.assign('b');
  assert.deepEqual(dispatcher.assign('b'), b);
  assert.equal(dispatcher.load(one.id, '2026-11-16'), 1);
  assert.equal(dispatcher.assign('c')?.rule, 'manual');
  assert.equal(dispatcher.load(one.id, '2026-11-16'), 2);
  assert.equal(dispatcher.assign('d')?.rule, 'unassigned');
  assert.equal(dispatcher.load(one.id, '2026-11-15'), 1);
  assert.equal(dispatcher.assign('missing'), null);
});

test('calendar dates reject rollover and accept leap days', () => {
  for (const value of ['', '2026-2-01', '2026-02-29', '2026-04-31', '2026-13-01']) assert.equal(isDate(value), false);
  assert.equal(isDate('2028-02-29'), true);
});
