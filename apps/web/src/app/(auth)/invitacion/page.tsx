'use client';

import type { InvitationPreview } from '@brisas/contracts';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { SetPasswordForm } from '@/components/set-password-form';
import { Skeleton, buttonClass } from '@/components/ui';
import { api } from '@/lib/api';

function Invitation() {
  const token = useSearchParams().get('token') ?? '';
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      api<InvitationPreview>('/auth/invitations/preview', { method: 'POST', body: { token }, skipRefresh: true }),
    enabled: token.length > 0,
    retry: false,
  });

  if (!token || preview.isError) {
    return (
      <AuthLayout
        title="Esta invitación ya no es válida"
        description="Puede que haya vencido o que ya la hayas usado. Si ya activaste tu cuenta, inicia sesión; si no, pide a la administración que te envíe una nueva."
      >
        <Link href="/login" className={buttonClass('primary')}>
          Ir a iniciar sesión
        </Link>
      </AuthLayout>
    );
  }

  if (preview.isPending) {
    return (
      <AuthLayout title="Activa tu cuenta">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      </AuthLayout>
    );
  }

  const place = preview.data.tenantName ?? 'Brisas';
  return (
    <AuthLayout
      title={`Te damos la bienvenida a ${place}`}
      description={
        <>
          Crea una contraseña para <strong className="text-ink">{preview.data.email}</strong> y activa tu cuenta.
        </>
      }
    >
      <SetPasswordForm
        endpoint="/auth/invitations/accept"
        token={token}
        submitLabel="Activar mi cuenta"
        successMessage="Tu cuenta quedó activa. Ya puedes iniciar sesión."
        consent={
          <>
            Autorizo a {place} el tratamiento de mis datos personales para la administración del conjunto, conforme a la
            Ley 1581 de 2012. Puedo consultar, corregir o pedir la eliminación de mis datos escribiendo a la
            administración.
          </>
        }
      />
    </AuthLayout>
  );
}

export default function InvitationPage() {
  return (
    <Suspense>
      <Invitation />
    </Suspense>
  );
}
