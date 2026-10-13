'use client';

import { PASSWORD_MIN_LENGTH, passwordSchema } from '@brisas/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { CircleCheck } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '@/lib/api';
import { handleFormError } from '@/lib/forms';
import { PasswordInput } from './password-input';
import { Button, Field, buttonClass } from './ui';

const schema = z
  .object({ password: passwordSchema, confirm: z.string(), acceptPrivacyPolicy: z.boolean() })
  .refine((value) => value.password === value.confirm, { error: 'Las contraseñas no coinciden', path: ['confirm'] });

type Values = z.infer<typeof schema>;

/** Formulario compartido por "restablecer contraseña" y "aceptar invitación". */
export function SetPasswordForm({
  endpoint,
  token,
  submitLabel,
  successMessage,
  consent,
}: {
  endpoint: string;
  token: string;
  submitLabel: string;
  successMessage: string;
  /** Texto de la autorización de tratamiento de datos (solo al activar la cuenta). */
  consent?: ReactNode;
}) {
  const [done, setDone] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '', acceptPrivacyPolicy: false },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    if (consent && !values.acceptPrivacyPolicy) {
      form.setError('acceptPrivacyPolicy', { message: 'Debes aceptar la política de tratamiento de datos para continuar' });
      return;
    }
    try {
      await api(endpoint, {
        method: 'POST',
        skipRefresh: true,
        body: { token, password: values.password, ...(consent ? { acceptPrivacyPolicy: true } : {}) },
      });
      setDone(true);
    } catch (error) {
      handleFormError(error, form.setError, ['password', 'acceptPrivacyPolicy']);
    }
  });

  if (done) {
    return (
      <div className="flex flex-col gap-5">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-ok-soft text-ok">
          <CircleCheck className="size-6" aria-hidden />
        </span>
        <p>{successMessage}</p>
        <Link href="/login" className={buttonClass('primary')}>
          Iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field
        label="Nueva contraseña"
        error={errors.password?.message}
        hint={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres, con al menos una letra y un número.`}
      >
        {(props) => <PasswordInput {...props} autoComplete="new-password" autoFocus {...form.register('password')} />}
      </Field>
      <Field label="Repite la contraseña" error={errors.confirm?.message}>
        {(props) => <PasswordInput {...props} autoComplete="new-password" {...form.register('confirm')} />}
      </Field>
      {consent && (
        <div>
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 size-4 accent-(--brand)" {...form.register('acceptPrivacyPolicy')} />
            <span>{consent}</span>
          </label>
          {errors.acceptPrivacyPolicy && (
            <p role="alert" className="mt-1.5 text-sm text-danger">
              {errors.acceptPrivacyPolicy.message}
            </p>
          )}
        </div>
      )}
      <Button type="submit" loading={form.formState.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
}
