import { type RequestListener, type Server, createServer } from 'node:http';

/** Starts an HTTP server and resolves once it is listening (rejects on e.g. EADDRINUSE). */
export function listen(handler: RequestListener, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

/**
 * Stops accepting connections and waits for in-flight requests to finish. Idle keep-alive
 * connections are closed immediately; the graceful-shutdown timeout bounds slow requests.
 */
export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
