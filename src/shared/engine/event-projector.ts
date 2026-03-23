import { ORBITAL_BASE_MASS, SHIP_STATS } from '../constants';
import { hexKey } from '../hex';
import { findBaseHex, SCENARIOS } from '../map-data';
import type { ScenarioDefinition, SolarSystemMap } from '../types';
import type { GameState } from '../types/domain';
import type { EngineEvent, EventEnvelope } from './engine-events';
import { processFleetReady } from './fleet-building';
import { createGame } from './game-creation';

const resolveScenarioByName = (
  scenarioName: string,
): ScenarioDefinition | null => {
  for (const scenario of Object.values(SCENARIOS)) {
    if (scenario.name === scenarioName) {
      return scenario;
    }
  }

  return null;
};

const requireState = (
  state: GameState | null,
  eventType: EngineEvent['type'],
):
  | {
      ok: true;
      state: GameState;
    }
  | {
      ok: false;
      error: string;
    } =>
  state === null
    ? {
        ok: false,
        error: `${eventType} before gameCreated`,
      }
    : {
        ok: true,
        state,
      };

const requireShip = (
  state: GameState,
  shipId: string,
):
  | {
      ok: true;
      ship: GameState['ships'][number];
    }
  | {
      ok: false;
      error: string;
    } => {
  const ship = state.ships.find((candidate) => candidate.id === shipId);

  return ship
    ? {
        ok: true,
        ship,
      }
    : {
        ok: false,
        error: `ship not found: ${shipId}`,
      };
};

const projectSetupEvent = (
  state: GameState | null,
  envelope: EventEnvelope,
  map: SolarSystemMap,
):
  | {
      ok: true;
      state: GameState;
    }
  | {
      ok: false;
      error: string;
    } => {
  const { event, gameId } = envelope;

  switch (event.type) {
    case 'gameCreated': {
      if (state !== null) {
        return {
          ok: false,
          error: 'duplicate gameCreated event',
        };
      }

      const scenario = resolveScenarioByName(event.scenario);

      if (!scenario) {
        return {
          ok: false,
          error: `unknown scenario: ${event.scenario}`,
        };
      }

      return {
        ok: true,
        state: createGame(scenario, map, gameId, findBaseHex, () => 0),
      };
    }

    case 'fleetPurchased': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      const scenario = resolveScenarioByName(baseState.state.scenario);

      if (!scenario) {
        return {
          ok: false,
          error: `unknown scenario: ${baseState.state.scenario}`,
        };
      }

      const result = processFleetReady(
        baseState.state,
        event.playerId,
        event.purchases,
        map,
        scenario.availableShipTypes,
      );

      return 'error' in result
        ? { ok: false, error: result.error }
        : { ok: true, state: result.state };
    }

    case 'fugitiveDesignated': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;

      for (const ship of state.ships) {
        if (ship.owner === event.playerId && ship.identity) {
          ship.identity.hasFugitives = false;
          ship.identity.revealed = false;
        }
      }

      const fugitive = state.ships.find((ship) => ship.id === event.shipId);

      if (!fugitive?.identity) {
        return {
          ok: false,
          error: `fugitive ship not found: ${event.shipId}`,
        };
      }

      fugitive.identity.hasFugitives = true;

      return {
        ok: true,
        state,
      };
    }

    case 'phaseChanged': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;

      state.phase = event.phase;
      state.turnNumber = event.turn;
      state.activePlayer = event.activePlayer;

      return {
        ok: true,
        state,
      };
    }

    case 'turnAdvanced': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;

      state.turnNumber = event.turn;
      state.activePlayer = event.activePlayer;

      return {
        ok: true,
        state,
      };
    }

    case 'shipMoved': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      projectedShip.ship.position = { ...event.to };
      projectedShip.ship.lastMovementPath = event.path.map((hex) => ({
        ...hex,
      }));
      projectedShip.ship.velocity = { ...event.newVelocity };
      projectedShip.ship.fuel = event.fuelRemaining;
      projectedShip.ship.lifecycle = event.lifecycle;
      projectedShip.ship.overloadUsed = event.overloadUsed;
      projectedShip.ship.pendingGravityEffects =
        event.pendingGravityEffects.map((effect) => ({
          ...effect,
          hex: { ...effect.hex },
        }));

      return {
        ok: true,
        state,
      };
    }

    case 'shipLanded': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      projectedShip.ship.lifecycle = 'landed';
      projectedShip.ship.velocity = { dq: 0, dr: 0 };
      projectedShip.ship.pendingGravityEffects = [];

      return {
        ok: true,
        state,
      };
    }

    case 'shipCrashed':
    case 'shipDestroyed': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      projectedShip.ship.lifecycle = 'destroyed';
      projectedShip.ship.velocity = { dq: 0, dr: 0 };
      projectedShip.ship.pendingGravityEffects = [];

      return {
        ok: true,
        state,
      };
    }

    case 'asteroidDestroyed': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      const key = hexKey(event.hex);

      if (!state.destroyedAsteroids.includes(key)) {
        state.destroyedAsteroids.push(key);
      }

      return {
        ok: true,
        state,
      };
    }

    case 'baseDestroyed': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      const key = hexKey(event.hex);

      if (!state.destroyedBases.includes(key)) {
        state.destroyedBases.push(key);
      }

      return {
        ok: true,
        state,
      };
    }

    case 'shipResupplied': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      const stats = SHIP_STATS[projectedShip.ship.type];

      if (!stats) {
        return {
          ok: false,
          error: `unknown ship type: ${projectedShip.ship.type}`,
        };
      }

      projectedShip.ship.fuel = stats.fuel;
      projectedShip.ship.cargoUsed = 0;
      projectedShip.ship.nukesLaunchedSinceResupply = 0;
      projectedShip.ship.damage = { disabledTurns: 0 };
      projectedShip.ship.control = 'own';
      projectedShip.ship.resuppliedThisTurn = true;

      if (event.source === 'base') {
        projectedShip.ship.overloadUsed = false;
      }

      return {
        ok: true,
        state,
      };
    }

    case 'fuelTransferred':
    case 'cargoTransferred': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      const source = requireShip(state, event.fromShipId);

      if (!source.ok) {
        return source;
      }

      const target = requireShip(state, event.toShipId);

      if (!target.ok) {
        return target;
      }

      if (event.type === 'fuelTransferred') {
        source.ship.fuel -= event.amount;
        target.ship.fuel += event.amount;
      } else {
        source.ship.cargoUsed -= event.amount;
        target.ship.cargoUsed += event.amount;
      }

      return {
        ok: true,
        state,
      };
    }

    case 'shipSurrendered': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      projectedShip.ship.control = 'surrendered';

      return {
        ok: true,
        state,
      };
    }

    case 'baseEmplaced': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      const sourceShip = requireShip(state, event.sourceShipId);

      if (!sourceShip.ok) {
        return sourceShip;
      }

      sourceShip.ship.baseStatus = undefined;
      sourceShip.ship.cargoUsed = Math.max(
        0,
        sourceShip.ship.cargoUsed - ORBITAL_BASE_MASS,
      );

      state.ships.push({
        id: event.shipId,
        type: 'orbitalBase',
        owner: event.owner,
        originalOwner: event.owner,
        position: { ...event.position },
        velocity: { ...event.velocity },
        fuel: Infinity,
        cargoUsed: 0,
        nukesLaunchedSinceResupply: 0,
        resuppliedThisTurn: false,
        lifecycle: 'active',
        control: 'own',
        heroismAvailable: false,
        overloadUsed: false,
        detected: true,
        baseStatus: 'emplaced',
        pendingGravityEffects: [],
        damage: { disabledTurns: 0 },
      });

      return {
        ok: true,
        state,
      };
    }

    case 'ordnanceLaunched': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      state.ordnance.push({
        id: event.ordnanceId,
        type: event.ordnanceType as 'mine' | 'torpedo' | 'nuke',
        owner: event.owner,
        sourceShipId: event.sourceShipId,
        position: { ...event.position },
        velocity: { ...event.velocity },
        turnsRemaining: event.turnsRemaining,
        lifecycle: 'active',
        pendingGravityEffects: event.pendingGravityEffects.map((effect) => ({
          ...effect,
          hex: { ...effect.hex },
        })),
      });

      return {
        ok: true,
        state,
      };
    }

    case 'ordnanceExpired': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      const ordnance = state.ordnance.find(
        (item) => item.id === event.ordnanceId,
      );

      if (!ordnance) {
        return {
          ok: false,
          error: `ordnance not found: ${event.ordnanceId}`,
        };
      }

      ordnance.lifecycle = 'destroyed';
      state.ordnance = state.ordnance.filter(
        (item) => item.lifecycle !== 'destroyed',
      );

      return {
        ok: true,
        state,
      };
    }

    case 'ordnanceDetonated': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;

      if (!event.targetShipId || event.damageType === 'none') {
        return {
          ok: true,
          state,
        };
      }

      const projectedShip = requireShip(state, event.targetShipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      if (event.damageType === 'disabled') {
        projectedShip.ship.damage.disabledTurns = Math.max(
          projectedShip.ship.damage.disabledTurns,
          event.disabledTurns,
        );
      }

      return {
        ok: true,
        state,
      };
    }

    case 'ordnanceDestroyed': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      const ordnance = state.ordnance.find(
        (item) => item.id === event.ordnanceId,
      );

      if (!ordnance) {
        return {
          ok: false,
          error: `ordnance not found: ${event.ordnanceId}`,
        };
      }

      ordnance.lifecycle = 'destroyed';
      state.ordnance = state.ordnance.filter(
        (item) => item.lifecycle !== 'destroyed',
      );

      return {
        ok: true,
        state,
      };
    }

    case 'combatAttack': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;

      if (event.targetType === 'ordnance') {
        return {
          ok: true,
          state,
        };
      }

      if (event.damageType === 'none' || event.damageType === 'eliminated') {
        return {
          ok: true,
          state,
        };
      }

      const projectedShip = requireShip(state, event.targetId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      projectedShip.ship.damage.disabledTurns = Math.max(
        projectedShip.ship.damage.disabledTurns,
        event.disabledTurns,
      );

      return {
        ok: true,
        state,
      };
    }

    case 'identityRevealed': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      if (projectedShip.ship.identity) {
        projectedShip.ship.identity.revealed = true;
      }

      return {
        ok: true,
        state,
      };
    }

    case 'checkpointVisited': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      const visitedBodies = state.players[event.playerId]?.visitedBodies;

      if (visitedBodies && !visitedBodies.includes(event.body)) {
        visitedBodies.push(event.body);
      }

      return {
        ok: true,
        state,
      };
    }

    case 'gameOver': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.state;
      state.winner = event.winner;
      state.winReason = event.reason;
      state.phase = 'gameOver';

      return {
        ok: true,
        state,
      };
    }

    default:
      return {
        ok: false,
        error: `unsupported setup event: ${event.type satisfies EngineEvent['type']}`,
      };
  }
};

export const projectMatchSetupFromStream = (
  events: EventEnvelope[],
  map: SolarSystemMap,
):
  | {
      ok: true;
      state: GameState;
    }
  | {
      ok: false;
      error: string;
    } => {
  let state: GameState | null = null;

  for (const envelope of events) {
    const projected = projectSetupEvent(state, envelope, map);

    if (!projected.ok) {
      return projected;
    }

    state = projected.state;
  }

  return state === null
    ? {
        ok: false,
        error: 'empty event stream',
      }
    : {
        ok: true,
        state,
      };
};
