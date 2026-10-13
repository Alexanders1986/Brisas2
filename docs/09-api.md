# 9. API

La referencia completa, con parámetros, cuerpos y respuestas, se genera del código:

- Interactiva: http://localhost:4000/api/docs (con `npm run dev`).
- Archivo: [docs/api/openapi.json](api/openapi.json), regenerable con
  `npm run build && npm run openapi -w @brisas/api`.

Este documento explica las convenciones que comparten todos los endpoints.

## Convenciones

- **Base:** `/api/v1`. Un cambio incompatible publicará `/api/v2` sin retirar la anterior.
- **Autenticación:** `Authorization: Bearer <accessToken>`. Las únicas rutas públicas son las
  de inicio de sesión, recuperación, invitación y salud.
- **Recursos de un conjunto:** `/tenants/{tenantId}/…`. El servidor valida en cada petición la
  pertenencia y el permiso.
- **Formato:** JSON, claves en `camelCase`, fechas con hora en ISO 8601 UTC y fechas de
  calendario como `AAAA-MM-DD`.
- **Paginación:** `?page=1&pageSize=20` → `{ items, page, pageSize, total, totalPages }`.
  `pageSize` máximo 100 (500 en unidades).
- **Filtros y orden:** parámetros de consulta con nombre propio (`search`, `towerId`,
  `relationship`, `status`, `sort`, `direction`).
- **Idempotencia:** `PUT` y `DELETE` son idempotentes. `POST /properties/generate` puede
  repetirse sin duplicar. La creación de residentes está protegida por restricciones únicas:
  un reintento responde `409` en lugar de crear un duplicado.
- **Límite de peticiones:** 300 por minuto e IP en general; entre 5 y 20 por minuto en las
  rutas de autenticación. Al superarlo: `429 RATE_LIMITED`.

## Errores

Todas las respuestas de error tienen la misma forma:

```json
{
  "error": {
    "code": "DUPLICATE_PERSON",
    "message": "Laura Gómez ya está registrada con ese correo.",
    "fields": { "person.email": "Ya hay una persona registrada con este dato" },
    "details": { "matches": [{ "personId": "…", "fullName": "Laura Gómez", "matchedBy": "email" }] },
    "requestId": "de3e1915-98e6-48f5-b025-c04eac28129b"
  }
}
```

- `code` es estable: los clientes deciden con él, nunca con el texto.
- `message` está en español y puede mostrarse tal cual.
- `fields` trae los errores por campo, con la ruta en notación de puntos.
- `requestId` coincide con el encabezado `x-request-id` y con los logs.

| HTTP | Cuándo | Códigos |
| --- | --- | --- |
| 400 | Datos con formato inválido | `VALIDATION_ERROR`, `INVALID_OR_EXPIRED_TOKEN`, `INVALID_MFA_CODE` |
| 401 | Sin sesión válida | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `MFA_CHALLENGE_EXPIRED` |
| 403 | Sin permiso | `FORBIDDEN`, `TENANT_SUSPENDED`, `MFA_ENROLLMENT_REQUIRED`, `ACCOUNT_DISABLED`, `CSRF_CHECK_FAILED` |
| 404 | No existe, o no es de tu conjunto | `NOT_FOUND` |
| 409 | Choca con el estado actual | `PLATE_TAKEN`, `PQR_CLOSED`, `INVALID_STATUS_CHANGE`, `DUPLICATE_PERSON`, `OCCUPANCY_EXISTS`, `ASSET_ALREADY_ASSIGNED`, `DUPLICATE_TOWER`, `DUPLICATE_PROPERTY`, `TOWER_HAS_UNITS`, `PROPERTY_OCCUPIED`, `SLUG_TAKEN`, `REFRESH_IN_PROGRESS` |
| 422 | Válido en forma, imposible por una regla | `PROPERTY_NOT_FOUND`, `PROPERTY_NOT_YOURS`, `ASSIGNEE_NOT_ALLOWED`, `PLAN_LIMIT_REACHED`, `EMAIL_REQUIRED`, `INVALID_END_DATE`, `NO_ACTIVE_OCCUPANCY` |
| 429 | Demasiados intentos | `RATE_LIMITED`, `ACCOUNT_LOCKED` |
| 500 | Error inesperado | `INTERNAL_ERROR` |

## Ejemplo: de iniciar sesión a registrar un residente

```bash
# 1. Iniciar sesión (cliente móvil: el refresh token viene en el cuerpo)
curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin.parque@brisas.test","password":"Brisas-Demo-2026","client":"mobile"}'
# → { "status":"authenticated", "accessToken":"…", "expiresIn":900, "refreshToken":"…" }

# 2. Saber a qué conjuntos pertenezco y con qué permisos
curl -s http://localhost:4000/api/v1/auth/me -H "Authorization: Bearer $TOKEN"

# 3. Buscar una unidad libre
curl -s "http://localhost:4000/api/v1/tenants/$TENANT/properties?occupancy=vacant&pageSize=5" \
  -H "Authorization: Bearer $TOKEN"

# 4. Registrar al residente con todo el asistente en una sola llamada
curl -s -X POST "http://localhost:4000/api/v1/tenants/$TENANT/residents" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "person": { "firstName":"Camila", "lastName":"Torres", "email":"camila@correo.test", "phone":"320 555 0144" },
    "relationship": "tenant",
    "propertyId": "'$PROPERTY'",
    "startDate": "2026-10-13",
    "householdSize": 2,
    "parkingSpaces": [{ "number":"P-31", "kind":"car" }],
    "pets": [{ "species":"cat", "name":"Milo" }],
    "sendInvitation": true
  }'
# → 201 { "personId":"…", "occupancyId":"…", "invitationSent":true }
```

## Endpoints disponibles

59 operaciones. Módulos previstos y aún no construidos: `documents`, `announcements`,
`projects`, `settings` y `notifications`.

| Módulo | Método y ruta | Permiso |
| --- | --- | --- |
| Salud | `GET /health` | público |
| Autenticación | `POST /auth/login` · `/auth/mfa/verify` · `/auth/refresh` · `/auth/password/forgot` · `/auth/password/reset` · `/auth/invitations/preview` · `/auth/invitations/accept` | público |
| | `POST /auth/logout` · `GET /auth/me` | sesión |
| Mi cuenta | `GET /account/sessions` · `DELETE /account/sessions/{id}` · `POST /account/sessions/revoke-others` · `POST /account/password` · `POST /account/mfa/setup` · `/enable` · `/disable` | sesión |
| Plataforma | `GET /platform/metrics` · `GET /platform/plans` · `GET` `POST /platform/tenants` · `GET` `PATCH /platform/tenants/{id}` · `PUT /platform/tenants/{id}/status` | SuperAdmin |
| Conjunto | `GET /tenants/{t}/branding` | cualquier miembro |
| | `GET /tenants/{t}/dashboard` | `dashboard.read` |
| Torres y unidades | `GET /tenants/{t}/towers` · `GET /tenants/{t}/properties` | `properties.read` |
| | `POST /towers` · `PUT` `DELETE /towers/{id}` · `POST /properties` · `POST /properties/generate` · `PATCH /properties/{id}` | `properties.manage` |
| Residentes | `GET /tenants/{t}/residents` · `GET /residents/{id}` | `residents.read` |
| | `POST /residents` · `GET /residents/duplicates` · `PUT /residents/{id}` · `PUT /residents/{id}/access` · `POST /residents/{id}/occupancies/{o}/end` | `residents.manage` |
| Hogar y vehículos | `GET /tenants/{t}/my/household` | `household.manage_own` |
| | `GET /properties/{p}/household` · `POST` `PUT` `DELETE /properties/{p}/household-members[/{id}]` · `POST` `PUT` `DELETE /properties/{p}/vehicles[/{id}]` · `POST` `PUT` `DELETE /properties/{p}/pets[/{id}]` | vivir en la unidad, o `residents.manage` |
| PQR | `POST /tenants/{t}/pqrs` | `pqr.create` |
| | `GET /pqrs` · `GET /pqrs/{id}` · `POST /pqrs/{id}/comments` | quien la radicó, o `pqr.read_all` |
| | `PATCH /pqrs/{id}` | `pqr.manage`, o `pqr.manage_assigned` si está asignada |
| | `GET /pqrs/assignees` | `pqr.read_all` |
| Reportes | `GET /tenants/{t}/reports/pqr?from&to` | `reports.read` |
