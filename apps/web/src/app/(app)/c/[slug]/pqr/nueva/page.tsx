'use client';

import {
  type CreatePqrInput,
  type MyHouseholdResponse,
  PQR_CATEGORIES,
  PQR_TYPES,
  PQR_TYPE_HINTS,
  PQR_TYPE_LABELS,
  type PqrDetail,
  createPqrSchema,
} from '@brisas/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { useTenant } from '@/components/tenant-context';
import { Button, Card, ChoiceCard, Field, Input, PageHeader, Select, buttonClass } from '@/components/ui';
import { api } from '@/lib/api';
import { handleFormError } from '@/lib/forms';

const TEXTAREA =
  'min-h-36 w-full rounded-(--radius-control) border border-line bg-surface px-3 py-2.5 text-[15px] transition placeholder:text-muted/70 hover:border-muted/60 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 aria-[invalid=true]:border-danger';

export default function NewPqrPage() {
  const tenant = useTenant();
  const router = useRouter();
  const queryClient = useQueryClient();
  const title = tenant.can('pqr.read_all') ? 'PQR' : 'Mis solicitudes';

  const household = useQuery({
    queryKey: [tenant.tenantId, 'my-household'],
    queryFn: () => api<MyHouseholdResponse>(`${tenant.apiPath}/my/household`),
    enabled: tenant.can('household.manage_own'),
  });
  const units = household.data?.units ?? [];

  const form = useForm<CreatePqrInput, unknown, z.output<typeof createPqrSchema>>({
    resolver: zodResolver(createPqrSchema),
    defaultValues: { category: '' as CreatePqrInput['category'], subject: '', description: '', propertyId: '' },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      const created = await api<PqrDetail>(`${tenant.apiPath}/pqrs`, { method: 'POST', body: values });
      await queryClient.invalidateQueries({ queryKey: [tenant.tenantId] });
      toast.success(`Solicitud radicada con el número ${created.filingNumber}.`);
      router.replace(`${tenant.path}/pqr/${created.id}`);
    } catch (error) {
      handleFormError(error, form.setError, ['type', 'category', 'subject', 'description', 'propertyId']);
    }
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Radicar solicitud"
        description="Cuéntale a la administración qué necesitas. Recibirás un número de radicado para hacerle seguimiento."
        crumbs={[{ label: title, href: `${tenant.path}/pqr` }, { label: 'Radicar' }]}
      />
      <form onSubmit={submit} noValidate>
        <Card className="flex flex-col gap-6 p-6 sm:p-8">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">¿Qué tipo de solicitud es?</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {PQR_TYPES.map((type) => (
                <ChoiceCard key={type} type="radio" value={type} title={PQR_TYPE_LABELS[type]} description={PQR_TYPE_HINTS[type]} {...form.register('type')} />
              ))}
            </div>
            {errors.type && (
              <p role="alert" className="mt-1.5 text-sm text-danger">
                {errors.type.message}
              </p>
            )}
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Categoría" error={errors.category?.message}>
              {(props) => (
                <Select {...props} {...form.register('category')}>
                  <option value="">Selecciona</option>
                  {PQR_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {units.length > 1 && (
              <Field label="Unidad" optional error={errors.propertyId?.message}>
                {(props) => (
                  <Select {...props} {...form.register('propertyId')}>
                    <option value="">No aplica</option>
                    {units.map((unit) => (
                      <option key={unit.propertyId} value={unit.propertyId}>
                        {unit.propertyLabel}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>

          <Field label="Asunto" error={errors.subject?.message} hint="Una frase corta que resuma tu solicitud.">
            {(props) => <Input {...props} maxLength={160} {...form.register('subject')} />}
          </Field>
          <Field label="Descripción" error={errors.description?.message} hint="Incluye cuándo ocurrió, dónde y cualquier detalle que ayude a resolverlo.">
            {(props) => <textarea {...props} className={TEXTAREA} maxLength={5000} {...form.register('description')} />}
          </Field>
        </Card>
        <div className="mt-5 flex items-center justify-between gap-3">
          <Link href={`${tenant.path}/pqr`} className={buttonClass('ghost')}>
            Cancelar
          </Link>
          <Button type="submit" icon={Send} loading={form.formState.isSubmitting}>
            Radicar solicitud
          </Button>
        </div>
      </form>
    </div>
  );
}
