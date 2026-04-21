import type { S2C } from '../../shared/types/protocol';

export const broadcastMessage = (
  sockets: {
    getWebSockets: (tag?: string) => WebSocket[];
  },
  msg: S2C,
) => {
  const data = JSON.stringify(msg);

  for (const ws of sockets.getWebSockets()) {
    try {
      ws.send(data);
    } catch {}
  }
};
