/**
 * Catálogo de permisos y roles del sistema.
 * Es la única fuente de verdad: el seed lo carga en base de datos, la API lo usa
 * en sus guards y los clientes lo usan solo para decidir qué mostrar.
 */

export const PERMISSIONS = {
  'dashboard.read': 'Ver el panel de indicadores del conjunto',
  'settings.read': 'Ver la configuración del conjunto',
  'settings.manage': 'Cambiar la configuración y personalización del conjunto',
  'members.read': 'Ver el equipo administrativo y sus roles',
  'members.manage': 'Invitar personal y asignar roles',
  'properties.read': 'Ver torres, unidades, parqueaderos y depósitos',
  'properties.manage': 'Crear y editar torres, unidades, parqueaderos y depósitos',
  'residents.read': 'Ver residentes y sus vinculaciones',
  'residents.manage': 'Registrar, editar y dar o quitar acceso a residentes',
  'household.manage_own': 'Registrar las personas y los vehículos de su propia unidad',
  'documents.read': 'Consultar documentos institucionales habilitados',
  'documents.manage': 'Subir, reemplazar y archivar documentos',
  'announcements.read': 'Ver comunicados publicados',
  'announcements.manage': 'Crear, publicar y archivar comunicados',
  'projects.read': 'Ver proyectos y mantenimientos',
  'projects.manage': 'Crear proyectos y registrar avances',
  'pqr.create': 'Radicar PQR propias',
  'pqr.read_own': 'Consultar y responder las PQR propias',
  'pqr.read_all': 'Ver todas las PQR del conjunto',
  'pqr.manage_assigned': 'Gestionar las PQR que tiene asignadas',
  'pqr.manage': 'Asignar, responder y cambiar el estado de cualquier PQR',
  'reports.read': 'Consultar reportes e indicadores',
  'reports.export': 'Exportar reportes a Excel y PDF',
  'finance.read': 'Consultar módulos financieros autorizados',
  'payments.access': 'Acceder a la pasarela de pagos',
  'audit.read': 'Consultar el historial de cambios',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export const ROLE_KEYS = [
  'tenant_admin',
  'operations_manager',
  'council_member',
  'accountant',
  'owner',
  'tenant_resident',
  'resident',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  tenant_admin: 'Administrador del conjunto',
  operations_manager: 'Gestor de operaciones',
  council_member: 'Consejo de administración',
  accountant: 'Contador',
  owner: 'Propietario',
  tenant_resident: 'Arrendatario',
  resident: 'Residente',
};

export const ROLE_DESCRIPTIONS: Record<RoleKey, string> = {
  tenant_admin: 'Administra toda la información y configuración del conjunto.',
  operations_manager: 'Gestiona mantenimientos, proyectos y las PQR que tiene asignadas.',
  council_member: 'Consulta indicadores, proyectos, reportes y documentos habilitados.',
  accountant: 'Consulta los módulos financieros y reportes que tenga autorizados.',
  owner: 'Dueño de una unidad. Accede al portal de residentes.',
  tenant_resident: 'Arrienda una unidad. Accede al portal de residentes.',
  resident: 'Otro perfil autorizado que vive en la unidad.',
};

/** Roles que operan el panel administrativo (y a los que aplica la exigencia de MFA). */
export const STAFF_ROLES: readonly RoleKey[] = [
  'tenant_admin',
  'operations_manager',
  'council_member',
  'accountant',
];

const RESIDENT_BASE: PermissionKey[] = [
  'household.manage_own',
  'documents.read',
  'announcements.read',
  'projects.read',
  'pqr.create',
  'pqr.read_own',
  'payments.access',
];

/** Permisos por defecto de cada rol del sistema. */
export const ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  tenant_admin: PERMISSION_KEYS.filter((key) => key !== 'finance.read'),
  operations_manager: [
    'dashboard.read',
    'properties.read',
    'residents.read',
    'documents.read',
    'announcements.read',
    'projects.read',
    'projects.manage',
    'pqr.read_all',
    'pqr.manage_assigned',
  ],
  council_member: ['dashboard.read', 'documents.read', 'announcements.read', 'projects.read', 'reports.read'],
  accountant: ['documents.read', 'announcements.read', 'reports.read', 'reports.export', 'finance.read'],
  owner: RESIDENT_BASE,
  tenant_resident: RESIDENT_BASE,
  resident: RESIDENT_BASE,
};

/** Tipo de vinculación de una persona con una unidad. */
export const RELATIONSHIP_TYPES = ['owner', 'tenant', 'authorized'] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  owner: 'Propietario',
  tenant: 'Arrendatario',
  authorized: 'Otro perfil autorizado',
};

/** Rol de acceso que recibe una persona según su vinculación. */
export const RELATIONSHIP_ROLE: Record<RelationshipType, RoleKey> = {
  owner: 'owner',
  tenant: 'tenant_resident',
  authorized: 'resident',
};
