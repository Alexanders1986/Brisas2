import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PERMISSION_KEYS,
  ROLE_KEYS,
  ROLE_PERMISSIONS,
  ageFrom,
  createResidentSchema,
  householdMemberSchema,
  vehicleSchema,
  dateOnlySchema,
  generatePropertiesSchema,
  listPropertiesQuerySchema,
  passwordSchema,
  tenantSlugSchema,
} from './index';

const validResident = {
  person: { firstName: 'Ana', lastName: 'Gómez', email: 'ANA@Example.com ', phone: '300 555 0100' },
  relationship: 'owner',
  propertyId: '3f0e8a52-6f0b-4c53-9d3e-0a4b6c1d2e3f',
  startDate: '2026-01-15',
  householdSize: '3',
};

test('cada rol solo referencia permisos que existen en el catálogo', () => {
  for (const role of ROLE_KEYS) {
    for (const permission of ROLE_PERMISSIONS[role]) {
      assert.ok(PERMISSION_KEYS.includes(permission), `${role} → ${permission}`);
    }
  }
});

test('los perfiles de residente no reciben permisos administrativos', () => {
  for (const role of ['owner', 'tenant_resident', 'resident'] as const) {
    const administrative = ROLE_PERMISSIONS[role].filter(
      (permission) => permission.endsWith('.manage') || permission === 'pqr.read_all' || permission === 'audit.read',
    );
    assert.deepEqual(administrative, []);
  }
});

test('la contraseña exige longitud, letra y número', () => {
  assert.equal(passwordSchema.safeParse('corta1').success, false);
  assert.equal(passwordSchema.safeParse('sololetrasmuylargas').success, false);
  assert.equal(passwordSchema.safeParse('12345678901234').success, false);
  assert.equal(passwordSchema.safeParse('Contraseña2026').success, true);
});

test('el asistente de residentes normaliza correo y convierte números', () => {
  const parsed = createResidentSchema.parse(validResident);
  assert.equal(parsed.person?.email, 'ana@example.com');
  assert.equal(parsed.householdSize, 3);
  assert.deepEqual(parsed.pets, []);
});

test('el asistente exige persona nueva o existente, pero no ambas', () => {
  const none = createResidentSchema.safeParse({ ...validResident, person: undefined });
  assert.equal(none.success, false);
  const both = createResidentSchema.safeParse({ ...validResident, existingPersonId: validResident.propertyId });
  assert.equal(both.success, false);
});

test('no se puede invitar a una persona nueva sin correo', () => {
  const result = createResidentSchema.safeParse({
    ...validResident,
    person: { firstName: 'Ana', lastName: 'Gómez', email: '', phone: '300 555 0100' },
    sendInvitation: true,
  });
  assert.equal(result.success, false);
});

test('las fechas imposibles se rechazan', () => {
  assert.equal(dateOnlySchema.safeParse('2026-02-30').success, false);
  assert.equal(dateOnlySchema.safeParse('2026-02-28').success, true);
});

test('el slug del conjunto solo admite minúsculas, números y guiones', () => {
  assert.equal(tenantSlugSchema.safeParse('Brisas del Río').success, false);
  assert.equal(tenantSlugSchema.parse('Brisas-Del-Rio'), 'brisas-del-rio');
});

test('el generador de unidades valida el rango de pisos', () => {
  const base = { towerId: validResident.propertyId, unitsPerFloor: 4 };
  assert.equal(generatePropertiesSchema.safeParse({ ...base, fromFloor: 5, toFloor: 2 }).success, false);
  assert.equal(generatePropertiesSchema.safeParse({ ...base, fromFloor: 1, toFloor: 12 }).success, true);
});

test('includeInactive=false en el query string se interpreta como falso', () => {
  assert.equal(listPropertiesQuerySchema.parse({ includeInactive: 'false' }).includeInactive, false);
  assert.equal(listPropertiesQuerySchema.parse({ includeInactive: 'true' }).includeInactive, true);
});

test('el celular es obligatorio para el residente principal', () => {
  const result = createResidentSchema.safeParse({ ...validResident, person: { firstName: 'Ana', lastName: 'Gómez', phone: '' } });
  assert.equal(result.success, false);
});

test('en el hogar el celular es opcional, salvo que la persona reciba notificaciones', () => {
  const member = { firstName: 'Luis', lastName: 'Gómez', kinship: 'child', gender: 'male', birthDate: '2015-04-20' };
  assert.equal(householdMemberSchema.safeParse(member).success, true);
  assert.equal(householdMemberSchema.safeParse({ ...member, receivesNotifications: true }).success, false);
  assert.equal(householdMemberSchema.safeParse({ ...member, receivesNotifications: true, phone: '310 555 0101' }).success, true);
  assert.equal(householdMemberSchema.safeParse({ ...member, birthDate: '2999-01-01' }).success, false);
});

test('la edad se calcula en años cumplidos', () => {
  assert.equal(ageFrom('2000-10-14', new Date(2026, 9, 13)), 25);
  assert.equal(ageFrom('2000-10-13', new Date(2026, 9, 13)), 26);
  assert.equal(ageFrom(null), null);
});

test('la placa se normaliza y es obligatoria para carros y motos, no para bicicletas', () => {
  const base = { powertrain: 'combustion', color: 'Rojo' };
  assert.equal(vehicleSchema.parse({ ...base, kind: 'car', plate: 'abc-123' }).plate, 'ABC123');
  assert.equal(vehicleSchema.safeParse({ ...base, kind: 'motorcycle', plate: '' }).success, false);
  assert.equal(vehicleSchema.safeParse({ kind: 'bicycle', powertrain: 'electric', color: 'Negro', plate: '' }).success, true);
});
