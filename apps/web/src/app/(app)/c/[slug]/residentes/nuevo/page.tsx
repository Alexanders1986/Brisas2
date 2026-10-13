'use client';

import {
  type CreateResidentData,
  type CreateResidentInput,
  type CreateResidentResponse,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  GENDERS,
  GENDER_LABELS,
  type DuplicateCheckResponse,
  type DuplicateMatch,
  PARKING_KINDS,
  PARKING_KIND_LABELS,
  PET_SPECIES,
  PET_SPECIES_LABELS,
  type Paginated,
  type PropertySummary,
  RELATIONSHIP_LABELS,
  type TowerSummary,
  createResidentSchema,
} from '@brisas/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Building2, Check, Handshake, KeyRound, Plus, Trash2, UserCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { type FieldPath, useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useTenant } from '@/components/tenant-context';
import { Button, Card, ChoiceCard, EmptyState, Field, IconButton, Input, PageHeader, Select, Toggle, buttonClass, cx } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { formatDate, todayIso } from '@/lib/forms';

type Values = CreateResidentInput;

const STEPS: { title: string; fields: FieldPath<Values>[] }[] = [
  { title: 'Datos personales', fields: ['person', 'relationship'] },
  { title: 'Unidad', fields: ['propertyId', 'startDate', 'householdSize'] },
  { title: 'Parqueaderos y depósitos', fields: ['parkingSpaces', 'storageUnits'] },
  { title: 'Mascotas', fields: ['pets'] },
  { title: 'Documentos y acceso', fields: ['libertadTradicionAvailable', 'sendInvitation'] },
  { title: 'Confirmación', fields: [] },
];

const EMPTY_PERSON = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  documentType: '' as const,
  documentNumber: '',
  gender: '' as const,
  birthDate: '',
};

export default function NewResidentPage() {
  const tenant = useTenant();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [towerId, setTowerId] = useState('');
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const [existing, setExisting] = useState<DuplicateMatch | null>(null);

  const form = useForm<Values, unknown, CreateResidentData>({
    resolver: zodResolver(createResidentSchema),
    mode: 'onTouched',
    defaultValues: {
      person: EMPTY_PERSON,
      propertyId: '',
      startDate: todayIso(),
      householdSize: 1,
      parkingSpaces: [],
      storageUnits: [],
      pets: [],
      libertadTradicionAvailable: false,
      sendInvitation: false,
    },
  });
  const { register, formState, watch } = form;
  const errors = formState.errors;
  const parking = useFieldArray({ control: form.control, name: 'parkingSpaces' });
  const storage = useFieldArray({ control: form.control, name: 'storageUnits' });
  const pets = useFieldArray({ control: form.control, name: 'pets' });
  const values = watch();

  const towers = useQuery({
    queryKey: [tenant.tenantId, 'towers'],
    queryFn: () => api<TowerSummary[]>(`${tenant.apiPath}/towers`),
  });
  const units = useQuery({
    queryKey: [tenant.tenantId, 'properties', 'all'],
    queryFn: () => api<Paginated<PropertySummary>>(`${tenant.apiPath}/properties`, { query: { pageSize: 500 } }),
  });
  const allUnits = units.data?.items ?? [];
  const hasTowers = (towers.data?.length ?? 0) > 0;
  const visibleUnits = hasTowers && towerId ? allUnits.filter((unit) => unit.towerId === towerId) : hasTowers ? [] : allUnits;
  const selectedUnit = allUnits.find((unit) => unit.id === values.propertyId);

  /** Avisa mientras se escribe si la persona ya existe, antes de llegar al final del asistente. */
  const checkDuplicate = async () => {
    const email = form.getValues('person.email');
    const documentNumber = form.getValues('person.documentNumber');
    if (!email && !documentNumber) return setDuplicate(null);
    try {
      const result = await api<DuplicateCheckResponse>(`${tenant.apiPath}/residents/duplicates`, {
        query: { email, documentNumber },
      });
      setDuplicate(result.matches[0] ?? null);
    } catch {
      // La verificación definitiva la hace el servidor al guardar.
    }
  };

  const linkExisting = (match: DuplicateMatch) => {
    setExisting(match);
    setDuplicate(null);
    form.setValue('existingPersonId', match.personId);
    form.setValue('person', undefined);
    form.clearErrors('person');
  };
  const unlinkExisting = () => {
    setExisting(null);
    form.setValue('existingPersonId', undefined);
    form.setValue('person', EMPTY_PERSON);
  };

  const next = async () => {
    const valid = await form.trigger(STEPS[step]!.fields, { shouldFocus: true });
    if (!valid) return;
    if (step === 0 && duplicate) {
      toast.error(`${duplicate.fullName} ya está registrada. Vincúlala o corrige el dato repetido.`);
      return;
    }
    setStep((current) => current + 1);
    window.scrollTo({ top: 0 });
  };

  const save = form.handleSubmit(
    async (data) => {
      try {
        const created = await api<CreateResidentResponse>(`${tenant.apiPath}/residents`, { method: 'POST', body: data });
        await queryClient.invalidateQueries({ queryKey: [tenant.tenantId] });
        toast.success(created.invitationSent ? 'Residente registrado. Enviamos la invitación a su correo.' : 'Residente registrado.');
        router.replace(`${tenant.path}/residentes/${created.personId}`);
      } catch (error) {
        toast.error(errorMessage(error));
        if (!(error instanceof ApiError)) return;
        // Lleva cada error del servidor a su campo y vuelve al primer paso que lo contiene.
        const fields = Object.keys(error.fields);
        for (const field of fields) form.setError(field as FieldPath<Values>, { type: 'server', message: error.fields[field] });
        const firstStep = STEPS.findIndex((item) => item.fields.some((name) => fields.some((field) => field.startsWith(name))));
        if (firstStep >= 0) setStep(firstStep);
      }
    },
    () => toast.error('Hay datos por corregir. Revisa los pasos anteriores.'),
  );

  if (units.isSuccess && allUnits.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Building2}
          title="Primero crea las unidades del conjunto"
          description="Para registrar un residente necesitas al menos una unidad a la cual vincularlo."
          action={
            <Link href={`${tenant.path}/unidades`} className={buttonClass('primary')}>
              Crear torres y unidades
            </Link>
          }
        />
      </Card>
    );
  }

  const isLast = step === STEPS.length - 1;
  const personError = (name: keyof typeof EMPTY_PERSON) => errors.person?.[name]?.message;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Registrar residente"
        crumbs={[{ label: 'Residentes', href: `${tenant.path}/residentes` }, { label: 'Registrar' }]}
      />

      <ol className="mb-6 flex items-start gap-1.5" aria-label="Pasos del registro">
        {STEPS.map((item, index) => (
          <li key={item.title} className="flex flex-1 flex-col gap-2" aria-current={index === step ? 'step' : undefined}>
            <span className={cx('h-1.5 rounded-full transition-colors', index <= step ? 'bg-brand' : 'bg-line')} />
            <span className={cx('hidden text-xs sm:block', index === step ? 'font-semibold text-ink' : 'text-muted')}>
              {index + 1}. {item.title}
            </span>
          </li>
        ))}
      </ol>
      <p className="mb-2 text-sm text-muted sm:hidden">
        Paso {step + 1} de {STEPS.length}
      </p>

      <form onSubmit={(event) => event.preventDefault()} noValidate>
        <Card className="p-6 sm:p-8">
          <h2 className="mb-6 text-xl font-semibold">{STEPS[step]!.title}</h2>

          {step === 0 && (
            <div className="flex flex-col gap-5">
              {existing ? (
                <div className="flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-brand bg-brand-soft p-4">
                  <UserCheck className="size-5 shrink-0 text-brand-ink" aria-hidden />
                  <p className="min-w-0 flex-1">
                    Vas a vincular a <strong>{existing.fullName}</strong>, que ya está registrada en el conjunto.
                  </p>
                  <Button variant="secondary" size="sm" onClick={unlinkExisting}>
                    Registrar a otra persona
                  </Button>
                </div>
              ) : (
                <>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field label="Nombres" error={personError('firstName')}>
                      {(props) => <Input {...props} autoComplete="off" autoFocus {...register('person.firstName')} />}
                    </Field>
                    <Field label="Apellidos" error={personError('lastName')}>
                      {(props) => <Input {...props} autoComplete="off" {...register('person.lastName')} />}
                    </Field>
                    <Field label="Correo electrónico" optional error={personError('email')} hint="Lo necesitas para darle acceso al portal.">
                      {(props) => (
                        <Input {...props} type="email" autoComplete="off" {...register('person.email', { onBlur: checkDuplicate })} />
                      )}
                    </Field>
                    <Field label="Celular" error={personError('phone')} hint="Obligatorio: es el contacto principal de la unidad.">
                      {(props) => <Input {...props} type="tel" autoComplete="off" {...register('person.phone')} />}
                    </Field>
                    <Field label="Género" optional error={personError('gender')}>
                      {(props) => (
                        <Select {...props} {...register('person.gender')}>
                          <option value="">Selecciona</option>
                          {GENDERS.map((gender) => (
                            <option key={gender} value={gender}>
                              {GENDER_LABELS[gender]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Fecha de nacimiento" optional error={personError('birthDate')}>
                      {(props) => <Input {...props} type="date" min="1900-01-01" {...register('person.birthDate')} />}
                    </Field>
                    <Field label="Tipo de documento" optional error={personError('documentType')}>
                      {(props) => (
                        <Select {...props} {...register('person.documentType')}>
                          <option value="">Selecciona</option>
                          {DOCUMENT_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {DOCUMENT_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label="Número de documento" optional error={personError('documentNumber')}>
                      {(props) => (
                        <Input {...props} autoComplete="off" {...register('person.documentNumber', { onBlur: checkDuplicate })} />
                      )}
                    </Field>
                  </div>
                  {duplicate && (
                    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-warn/40 bg-warn-soft p-4">
                      <p className="min-w-0 flex-1">
                        <strong>{duplicate.fullName}</strong> ya está registrada con ese{' '}
                        {duplicate.matchedBy === 'email' ? 'correo' : 'documento'}. Para no duplicarla, vincúlala a la nueva unidad.
                      </p>
                      <Button size="sm" onClick={() => linkExisting(duplicate)}>
                        Vincular a {duplicate.fullName.split(' ')[0]}
                      </Button>
                    </div>
                  )}
                </>
              )}

              <fieldset>
                <legend className="mb-2 text-sm font-medium">Tipo de vinculación</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <ChoiceCard type="radio" value="owner" icon={KeyRound} title={RELATIONSHIP_LABELS.owner} description="Dueño de la unidad" {...register('relationship')} />
                  <ChoiceCard type="radio" value="tenant" icon={Handshake} title={RELATIONSHIP_LABELS.tenant} description="Vive en arriendo" {...register('relationship')} />
                  <ChoiceCard type="radio" value="authorized" icon={UserRound} title="Otro autorizado" description="Familiar o apoderado" {...register('relationship')} />
                </div>
                {errors.relationship && (
                  <p role="alert" className="mt-1.5 text-sm text-danger">
                    {errors.relationship.message}
                  </p>
                )}
              </fieldset>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-5 sm:grid-cols-2">
              {hasTowers && (
                <Field label="Torre o bloque">
                  {(props) => (
                    <Select
                      {...props}
                      value={towerId}
                      onChange={(event) => {
                        setTowerId(event.target.value);
                        form.setValue('propertyId', '');
                      }}
                    >
                      <option value="">Selecciona</option>
                      {towers.data!.map((tower) => (
                        <option key={tower.id} value={tower.id}>
                          {tower.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <Field
                label="Apartamento o casa"
                error={errors.propertyId ? 'Selecciona la unidad' : undefined}
                hint={hasTowers && !towerId ? 'Elige primero la torre.' : undefined}
              >
                {(props) => (
                  <Select {...props} disabled={hasTowers && !towerId} {...register('propertyId')}>
                    <option value="">Selecciona</option>
                    {visibleUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.number}
                        {unit.floor ? ` (piso ${unit.floor})` : ''}
                        {unit.activeOccupants > 0 ? ', ya tiene residentes' : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Fecha de vinculación" error={errors.startDate?.message}>
                {(props) => <Input {...props} type="date" max="2100-12-31" {...register('startDate')} />}
              </Field>
              <Field label="Personas que viven en la unidad" error={errors.householdSize?.message} hint="Contando a esta persona.">
                {(props) => <Input {...props} type="number" min={1} max={50} inputMode="numeric" {...register('householdSize')} />}
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-8">
              <Repeater
                title="Parqueaderos"
                empty="Esta unidad no tiene parqueaderos asignados."
                addLabel="Agregar parqueadero"
                onAdd={() => parking.append({ number: '', kind: 'car' })}
              >
                {parking.fields.map((field, index) => (
                  <div key={field.id} className="flex items-start gap-3">
                    <Field label="Número" className="flex-1" error={errors.parkingSpaces?.[index]?.number?.message}>
                      {(props) => <Input {...props} placeholder="P-12" {...register(`parkingSpaces.${index}.number`)} />}
                    </Field>
                    <Field label="Tipo" className="w-36">
                      {(props) => (
                        <Select {...props} {...register(`parkingSpaces.${index}.kind`)}>
                          {PARKING_KINDS.map((kind) => (
                            <option key={kind} value={kind}>
                              {PARKING_KIND_LABELS[kind]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <IconButton label="Quitar parqueadero" icon={Trash2} className="mt-7" onClick={() => parking.remove(index)} />
                  </div>
                ))}
              </Repeater>
              <Repeater
                title="Depósitos"
                empty="Esta unidad no tiene depósitos asignados."
                addLabel="Agregar depósito"
                onAdd={() => storage.append({ number: '' })}
              >
                {storage.fields.map((field, index) => (
                  <div key={field.id} className="flex items-start gap-3">
                    <Field label="Número" className="flex-1" error={errors.storageUnits?.[index]?.number?.message}>
                      {(props) => <Input {...props} placeholder="D-05" {...register(`storageUnits.${index}.number`)} />}
                    </Field>
                    <IconButton label="Quitar depósito" icon={Trash2} className="mt-7" onClick={() => storage.remove(index)} />
                  </div>
                ))}
              </Repeater>
            </div>
          )}

          {step === 3 && (
            <Repeater title="Mascotas" empty="No hay mascotas registradas." addLabel="Agregar mascota" onAdd={() => pets.append({ species: 'dog', breed: '', name: '' })}>
              {pets.fields.map((field, index) => (
                <div key={field.id} className="flex flex-wrap items-start gap-3">
                  <Field label="Tipo de animal" className="w-32">
                    {(props) => (
                      <Select {...props} {...register(`pets.${index}.species`)}>
                        {PET_SPECIES.map((species) => (
                          <option key={species} value={species}>
                            {PET_SPECIES_LABELS[species]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Raza" optional className="min-w-32 flex-1" error={errors.pets?.[index]?.breed?.message}>
                    {(props) => <Input {...props} {...register(`pets.${index}.breed`)} />}
                  </Field>
                  <Field label="Nombre" optional className="min-w-32 flex-1" error={errors.pets?.[index]?.name?.message}>
                    {(props) => <Input {...props} {...register(`pets.${index}.name`)} />}
                  </Field>
                  <IconButton label="Quitar mascota" icon={Trash2} className="mt-7" onClick={() => pets.remove(index)} />
                </div>
              ))}
            </Repeater>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-4">
              <Toggle
                label="La administración tiene el certificado de libertad y tradición"
                description="Marca esta opción si ya recibiste el certificado de esta unidad."
                {...register('libertadTradicionAvailable')}
              />
              <Toggle
                label="Dar acceso al portal de residentes"
                description="Le enviaremos un correo para que cree su contraseña."
                {...register('sendInvitation')}
              />
              {errors.person?.email?.type === 'custom' && (
                <p role="alert" className="text-sm text-danger">
                  Para enviar la invitación vuelve al primer paso y escribe el correo de la persona.
                </p>
              )}
            </div>
          )}

          {isLast && (
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <Summary label="Persona">
                {existing ? existing.fullName : `${values.person?.firstName ?? ''} ${values.person?.lastName ?? ''}`}
                {!existing && values.person?.email && <span className="block text-sm text-muted">{values.person.email}</span>}
              </Summary>
              <Summary label="Vinculación">
                {values.relationship ? RELATIONSHIP_LABELS[values.relationship] : '—'}
                <span className="block text-sm text-muted">desde el {formatDate(values.startDate)}</span>
              </Summary>
              <Summary label="Unidad">
                {selectedUnit?.label ?? '—'}
                <span className="block text-sm text-muted">
                  {Number(values.householdSize) === 1 ? '1 persona' : `${String(values.householdSize)} personas`} en la unidad
                </span>
              </Summary>
              <Summary label="Parqueaderos y depósitos">
                {[...(values.parkingSpaces ?? []), ...(values.storageUnits ?? [])].map((item) => item.number).join(', ') || 'Ninguno'}
              </Summary>
              <Summary label="Mascotas">
                {(values.pets ?? []).map((pet) => pet.name || PET_SPECIES_LABELS[pet.species]).join(', ') || 'Ninguna'}
              </Summary>
              <Summary label="Certificado de libertad y tradición">
                {values.libertadTradicionAvailable ? 'Disponible' : 'Pendiente'}
              </Summary>
              <Summary label="Acceso al portal">
                {values.sendInvitation ? 'Se enviará la invitación por correo' : 'Sin acceso por ahora'}
              </Summary>
            </dl>
          )}
        </Card>

        <div className="mt-5 flex items-center justify-between gap-3">
          {step === 0 ? (
            <Link href={`${tenant.path}/residentes`} className={buttonClass('ghost')}>
              Cancelar
            </Link>
          ) : (
            <Button variant="secondary" icon={ArrowLeft} onClick={() => setStep(step - 1)}>
              Atrás
            </Button>
          )}
          {isLast ? (
            <Button icon={Check} loading={formState.isSubmitting} onClick={() => void save()}>
              Guardar residente
            </Button>
          ) : (
            <Button onClick={() => void next()}>
              Continuar <ArrowRight className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function Repeater({
  title,
  empty,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  empty: string;
  addLabel: string;
  onAdd: () => void;
  children: ReactNode[];
}) {
  return (
    <section>
      <h3 className="mb-3 font-display font-semibold">{title}</h3>
      {children.length === 0 ? <p className="mb-3 text-muted">{empty}</p> : <div className="mb-3 flex flex-col gap-4">{children}</div>}
      <Button variant="secondary" size="sm" icon={Plus} onClick={onAdd}>
        {addLabel}
      </Button>
    </section>
  );
}

function Summary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
