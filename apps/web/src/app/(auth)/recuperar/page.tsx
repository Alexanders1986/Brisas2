'use client';

import { type ForgotPasswordInput, forgotPasswordSchema } from '@brisas/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { AuthLayout } from '@/components/auth-layout';
import { Button, Field, Input, buttonClass } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });

  const submit = form.handleSubmit(async (values) => {
    try {
      await api('/auth/password/forgot', { method: 'POST', body: values, skipRefresh: true });
      setSentTo(values.email);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  if (sentTo) {
    return (
      <AuthLayout title="Revisa tu correo">
        <div className="flex flex-col gap-5">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand-ink">
            <MailCheck className="size-6" aria-hidden />
          </span>
          <p>
            Si <strong>{sentTo}</strong> está registrado, en unos minutos recibirás un enlace para crear una nueva
            contraseña. El enlace vence en una hora.
          </p>
          <p className="text-sm text-muted">¿No llega? Revisa la carpeta de correo no deseado o pide el enlace otra vez.</p>
          <Link href="/login" className={buttonClass('secondary')}>
            Volver a iniciar sesión
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Recupera tu contraseña" description="Te enviaremos un enlace para crear una nueva.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <Field label="Correo electrónico" error={form.formState.errors.email?.message}>
          {(props) => <Input {...props} type="email" autoComplete="email" autoFocus {...form.register('email')} />}
        </Field>
        <Button type="submit" loading={form.formState.isSubmitting}>
          Enviar enlace
        </Button>
        <Link href="/login" className="self-center text-sm font-medium text-brand-ink hover:underline">
          Volver a iniciar sesión
        </Link>
      </form>
    </AuthLayout>
  );
}
