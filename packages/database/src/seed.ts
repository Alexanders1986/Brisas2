import {
  PERMISSIONS,
  PERMISSION_KEYS,
  ROLE_DESCRIPTIONS,
  ROLE_KEYS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type RelationshipType,
  type RoleKey,
} from '@brisas/contracts';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { hashPassword } from './password';
import * as schema from './schema';

type Db = NodePgDatabase<typeof schema>;

const PLANS = [
  { key: 'basic', name: 'Básico', maxUnits: 100 },
  { key: 'standard', name: 'Estándar', maxUnits: 400 },
  { key: 'premium', name: 'Premium', maxUnits: null },
];

const EMAIL_LAYOUT = (content: string) => `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2933">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
          <tr><td>
            <p style="margin:0 0 24px;font-size:14px;font-weight:600;color:#0f766e">{{brandName}}</p>
            ${content}
            <p style="margin:32px 0 0;font-size:12px;color:#7b8794">Si no reconoces este mensaje puedes ignorarlo. Nadie podrá entrar a tu cuenta sin el enlace.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

const BUTTON = (label: string) =>
  `<p style="margin:24px 0"><a href="{{link}}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${label}</a></p>
   <p style="margin:0;font-size:13px;color:#52606d">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all">{{link}}</span></p>`;

const DEFAULT_TEMPLATES = [
  {
    key: 'auth.password_reset',
    subject: 'Restablece tu contraseña',
    bodyHtml: EMAIL_LAYOUT(
      `<h1 style="margin:0 0 12px;font-size:22px">Hola, {{name}}</h1>
       <p style="margin:0;font-size:15px;line-height:1.6">Recibimos una solicitud para restablecer tu contraseña. El enlace vence en {{expiresIn}}.</p>
       ${BUTTON('Crear nueva contraseña')}`,
    ),
  },
  {
    key: 'auth.invitation',
    subject: 'Te invitaron a {{brandName}}',
    bodyHtml: EMAIL_LAYOUT(
      `<h1 style="margin:0 0 12px;font-size:22px">Hola, {{name}}</h1>
       <p style="margin:0;font-size:15px;line-height:1.6">La administración de <strong>{{brandName}}</strong> creó una cuenta para ti. Activa tu acceso creando una contraseña. El enlace vence en {{expiresIn}}.</p>
       ${BUTTON('Activar mi cuenta')}`,
    ),
  },
];

/** Sincroniza los catálogos que el código da por existentes. Idempotente. */
export async function seedBaseData(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const plan of PLANS) {
      await tx
        .insert(schema.plans)
        .values(plan)
        .onConflictDoUpdate({ target: schema.plans.key, set: { name: plan.name, maxUnits: plan.maxUnits } });
    }

    for (const key of PERMISSION_KEYS) {
      await tx
        .insert(schema.permissions)
        .values({ key, description: PERMISSIONS[key] })
        .onConflictDoUpdate({ target: schema.permissions.key, set: { description: PERMISSIONS[key] } });
    }
    await tx.delete(schema.permissions).where(notInArray(schema.permissions.key, PERMISSION_KEYS));

    for (const key of ROLE_KEYS) {
      const values = { key, name: ROLE_LABELS[key], description: ROLE_DESCRIPTIONS[key], isSystem: true };
      const [existing] = await tx
        .select({ id: schema.roles.id })
        .from(schema.roles)
        .where(and(isNull(schema.roles.tenantId), eq(schema.roles.key, key)));
      const roleId =
        existing?.id ?? (await tx.insert(schema.roles).values(values).returning({ id: schema.roles.id }))[0]!.id;
      if (existing) {
        await tx.update(schema.roles).set(values).where(eq(schema.roles.id, roleId));
      }
      await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
      await tx
        .insert(schema.rolePermissions)
        .values(ROLE_PERMISSIONS[key].map((permissionKey) => ({ roleId, permissionKey })));
    }

    for (const template of DEFAULT_TEMPLATES) {
      const [existing] = await tx
        .select({ id: schema.notificationTemplates.id })
        .from(schema.notificationTemplates)
        .where(and(isNull(schema.notificationTemplates.tenantId), eq(schema.notificationTemplates.key, template.key)));
      if (!existing) {
        await tx.insert(schema.notificationTemplates).values({ ...template, channel: 'email' });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// DATOS DE DEMOSTRACIÓN — solo para desarrollo local. No se cargan en producción.
// ---------------------------------------------------------------------------

export const DEMO_PASSWORD = 'Brisas-Demo-2026';

export interface DemoSeedResult {
  created: boolean;
  accounts: { email: string; description: string }[];
}

const DEMO_ACCOUNTS = [
  { email: 'superadmin@brisas.test', description: 'SuperAdmin de la plataforma' },
  { email: 'admin.parque@brisas.test', description: 'Administradora de Brisas del Parque' },
  { email: 'admin.colina@brisas.test', description: 'Administrador de Altos de la Colina' },
  {
    email: 'laura.gomez@brisas.test',
    description: 'Propietaria en Brisas del Parque y arrendataria en Altos de la Colina',
  },
];

export async function seedDemoData(db: Db): Promise<DemoSeedResult> {
  const [alreadySeeded] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(sql`lower(${schema.users.email})`, DEMO_ACCOUNTS[0]!.email));
  if (alreadySeeded) return { created: false, accounts: DEMO_ACCOUNTS };

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await db.transaction(async (tx) => {
    const roleRows = await tx.select().from(schema.roles).where(isNull(schema.roles.tenantId));
    const roleId = (key: RoleKey) => {
      const role = roleRows.find((row) => row.key === key);
      if (!role) throw new Error(`Falta el rol ${key}. Ejecuta primero las migraciones.`);
      return role.id;
    };
    const [plan] = await tx.select().from(schema.plans).where(eq(schema.plans.key, 'standard'));
    if (!plan) throw new Error('Faltan los planes. Ejecuta primero las migraciones.');

    const createUser = async (email: string, displayName: string, isPlatformAdmin = false) => {
      const [user] = await tx
        .insert(schema.users)
        .values({ email, displayName, passwordHash, status: 'active', isPlatformAdmin, passwordChangedAt: new Date() })
        .returning();
      return user!;
    };

    await createUser('superadmin@brisas.test', 'Soporte Brisas', true);
    const adminParque = await createUser('admin.parque@brisas.test', 'Patricia Rojas');
    const adminColina = await createUser('admin.colina@brisas.test', 'Andrés Mejía');
    const laura = await createUser('laura.gomez@brisas.test', 'Laura Gómez');

    const createTenant = async (
      values: { slug: string; name: string; taxId: string },
      settings: Omit<typeof schema.tenantSettings.$inferInsert, 'tenantId'>,
    ) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ ...values, planId: plan.id })
        .returning();
      await tx.insert(schema.tenantSettings).values({ tenantId: tenant!.id, ...settings });
      return tenant!;
    };

    const parque = await createTenant(
      { slug: 'brisas-del-parque', name: 'Brisas del Parque', taxId: '900123456-1' },
      {
        primaryColor: '#0F766E',
        welcomeMessage: 'Bienvenido a tu conjunto. Aquí encuentras todo lo que necesitas de la administración.',
        address: 'Calle 152 # 58-20',
        city: 'Bogotá',
        phones: ['601 555 0142'],
        whatsapp: '+57 300 555 0142',
        email: 'administracion@brisasdelparque.test',
        officeHours: 'Lunes a viernes de 8:00 a. m. a 5:00 p. m. · Sábados de 9:00 a. m. a 12:00 m.',
      },
    );
    const colina = await createTenant(
      { slug: 'altos-de-la-colina', name: 'Altos de la Colina', taxId: '901654321-7' },
      {
        primaryColor: '#4338CA',
        welcomeMessage: 'Tu conjunto, siempre a la mano.',
        address: 'Carrera 7 # 180-45',
        city: 'Medellín',
        phones: ['604 555 0188'],
        email: 'admin@altosdelacolina.test',
        officeHours: 'Lunes a viernes de 7:30 a. m. a 4:30 p. m.',
      },
    );

    await tx.insert(schema.userTenantMemberships).values([
      { tenantId: parque.id, userId: adminParque.id, roleId: roleId('tenant_admin') },
      { tenantId: colina.id, userId: adminColina.id, roleId: roleId('tenant_admin') },
      { tenantId: parque.id, userId: laura.id, roleId: roleId('owner') },
      { tenantId: colina.id, userId: laura.id, roleId: roleId('tenant_resident') },
    ]);

    // --- Brisas del Parque: 2 torres de 5 pisos con 4 apartamentos por piso.
    const parqueUnits = new Map<string, string>();
    for (const [index, name] of ['Torre 1', 'Torre 2'].entries()) {
      const [tower] = await tx
        .insert(schema.towers)
        .values({ tenantId: parque.id, name, floors: 5, sortOrder: index })
        .returning();
      const units = [];
      for (let floor = 1; floor <= 5; floor += 1) {
        for (let unit = 1; unit <= 4; unit += 1) {
          units.push({ tenantId: parque.id, towerId: tower!.id, floor, number: `${floor}0${unit}`, areaM2: 68 });
        }
      }
      const inserted = await tx.insert(schema.properties).values(units).returning();
      for (const property of inserted) parqueUnits.set(`${name}/${property.number}`, property.id);
    }

    // --- Altos de la Colina: 12 casas sin torres.
    const colinaUnits = new Map<string, string>();
    const houses = await tx
      .insert(schema.properties)
      .values(
        Array.from({ length: 12 }, (_, index) => ({
          tenantId: colina.id,
          kind: 'house' as const,
          number: String(index + 1),
          areaM2: 120,
        })),
      )
      .returning();
    for (const house of houses) colinaUnits.set(house.number, house.id);

    const createResident = async (input: {
      tenantId: string;
      createdBy: string;
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      documentNumber: string;
      userId?: string;
      propertyId: string;
      relationship: RelationshipType;
      startDate: string;
      householdSize: number;
    }) => {
      const [person] = await tx
        .insert(schema.persons)
        .values({
          tenantId: input.tenantId,
          userId: input.userId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          documentType: 'CC',
          documentNumber: input.documentNumber,
          createdBy: input.createdBy,
        })
        .returning();
      await tx.insert(schema.propertyOccupancies).values({
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        personId: person!.id,
        relationship: input.relationship,
        startDate: input.startDate,
        householdSize: input.householdSize,
        libertadTradicionAvailable: input.relationship === 'owner',
        createdBy: input.createdBy,
      });
      return person!;
    };

    const unit = (map: Map<string, string>, key: string) => {
      const id = map.get(key);
      if (!id) throw new Error(`Unidad de demostración no encontrada: ${key}`);
      return id;
    };

    await createResident({
      tenantId: parque.id,
      createdBy: adminParque.id,
      firstName: 'Laura',
      lastName: 'Gómez',
      email: 'laura.gomez@brisas.test',
      phone: '300 555 0101',
      documentNumber: '52100200',
      userId: laura.id,
      propertyId: unit(parqueUnits, 'Torre 1/302'),
      relationship: 'owner',
      startDate: '2021-03-01',
      householdSize: 3,
    });
    await createResident({
      tenantId: parque.id,
      createdBy: adminParque.id,
      firstName: 'Carlos',
      lastName: 'Ruiz',
      email: 'carlos.ruiz@correo.test',
      phone: '310 555 0102',
      documentNumber: '80300400',
      propertyId: unit(parqueUnits, 'Torre 1/101'),
      relationship: 'tenant',
      startDate: '2024-08-15',
      householdSize: 2,
    });
    const marta = await createResident({
      tenantId: parque.id,
      createdBy: adminParque.id,
      firstName: 'Marta',
      lastName: 'Peña',
      phone: '315 555 0103',
      documentNumber: '41500600',
      propertyId: unit(parqueUnits, 'Torre 2/201'),
      relationship: 'owner',
      startDate: '2019-11-20',
      householdSize: 4,
    });
    await tx.insert(schema.parkingSpaces).values([
      { tenantId: parque.id, number: 'P-12', kind: 'car', propertyId: unit(parqueUnits, 'Torre 2/201') },
      { tenantId: parque.id, number: 'P-27', kind: 'car', propertyId: unit(parqueUnits, 'Torre 1/302') },
    ]);
    await tx
      .insert(schema.storageUnits)
      .values({ tenantId: parque.id, number: 'D-05', propertyId: unit(parqueUnits, 'Torre 2/201') });
    await tx.insert(schema.pets).values({
      tenantId: parque.id,
      propertyId: unit(parqueUnits, 'Torre 2/201'),
      ownerPersonId: marta.id,
      species: 'dog',
      breed: 'Beagle',
      name: 'Toby',
    });

    await createResident({
      tenantId: colina.id,
      createdBy: adminColina.id,
      firstName: 'Laura',
      lastName: 'Gómez',
      email: 'laura.gomez@brisas.test',
      documentNumber: '52100200',
      userId: laura.id,
      propertyId: unit(colinaUnits, '5'),
      relationship: 'tenant',
      startDate: '2025-06-01',
      householdSize: 1,
    });
    await createResident({
      tenantId: colina.id,
      createdBy: adminColina.id,
      firstName: 'Jorge',
      lastName: 'Díaz',
      email: 'jorge.diaz@correo.test',
      documentNumber: '71700800',
      propertyId: unit(colinaUnits, '1'),
      relationship: 'owner',
      startDate: '2018-02-10',
      householdSize: 5,
    });
  });

  return { created: true, accounts: DEMO_ACCOUNTS };
}
