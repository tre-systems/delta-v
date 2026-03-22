import { SHIP_STATS } from '../../shared/constants';
import type { Ship } from '../../shared/types/domain';

export interface ShipDetailRowView {
  label: string;
  value: string;
  tone: 'warning' | 'danger' | 'success' | null;
}

export interface ShipListEntryView {
  shipId: string;
  displayName: string;
  isSelected: boolean;
  isDestroyed: boolean;
  statusText: string;
  hasBurn: boolean;
  fuelText: string;
  detailRows: ShipDetailRowView[];
}

const getDisplayNames = (ships: Ship[]) => {
  const typeCounts = ships.reduce<Record<string, number>>((acc, ship) => {
    acc[ship.type] = (acc[ship.type] ?? 0) + 1;

    return acc;
  }, {});

  const typeIndices: Record<string, number> = {};

  return ships.map((ship) => {
    const name = SHIP_STATS[ship.type]?.name ?? ship.type;
    const needsNumber = (typeCounts[ship.type] ?? 0) > 1;

    typeIndices[ship.type] = (typeIndices[ship.type] ?? 0) + 1;

    return needsNumber ? `${name} ${typeIndices[ship.type]}` : name;
  });
};

const getStatusText = (ship: Ship): string =>
  [
    ship.lifecycle === 'destroyed'
      ? 'X'
      : ship.control === 'captured'
        ? 'CAP'
        : ship.damage.disabledTurns > 0
          ? `D${ship.damage.disabledTurns}`
          : '',
    ship.heroismAvailable ? 'H' : '',
  ]
    .filter(Boolean)
    .join(' ');

const getVelocityLabel = (ship: Ship): string => {
  const speed = Math.abs(ship.velocity.dq) + Math.abs(ship.velocity.dr);

  return speed === 0
    ? 'Stationary'
    : `${ship.velocity.dq}, ${ship.velocity.dr}`;
};

const getShipDetailRows = (
  ship: Ship,
  isSelected: boolean,
): ShipDetailRowView[] => {
  const stats = SHIP_STATS[ship.type];
  if (!isSelected || ship.lifecycle === 'destroyed' || !stats) {
    return [];
  }

  return [
    {
      label: 'Combat',
      value: `${stats.combat}${stats.defensiveOnly ? ' (def)' : ''}${ship.heroismAvailable ? ' \u2605' : ''}`,
      tone: null,
    },
    stats.cargo > 0
      ? {
          label: 'Cargo',
          value: `${stats.cargo - ship.cargoUsed}/${stats.cargo}`,
          tone: null,
        }
      : null,
    {
      label: 'Velocity',
      value: getVelocityLabel(ship),
      tone: null,
    },
    ship.damage.disabledTurns > 0
      ? {
          label: 'Disabled',
          value: `${ship.damage.disabledTurns} turns`,
          tone: 'warning' as const,
        }
      : null,
    ship.control === 'captured'
      ? {
          label: 'Status',
          value: 'Captured',
          tone: 'danger' as const,
        }
      : null,
    ship.control !== 'captured' && ship.lifecycle === 'landed'
      ? {
          label: 'Status',
          value: 'Landed',
          tone: 'success' as const,
        }
      : null,
  ].filter((row): row is ShipDetailRowView => row !== null);
};

export const buildShipListView = (
  ships: Ship[],
  selectedId: string | null,
  burns: Map<string, number | null>,
): ShipListEntryView[] => {
  const displayNames = getDisplayNames(ships);

  return ships.map((ship, index) => ({
    shipId: ship.id,
    displayName: displayNames[index],
    isSelected: ship.id === selectedId,
    isDestroyed: ship.lifecycle === 'destroyed',
    statusText: getStatusText(ship),
    hasBurn: burns.has(ship.id) && burns.get(ship.id) !== null,
    fuelText:
      ship.lifecycle === 'destroyed'
        ? ''
        : `${ship.fuel}/${SHIP_STATS[ship.type]?.fuel ?? '?'}`,
    detailRows: getShipDetailRows(ship, ship.id === selectedId),
  }));
};
