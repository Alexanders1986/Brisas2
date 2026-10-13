'use client';

import { type LoginInput, type LoginResponse, loginSchema } from '@brisas/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AuthLayout } from '@/components/auth-layout';
import { PasswordInput } from '@/components/password-input';
import { useSession } from '@/components/providers';
import { Button, Field, Input } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { homeFor } from '@/lib/routes';

export default function LoginPage() {
  const router = useRouter();
  const session = useSession();
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  // Quien ya tiene sesión no necesita ver esta pantalla.
  useEffect(() => {
    if (session.status === 'authenticated' && session.me) router.replace(homeFor(session.me));
  }, [session.status, session.me, router]);

  const finish = async (login: LoginResponse) => {
    if (login.status === 'mfa_required') {
      setChallengeToken(login.challengeToken);
      return;
    }
    router.replace(homeFor(await session.signIn(login)));
  };

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await finish(await api<LoginResponse>('/auth/login', { method: 'POST', body: values, skipRefresh: true }));
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  if (challengeToken) {
    return <MfaStep challengeToken={challengeToken} onDone={finish} onCancel={() => setChallengeToken(null)} />;
  }

  return (
    <AuthLayout title="Inicia sesión" description="Entra con el correo que registró la administración de tu conjunto.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field label="Correo electrónico" error={form.formState.errors.email?.message}>
          {(props) => <Input {...props} type="email" autoComplete="email" autoFocus {...form.register('email')} />}
        </Field>
        <Field label="Contraseña" error={form.formState.errors.password?.message}>
          {(props) => <PasswordInput {...props} autoComplete="current-password" {...form.register('password')} />}
        </Field>
        {formError && (
          <p role="alert" className="rounded-(--radius-control) bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {formError}
          </p>
        )}
        <Button type="submit" loading={form.formState.isSubmitting}>
          Iniciar sesión
        </Button>
        <Link href="/recuperar" className="self-center text-sm font-medium text-brand-ink hover:underline">
          Olvidé mi contraseña
        </Link>
      </form>
    </AuthLayout>
  );
}

function MfaStep({
  challengeToken,
  onDone,
  onCancel,
}: {
  challengeToken: string;
  onDone: (login: LoginResponse) => Promise<void>;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await onDone(
        await api<LoginResponse>('/auth/mfa/verify', {
          method: 'POST',
          body: { challengeToken, code: code.trim() },
          skipRefresh: true,
        }),
      );
    } catch (caught) {
      // Si la verificación venció hay que volver a escribir la contraseña.
      if (caught instanceof ApiError && caught.code === 'MFA_CHALLENGE_EXPIRED') onCancel();
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Verificación en dos pasos"
      description="Escribe el código de 6 dígitos de tu aplicación de autenticación, o uno de tus códigos de recuperación."
    >
      <form onSubmit={submit} className="flex flex-col gap-5">
        <Field label="Código de verificación" error={error ?? undefined}>
          {(props) => (
            <Input
              {...props}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              className="text-center text-lg tracking-[0.3em]"
            />
          )}
        </Field>
        <Button type="submit" loading={loading} disabled={code.trim().length < 6}>
          Verificar y entrar
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Volver
        </Button>
      </form>
    </AuthLayout>
  );
}
