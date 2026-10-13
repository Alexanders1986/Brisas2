'use client';

import {
  GENDERS,
  GENDER_LABELS,
  type HouseholdMember,
  type HouseholdMemberInput,
  type HouseholdPet,
  type HouseholdPetInput,
  KINSHIPS,
  PET_SEXES,
  PET_SEX_LABELS,
  PET_SPECIES,
  PET_SPECIES_LABELS,
  householdPetSchema,
  KINSHIP_LABELS,
  POWERTRAINS,
  POWERTRAIN_LABELS,
  type PropertyHousehold,
  RELATIONSHIP_LABELS,
  VEHICLE_KINDS,
  VEHICLE_KIND_LABELS,
  type Vehicle,
  type VehicleInput,
  ageFrom,
  householdMemberSchema,
  vehicleSchema,
} from '@brisas/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { BellRing, Bike, Bird, Car, Cat, Dog, PawPrint, Pencil, Phone, Plus, Syringe, Trash2, UserRound, Zap } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { api, errorMessage } from '@/lib/api';
import { handleFormError, initials } from '@/lib/forms';
import { useTenant } from './tenant-context';
import { Badge, Button, Card, ConfirmDialog, Dialog, Field, IconButton, Input, Select, Toggle } from './ui';

type Modal =
  | { type: 'member'; member?: HouseholdMember }
  | { type: 'vehicle'; vehicle?: Vehicle }
  | { type: 'removeMember'; member: HouseholdMember }
  | { type: 'removeVehicle'; vehicle: Vehicle }
  | { type: 'pet'; pet?: HouseholdPet }
  | { type: 'removePet'; pet: HouseholdPet };

/** Quiénes viven en una unidad y qué vehículos tienen, con edición si quien mira puede. */
export function HouseholdPanel({ household, onChanged }: { household: PropertyHousehold; onChanged: () => Promise<unknown> }) {
  const tenant = useTenant();
  const [modal, setModal] = useState<Modal | null>(null);
  const [removing, setRemoving] = useState(false);
  const close = () => setModal(null);
  const unitUrl = `${tenant.apiPath}/properties/${household.propertyId}`;
  const { canManage } = household;

  const remove = async (url: string, done: string) => {
    setRemoving(true);
    try {
      await api(url, { method: 'DELETE' });
      await onChanged();
      toast.success(done);
      close();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-display text-lg font-semibold">Personas que viven aquí</h3>
          {canManage && (
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setModal({ type: 'member' })}>
              Agregar persona
            </Button>
          )}
        </div>
        <ul className="divide-y divide-line">
          {household.residents.map((resident) => (
            <li key={resident.personId} className="flex items-center gap-3 py-3 first:pt-0">
              <Avatar name={resident.fullName} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{resident.fullName}</p>
                <p className="text-sm text-muted">{RELATIONSHIP_LABELS[resident.relationship]}</p>
              </div>
              <Badge tone="brand">Residente principal</Badge>
            </li>
          ))}
          {household.members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <Avatar name={`${member.firstName} ${member.lastName}`} />
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate font-medium">
                  {member.firstName} {member.lastName}
                </p>
                <p className="text-sm text-muted">
                  {KINSHIP_LABELS[member.kinship]}, {GENDER_LABELS[member.gender].toLowerCase()}, {formatAge(member.birthDate)}
                </p>
                {member.phone && (
                  <p className="flex items-center gap-1.5 text-sm text-muted">
                    <Phone className="size-3.5" aria-hidden /> {member.phone}
                  </p>
                )}
              </div>
              {member.receivesNotifications && (
                <Badge tone="ok" icon={BellRing}>
                  Recibe notificaciones
                </Badge>
              )}
              {canManage && (
                <span className="flex">
                  <IconButton label={`Editar a ${member.firstName}`} icon={Pencil} onClick={() => setModal({ type: 'member', member })} />
                  <IconButton label={`Quitar a ${member.firstName}`} icon={Trash2} onClick={() => setModal({ type: 'removeMember', member })} />
                </span>
              )}
            </li>
          ))}
        </ul>
        {household.members.length === 0 && (
          <p className="mt-3 text-sm text-muted">
            {canManage
              ? 'Agrega a tu pareja, hijos, padres u otras personas que vivan en la unidad.'
              : 'No hay más personas registradas en esta unidad.'}
          </p>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-display text-lg font-semibold">Vehículos</h3>
          {canManage && (
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setModal({ type: 'vehicle' })}>
              Agregar vehículo
            </Button>
          )}
        </div>
        {household.vehicles.length === 0 ? (
          <p className="text-sm text-muted">
            {canManage ? 'Registra carros, motos y bicicletas para que la portería los reconozca.' : 'No hay vehículos registrados.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {household.vehicles.map((vehicle) => {
              const Icon = vehicle.kind === 'car' ? Car : Bike;
              const title = [vehicle.brand, vehicle.model, vehicle.modelYear].filter(Boolean).join(' ') || VEHICLE_KIND_LABELS[vehicle.kind];
              return (
                <li key={vehicle.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate font-medium">
                      {vehicle.plate ? <span className="mr-2 rounded border border-line px-1.5 py-0.5 text-sm tabular-nums">{vehicle.plate}</span> : null}
                      {title}
                    </p>
                    <p className="text-sm text-muted">
                      {VEHICLE_KIND_LABELS[vehicle.kind]}, color {vehicle.color.toLowerCase()}
                    </p>
                  </div>
                  {(vehicle.powertrain === 'electric' || vehicle.powertrain === 'hybrid') && (
                    <Badge tone="ok" icon={Zap}>
                      {POWERTRAIN_LABELS[vehicle.powertrain]}
                    </Badge>
                  )}
                  {canManage && (
                    <span className="flex">
                      <IconButton label="Editar vehículo" icon={Pencil} onClick={() => setModal({ type: 'vehicle', vehicle })} />
                      <IconButton label="Quitar vehículo" icon={Trash2} onClick={() => setModal({ type: 'removeVehicle', vehicle })} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-display text-lg font-semibold">Mascotas</h3>
          {canManage && (
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setModal({ type: 'pet' })}>
              Agregar mascota
            </Button>
          )}
        </div>
        {household.pets.length === 0 ? (
          <p className="text-sm text-muted">
            {canManage ? 'Registra a tus mascotas para que la administración las conozca.' : 'No hay mascotas registradas.'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {household.pets.map((pet) => {
              const Icon = pet.species === 'dog' ? Dog : pet.species === 'cat' ? Cat : pet.species === 'bird' ? Bird : PawPrint;
              const details = [
                PET_SPECIES_LABELS[pet.species],
                pet.breed,
                pet.sex ? PET_SEX_LABELS[pet.sex].toLowerCase() : null,
                pet.color ? `color ${pet.color.toLowerCase()}` : null,
              ].filter(Boolean);
              return (
                <li key={pet.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate font-medium">{pet.name ?? 'Sin nombre'}</p>
                    <p className="text-sm text-muted">{details.join(', ')}</p>
                  </div>
                  {pet.vaccinesUpToDate && (
                    <Badge tone="ok" icon={Syringe}>
                      Vacunas al día
                    </Badge>
                  )}
                  {canManage && (
                    <span className="flex">
                      <IconButton label={`Editar a ${pet.name ?? 'la mascota'}`} icon={Pencil} onClick={() => setModal({ type: 'pet', pet })} />
                      <IconButton label={`Quitar a ${pet.name ?? 'la mascota'}`} icon={Trash2} onClick={() => setModal({ type: 'removePet', pet })} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {modal?.type === 'pet' && <PetDialog unitUrl={unitUrl} pet={modal.pet} onClose={close} onSaved={onChanged} />}
      {modal?.type === 'removePet' && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && close()}
          title={`Quitar a ${modal.pet.name ?? 'la mascota'}`}
          description="Dejará de aparecer como mascota de esta unidad."
          confirmLabel="Quitar mascota"
          danger
          loading={removing}
          onConfirm={() => void remove(`${unitUrl}/pets/${modal.pet.id}`, 'Mascota quitada.')}
        />
      )}
      {modal?.type === 'member' && <MemberDialog unitUrl={unitUrl} member={modal.member} onClose={close} onSaved={onChanged} />}
      {modal?.type === 'vehicle' && <VehicleDialog unitUrl={unitUrl} vehicle={modal.vehicle} onClose={close} onSaved={onChanged} />}
      {modal?.type === 'removeMember' && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && close()}
          title={`Quitar a ${modal.member.firstName} del hogar`}
          description="Sus datos se eliminarán de esta unidad. Puedes volver a registrarla cuando quieras."
          confirmLabel="Quitar persona"
          danger
          loading={removing}
          onConfirm={() => void remove(`${unitUrl}/household-members/${modal.member.id}`, 'Persona quitada del hogar.')}
        />
      )}
      {modal?.type === 'removeVehicle' && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && close()}
          title={`Quitar el vehículo${modal.vehicle.plate ? ` ${modal.vehicle.plate}` : ''}`}
          description="Dejará de aparecer como vehículo de esta unidad."
          confirmLabel="Quitar vehículo"
          danger
          loading={removing}
          onConfirm={() => void remove(`${unitUrl}/vehicles/${modal.vehicle.id}`, 'Vehículo quitado.')}
        />
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft font-display text-sm font-semibold text-brand-ink">
      {initials(name) || <UserRound className="size-4" aria-hidden />}
    </span>
  );
}

function formatAge(birthDate: string): string {
  const age = ageFrom(birthDate);
  if (age === null) return '';
  if (age < 1) return 'menor de 1 año';
  return age === 1 ? '1 año' : `${age} años`;
}

interface DialogProps {
  unitUrl: string;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}

function Actions({ label, loading, onClose }: { label: string; loading: boolean; onClose: () => void }) {
  return (
    <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
      <Button variant="secondary" onClick={onClose}>
        Cancelar
      </Button>
      <Button type="submit" loading={loading}>
        {label}
      </Button>
    </div>
  );
}

function MemberDialog({ unitUrl, member, onClose, onSaved }: DialogProps & { member?: HouseholdMember }) {
  const form = useForm<HouseholdMemberInput, unknown, z.output<typeof householdMemberSchema>>({
    resolver: zodResolver(householdMemberSchema),
    defaultValues: {
      firstName: member?.firstName ?? '',
      lastName: member?.lastName ?? '',
      kinship: member?.kinship ?? ('' as HouseholdMemberInput['kinship']),
      gender: member?.gender ?? ('' as HouseholdMemberInput['gender']),
      birthDate: member?.birthDate ?? '',
      phone: member?.phone ?? '',
      email: member?.email ?? '',
      receivesNotifications: member?.receivesNotifications ?? false,
    },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      await api(member ? `${unitUrl}/household-members/${member.id}` : `${unitUrl}/household-members`, {
        method: member ? 'PUT' : 'POST',
        body: values,
      });
      await onSaved();
      toast.success(member ? 'Datos actualizados.' : 'Persona agregada al hogar.');
      onClose();
    } catch (error) {
      handleFormError(error, form.setError, ['firstName', 'lastName', 'kinship', 'gender', 'birthDate', 'phone', 'email']);
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={member ? 'Editar persona' : 'Agregar persona al hogar'} wide>
      <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
        <Field label="Nombres" error={errors.firstName?.message}>
          {(props) => <Input {...props} autoFocus autoComplete="off" {...form.register('firstName')} />}
        </Field>
        <Field label="Apellidos" error={errors.lastName?.message}>
          {(props) => <Input {...props} autoComplete="off" {...form.register('lastName')} />}
        </Field>
        <Field label="Parentesco con el residente principal" error={errors.kinship?.message}>
          {(props) => (
            <Select {...props} {...form.register('kinship')}>
              <option value="">Selecciona</option>
              {KINSHIPS.map((kinship) => (
                <option key={kinship} value={kinship}>
                  {KINSHIP_LABELS[kinship]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Género" error={errors.gender?.message}>
          {(props) => (
            <Select {...props} {...form.register('gender')}>
              <option value="">Selecciona</option>
              {GENDERS.map((gender) => (
                <option key={gender} value={gender}>
                  {GENDER_LABELS[gender]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Fecha de nacimiento" error={errors.birthDate?.message} hint="Con ella calculamos la edad.">
          {(props) => <Input {...props} type="date" min="1900-01-01" {...form.register('birthDate')} />}
        </Field>
        <Field label="Celular" optional error={errors.phone?.message}>
          {(props) => <Input {...props} type="tel" autoComplete="off" {...form.register('phone')} />}
        </Field>
        <Field label="Correo electrónico" optional error={errors.email?.message} className="sm:col-span-2">
          {(props) => <Input {...props} type="email" autoComplete="off" {...form.register('email')} />}
        </Field>
        <div className="sm:col-span-2">
          <Toggle
            label="También recibe las notificaciones del conjunto"
            description="Necesita tener registrado un celular o un correo."
            {...form.register('receivesNotifications')}
          />
        </div>
        <Actions label={member ? 'Guardar cambios' : 'Agregar persona'} loading={form.formState.isSubmitting} onClose={onClose} />
      </form>
    </Dialog>
  );
}

function PetDialog({ unitUrl, pet, onClose, onSaved }: DialogProps & { pet?: HouseholdPet }) {
  const form = useForm<HouseholdPetInput, unknown, z.output<typeof householdPetSchema>>({
    resolver: zodResolver(householdPetSchema),
    defaultValues: {
      species: pet?.species ?? 'dog',
      name: pet?.name ?? '',
      breed: pet?.breed ?? '',
      sex: pet?.sex ?? '',
      color: pet?.color ?? '',
      vaccinesUpToDate: pet?.vaccinesUpToDate ?? false,
    },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    try {
      await api(pet ? `${unitUrl}/pets/${pet.id}` : `${unitUrl}/pets`, { method: pet ? 'PUT' : 'POST', body: values });
      await onSaved();
      toast.success(pet ? 'Mascota actualizada.' : 'Mascota registrada.');
      onClose();
    } catch (error) {
      handleFormError(error, form.setError, ['species', 'name', 'breed', 'sex', 'color']);
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={pet ? 'Editar mascota' : 'Agregar mascota'} wide>
      <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
        <Field label="Nombre" error={errors.name?.message}>
          {(props) => <Input {...props} autoFocus autoComplete="off" {...form.register('name')} />}
        </Field>
        <Field label="Tipo de animal" error={errors.species?.message}>
          {(props) => (
            <Select {...props} {...form.register('species')}>
              {PET_SPECIES.map((species) => (
                <option key={species} value={species}>
                  {PET_SPECIES_LABELS[species]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Raza" optional error={errors.breed?.message}>
          {(props) => <Input {...props} autoComplete="off" {...form.register('breed')} />}
        </Field>
        <Field label="Sexo" optional error={errors.sex?.message}>
          {(props) => (
            <Select {...props} {...form.register('sex')}>
              <option value="">Selecciona</option>
              {PET_SEXES.map((sex) => (
                <option key={sex} value={sex}>
                  {PET_SEX_LABELS[sex]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Color" optional error={errors.color?.message}>
          {(props) => <Input {...props} autoComplete="off" {...form.register('color')} />}
        </Field>
        <div className="sm:col-span-2">
          <Toggle label="Tiene las vacunas al día" {...form.register('vaccinesUpToDate')} />
        </div>
        <Actions label={pet ? 'Guardar cambios' : 'Agregar mascota'} loading={form.formState.isSubmitting} onClose={onClose} />
      </form>
    </Dialog>
  );
}

function VehicleDialog({ unitUrl, vehicle, onClose, onSaved }: DialogProps & { vehicle?: Vehicle }) {
  const form = useForm<VehicleInput, unknown, z.output<typeof vehicleSchema>>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: {
      kind: vehicle?.kind ?? 'car',
      powertrain: vehicle?.powertrain ?? 'combustion',
      plate: vehicle?.plate ?? '',
      brand: vehicle?.brand ?? '',
      model: vehicle?.model ?? '',
      modelYear: vehicle?.modelYear ?? '',
      color: vehicle?.color ?? '',
      notes: vehicle?.notes ?? '',
    },
  });
  const { errors } = form.formState;
  const kind = form.watch('kind');
  const needsPlate = kind === 'car' || kind === 'motorcycle';

  const submit = form.handleSubmit(async (values) => {
    try {
      await api(vehicle ? `${unitUrl}/vehicles/${vehicle.id}` : `${unitUrl}/vehicles`, {
        method: vehicle ? 'PUT' : 'POST',
        body: values,
      });
      await onSaved();
      toast.success(vehicle ? 'Vehículo actualizado.' : 'Vehículo registrado.');
      onClose();
    } catch (error) {
      handleFormError(error, form.setError, ['kind', 'powertrain', 'plate', 'brand', 'model', 'modelYear', 'color', 'notes']);
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={vehicle ? 'Editar vehículo' : 'Agregar vehículo'} wide>
      <form onSubmit={submit} noValidate className="grid gap-5 sm:grid-cols-2">
        <Field label="Tipo de vehículo" error={errors.kind?.message}>
          {(props) => (
            <Select
              {...props}
              {...form.register('kind', {
                // Una bicicleta nueva suele no tener motor; se propone, pero se puede cambiar.
                onChange: (event: { target: { value: string } }) => {
                  if (event.target.value === 'bicycle') form.setValue('powertrain', 'human');
                  else if (form.getValues('powertrain') === 'human') form.setValue('powertrain', 'combustion');
                },
              })}
            >
              {VEHICLE_KINDS.map((item) => (
                <option key={item} value={item}>
                  {VEHICLE_KIND_LABELS[item]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Motor" error={errors.powertrain?.message}>
          {(props) => (
            <Select {...props} {...form.register('powertrain')}>
              {POWERTRAINS.map((item) => (
                <option key={item} value={item}>
                  {POWERTRAIN_LABELS[item]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Placa" optional={!needsPlate} error={errors.plate?.message} hint={needsPlate ? 'Por ejemplo ABC123.' : undefined}>
          {(props) => <Input {...props} autoComplete="off" className="uppercase" {...form.register('plate')} />}
        </Field>
        <Field label="Color" error={errors.color?.message}>
          {(props) => <Input {...props} autoComplete="off" {...form.register('color')} />}
        </Field>
        <Field label="Marca" optional error={errors.brand?.message}>
          {(props) => <Input {...props} autoComplete="off" placeholder="Renault" {...form.register('brand')} />}
        </Field>
        <Field label="Línea o modelo" optional error={errors.model?.message}>
          {(props) => <Input {...props} autoComplete="off" placeholder="Sandero" {...form.register('model')} />}
        </Field>
        <Field label="Año" optional error={errors.modelYear?.message}>
          {(props) => <Input {...props} type="number" inputMode="numeric" min={1950} {...form.register('modelYear')} />}
        </Field>
        <Field label="Observaciones" optional error={errors.notes?.message}>
          {(props) => <Input {...props} autoComplete="off" {...form.register('notes')} />}
        </Field>
        <Actions label={vehicle ? 'Guardar cambios' : 'Agregar vehículo'} loading={form.formState.isSubmitting} onClose={onClose} />
      </form>
    </Dialog>
  );
}
