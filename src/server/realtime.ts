import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

interface ClientMeta {
  ws: WebSocket;
  userId?: number;
  role?: string;
}

const clients = new Set<ClientMeta>();

export function initRealtimeServer(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const client: ClientMeta = { ws };
    clients.add(client);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'auth' && typeof msg.userId === 'number') {
          client.userId = msg.userId;
          client.role = typeof msg.role === 'string' ? msg.role : undefined;
          ws.send(JSON.stringify({ type: 'connected', ts: new Date().toISOString() }));
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    ws.on('close', () => {
      clients.delete(client);
    });
  });

  return wss;
}

export function broadcastToUser(userId: number, event: string, payload: unknown) {
  const frame = JSON.stringify({ type: event, payload, ts: new Date().toISOString() });
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      if (client.userId === userId || client.role === 'super_admin') {
        client.ws.send(frame);
      }
    }
  }
}

export function broadcastGlobal(event: string, payload: unknown) {
  const frame = JSON.stringify({ type: event, payload, ts: new Date().toISOString() });
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(frame);
    }
  }
}
