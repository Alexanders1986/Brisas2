'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/components/providers';
import { Spinner } from '@/components/ui';
import { homeFor } from '@/lib/routes';

export default function RootPage() {
  const router = useRouter();
  const { status, me } = useSession();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    if (status === 'authenticated' && me) router.replace(homeFor(me));
  }, [status, me, router]);

  return <Spinner />;
}
