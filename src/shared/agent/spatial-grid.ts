// ASCII hex-grid rendering for the Observation v2 payload. LLMs reason
// noticeably better about spatial relationships from a visual grid than
// from coordinate lists. Fog-of-war compliant: undetected enemies are
// omitted so agents can't exploit the observation.
//
// Coordinate convention: axial (q, r) flat-topped. We project to a
// staggered ASCII grid where each row r is indented by r spaces and each
// cell is 2 chars wide. That gives the characteristic diagonal lattice.

import type { HexCoord } from '../hex';
import { hexDistance } from '../hex';
import type {
  GameState,
  PlayerId,
  Ship,
  SolarSystemMap,
} from '../types/domain';

const VIEWPORT_PADDING = 2;

export interface SpatialGridOptions {
  // Maximum viewport half-width in hexes. Default 12, overridable for tiny
  // or huge maps. Grid caps so the string stays a few KB at most.
  maxRadius?: number;
}

interface Marker {
  char: string;
  legend: string;
}

const VELOCITY_ARROW: Record<string, string> = {
  '1,0': '►',
  '1,-1': '◥',
  '0,-1': '▲',
  '-1,0': '◄',
  '-1,1': '◣',
  '0,1': '▼',
};

const velocityArrow = (vel: { dq: number; dr: number }): string => {
  if (vel.dq === 0 && vel.dr === 0) return ' ';
  const dq = Math.sign(vel.dq);
  const dr = Math.sign(vel.dr);
  return VELOCITY_ARROW[`${dq},${dr}`] ?? '·';
};

const collectMarkers = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
): Map<string, Marker> => {
  const opponentId: PlayerId = playerId === 0 ? 1 : 0;
  const markers = new Map<string, Marker>();
  const key = (pos: HexCoord) => `${pos.q},${pos.r}`;

  // Celestial bodies (and gravity wells).
  for (const body of map.bodies) {
    markers.set(key(body.center), {
      char: '*',
      legend: `* ${body.name} at (${body.center.q},${body.center.r})`,
    });
  }

  // Home and target bodies override the generic '*' so agents can eyeball
  // objectives without scanning the legend.
  const player = state.players[playerId];
  if (player.homeBody) {
    const home = map.bodies.find((b) => b.name === player.homeBody);
    if (home) {
      markers.set(key(home.center), {
        char: 'H',
        legend: `H = your home: ${home.name} at (${home.center.q},${home.center.r})`,
      });
    }
  }
  if (player.targetBody) {
    const target = map.bodies.find((b) => b.name === player.targetBody);
    if (target) {
      markers.set(key(target.center), {
        char: 'T',
        legend: `T = your target: ${target.name} at (${target.center.q},${target.center.r})`,
      });
    }
  }

  // Gravity hexes. Rendered as '~' so agents can see gravity wells. Ship and
  // body markers placed later override these when they share a hex.
  for (const [hexKey, hexData] of map.hexes) {
    if (!hexData.gravity) continue;
    const existing = markers.get(hexKey);
    if (existing) continue; // body or home/target already placed here
    markers.set(hexKey, {
      char: '~',
      legend: '',
    });
  }

  // Ships. Own ships always visible; enemies only if detected.
  for (const ship of state.ships) {
    if (ship.lifecycle === 'destroyed') continue;
    const mine = ship.owner === playerId;
    if (!mine && ship.owner === opponentId && !ship.detected) continue;

    const marker = mine ? '@' : '!';
    const arrow = velocityArrow(ship.velocity);
    const char = arrow === ' ' ? marker : marker + arrow;
    const label = mine
      ? `@ ${ship.id} (${ship.type}) at (${ship.position.q},${ship.position.r}) vel=(${ship.velocity.dq},${ship.velocity.dr}) fuel=${ship.fuel}`
      : `! ${ship.id} (${ship.type}) at (${ship.position.q},${ship.position.r}) vel=(${ship.velocity.dq},${ship.velocity.dr})`;
    markers.set(key(ship.position), { char, legend: label });
  }

  // Active ordnance (both sides' visible ordnance).
  for (const ord of state.ordnance) {
    if (ord.lifecycle === 'destroyed') continue;
    const owner = ord.owner === playerId ? 'yours' : 'enemy';
    const existing = markers.get(key(ord.position));
    const char = existing ? existing.char : 'x';
    markers.set(key(ord.position), {
      char,
      legend: `x ${ord.type} (${owner}) at (${ord.position.q},${ord.position.r})`,
    });
  }

  return markers;
};

const computeViewport = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  maxRadius: number,
): { minQ: number; maxQ: number; minR: number; maxR: number } => {
  const opponentId: PlayerId = playerId === 0 ? 1 : 0;
  const points: HexCoord[] = [];

  for (const ship of state.ships) {
    if (ship.lifecycle === 'destroyed') continue;
    if (ship.owner === playerId) {
      points.push(ship.position);
      continue;
    }
    if (ship.owner === opponentId && ship.detected) points.push(ship.position);
  }

  // Include own target and home bodies so the viewport always shows them.
  const player = state.players[playerId];
  for (const bodyName of [player.homeBody, player.targetBody]) {
    if (!bodyName) continue;
    const body = map.bodies.find((b) => b.name === bodyName);
    if (body) points.push(body.center);
  }

  if (points.length === 0) return { minQ: -3, maxQ: 3, minR: -3, maxR: 3 };

  let minQ = Number.POSITIVE_INFINITY;
  let maxQ = Number.NEGATIVE_INFINITY;
  let minR = Number.POSITIVE_INFINITY;
  let maxR = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.q < minQ) minQ = p.q;
    if (p.q > maxQ) maxQ = p.q;
    if (p.r < minR) minR = p.r;
    if (p.r > maxR) maxR = p.r;
  }

  minQ -= VIEWPORT_PADDING;
  maxQ += VIEWPORT_PADDING;
  minR -= VIEWPORT_PADDING;
  maxR += VIEWPORT_PADDING;

  // Cap total size so the grid doesn't balloon for sparse layouts.
  const centroid = {
    q: Math.round((minQ + maxQ) / 2),
    r: Math.round((minR + maxR) / 2),
  };
  if (maxQ - minQ > maxRadius * 2) {
    minQ = centroid.q - maxRadius;
    maxQ = centroid.q + maxRadius;
  }
  if (maxR - minR > maxRadius * 2) {
    minR = centroid.r - maxRadius;
    maxR = centroid.r + maxRadius;
  }

  return { minQ, maxQ, minR, maxR };
};

// Render the axial grid as staggered ASCII. Each (q,r) occupies two chars
// so velocity arrows can sit next to their ship marker. Odd rows indent by
// one char to produce the diagonal hex lattice look.
export const renderSpatialGrid = (
  state: GameState,
  playerId: PlayerId,
  map: SolarSystemMap,
  options?: SpatialGridOptions,
): string => {
  const maxRadius = options?.maxRadius ?? 12;
  const { minQ, maxQ, minR, maxR } = computeViewport(
    state,
    playerId,
    map,
    maxRadius,
  );
  const markers = collectMarkers(state, playerId, map);

  const lines: string[] = [];
  for (let r = minR; r <= maxR; r++) {
    const parts: string[] = [];
    // Indent odd rows so the hex offset is visible.
    parts.push(' '.repeat(Math.abs(r - minR) % 2));
    for (let q = minQ; q <= maxQ; q++) {
      const m = markers.get(`${q},${r}`);
      if (m) {
        // Each cell is exactly 2 chars wide. Single-char markers get a space.
        parts.push(m.char.length === 1 ? `${m.char} ` : m.char);
      } else {
        parts.push('· ');
      }
    }
    lines.push(parts.join(''));
  }

  // Deduplicate legend entries by character when they collide.
  const seenLegends = new Set<string>();
  const legendLines: string[] = [];
  for (const marker of markers.values()) {
    if (seenLegends.has(marker.legend)) continue;
    seenLegends.add(marker.legend);
    legendLines.push(marker.legend);
  }

  // Summary footer (distance hint keeps agents from parsing coordinates twice).
  const ownShips = state.ships.filter(
    (s) => s.owner === playerId && s.lifecycle !== 'destroyed',
  );
  const opponentId: PlayerId = playerId === 0 ? 1 : 0;
  const detectedEnemies = state.ships.filter(
    (s) => s.owner === opponentId && s.detected && s.lifecycle !== 'destroyed',
  );
  const nearest = nearestDistance(ownShips, detectedEnemies);

  const header =
    'Legend: @ = your ship  ! = detected enemy  * = body  ' +
    'H = home  T = target  x = ordnance  ~ = gravity  · = empty hex';

  const footer =
    nearest === null
      ? `Viewport q=[${minQ}..${maxQ}] r=[${minR}..${maxR}]`
      : `Viewport q=[${minQ}..${maxQ}] r=[${minR}..${maxR}]; nearest detected enemy is ${nearest} hex away`;

  return [header, '', ...lines, '', ...legendLines, '', footer].join('\n');
};

const nearestDistance = (
  owned: readonly Ship[],
  detected: readonly Ship[],
): number | null => {
  let best: number | null = null;
  for (const own of owned) {
    for (const enemy of detected) {
      const d = hexDistance(own.position, enemy.position);
      if (best === null || d < best) best = d;
    }
  }
  return best;
};
