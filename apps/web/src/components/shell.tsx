'use client';

import {
  Building2,
  ChevronsUpDown,
  LogOut,
  type LucideIcon,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldAlert,
  Sun,
  UserRound,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { DropdownMenu } from 'radix-ui';
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { initials } from '@/lib/forms';
import { useSession } from './providers';
import { IconButton, cx } from './ui';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** true = activo solo con la ruta exacta (para "Inicio"). */
  exact?: boolean;
}

interface ShellProps {
  /** Nombre del conjunto o de la consola que se muestra arriba del menú. */
  title: string;
  subtitle: string;
  /** Color de marca del conjunto; pinta botones, estados activos y la fachada. */
  brandColor?: string | null;
  nav: NavItem[];
  /** Búsqueda global: recibe el texto y decide a dónde llevar. */
  search?: { placeholder: string; onSearch: (text: string) => void };
  children: ReactNode;
}

function useStoredFlag(key: string): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(false);
  useEffect(() => {
    try {
      setValue(localStorage.getItem(key) === '1');
    } catch {
      // Sin almacenamiento local se usa el valor por defecto.
    }
  }, [key]);
  return [
    value,
    (next) => {
      setValue(next);
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        // Preferencia no persistente.
      }
    },
  ];
}

export function Shell({ title, subtitle, brandColor, nav, search, children }: ShellProps) {
  const pathname = usePathname();
  const { me } = useSession();
  const [collapsed, setCollapsed] = useStoredFlag('brisas:menu-colapsado');
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname.startsWith(item.href));

  const menu = (compact: boolean) => (
    <>
      <div className={cx('flex items-center gap-3 px-3 pb-4 pt-5', compact && 'justify-center px-0')}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand font-display text-sm font-semibold text-on-brand">
          {initials(title) || <Building2 className="size-5" aria-hidden />}
        </span>
        {!compact && (
          <div className="min-w-0">
            <p className="truncate font-display font-semibold leading-tight">{title}</p>
            <p className="truncate text-sm text-muted">{subtitle}</p>
          </div>
        )}
      </div>
      <nav aria-label="Menú principal" className="flex flex-1 flex-col gap-1 px-2">
        {nav.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              title={compact ? item.label : undefined}
              className={cx(
                'flex min-h-11 items-center gap-3 rounded-(--radius-control) px-3 font-medium transition',
                compact && 'justify-center px-0',
                active ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:bg-surface-2 hover:text-ink',
              )}
            >
              <item.icon className="size-5 shrink-0" aria-hidden />
              {compact ? <span className="sr-only">{item.label}</span> : item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <div
      className="flex min-h-dvh"
      style={brandColor ? ({ '--brand': brandColor } as CSSProperties) : undefined}
    >
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg"
      >
        Saltar al contenido
      </a>

      {/* Menú lateral fijo (escritorio y tableta) */}
      <aside
        className={cx(
          'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 md:flex',
          collapsed ? 'w-[72px]' : 'w-64',
        )}
      >
        {menu(collapsed)}
        <div className={cx('border-t border-line p-2', collapsed && 'flex justify-center')}>
          <IconButton
            label={collapsed ? 'Expandir menú' : 'Contraer menú'}
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            onClick={() => setCollapsed(!collapsed)}
          />
        </div>
      </aside>

      {/* Menú deslizable (celular) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menú principal">
          <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-black/45" onClick={() => setMobileOpen(false)} />
          <aside className="animate-rise relative flex h-full w-72 max-w-[85vw] flex-col bg-surface shadow-2xl">
            <IconButton label="Cerrar menú" icon={X} className="absolute right-2 top-3" onClick={() => setMobileOpen(false)} />
            {menu(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur sm:px-6">
          <IconButton label="Abrir menú" icon={Menu} className="md:hidden" onClick={() => setMobileOpen(true)} />
          {search ? <SearchBox {...search} /> : <div className="flex-1" />}
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        {me?.mfaEnrollmentRequired && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-warn-soft px-4 py-2.5 text-sm sm:px-6">
            <ShieldAlert className="size-4 shrink-0 text-warn" aria-hidden />
            <span>Para usar el panel debes activar la verificación en dos pasos.</span>
            <Link href="/cuenta" className="font-medium underline">
              Activarla ahora
            </Link>
          </div>
        )}

        <main id="contenido" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function SearchBox({ placeholder, onSearch }: { placeholder: string; onSearch: (text: string) => void }) {
  const [text, setText] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) onSearch(text.trim());
  };
  return (
    <form role="search" onSubmit={submit} className="relative max-w-md flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-full border border-line bg-surface pl-9 pr-4 text-sm placeholder:text-muted/80 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25"
      />
    </form>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === 'dark'), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem('brisas:tema', next ? 'dark' : 'light');
    } catch {
      // Preferencia no persistente.
    }
  };
  return <IconButton label={dark ? 'Usar modo claro' : 'Usar modo oscuro'} icon={dark ? Sun : Moon} onClick={toggle} />;
}

const MENU_ITEM =
  'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none data-[highlighted]:bg-surface-2';

function UserMenu() {
  const router = useRouter();
  const { me, signOut } = useSession();
  if (!me) return null;
  const canSwitch = me.memberships.length + (me.isPlatformAdmin ? 1 : 0) > 1;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Cuenta de ${me.displayName}`}
        className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-2.5 hover:bg-surface-2"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-ink text-xs font-semibold text-surface">
          {initials(me.displayName)}
        </span>
        <span className="hidden max-w-36 truncate text-sm font-medium sm:block">{me.displayName}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="animate-rise z-50 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-xl"
        >
          <div className="px-2.5 py-2">
            <p className="truncate font-medium">{me.displayName}</p>
            <p className="truncate text-sm text-muted">{me.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item className={MENU_ITEM} onSelect={() => router.push('/cuenta')}>
            <UserRound className="size-4 text-muted" aria-hidden /> Mi cuenta y seguridad
          </DropdownMenu.Item>
          {canSwitch && (
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => router.push('/conjuntos')}>
              <ChevronsUpDown className="size-4 text-muted" aria-hidden /> Cambiar de conjunto
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            className={MENU_ITEM}
            onSelect={() => {
              void signOut().then(() => router.replace('/login'));
            }}
          >
            <LogOut className="size-4 text-muted" aria-hidden /> Cerrar sesión
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
