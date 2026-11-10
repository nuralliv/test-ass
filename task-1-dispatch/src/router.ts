import type { Assignment, Branch, Order, Rule } from './types.ts';
import { distanceKm } from './geo.ts';

export const MAX_DISTANCE_KM = 42;

export function assignBranch(order: Order, branches: Branch[], load: (branchId: string) => number = () => 0): Assignment {
  const own = branches.filter((b) => b.storeId === order.storeId && b.active);
  const result = (branchId: string | null, rule: Rule): Assignment => ({ orderId: order.id, branchId, rule });
  const available = (b: Branch) => load(b.id) < b.dailyLimit;
  const geo = (candidates: Branch[]): Assignment => {
    const nearest = findNearest(order, candidates);
    if (!nearest) return result(null, 'unassigned');
    return nearest.distance > MAX_DISTANCE_KM ? result(null, 'too_far') : result(nearest.branch.id, 'geo');
  };
  const select = (branch: Branch, rule: Rule): Assignment => available(branch)
    ? result(branch.id, rule)
    : geo(own.filter(available));

  const manual = own.find((b) => b.id === order.manualBranchId);
  if (manual) return result(manual.id, 'manual');
  if (own.length === 1) return select(own[0], 'single');
  const pickup = order.pickupPointId && own.find((b) => b.pickupPointIds.includes(order.pickupPointId!));
  if (pickup) return select(pickup, 'pickup_point');
  const city = own.filter((b) => b.city === order.city);
  if (city.length === 1) return select(city[0], 'city');
  const nearest = findNearest(order, city.length > 1 ? city : own);
  if (!nearest) return result(null, 'unassigned');
  if (!available(nearest.branch)) return geo(own.filter(available));
  return geo([nearest.branch]);
}

function findNearest(order: Order, branches: Branch[]): { branch: Branch; distance: number } | null {
  if (order.lat === null || order.lon === null || !Number.isFinite(order.lat) || !Number.isFinite(order.lon)) return null;
  let best: { branch: Branch; distance: number } | null = null;
  for (const branch of branches) {
    const distance = distanceKm(order.lat, order.lon, branch.lat, branch.lon);
    if (Number.isFinite(distance) && (!best || distance < best.distance)) best = { branch, distance };
  }
  return best;
}
