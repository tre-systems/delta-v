import Anthropic from '@anthropic-ai/sdk';

// Minimal local types matching llm-player.ts AgentTurnInput
interface AgentTurnInput {
  version: 1;
  gameCode: string;
  playerId: 0 | 1;
  state: {
    phase: string;
    turnNumber: number;
    activePlayer: number;
  };
  candidates: unknown[];
  recommendedIndex: number;
  summary?: string;
  legalActionInfo?: {
    phase: string;
    allowedTypes: string[];
    burnDirections: string[];
    ownShips: Array<{
      id: string;
      type: string;
      position: { q: number; r: number };
      velocity: { dq: number; dr: number };
      fuel: number;
      lifecycle: string;
      canBurn: boolean;
      canOverload: boolean;
      canAttack: boolean;
      canLaunchOrdnance: boolean;
      cargoUsed: number;
      cargoCapacity: number;
      disabledTurns: number;
    }>;
    enemies: Array<{
      id: string;
      type: string;
      position: { q: number; r: number };
      velocity: { dq: number; dr: number };
      lifecycle: string;
      detected: boolean;
    }>;
  };
}

interface AgentTurnResponse {
  candidateIndex: number;
  chat?: string;
}

const GAME_RULES = `
Delta-V is a 2-player tactical space combat game played on a hex grid.

MOVEMENT (astrogation phase):
- Ships have position and velocity (hex vector). Each turn you choose a burn direction (E/NE/NW/W/SW/SE) or coast.
- Next position = current position + current velocity + burn. Velocity persists (inertia).
- Overload burns cost 2 fuel and add extra delta-v.
- Plan your trajectory across multiple turns — you can't stop instantly.
- Gravity: landing on a celestial body requires low velocity and correct approach.

OBJECTIVES:
- Each player has a home body and a target body. You win by landing a ship on the opponent's target (or defending your own).
- Secondary: destroy all enemy ships.

PHASES each turn:
1. fleetBuilding — buy ships with credits (one-time, start of game)
2. astrogation — simultaneous movement orders for all your ships
3. ordnance — launch torpedoes, mines, or nukes (or skip)
4. combat — resolve attacks between ships in range (or skip)
5. logistics — transfer fuel/cargo between adjacent ships (or skip)

COMBAT:
- Attacks are probabilistic. More attackers vs one target = better odds.
- Ships have HP; reaching 0 disables then destroys. Disabled ships can still be attacked.
- Ordnance (torpedoes, mines) intercepts ships along trajectories.

SHIPS (common types):
- Frigate: balanced attack/defence, moderate fuel
- Destroyer: fast, low HP
- Cruiser: high HP, heavy attack, slow
- Carrier: cargo-heavy, launches fighters
- Base: immobile, high HP, defensive only

STRATEGY TIPS:
- Use gravity assists and coasting to conserve fuel for tactical burns.
- Control approaches to objective bodies early.
- Don't overcommit to combat if you can win on objectives.
- Ordnance is powerful but limited — save for high-value targets.
`.trim();

const buildPrompt = (input: AgentTurnInput): string => {
  const lines: string[] = [];

  lines.push(GAME_RULES);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`You are Player ${input.playerId} in game ${input.gameCode}.`);
  lines.push(`Phase: ${input.state.phase}, Turn: ${input.state.turnNumber}`);

  if (input.summary) {
    lines.push('');
    lines.push('CURRENT GAME STATE:');
    lines.push(input.summary);
  }

  if (input.legalActionInfo) {
    const info = input.legalActionInfo;
    lines.push('');
    lines.push(`LEGAL ACTIONS (phase: ${info.phase})`);
    lines.push(`Allowed action types: ${info.allowedTypes.join(', ')}`);

    if (info.ownShips.length > 0) {
      lines.push('Your ships:');
      for (const ship of info.ownShips) {
        const flags = [
          ship.canBurn ? 'can-burn' : null,
          ship.canOverload ? 'can-overload' : null,
          ship.canAttack ? 'can-attack' : null,
          ship.canLaunchOrdnance ? 'can-launch-ordnance' : null,
          ship.disabledTurns > 0 ? `disabled-${ship.disabledTurns}T` : null,
        ]
          .filter(Boolean)
          .join(', ');
        lines.push(
          `  ${ship.id} (${ship.type}) at (${ship.position.q},${ship.position.r}) vel(${ship.velocity.dq},${ship.velocity.dr}) fuel:${ship.fuel} [${flags || ship.lifecycle}]`,
        );
      }
    }

    if (info.enemies.length > 0) {
      lines.push('Enemy ships:');
      for (const enemy of info.enemies) {
        const detected = enemy.detected ? '' : ' (undetected)';
        lines.push(
          `  ${enemy.id} (${enemy.type}) at (${enemy.position.q},${enemy.position.r}) vel(${enemy.velocity.dq},${enemy.velocity.dr})${detected}`,
        );
      }
    }
  }

  lines.push('');
  lines.push(`CANDIDATE ACTIONS (${input.candidates.length} options):`);
  lines.push(
    'The summary above already lists them with descriptions. Candidate [0] is recommended by the built-in AI.',
  );
  lines.push('');
  lines.push(
    'Choose the best candidate index (0-based). Respond with JSON only:',
  );
  lines.push(
    '{"candidateIndex": <number>, "chat": "<optional short taunt/comment max 100 chars>"}',
  );
  lines.push('');
  lines.push(
    'No markdown, no explanation outside the JSON. The chat field is optional — only include it if you have something memorable to say.',
  );

  return lines.join('\n');
};

const extractResponse = (
  content: string,
  fallback: number,
): AgentTurnResponse => {
  const trimmed = content.trim();

  // Try to parse the whole response as JSON
  try {
    const parsed = JSON.parse(trimmed) as {
      candidateIndex?: number;
      chat?: string;
    };
    if (
      typeof parsed.candidateIndex === 'number' &&
      Number.isInteger(parsed.candidateIndex) &&
      parsed.candidateIndex >= 0
    ) {
      return {
        candidateIndex: parsed.candidateIndex,
        chat:
          typeof parsed.chat === 'string' && parsed.chat.trim()
            ? parsed.chat.trim().slice(0, 200)
            : undefined,
      };
    }
  } catch {
    // fall through
  }

  // Try to find a JSON block in the response
  const jsonMatch = trimmed.match(
    /\{[^{}]*"candidateIndex"\s*:\s*(\d+)[^{}]*\}/,
  );
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        candidateIndex?: number;
        chat?: string;
      };
      if (
        typeof parsed.candidateIndex === 'number' &&
        parsed.candidateIndex >= 0
      ) {
        return {
          candidateIndex: parsed.candidateIndex,
          chat:
            typeof parsed.chat === 'string' && parsed.chat.trim()
              ? parsed.chat.trim().slice(0, 200)
              : undefined,
        };
      }
    } catch {
      // fall through
    }
  }

  // Try to find just a number
  const numMatch = trimmed.match(/\b(\d+)\b/);
  if (numMatch) {
    return { candidateIndex: Number.parseInt(numMatch[1], 10) };
  }

  return { candidateIndex: fallback };
};

const main = async (): Promise<void> => {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk.toString());
  }

  const raw = chunks.join('').trim();
  const fallbackIndex = 0;

  if (!raw) {
    process.stdout.write(JSON.stringify({ candidateIndex: fallbackIndex }));
    return;
  }

  let input: AgentTurnInput;
  try {
    input = JSON.parse(raw) as AgentTurnInput;
  } catch {
    process.stdout.write(JSON.stringify({ candidateIndex: fallbackIndex }));
    return;
  }

  const recommended =
    typeof input.recommendedIndex === 'number' &&
    Number.isInteger(input.recommendedIndex) &&
    input.recommendedIndex >= 0
      ? input.recommendedIndex
      : fallbackIndex;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      'ANTHROPIC_API_KEY not set, falling back to recommended\n',
    );
    process.stdout.write(JSON.stringify({ candidateIndex: recommended }));
    return;
  }

  try {
    const client = new Anthropic({ apiKey });
    const prompt = buildPrompt(input);

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = message.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      process.stdout.write(JSON.stringify({ candidateIndex: recommended }));
      return;
    }

    const response = extractResponse(textContent.text, recommended);

    // Clamp to valid range
    const clampedIndex =
      response.candidateIndex >= 0 &&
      response.candidateIndex < input.candidates.length
        ? response.candidateIndex
        : recommended;

    process.stdout.write(
      JSON.stringify({ candidateIndex: clampedIndex, chat: response.chat }),
    );
  } catch (error) {
    process.stderr.write(
      `Claude API error, falling back to recommended: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.stdout.write(JSON.stringify({ candidateIndex: recommended }));
  }
};

void main().catch((error: unknown) => {
  process.stderr.write(
    `Fatal error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.stdout.write(JSON.stringify({ candidateIndex: 0 }));
  process.exitCode = 1;
});
