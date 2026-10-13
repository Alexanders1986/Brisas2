'use client';

import { ROLE_LABELS } from '@brisas/contracts';
import { ArrowRight, Building2, ServerCog } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { BrandMark } from '@/components/auth-layout';
import { useSession } from '@/components/providers';
import { Badge, Button, EmptyState } from '@/components/ui';
import { initials } from '@/lib/forms';

export default function TenantPickerPage() {
  const { me, signOut } = useSession();
  if (!me) return null;

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-5 py-8">
      <div className="flex items-center justify-between">
        <BrandMark />
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Cerrar sesión
        </Button>
      </div>

      <h1 className="mt-14 text-[32px] font-semibold leading-tight">Hola, {me.displayName.split(' ')[0]}</h1>
      <p className="mt-1 text-muted">Elige a dónde quieres entrar.</p>

      <ul className="mt-8 flex flex-col gap-3">
        {me.memberships.map((membership) => (
          <li key={membership.tenantId}>
            <Link
              href={`/c/${membership.tenantSlug}`}
              style={membership.primaryColor ? ({ '--brand': membership.primaryColor } as CSSProperties) : undefined}
              className="group flex items-center gap-4 rounded-(--radius-card) border border-line bg-surface p-4 transition hover:border-brand hover:shadow-md"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand font-display font-semibold text-on-brand">
                {initials(membership.tenantName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-lg font-semibold">{membership.tenantName}</span>
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {membership.roles.map((role) => (
                    <Badge key={role}>{ROLE_LABELS[role]}</Badge>
                  ))}
                  {membership.tenantStatus === 'suspended' && <Badge tone="danger">Desactivado</Badge>}
                </span>
              </span>
              <ArrowRight className="size-5 text-muted transition group-hover:translate-x-1 group-hover:text-brand" aria-hidden />
            </Link>
          </li>
        ))}
        {me.isPlatformAdmin && (
          <li>
            <Link
              href="/plataforma"
              className="group flex items-center gap-4 rounded-(--radius-card) border border-line bg-surface p-4 transition hover:border-ink hover:shadow-md"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-ink text-surface">
                <ServerCog className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-lg font-semibold">Consola de plataforma</span>
                <span className="text-sm text-muted">Crear y administrar conjuntos residenciales</span>
              </span>
              <ArrowRight className="size-5 text-muted transition group-hover:translate-x-1" aria-hidden />
            </Link>
          </li>
        )}
      </ul>

      {me.memberships.length === 0 && !me.isPlatformAdmin && (
        <EmptyState
          icon={Building2}
          title="Aún no perteneces a ningún conjunto"
          description="Pide a la administración de tu conjunto que te registre con este correo. Cuando lo haga, aparecerá aquí."
        />
      )}
    </div>
  );
}
