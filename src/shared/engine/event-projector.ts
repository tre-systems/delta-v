import {
  DAMAGE_ELIMINATION_THRESHOLD,
  ORBITAL_BASE_MASS,
  ORDNANCE_MASS,
  SHIP_STATS,
} from '../constants';
import { hexKey } from '../hex';
import { findBaseHex, SCENARIOS } from '../map-data';
import type { ScenarioDefinition, SolarSystemMap } from '../types';
import { CURRENT_GAME_STATE_SCHEMA_VERSION } from '../types';
import type { GameState, Result } from '../types/domain';
import type { EngineEvent, EventEnvelope } from './engine-events';
import { processFleetReady } from './fleet-building';
import { createGame } from './game-creation';
import { getCargoUsedAfterResupply } from './util';

const migrateGameState = (state: GameState): GameState => ({
  ...state,
  schemaVersion: state.schemaVersion ?? CURRENT_GAME_STATE_SCHEMA_VERSION,
});

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
): Result<GameState> =>
  state === null
    ? { ok: false, error: `${eventType} before gameCreated` }
    : { ok: true, value: state };

const requireShip = (
  state: GameState,
  shipId: string,
): Result<GameState['ships'][number]> => {
  const ship = state.ships.find((candidate) => candidate.id === shipId);

  return ship
    ? { ok: true, value: ship }
    : { ok: false, error: `ship not found: ${shipId}` };
};

const requireOrdnance = (
  state: GameState,
  ordnanceId: string,
): Result<GameState['ordnance'][number]> => {
  const ordnance = state.ordnance.find(
    (candidate) => candidate.id === ordnanceId,
  );

  return ordnance
    ? { ok: true, value: ordnance }
    : { ok: false, error: `ordnance not found: ${ordnanceId}` };
};

const projectSetupEvent = (
  state: GameState | null,
  envelope: EventEnvelope,
  map: SolarSystemMap,
): Result<GameState> => {
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
        value: migrateGameState(
          createGame(scenario, map, gameId, findBaseHex, () => 0),
        ),
      };
    }

    case 'fleetPurchased': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      const result = processFleetReady(
        baseState.value,
        event.playerId,
        event.purchases,
        map,
      );

      return 'error' in result
        ? { ok: false, error: result.error.message }
        : { ok: true, value: result.state };
    }

    case 'astrogationOrdersCommitted':
    case 'ordnanceLaunchesCommitted':
    case 'logisticsTransfersCommitted':
    case 'surrenderDeclared': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      if (event.type === 'astrogationOrdersCommitted') {
        baseState.value.pendingAstrogationOrders = event.orders.map(
          (order) => ({
            shipId: order.shipId,
            burn: order.burn,
            overload: order.overload ?? null,
            weakGravityChoices: order.weakGravityChoices
              ? { ...order.weakGravityChoices }
              : undefined,
          }),
        );
      }

      return baseState;
    }

    case 'fugitiveDesignated': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;

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
        value: state,
      };
    }

    case 'phaseChanged': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;

      state.phase = event.phase;
      state.turnNumber = event.turn;
      state.activePlayer = event.activePlayer;

      return {
        ok: true,
        value: state,
      };
    }

    case 'turnAdvanced': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const previousActivePlayer = 1 - event.activePlayer;

      for (const ship of state.ships) {
        if (ship.owner !== previousActivePlayer) continue;

        if (ship.lifecycle === 'destroyed') continue;

        ship.resuppliedThisTurn = false;

        if (ship.damage.disabledTurns > 0) {
          ship.damage.disabledTurns--;
        }
      }

      state.pendingAstrogationOrders = null;
      state.turnNumber = event.turn;
      state.activePlayer = event.activePlayer;

      return {
        ok: true,
        value: state,
      };
    }

    case 'shipMoved': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      state.pendingAstrogationOrders = null;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      projectedShip.value.position = { ...event.to };
      projectedShip.value.lastMovementPath = event.path.map((hex) => ({
        ...hex,
      }));
      projectedShip.value.velocity = { ...event.newVelocity };
      projectedShip.value.fuel = event.fuelRemaining;
      projectedShip.value.lifecycle = event.lifecycle;
      projectedShip.value.overloadUsed = event.overloadUsed;
      projectedShip.value.pendingGravityEffects =
        event.pendingGravityEffects.map((effect) => ({
          ...effect,
          hex: { ...effect.hex },
        }));

      return {
        ok: true,
        value: state,
      };
    }

    case 'shipLanded': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      projectedShip.value.lifecycle = 'landed';
      projectedShip.value.velocity = { dq: 0, dr: 0 };
      projectedShip.value.pendingGravityEffects = [];

      return {
        ok: true,
        value: state,
      };
    }

    case 'shipCrashed': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      projectedShip.value.lifecycle = 'destroyed';
      projectedShip.value.deathCause = 'crash';
      projectedShip.value.velocity = { dq: 0, dr: 0 };
      projectedShip.value.pendingGravityEffects = [];

      return {
        ok: true,
        value: state,
      };
    }

    case 'shipDestroyed': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      projectedShip.value.lifecycle = 'destroyed';
      projectedShip.value.deathCause = event.cause;
      projectedShip.value.velocity = { dq: 0, dr: 0 };

      return {
        ok: true,
        value: state,
      };
    }

    case 'shipCaptured': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      projectedShip.value.owner = event.capturedBy;
      projectedShip.value.control = 'captured';

      if (projectedShip.value.identity) {
        projectedShip.value.identity.revealed = true;
      }

      return {
        ok: true,
        value: state,
      };
    }

    case 'asteroidDestroyed': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const key = hexKey(event.hex);

      if (!state.destroyedAsteroids.includes(key)) {
        state.destroyedAsteroids.push(key);
      }

      return {
        ok: true,
        value: state,
      };
    }

    case 'baseDestroyed': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const key = hexKey(event.hex);

      if (!state.destroyedBases.includes(key)) {
        state.destroyedBases.push(key);
      }

      return {
        ok: true,
        value: state,
      };
    }

    case 'shipResupplied': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      const stats = SHIP_STATS[projectedShip.value.type];

      if (!stats) {
        return {
          ok: false,
          error: `unknown ship type: ${projectedShip.value.type}`,
        };
      }

      projectedShip.value.fuel = stats.fuel;
      projectedShip.value.cargoUsed = getCargoUsedAfterResupply(
        projectedShip.value,
      );
      projectedShip.value.nukesLaunchedSinceResupply = 0;
      projectedShip.value.damage = { disabledTurns: 0 };
      projectedShip.value.control = 'own';
      projectedShip.value.resuppliedThisTurn = true;

      if (event.source === 'base') {
        projectedShip.value.overloadUsed = false;
      }

      return {
        ok: true,
        value: state,
      };
    }

    case 'fuelTransferred':
    case 'cargoTransferred':
    case 'passengersTransferred': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const source = requireShip(state, event.fromShipId);

      if (!source.ok) {
        return source;
      }

      const target = requireShip(state, event.toShipId);

      if (!target.ok) {
        return target;
      }

      if (event.type === 'fuelTransferred') {
        source.value.fuel -= event.amount;
        target.value.fuel += event.amount;
      } else if (event.type === 'cargoTransferred') {
        source.value.cargoUsed -= event.amount;
        target.value.cargoUsed += event.amount;
      } else {
        const fromP = source.value.passengersAboard ?? 0;
        const nextFrom = fromP - event.amount;
        if (nextFrom <= 0) {
          source.value.passengersAboard = undefined;
        } else {
          source.value.passengersAboard = nextFrom;
        }
        target.value.passengersAboard =
          (target.value.passengersAboard ?? 0) + event.amount;
      }

      return {
        ok: true,
        value: state,
      };
    }

    case 'shipSurrendered': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      projectedShip.value.control = 'surrendered';

      return {
        ok: true,
        value: state,
      };
    }

    case 'baseEmplaced': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const sourceShip = requireShip(state, event.sourceShipId);

      if (!sourceShip.ok) {
        return sourceShip;
      }

      sourceShip.value.baseStatus = undefined;
      sourceShip.value.cargoUsed = Math.max(
        0,
        sourceShip.value.cargoUsed - ORBITAL_BASE_MASS,
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
        value: state,
      };
    }

    case 'ordnanceLaunched': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const sourceShip = requireShip(state, event.sourceShipId);

      if (!sourceShip.ok) {
        return sourceShip;
      }

      sourceShip.value.cargoUsed += ORDNANCE_MASS[event.ordnanceType];

      if (event.ordnanceType === 'nuke') {
        sourceShip.value.nukesLaunchedSinceResupply += 1;
      }

      state.ordnance.push({
        id: event.ordnanceId,
        type: event.ordnanceType,
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
        value: state,
      };
    }

    case 'ordnanceMoved': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      state.pendingAstrogationOrders = null;
      const projectedOrdnance = requireOrdnance(state, event.ordnanceId);

      if (!projectedOrdnance.ok) {
        return projectedOrdnance;
      }

      projectedOrdnance.value.position = { ...event.position };
      projectedOrdnance.value.velocity = { ...event.velocity };
      projectedOrdnance.value.turnsRemaining = event.turnsRemaining;
      projectedOrdnance.value.pendingGravityEffects =
        event.pendingGravityEffects.map((effect) => ({
          ...effect,
          hex: { ...effect.hex },
        }));

      return {
        ok: true,
        value: state,
      };
    }

    case 'ordnanceExpired': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const ordnance = requireOrdnance(state, event.ordnanceId);

      if (!ordnance.ok) {
        return ordnance;
      }

      ordnance.value.lifecycle = 'destroyed';
      state.ordnance = state.ordnance.filter(
        (item) => item.lifecycle !== 'destroyed',
      );

      return {
        ok: true,
        value: state,
      };
    }

    case 'ordnanceDetonated': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;

      if (!event.targetShipId || event.damageType === 'none') {
        return {
          ok: true,
          value: state,
        };
      }

      const projectedShip = requireShip(state, event.targetShipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      if (event.damageType === 'disabled') {
        projectedShip.value.damage.disabledTurns += event.disabledTurns;
      }

      return {
        ok: true,
        value: state,
      };
    }

    case 'ramming': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;

      if (event.damageType === 'none' || event.damageType === 'eliminated') {
        return {
          ok: true,
          value: state,
        };
      }

      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      projectedShip.value.damage.disabledTurns += event.disabledTurns;

      return {
        ok: true,
        value: state,
      };
    }

    case 'ordnanceDestroyed': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const ordnance = requireOrdnance(state, event.ordnanceId);

      if (!ordnance.ok) {
        return ordnance;
      }

      ordnance.value.lifecycle = 'destroyed';
      state.ordnance = state.ordnance.filter(
        (item) => item.lifecycle !== 'destroyed',
      );

      return {
        ok: true,
        value: state,
      };
    }

    case 'combatAttack': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;

      if (event.targetType === 'ordnance') {
        return {
          ok: true,
          value: state,
        };
      }

      if (event.damageType === 'none') {
        return {
          ok: true,
          value: state,
        };
      }

      const projectedShip = requireShip(state, event.targetId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      if (event.damageType === 'eliminated') {
        projectedShip.value.lifecycle = 'destroyed';
        projectedShip.value.deathCause = event.attackType;
        projectedShip.value.killedBy = event.attackerIds[0] ?? null;
        projectedShip.value.velocity = { dq: 0, dr: 0 };
        return {
          ok: true,
          value: state,
        };
      }

      projectedShip.value.damage.disabledTurns += event.disabledTurns;
      if (
        projectedShip.value.damage.disabledTurns >= DAMAGE_ELIMINATION_THRESHOLD
      ) {
        projectedShip.value.lifecycle = 'destroyed';
        projectedShip.value.deathCause = event.attackType;
        projectedShip.value.killedBy = event.attackerIds[0] ?? null;
        projectedShip.value.velocity = { dq: 0, dr: 0 };
      }

      return {
        ok: true,
        value: state,
      };
    }

    case 'identityRevealed': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const projectedShip = requireShip(state, event.shipId);

      if (!projectedShip.ok) {
        return projectedShip;
      }

      if (projectedShip.value.identity) {
        projectedShip.value.identity.revealed = true;
      }

      return {
        ok: true,
        value: state,
      };
    }

    case 'checkpointVisited': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      const visitedBodies = state.players[event.playerId]?.visitedBodies;

      if (visitedBodies && !visitedBodies.includes(event.body)) {
        visitedBodies.push(event.body);
      }

      return {
        ok: true,
        value: state,
      };
    }

    case 'gameOver': {
      const baseState = requireState(state, event.type);

      if (!baseState.ok) {
        return baseState;
      }

      state = baseState.value;
      state.outcome =
        event.winner !== null
          ? { winner: event.winner, reason: event.reason }
          : null;
      state.phase = 'gameOver';

      return {
        ok: true,
        value: state,
      };
    }

    default: {
      const unreachable: never = event;
      return {
        ok: false,
        error: `unsupported setup event: ${String(unreachable)}`,
      };
    }
  }
};

export const projectGameStateFromStream = (
  events: EventEnvelope[],
  map: SolarSystemMap,
  initialState: GameState | null = null,
): Result<GameState> => {
  let state = initialState
    ? migrateGameState(structuredClone(initialState))
    : null;

  for (const envelope of events) {
    const projected = projectSetupEvent(state, envelope, map);

    if (!projected.ok) {
      return projected;
    }

    state = projected.value;
  }

  return state === null
    ? {
        ok: false,
        error: 'empty event stream',
      }
    : {
        ok: true,
        value: state,
      };
};

export const projectMatchSetupFromStream = (
  events: EventEnvelope[],
  map: SolarSystemMap,
): Result<GameState> => projectGameStateFromStream(events, map);
