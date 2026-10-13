'use client';

import type { LoginResponse, MeResponse } from '@brisas/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Toaster } from 'sonner';
import { ApiError, api, refreshSession, setAccessToken } from '@/lib/api';

type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

interface SessionValue {
  status: SessionStatus;
  me: MeResponse | null;
  /** Guarda el token recibido al iniciar sesión y carga el perfil. */
  signIn: (login: Extract<LoginResponse, { status: 'authenticated' }>) => Promise<MeResponse>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession debe usarse dentro de <Providers>');
  return value;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, error) => !(error instanceof ApiError && error.status < 500 && error.status !== 0) && count < 2,
          },
        },
      }),
  );
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);

  const loadProfile = useCallback(async () => {
    const profile = await api<MeResponse>('/auth/me');
    setMe(profile);
    setStatus('authenticated');
    return profile;
  }, []);

  // Al abrir la aplicación se intenta recuperar la sesión con la cookie httpOnly.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!(await refreshSession())) throw new Error('sin sesión');
        if (!cancelled) await loadProfile();
      } catch {
        if (!cancelled) setStatus('anonymous');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      me,
      signIn: async (login) => {
        setAccessToken(login.accessToken);
        return loadProfile();
      },
      signOut: async () => {
        try {
          await api('/auth/logout', { method: 'POST', skipRefresh: true });
        } catch {
          // Aunque el servidor no responda, la sesión local se cierra.
        }
        setAccessToken(null);
        queryClient.clear();
        setMe(null);
        setStatus('anonymous');
      },
      reload: async () => {
        await loadProfile();
      },
    }),
    [status, me, loadProfile, queryClient],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
      <Toaster
        position="top-right"
        closeButton
        toastOptions={{
          style: {
            background: 'var(--surface)',
            color: 'var(--ink)',
            border: '1px solid var(--line)',
            borderRadius: '12px',
            fontFamily: 'inherit',
          },
        }}
      />
    </QueryClientProvider>
  );
}
