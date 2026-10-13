'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { AuthLayout } from '@/components/auth-layout';
import { SetPasswordForm } from '@/components/set-password-form';
import { buttonClass } from '@/components/ui';

function ResetPassword() {
  const token = useSearchParams().get('token');
  if (!token) {
    return (
      <AuthLayout title="Este enlace no es válido" description="Pide un nuevo enlace para restablecer tu contraseña.">
        <Link href="/recuperar" className={buttonClass('primary')}>
          Pedir un enlace nuevo
        </Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Crea una nueva contraseña" description="Al guardarla se cerrarán las sesiones abiertas en otros dispositivos.">
      <SetPasswordForm
        endpoint="/auth/password/reset"
        token={token}
        submitLabel="Guardar contraseña"
        successMessage="Tu contraseña quedó actualizada. Ya puedes iniciar sesión."
      />
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPassword />
    </Suspense>
  );
}
