import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { branches, orders, assignments } from './store.ts';
import { createDispatcher } from './dispatch.ts';
import { send } from '../../shared/http.ts';
import { isDate } from '../../shared/time.ts';
import { startServer } from '../../shared/start-server.ts';

export function createDispatchServer() {
  const dispatcher = createDispatcher(branches, orders, assignments);
  return createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, {
        service: 'dispatch',
        message: 'Backend API. Open the GET links in a browser; use an HTTP client for POST requests.',
        routes: ['GET /branches', 'GET /orders/o-101', 'POST /orders/o-101/assign', 'GET /branches/b-ala-1/load?date=2026-11-16'],
      });
      if (req.method === 'GET' && url.pathname === '/branches') return send(res, 200, branches);
      if (req.method === 'GET' && parts[0] === 'orders' && parts.length === 2) {
        const order = orders.find((o) => o.id === parts[1]);
        return order ? send(res, 200, order) : send(res, 404, { error: 'order_not_found' });
      }
      if (req.method === 'POST' && parts[0] === 'orders' && parts[2] === 'assign' && parts.length === 3) {
        const assignment = dispatcher.assign(parts[1]);
        return assignment ? send(res, 200, assignment) : send(res, 404, { error: 'order_not_found' });
      }
      if (req.method === 'GET' && parts[0] === 'branches' && parts[2] === 'load' && parts.length === 3) {
        const date = url.searchParams.get('date');
        if (!date || !isDate(date)) return send(res, 400, { error: 'invalid_date' });
        const branch = branches.find((b) => b.id === parts[1]);
        if (!branch) return send(res, 404, { error: 'branch_not_found' });
        return send(res, 200, { branchId: branch.id, date, assigned: dispatcher.load(branch.id, date), limit: branch.dailyLimit });
      }
      send(res, 404, { error: 'not_found' });
    } catch (error) {
      console.error(error);
      send(res, 500, { error: 'internal' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer(createDispatchServer(), 'dispatch', 3001);
}
