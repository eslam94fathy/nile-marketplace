import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { closeServer, listen } from '../../../../src/lib/http/http-server.js';

const ok = (_req: unknown, res: { end: (body: string) => void }) => res.end('ok');

describe('listen / closeServer', () => {
  it('listens on the port, serves requests, and closes', async () => {
    const server = await listen(ok, 0);
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(await response.text()).toBe('ok');

    await closeServer(server);
    expect(server.listening).toBe(false);
  });

  it('rejects when the port is already in use', async () => {
    const first = await listen(ok, 0);
    const { port } = first.address() as AddressInfo;

    await expect(listen(ok, port)).rejects.toMatchObject({ code: 'EADDRINUSE' });

    await closeServer(first);
  });

  it('closes even with idle keep-alive connections open', async () => {
    const server = await listen(ok, 0);
    const { port } = server.address() as AddressInfo;
    await fetch(`http://127.0.0.1:${port}/`, { keepalive: true });

    await expect(closeServer(server)).resolves.toBeUndefined();
  });
});
