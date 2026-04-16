import type { AgentTurnInput } from '../src/shared/agent';

export const GAME_RULES = `
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

export const buildDeltaVAgentPrompt = (input: AgentTurnInput): string => {
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
    'Choose the best candidate index and call submit_action with your decision.',
  );

  return lines.join('\n');
};
