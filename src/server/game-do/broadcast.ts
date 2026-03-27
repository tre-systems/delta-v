import { must } from '../../shared/assert';
import { filterStateForPlayer } from '../../shared/engine/game-engine';
import type { GameState } from '../../shared/types/domain';
import type { S2C } from '../../shared/types/protocol';
import { type StatefulServerMessage, toStateUpdateMessage } from './messages';

export const sendSocketMessage = (ws: WebSocket, msg: S2C) => {
  try {
    ws.send(JSON.stringify(msg));
  } catch {}
};

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

export const broadcastFilteredMessage = (
  sockets: {
    getWebSockets: (tag?: string) => WebSocket[];
  },
  msg: S2C & { state: GameState },
) => {
  const hasHiddenInfo =
    msg.state.scenarioRules.hiddenIdentityInspection ||
    msg.state.ships.some((ship) => ship.identity && !ship.identity.revealed);

  if (!hasHiddenInfo) {
    broadcastMessage(sockets, msg);
    return;
  }

  for (let playerId = 0; playerId < 2; playerId++) {
    const playerSockets = sockets.getWebSockets(`player:${playerId}`);

    if (playerSockets.length === 0) continue;

    const filteredMessage = {
      ...msg,
      state: filterStateForPlayer(msg.state, playerId),
    };
    const data = JSON.stringify(filteredMessage);

    for (const ws of playerSockets) {
      try {
        ws.send(data);
      } catch {}
    }
  }

  const spectatorSockets = sockets.getWebSockets('spectator');

  if (spectatorSockets.length === 0) {
    return;
  }

  const spectatorData = JSON.stringify({
    ...msg,
    state: filterStateForPlayer(msg.state, 'spectator'),
  });

  for (const ws of spectatorSockets) {
    try {
      ws.send(spectatorData);
    } catch {}
  }
};

export const broadcastStateChange = (
  sockets: {
    getWebSockets: (tag?: string) => WebSocket[];
  },
  state: GameState,
  primaryMessage?: StatefulServerMessage,
) => {
  broadcastFilteredMessage(
    sockets,
    primaryMessage ?? toStateUpdateMessage(state),
  );

  if (state.phase === 'gameOver') {
    broadcastMessage(sockets, {
      type: 'gameOver',
      winner: must(state.outcome).winner,
      reason: must(state.outcome).reason,
    });
  }
};
