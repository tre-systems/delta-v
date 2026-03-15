import WebSocket from 'ws';
import { SCENARIOS } from '../src/shared/map-data';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8787';

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class BotClient {
  private ws: WebSocket | null = null;
  private id: string;
  private gameCode: string;
  private playerId: number = -1;

  constructor(id: string, gameCode: string) {
    this.id = id;
    this.gameCode = gameCode;
  }

  async connect() {
    const wsUrl = SERVER_URL.replace('http', 'ws') + `/ws/${this.gameCode}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      // console.log(`[Bot ${this.id}] Connected`);
    });

    this.ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        await this.handleMessage(msg);
      } catch (err) {
        console.error(`[Bot ${this.id}] Message parse error:`, err);
      }
    });

    this.ws.on('close', () => {
      // console.log(`[Bot ${this.id}] Disconnected`);
    });

    this.ws.on('error', (err) => {
      console.error(`[Bot ${this.id}] WebSocket Error:`, err);
    });
  }

  private send(msg: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async handleMessage(msg: any) {
    if (msg.type === 'welcome') {
      this.playerId = msg.playerId;
    } else if (msg.type === 'gameStart' || msg.type === 'movementResult' || msg.type === 'combatResult' || msg.type === 'stateUpdate') {
      const state = msg.state;
      if (!state) return;

      if (state.phase === 'gameOver') {
        console.log(`[Bot ${this.id}] Game Over. Winner: ${msg.winner || state.winner}`);
        this.ws?.close();
        return;
      }

      // Check if it's our turn
      if (state.activePlayer === this.playerId) {
        // Wait simulated reaction time
        await delay(300 + Math.random() * 700);
        
        if (state.phase === 'astrogation') {
          // Submit empty burns (just pass the turn)
          const myShips = state.ships.filter((s: any) => s.owner === this.playerId && !s.destroyed);
          const orders = myShips.map((s: any) => ({ shipId: s.id, burn: null }));
          this.send({ type: 'astrogation', orders });
        } else if (state.phase === 'ordnance') {
          this.send({ type: 'skipOrdnance' });
        } else if (state.phase === 'combat') {
          this.send({ type: 'skipCombat' });
        }
      }
    } else if (msg.type === 'ping') {
      this.send({ type: 'pong', t: msg.t });
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function spawnGame(botPairId: number) {
  // 1. Create a game lobby
  let code = '';
  try {
    const res = await fetch(`${SERVER_URL}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'biplanetary' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: any = await res.json();
    code = data.code;
  } catch (err: any) {
    console.error(`[Pair ${botPairId}] Failed to create game: ${err.message}`);
    return;
  }

  console.log(`[Pair ${botPairId}] Created game ${code}. Spawning bots...`);

  const bot1 = new BotClient(`P${botPairId}A`, code);
  const bot2 = new BotClient(`P${botPairId}B`, code);

  await bot1.connect();
  // Small delay so bot2 definitely gets assigned player 1
  await delay(100);
  await bot2.connect();
}

async function main() {
  const args = process.argv.slice(2);
  const concurrentGames = parseInt(args[0] || '10', 10);
  const spawnDelayMs = 250; 

  console.log(`Starting Load Test: ${concurrentGames} concurrent games`);

  for (let i = 0; i < concurrentGames; i++) {
    spawnGame(i).catch(console.error);
    await delay(spawnDelayMs);
  }
}

main().catch(console.error);
