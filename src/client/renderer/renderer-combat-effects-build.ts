import { hexToPixel, type PixelCoord, parseHexKey } from '../../shared/hex';
import type {
  CombatResult,
  GameState,
  SolarSystemMap,
} from '../../shared/types/domain';
import { getCombatTargetEntity } from './combat';
import type { CombatEffect } from './effects';

function pixelFromBaseRef(
  baseRef: string,
  map: SolarSystemMap | null,
  hexSize: number,
): PixelCoord | null {
  if (baseRef.includes(',')) {
    return hexToPixel(parseHexKey(baseRef), hexSize);
  }
  if (!map) return null;
  const baseEntry = [...map.hexes.entries()].find(
    ([, hex]) => hex.base?.bodyName === baseRef,
  );
  return baseEntry ? hexToPixel(parseHexKey(baseEntry[0]), hexSize) : null;
}

function resolveAttackerPixel(
  firstId: string,
  gameState: GameState | null,
  map: SolarSystemMap | null,
  hexSize: number,
): PixelCoord | null {
  if (!firstId.startsWith('base:')) {
    const attacker = gameState?.ships.find((s) => s.id === firstId);
    return attacker ? hexToPixel(attacker.position, hexSize) : null;
  }
  return pixelFromBaseRef(firstId.slice(5), map, hexSize);
}

function beamColorForAttack(
  firstId: string,
  damageType: CombatResult['damageType'],
): string {
  if (firstId.startsWith('base:')) return '#66bb6a';
  if (damageType === 'eliminated') return '#ff4444';
  if (damageType === 'disabled') return '#ffaa00';
  return '#4fc3f7';
}

function pushAttackerBeamEffects(
  out: CombatEffect[],
  r: CombatResult,
  targetPos: PixelCoord,
  attackerPos: PixelCoord,
  now: number,
): void {
  const firstId = r.attackerIds[0];
  if (!firstId || r.attackType === 'asteroidHazard') return;
  out.push({
    type: 'beam',
    from: attackerPos,
    to: targetPos,
    startTime: now,
    duration: 600,
    color: beamColorForAttack(firstId, r.damageType),
  });
}

function pushDamageExplosion(
  out: CombatEffect[],
  targetPos: PixelCoord,
  now: number,
  damageType: CombatResult['damageType'],
): void {
  if (damageType === 'none') return;
  out.push({
    type: 'explosion',
    from: targetPos,
    to: targetPos,
    startTime: now + 300,
    duration: 800,
    color: damageType === 'eliminated' ? '#ff4444' : '#ffaa00',
  });
}

function pushCounterattackEffects(
  out: CombatEffect[],
  r: CombatResult,
  targetPos: PixelCoord,
  gameState: GameState | null,
  now: number,
  hexSize: number,
): void {
  const ca = r.counterattack;
  if (!ca || ca.damageType === 'none') return;
  const counterTarget = gameState?.ships.find((s) => s.id === ca.targetId);
  if (!counterTarget) return;
  const counterPos = hexToPixel(counterTarget.position, hexSize);
  out.push({
    type: 'beam',
    from: targetPos,
    to: counterPos,
    startTime: now + 500,
    duration: 600,
    color: ca.damageType === 'eliminated' ? '#ff4444' : '#ffaa00',
  });
  out.push({
    type: 'explosion',
    from: counterPos,
    to: counterPos,
    startTime: now + 800,
    duration: 800,
    color: ca.damageType === 'eliminated' ? '#ff4444' : '#ffaa00',
  });
}

function effectsForOneResult(
  r: CombatResult,
  gameState: GameState | null,
  previousState: GameState | null | undefined,
  map: SolarSystemMap | null,
  now: number,
  hexSize: number,
): CombatEffect[] {
  const local: CombatEffect[] = [];
  const target = getCombatTargetEntity(r, gameState, previousState ?? null);
  if (!target) return local;
  const targetPos = hexToPixel(target.position, hexSize);
  if (r.attackerIds.length > 0) {
    const firstId = r.attackerIds[0];
    const attackerPos = resolveAttackerPixel(firstId, gameState, map, hexSize);
    if (attackerPos) {
      pushAttackerBeamEffects(local, r, targetPos, attackerPos, now);
    }
  }
  pushDamageExplosion(local, targetPos, now, r.damageType);
  pushCounterattackEffects(local, r, targetPos, gameState, now, hexSize);
  return local;
}

/** Build beam / explosion effects for a batch of combat results (screen space). */
export function buildCombatEffectsForResults(
  results: CombatResult[],
  gameState: GameState | null,
  previousState: GameState | null | undefined,
  map: SolarSystemMap | null,
  now: number,
  hexSize: number,
): CombatEffect[] {
  const out: CombatEffect[] = [];
  for (const r of results) {
    out.push(
      ...effectsForOneResult(r, gameState, previousState, map, now, hexSize),
    );
  }
  return out;
}
