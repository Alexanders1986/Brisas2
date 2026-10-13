# 4. Roles y permisos

El catálogo vive en [packages/contracts/src/permissions.ts](../packages/contracts/src/permissions.ts)
y es la única fuente de verdad: las migraciones lo cargan en base de datos, la API lo exige en
cada ruta y la web lo usa solo para decidir qué mostrar.

## Cómo se autoriza

- Un usuario obtiene permisos **por conjunto**, a través de sus membresías
  (`user_tenant_memberships`). Puede tener varios roles en el mismo conjunto: sus permisos se
  suman.
- Cada ruta de la API declara los permisos que exige con `@RequirePermissions(...)`. Una ruta
  de conjunto que no declare ninguno **se rechaza por defecto**.
- Los permisos se leen de la base de datos en cada petición: quitar un rol o suspender una
  membresía surte efecto de inmediato, sin esperar a que venza el token.
- El **SuperAdmin de plataforma** no es un rol de conjunto. Es una marca en la cuenta que da
  acceso a `/platform/*` y a nada más: no ve datos de residentes de ningún conjunto.
- Con `MFA_REQUIRED_FOR_ADMINS=true`, los roles administrativos y el SuperAdmin no pueden
  operar hasta activar la verificación en dos pasos.

## Matriz de roles del sistema

✔ = incluido por defecto.

| Permiso | Administrador | Gestor de operaciones | Consejo | Contador | Propietario | Arrendatario | Residente |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `dashboard.read` Ver el panel | ✔ | ✔ | ✔ | | | | |
| `settings.read` Ver configuración | ✔ | | | | | | |
| `settings.manage` Cambiar configuración | ✔ | | | | | | |
| `members.read` Ver equipo y roles | ✔ | | | | | | |
| `members.manage` Invitar personal | ✔ | | | | | | |
| `properties.read` Ver torres y unidades | ✔ | ✔ | | | | | |
| `properties.manage` Editar torres y unidades | ✔ | | | | | | |
| `residents.read` Ver residentes | ✔ | ✔ | | | | | |
| `residents.manage` Registrar y dar acceso | ✔ | | | | | | |
| `household.manage_own` Registrar su hogar y vehículos | ✔ | | | | ✔ | ✔ | ✔ |
| `documents.read` Consultar documentos | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `documents.manage` Administrar documentos | ✔ | | | | | | |
| `announcements.read` Ver comunicados | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `announcements.manage` Publicar comunicados | ✔ | | | | | | |
| `projects.read` Ver proyectos | ✔ | ✔ | ✔ | | ✔ | ✔ | ✔ |
| `projects.manage` Administrar proyectos | ✔ | ✔ | | | | | |
| `pqr.create` Radicar PQR | ✔ | | | | ✔ | ✔ | ✔ |
| `pqr.read_own` Ver sus PQR | ✔ | | | | ✔ | ✔ | ✔ |
| `pqr.read_all` Ver todas las PQR | ✔ | ✔ | | | | | |
| `pqr.manage_assigned` Gestionar PQR asignadas | ✔ | ✔ | | | | | |
| `pqr.manage` Gestionar cualquier PQR | ✔ | | | | | | |
| `reports.read` Consultar reportes | ✔ | | ✔ | ✔ | | | |
| `reports.export` Exportar reportes | ✔ | | | ✔ | | | |
| `finance.read` Módulos financieros | | | | ✔ | | | |
| `payments.access` Pasarela de pagos | ✔ | | | | ✔ | ✔ | ✔ |
| `audit.read` Historial de cambios | ✔ | | | | | | |

Propietario, arrendatario y residente comparten hoy los mismos permisos; son roles distintos
para que los documentos y comunicados puedan dirigirse a uno solo de ellos
(`institutional_documents.visible_to_roles`, `announcement_audiences`).

## Permisos que dependen del recurso

Algunos permisos no bastan por sí solos: el servidor comprueba además la relación de quien
llama con el recurso.

| Acción | Quién puede |
| --- | --- |
| Ver o editar el hogar y los vehículos de una unidad | Quien tiene una vinculación vigente en esa unidad (`household.manage_own`) o el personal con `residents.manage`. `residents.read` permite solo ver. |
| Ver una PQR | Quien la radicó (`pqr.read_own`) o el personal con `pqr.read_all`. Una PQR ajena responde 404. |
| Escribir en la conversación | Quien la radicó, o quien puede gestionarla. |
| Cambiar estado o prioridad, escribir notas internas | `pqr.manage`, o `pqr.manage_assigned` si la PQR está asignada a quien llama. |
| Asignar responsable | Solo `pqr.manage`. |

## Rol que recibe un residente

Al dar acceso al portal, el rol se deriva de la vinculación vigente:

| Vinculación | Rol |
| --- | --- |
| Propietario | `owner` |
| Arrendatario | `tenant_resident` |
| Otro perfil autorizado | `resident` |

Al terminar la última vinculación vigente de una persona, sus roles de residente en ese
conjunto se suspenden automáticamente.

## Pendiente

- Pantalla para invitar personal (gestor, consejo, contador) y asignar roles: hoy esos roles
  existen y se validan, pero solo el administrador inicial se crea desde la interfaz.
- Roles propios por conjunto: el modelo los admite (`roles.tenant_id`); falta la interfaz.
