'use client';

import type { PropertySummary } from '@brisas/contracts';
import { cx } from './ui';

/**
 * La fachada: una torre dibujada como edificio. Cada ventana es una unidad; encendida si
 * está ocupada, apagada si está libre. Reemplaza a una tabla de cientos de filas por algo
 * que un administrador reconoce de inmediato: su propio conjunto.
 */
export function Facade({
  units,
  onSelect,
  selectedId,
}: {
  units: PropertySummary[];
  onSelect?: (unit: PropertySummary) => void;
  selectedId?: string | null;
}) {
  const floors = new Map<number, PropertySummary[]>();
  for (const unit of units) {
    const floor = unit.floor ?? 0;
    floors.set(floor, [...(floors.get(floor) ?? []), unit]);
  }
  // El piso más alto se dibuja arriba, como en el edificio.
  const ordered = [...floors.entries()].sort(([a], [b]) => b - a);

  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-flex min-w-full flex-col gap-1.5">
        {ordered.map(([floor, floorUnits]) => (
          <div key={floor} className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted">
              {floor === 0 ? '' : `Piso ${floor}`}
            </span>
            <div className="flex gap-1.5">
              {floorUnits.map((unit) => (
                <Window key={unit.id} unit={unit} selected={unit.id === selectedId} onSelect={onSelect} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Window({
  unit,
  selected,
  onSelect,
}: {
  unit: PropertySummary;
  selected: boolean;
  onSelect?: (unit: PropertySummary) => void;
}) {
  const occupied = unit.activeOccupants > 0;
  const state = !unit.isActive ? 'desactivada' : occupied ? 'ocupada' : 'libre';
  const className = cx(
    'flex h-10 w-14 items-center justify-center rounded-md border text-xs font-medium tabular-nums transition',
    !unit.isActive && 'border-dashed border-line text-muted/60 line-through',
    unit.isActive && occupied && 'border-transparent bg-brand text-on-brand [animation:window-on_0.5s_ease-out]',
    unit.isActive && !occupied && 'border-line bg-surface text-muted',
    onSelect && 'hover:-translate-y-0.5 hover:shadow-md',
    selected && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
  );
  const label = `${unit.label}, ${state}`;
  return onSelect ? (
    <button type="button" className={className} aria-label={label} aria-pressed={selected} title={label} onClick={() => onSelect(unit)}>
      {unit.number}
    </button>
  ) : (
    <span className={className} title={label}>
      {unit.number}
    </span>
  );
}

export function FacadeLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
      <li className="flex items-center gap-2">
        <span className="size-3.5 rounded bg-brand" aria-hidden /> Ocupada
      </li>
      <li className="flex items-center gap-2">
        <span className="size-3.5 rounded border border-line bg-surface" aria-hidden /> Libre
      </li>
      <li className="flex items-center gap-2">
        <span className="size-3.5 rounded border border-dashed border-line" aria-hidden /> Desactivada
      </li>
    </ul>
  );
}

/** Motivo decorativo del inicio de sesión: un edificio de noche con algunas ventanas encendidas. */
export function FacadeArt() {
  const rows = 9;
  const columns = 7;
  // Patrón fijo (no aleatorio) para que el servidor y el navegador dibujen lo mismo.
  const lit = (row: number, column: number) => (row * 7 + column * 13 + row * column) % 5 < 2;
  return (
    <div aria-hidden className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {Array.from({ length: rows * columns }, (_, index) => {
        const row = Math.floor(index / columns);
        const column = index % columns;
        return (
          <span
            key={index}
            className={cx('aspect-[4/5] rounded-[5px]', lit(row, column) ? 'bg-amber-200/90' : 'bg-white/10')}
            style={lit(row, column) ? { animation: `window-on 0.9s ease-out ${(row + column) * 70}ms both` } : undefined}
          />
        );
      })}
    </div>
  );
}
