import { Building2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { FacadeArt } from './facade';

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-xl font-semibold ${className ?? ''}`}>
      <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-on-brand">
        <Building2 className="size-5" aria-hidden />
      </span>
      Brisas
    </span>
  );
}

/** Pantallas públicas: formulario a la izquierda, la fachada del conjunto a la derecha. */
export function AuthLayout({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <main className="flex flex-col px-6 py-8 sm:px-12">
        <BrandMark />
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <h1 className="text-[32px] font-semibold leading-tight">{title}</h1>
          {description && <p className="mt-2 text-muted">{description}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
      <aside className="relative hidden overflow-hidden bg-[#12303a] lg:flex lg:flex-col lg:justify-end">
        <div className="absolute inset-x-[16%] bottom-0 top-[14%] rounded-t-3xl bg-[#0b2029] p-8">
          <FacadeArt />
        </div>
        <p className="relative z-10 bg-gradient-to-t from-[#12303a] via-[#12303a]/95 to-transparent px-12 pb-12 pt-24 font-display text-2xl leading-snug text-white">
          Residentes, unidades y comunicación del conjunto, en un solo lugar.
        </p>
      </aside>
    </div>
  );
}
