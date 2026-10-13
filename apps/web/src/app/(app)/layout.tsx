'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { useSession } from '@/components/providers';
import { Spinner } from '@/components/ui';

/**
 * Todo lo que cuelga de este grupo exige sesión. Es una comodidad de navegación: la
 * protección real está en la API, que rechaza cualquier petición sin token válido.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated') return <Spinner label="Verificando tu sesión" />;
  return children;
}
