import { ORBITAL_BASE_MASS, SHIP_STATS } from '../../constants';
import { hexKey } from '../../hex';
import type { GameState, Result } from '../../types/domain';
import { getCargoUsedAfterResupply } from '../util';
import type { ShipProjectionEvent } from './support';
import { cloneGravityEffects, requireShip, requireState } from './support';

const applyFriendlyBaseResupply = (
  state: GameState,
  ship: GameState['ships'][number],
): void => {
  const baseKey = hexKey(ship.position);

  if (state.destroyedBases.includes(baseKey)) {
    return;
  }

  if (!(state.players[ship.owner]?.bases.includes(baseKey) ?? false)) {
    return;
  }

  const stats = SHIP_STATS[ship.type];

  if (!stats) {
    return;
  }

  ship.fuel = stats.fuel;
  ship.cargoUsed = getCargoUsedAfterResupply(ship);
  ship.nukesLaunchedSinceResupply = 0;
  ship.overloadUsed = false;
  ship.damage = { disabledTurns: 0 };
  ship.control = 'own';
  ship.resuppliedThisTurn = true;
};

export const projectShipEvent = (
  state: GameState | null,
  event: ShipProjectionEvent,
): Result<GameState> => {
  switch (event.type) {
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
      if (event.lastBurnDirection !== undefined) {
        projectedShip.value.lastBurnDirection = event.lastBurnDirection;
      }
      projectedShip.value.pendingGravityEffects = cloneGravityEffects(
        event.pendingGravityEffects,
      );

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
      applyFriendlyBaseResupply(state, projectedShip.value);

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
        const fromPassengers = source.value.passengersAboard ?? 0;
        const nextFrom = fromPassengers - event.amount;
        source.value.passengersAboard = nextFrom <= 0 ? undefined : nextFrom;
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

    default: {
      const unreachable: never = event;
      return {
        ok: false,
        error: `unsupported ship event: ${String(unreachable)}`,
      };
    }
  }
};
