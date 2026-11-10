import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export function startServer(server: Server, name: string, defaultPort: number): void {
  const value = process.env.PORT ?? String(defaultPort);
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port > 65535) {
    console.error(`${name}: PORT must be an integer between 0 and 65535.`);
    process.exitCode = 1;
    return;
  }
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE'
      ? `${name}: port ${port} is already in use. Stop the existing server (Ctrl+C in its terminal), then start again.`
      : `${name}: could not start server: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, () => {
    const address = server.address() as AddressInfo;
    console.log(`${name}: http://localhost:${address.port}`);
  });
}
