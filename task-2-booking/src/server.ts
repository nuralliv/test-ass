import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { masters, services, bookingRepo } from './store.ts';
import { getSlots } from './slots.ts';
import { createBooking, cancelBooking, resolveService } from './booking.ts';
import { HttpError, readJson, send } from '../../shared/http.ts';
import { isDate } from '../../shared/time.ts';
import { startServer } from '../../shared/start-server.ts';

export function createBookingServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, {
        service: 'booking',
        message: 'Backend API. Open the GET links in a browser; use an HTTP client for POST and DELETE requests.',
        routes: ['GET /masters', 'GET /services', 'GET /masters/m-1/slots?serviceId=s-cut&date=2030-11-18', 'POST /bookings', 'DELETE /bookings/:id'],
      });
      if (req.method === 'GET' && url.pathname === '/masters') return send(res, 200, masters);
      if (req.method === 'GET' && url.pathname === '/services') return send(res, 200, services);
      if (req.method === 'GET' && parts[0] === 'masters' && parts[2] === 'slots' && parts.length === 3) {
        const serviceId = url.searchParams.get('serviceId');
        const date = url.searchParams.get('date');
        if (!serviceId || !date || !isDate(date)) throw new HttpError(400, 'invalid_query');
        const { master, service } = resolveService(parts[1], serviceId);
        const slots = getSlots(master, service, date, await bookingRepo.listByMaster(master.id));
        return send(res, 200, { masterId: master.id, serviceId, date, slots });
      }
      if (req.method === 'POST' && url.pathname === '/bookings') {
        return send(res, 201, await createBooking(await readJson(req)));
      }
      if (req.method === 'DELETE' && parts[0] === 'bookings' && parts.length === 2) {
        return send(res, 200, await cancelBooking(parts[1]));
      }
      send(res, 404, { error: 'not_found' });
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message });
      console.error(error);
      send(res, 500, { error: 'internal' });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer(createBookingServer(), 'booking', 3002);
}
