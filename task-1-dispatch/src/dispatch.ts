import { almatyDate } from '../../shared/time.ts';
import { assignBranch } from './router.ts';
import type { Assignment, Branch, Order } from './types.ts';

export function createDispatcher(branches: Branch[], orders: Order[], assignments = new Map<string, Assignment>()) {
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  function load(branchId: string, date: string): number {
    let count = 0;
    for (const assignment of assignments.values()) {
      const order = ordersById.get(assignment.orderId);
      if (assignment.branchId === branchId && order && almatyDate(order.createdAt) === date) count++;
    }
    return count;
  }
  return {
    load,
    assign(orderId: string): Assignment | null {
      const order = ordersById.get(orderId);
      if (!order) return null;
      const previous = assignments.get(orderId);
      if (previous) return previous;
      const date = almatyDate(order.createdAt);
      const assignment = assignBranch(order, branches, (id) => load(id, date));
      assignments.set(orderId, assignment);
      return assignment;
    },
  };
}
