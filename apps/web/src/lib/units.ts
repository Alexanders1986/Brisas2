import type { PropertySummary, TowerSummary } from '@brisas/contracts';

/** Agrupa las unidades por torre, en el orden de las torres; las casas sin torre van al final. */
export function groupByTower(units: PropertySummary[], towers: TowerSummary[]) {
  const groups = towers.map((tower) => ({
    id: tower.id as string | null,
    name: tower.name,
    units: units.filter((unit) => unit.towerId === tower.id),
  }));
  const loose = units.filter((unit) => unit.towerId === null);
  if (loose.length > 0) groups.push({ id: null, name: towers.length > 0 ? 'Sin torre' : 'Unidades', units: loose });
  return groups;
}
