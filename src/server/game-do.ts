import { DurableObject } from 'cloudflare:workers';
import type {
  GameState, Ship, C2S, S2C, AstrogationOrder, ShipMovement,
} from '../shared/types';
import { computeCourse } from '../shared/movement';
import { getSolarSystemMap, SCENARIOS, findBaseHex } from '../shared/map-data';
import { SHIP_STATS, INACTIVITY_TIMEOUT_MS } from '../shared/constants';

export interface Env {
  ASSETS: Fetcher;
  GAME: DurableObjectNamespace;
}

export class GameDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  // --- Helpers for WebSocket tag-based player tracking ---

  private getPlayerSockets(): Map<number, WebSocket> {
    const result = new Map<number, WebSocket>();
    for (const ws of this.ctx.getWebSockets()) {
      const tag = this.ctx.getTags(ws).find(t => t.startsWith('player:'));
      if (tag) {
        const id = parseInt(tag.split(':')[1]);
        result.set(id, ws);
      }
    }
    return result;
  }

  private getPlayerId(ws: WebSocket): number | null {
    const tag = this.ctx.getTags(ws).find(t => t.startsWith('player:'));
    return tag ? parseInt(tag.split(':')[1]) : null;
  }

  private getPlayerCount(): number {
    return this.ctx.getWebSockets('player:0').length
      + this.ctx.getWebSockets('player:1').length;
  }

  // --- State management via DO storage ---

  private async getGameState(): Promise<GameState | null> {
    return await this.ctx.storage.get<GameState>('gameState') ?? null;
  }

  private async saveGameState(state: GameState): Promise<void> {
    await this.ctx.storage.put('gameState', state);
  }

  private async getGameCode(): Promise<string> {
    return await this.ctx.storage.get<string>('gameCode') ?? '';
  }

  private async setGameCode(code: string): Promise<void> {
    await this.ctx.storage.put('gameCode', code);
  }

  // --- WebSocket lifecycle ---

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    // Extract code from URL
    const url = new URL(request.url);
    const codeMatch = url.pathname.match(/\/ws\/([A-Z0-9]{5})/);
    if (codeMatch) {
      await this.setGameCode(codeMatch[1]);
    }

    // Count current players
    const playerCount = this.getPlayerCount();
    if (playerCount >= 2) {
      return new Response('Game is full', { status: 409 });
    }

    // Assign next available player ID
    const playerId = this.ctx.getWebSockets('player:0').length === 0 ? 0 : 1;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept with a tag so we can identify this player after hibernation
    this.ctx.acceptWebSocket(server, [`player:${playerId}`]);

    // Send welcome
    const code = await this.getGameCode();
    this.send(server, { type: 'welcome', playerId, code });

    // Check if both players are now connected
    // +1 because the just-accepted socket may not yet appear in getWebSockets
    if (playerCount + 1 >= 2) {
      this.broadcast({ type: 'matchFound' });
      await this.initGame();
    }

    // Set inactivity alarm
    await this.ctx.storage.setAlarm(Date.now() + INACTIVITY_TIMEOUT_MS);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    let msg: C2S;
    try {
      msg = JSON.parse(message);
    } catch {
      this.send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    const playerId = this.getPlayerId(ws);
    if (playerId === null) return;

    // Reset inactivity alarm
    await this.ctx.storage.setAlarm(Date.now() + INACTIVITY_TIMEOUT_MS);

    switch (msg.type) {
      case 'astrogation':
        await this.handleAstrogation(playerId, ws, msg.orders);
        break;
      case 'rematch':
        await this.initGame();
        break;
      case 'ping':
        this.send(ws, { type: 'pong', t: msg.t });
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.broadcast({ type: 'opponentDisconnected' });
  }

  async alarm(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(1000, 'Inactivity timeout'); } catch {}
    }
    await this.ctx.storage.deleteAll();
  }

  // --- Game logic ---

  private async initGame() {
    const scenario = SCENARIOS.biplanetary;
    const map = getSolarSystemMap();
    const code = await this.getGameCode();

    const ships: Ship[] = [];
    for (let p = 0; p < scenario.players.length; p++) {
      for (let s = 0; s < scenario.players[p].ships.length; s++) {
        const def = scenario.players[p].ships[s];
        const stats = SHIP_STATS[def.type];
        const baseHex = findBaseHex(map, p === 0 ? 'Mars' : 'Venus');
        ships.push({
          id: `p${p}s${s}`,
          type: def.type,
          owner: p,
          position: baseHex ?? def.position,
          velocity: { ...def.velocity },
          fuel: stats.fuel,
          landed: true,
        });
      }
    }

    const gameState: GameState = {
      gameId: code,
      scenario: scenario.name,
      turnNumber: 1,
      phase: 'astrogation',
      activePlayer: 0,
      ships,
      players: [
        { connected: true, ready: true, targetBody: scenario.players[0].targetBody },
        { connected: true, ready: true, targetBody: scenario.players[1].targetBody },
      ],
      winner: null,
      winReason: null,
    };

    await this.saveGameState(gameState);
    this.broadcast({ type: 'gameStart', state: gameState });
  }

  private async handleAstrogation(playerId: number, ws: WebSocket, orders: AstrogationOrder[]) {
    const gameState = await this.getGameState();
    if (!gameState) return;

    if (gameState.phase !== 'astrogation') {
      this.send(ws, { type: 'error', message: 'Not in astrogation phase' });
      return;
    }
    if (playerId !== gameState.activePlayer) {
      this.send(ws, { type: 'error', message: 'Not your turn' });
      return;
    }

    const map = getSolarSystemMap();
    const movements: ShipMovement[] = [];

    for (const ship of gameState.ships) {
      if (ship.owner !== playerId) continue;

      const order = orders.find(o => o.shipId === ship.id);
      const burn = order?.burn ?? null;

      // Validate burn
      if (burn !== null) {
        if (burn < 0 || burn > 5) {
          this.send(ws, { type: 'error', message: 'Invalid burn direction' });
          return;
        }
        if (ship.fuel <= 0) {
          this.send(ws, { type: 'error', message: 'No fuel remaining' });
          return;
        }
      }

      const course = computeCourse(ship, burn, map);
      movements.push({
        shipId: ship.id,
        from: { ...ship.position },
        to: course.destination,
        path: course.path,
        newVelocity: course.newVelocity,
        fuelSpent: course.fuelSpent,
        gravityEffects: course.gravityEffects,
        crashed: course.crashed,
        landedAt: course.landedAt,
      });

      // Update ship
      ship.position = course.destination;
      ship.velocity = course.newVelocity;
      ship.fuel -= course.fuelSpent;
      ship.landed = course.landedAt !== null;

      if (course.crashed) {
        ship.velocity = { dq: 0, dr: 0 };
      }
    }

    // Check victory
    for (const ship of gameState.ships) {
      if (!ship.landed) continue;
      const targetBody = gameState.players[ship.owner].targetBody;
      const hex = map.hexes.get(`${ship.position.q},${ship.position.r}`);
      if (hex?.base?.bodyName === targetBody || hex?.body?.name === targetBody) {
        gameState.winner = ship.owner;
        gameState.winReason = `Landed on ${targetBody}!`;
        gameState.phase = 'gameOver';
      }
    }

    // Broadcast movement results
    this.broadcast({ type: 'movementResult', movements, state: gameState });

    if (gameState.phase === 'gameOver') {
      this.broadcast({
        type: 'gameOver',
        winner: gameState.winner!,
        reason: gameState.winReason!,
      });
      await this.saveGameState(gameState);
      return;
    }

    // Switch active player
    gameState.activePlayer = 1 - gameState.activePlayer;
    if (gameState.activePlayer === 0) {
      gameState.turnNumber++;
    }

    await this.saveGameState(gameState);
    this.broadcast({ type: 'stateUpdate', state: gameState });
  }

  // --- Messaging helpers ---

  private send(ws: WebSocket, msg: S2C) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }

  private broadcast(msg: S2C) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(data); } catch {}
    }
  }
}
