'use client';

import {
  type ChangePasswordInput,
  type MfaEnabledResponse,
  type MfaSetupResponse,
  PASSWORD_MIN_LENGTH,
  type SessionSummary,
  changePasswordSchema,
} from '@brisas/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, KeyRound, MonitorSmartphone, ShieldCheck, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { type FormEvent, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { PasswordInput } from '@/components/password-input';
import { useSession } from '@/components/providers';
import { Shell } from '@/components/shell';
import { Badge, Button, Card, Dialog, Field, Input, PageHeader, Skeleton } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, handleFormError } from '@/lib/forms';
import { homeFor } from '@/lib/routes';

export default function AccountPage() {
  const { me } = useSession();
  if (!me) return null;
  return (
    <Shell title="Mi cuenta" subtitle={me.email} nav={[{ href: homeFor(me), label: 'Volver', icon: ArrowLeft, exact: true }]}>
      <PageHeader title="Mi cuenta y seguridad" description="Tu contraseña, la verificación en dos pasos y los dispositivos con sesión abierta." />
      <div className="grid max-w-3xl gap-4">
        <PasswordCard />
        <MfaCard />
        <SessionsCard />
      </div>
    </Shell>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof KeyRound; children: string }) {
  return (
    <h2 className="flex items-center gap-2 text-xl font-semibold">
      <Icon className="size-5 text-muted" aria-hidden /> {children}
    </h2>
  );
}

function PasswordCard() {
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const submit = form.handleSubmit(async (values) => {
    try {
      await api('/account/password', { method: 'POST', body: values });
      form.reset();
      toast.success('Contraseña actualizada. Cerramos tus otras sesiones.');
    } catch (error) {
      handleFormError(error, form.setError, ['currentPassword', 'newPassword']);
    }
  });
  return (
    <Card className="p-6">
      <SectionTitle icon={KeyRound}>Contraseña</SectionTitle>
      <form onSubmit={submit} noValidate className="mt-5 grid gap-5 sm:grid-cols-2">
        <Field label="Contraseña actual" error={form.formState.errors.currentPassword?.message}>
          {(props) => <PasswordInput {...props} autoComplete="current-password" {...form.register('currentPassword')} />}
        </Field>
        <Field
          label="Nueva contraseña"
          error={form.formState.errors.newPassword?.message}
          hint={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres, con letra y número.`}
        >
          {(props) => <PasswordInput {...props} autoComplete="new-password" {...form.register('newPassword')} />}
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={form.formState.isSubmitting}>
            Cambiar contraseña
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MfaCard() {
  const { me, reload } = useSession();
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!setup) return setQr(null);
    // El código QR se dibuja en el navegador: el secreto no viaja a servicios externos.
    void QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 200 }).then(setQr);
  }, [setup]);

  const start = async () => {
    setBusy(true);
    try {
      setSetup(await api<MfaSetupResponse>('/account/mfa/setup', { method: 'POST' }));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const enable = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setCodeError(null);
    try {
      const result = await api<MfaEnabledResponse>('/account/mfa/enable', { method: 'POST', body: { code: code.trim() } });
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setCode('');
      await reload();
    } catch (error) {
      setCodeError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle icon={ShieldCheck}>Verificación en dos pasos</SectionTitle>
        {me?.mfaEnabled ? <Badge tone="ok">Activa</Badge> : <Badge>Inactiva</Badge>}
      </div>
      <p className="mt-2 max-w-xl text-muted">
        Además de tu contraseña, te pediremos un código de tu celular al iniciar sesión. Así nadie entra a tu cuenta aunque
        conozca tu contraseña.
      </p>

      {me?.mfaEnabled ? (
        <Button variant="secondary" className="mt-5" onClick={() => setDisabling(true)}>
          Desactivar verificación
        </Button>
      ) : !setup ? (
        <Button className="mt-5" loading={busy} onClick={() => void start()}>
          Activar verificación en dos pasos
        </Button>
      ) : (
        <form onSubmit={enable} className="mt-6 grid gap-6 sm:grid-cols-[200px_minmax(0,1fr)]">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="Código QR para configurar la aplicación de autenticación" width={200} height={200} className="rounded-xl border border-line bg-white p-2" />
          ) : (
            <Skeleton className="size-[200px]" />
          )}
          <div className="flex flex-col gap-4">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Abre Google Authenticator, Microsoft Authenticator o una aplicación similar.</li>
              <li>Escanea el código QR o escribe esta clave: <code className="break-all font-semibold">{setup.secret}</code></li>
              <li>Escribe aquí el código de 6 dígitos que te muestra la aplicación.</li>
            </ol>
            <Field label="Código de 6 dígitos" error={codeError ?? undefined}>
              {(props) => (
                <Input
                  {...props}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="max-w-40 text-center text-lg tracking-[0.3em]"
                />
              )}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" loading={busy} disabled={code.length !== 6}>
                Verificar y activar
              </Button>
              <Button variant="ghost" onClick={() => setSetup(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        </form>
      )}

      {recoveryCodes && (
        <Dialog
          open
          onOpenChange={(open) => !open && setRecoveryCodes(null)}
          title="Guarda tus códigos de recuperación"
          description="Te sirven para entrar si pierdes tu celular. Cada uno funciona una sola vez y no volveremos a mostrarlos."
        >
          <ul className="grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-4 font-mono text-sm">
            {recoveryCodes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="secondary"
              icon={Copy}
              onClick={() => void navigator.clipboard.writeText(recoveryCodes.join('\n')).then(() => toast.success('Códigos copiados.'))}
            >
              Copiar
            </Button>
            <Button onClick={() => setRecoveryCodes(null)}>Ya los guardé</Button>
          </div>
        </Dialog>
      )}
      {disabling && <DisableMfaDialog onClose={() => setDisabling(false)} />}
    </Card>
  );
}

function DisableMfaDialog({ onClose }: { onClose: () => void }) {
  const { reload } = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/account/mfa/disable', { method: 'POST', body: { password } });
      await reload();
      toast.success('Verificación en dos pasos desactivada.');
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Desactivar la verificación en dos pasos" description="Tu cuenta quedará protegida solo por la contraseña.">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="Confirma tu contraseña" error={error ?? undefined}>
          {(props) => <PasswordInput {...props} autoFocus autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" loading={busy} disabled={!password}>
            Desactivar verificación
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Dispositivo desconocido';
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Chrome\//.test(userAgent) ? 'Chrome' : /Firefox\//.test(userAgent) ? 'Firefox' : /Safari\//.test(userAgent) ? 'Safari' : 'Navegador';
  const system = /Windows/.test(userAgent) ? 'Windows' : /Android/.test(userAgent) ? 'Android' : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Mac OS/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : '';
  return system ? `${browser} en ${system}` : browser;
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['account', 'sessions'], queryFn: () => api<SessionSummary[]>('/account/sessions') });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['account', 'sessions'] });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/account/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await refresh();
      toast.success('Sesión cerrada.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const revokeOthers = useMutation({
    mutationFn: () => api('/account/sessions/revoke-others', { method: 'POST' }),
    onSuccess: async () => {
      await refresh();
      toast.success('Cerramos las demás sesiones.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const others = (sessions.data ?? []).filter((session) => !session.current).length;

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle icon={MonitorSmartphone}>Dispositivos con sesión abierta</SectionTitle>
        {others > 0 && (
          <Button variant="secondary" size="sm" loading={revokeOthers.isPending} onClick={() => revokeOthers.mutate()}>
            Cerrar las demás sesiones
          </Button>
        )}
      </div>
      {sessions.isPending ? (
        <Skeleton className="mt-5 h-20" />
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {sessions.data?.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 last:pb-0">
              {session.client === 'mobile' ? (
                <Smartphone className="size-5 shrink-0 text-muted" aria-hidden />
              ) : (
                <MonitorSmartphone className="size-5 shrink-0 text-muted" aria-hidden />
              )}
              <div className="min-w-0 flex-1 basis-48">
                <p className="font-medium">{describeDevice(session.userAgent)}</p>
                <p className="text-sm text-muted">Último uso: {formatDateTime(session.lastUsedAt)}</p>
              </div>
              {session.current ? (
                <Badge tone="ok">Este dispositivo</Badge>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => revoke.mutate(session.id)}>
                  Cerrar sesión
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
