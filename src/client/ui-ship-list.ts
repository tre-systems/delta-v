import { SHIP_STATS } from '../shared/constants';
import type { Ship } from '../shared/types';

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
  const typeCounts: Record<string, number> = {};
  for (const ship of ships) {
    typeCounts[ship.type] = (typeCounts[ship.type] ?? 0) + 1;
  }

  const typeIndices: Record<string, number> = {};
  return ships.map((ship) => {
    const name = SHIP_STATS[ship.type]?.name ?? ship.type;
    const needsNumber = (typeCounts[ship.type] ?? 0) > 1;
    typeIndices[ship.type] = (typeIndices[ship.type] ?? 0) + 1;
    return needsNumber ? `${name} ${typeIndices[ship.type]}` : name;
  });
};

const getStatusText = (ship: Ship): string => {
  const statusParts: string[] = [];
  if (ship.destroyed) statusParts.push('X');
  else if (ship.captured) statusParts.push('CAP');
  else if (ship.damage.disabledTurns > 0) statusParts.push(`D${ship.damage.disabledTurns}`);
  if (ship.heroismAvailable) statusParts.push('H');
  return statusParts.join(' ');
};

const getVelocityLabel = (ship: Ship): string => {
  const speed = Math.abs(ship.velocity.dq) + Math.abs(ship.velocity.dr);
  return speed === 0 ? 'Stationary' : `${ship.velocity.dq}, ${ship.velocity.dr}`;
};

const getShipDetailRows = (ship: Ship, isSelected: boolean): ShipDetailRowView[] => {
  const stats = SHIP_STATS[ship.type];
  if (!isSelected || ship.destroyed || !stats) return [];

  const rows: ShipDetailRowView[] = [
    {
      label: 'Combat',
      value: `${stats.combat}${stats.defensiveOnly ? ' (def)' : ''}${ship.heroismAvailable ? ' ★' : ''}`,
      tone: null,
    },
  ];

  if (stats.cargo > 0) {
    rows.push({
      label: 'Cargo',
      value: `${stats.cargo - ship.cargoUsed}/${stats.cargo}`,
      tone: null,
    });
  }

  rows.push({
    label: 'Velocity',
    value: getVelocityLabel(ship),
    tone: null,
  });

  if (ship.damage.disabledTurns > 0) {
    rows.push({
      label: 'Disabled',
      value: `${ship.damage.disabledTurns} turns`,
      tone: 'warning',
    });
  }

  if (ship.captured) {
    rows.push({
      label: 'Status',
      value: 'Captured',
      tone: 'danger',
    });
  } else if (ship.landed) {
    rows.push({
      label: 'Status',
      value: 'Landed',
      tone: 'success',
    });
  }

  return rows;
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
    isDestroyed: ship.destroyed,
    statusText: getStatusText(ship),
    hasBurn: burns.has(ship.id) && burns.get(ship.id) !== null,
    fuelText: ship.destroyed ? '' : `${ship.fuel}/${SHIP_STATS[ship.type]?.fuel ?? '?'}`,
    detailRows: getShipDetailRows(ship, ship.id === selectedId),
  }));
};
