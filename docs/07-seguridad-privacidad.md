# 7. Seguridad y privacidad

Cada control de esta página indica si está **implementado** (y cubierto por pruebas) o
**pendiente**.

## Controles implementados

| Riesgo | Control | Dónde |
| --- | --- | --- |
| Robo de contraseñas | Hash Argon2id (19 MiB, 2 iteraciones). Mínimo 10 caracteres con letra y número. | `packages/database/src/password.ts` |
| Fuerza bruta | Bloqueo de 15 minutos tras 5 fallos; límite de 10 inicios de sesión por minuto e IP. | `auth.service.ts`, `auth.controller.ts` |
| Enumeración de cuentas | Mismo mensaje y mismo costo de cómputo exista o no el correo; "olvidé mi contraseña" siempre responde igual. | `auth.service.ts` |
| Robo de sesión | Access token de 15 minutos solo en memoria; refresh token opaco en cookie `HttpOnly`, `SameSite=Strict`, `Secure` en producción y limitada a `/api/v1/auth`. | `auth.controller.ts`, `apps/web/src/lib/api.ts` |
| Refresh token robado | Rotación en cada uso; si reaparece uno ya rotado, la sesión completa se cierra y queda registrado. | `auth.service.ts` |
| Sesión que debe terminar ya | Cada petición valida la sesión en base de datos: cerrar sesión, revocar un dispositivo, cambiar la contraseña o desactivar la cuenta surten efecto inmediato. | `auth.guard.ts` |
| Cuenta administrativa comprometida | Verificación en dos pasos TOTP con códigos de recuperación de un solo uso; el secreto se guarda cifrado (AES-256-GCM). Exigible con `MFA_REQUIRED_FOR_ADMINS`. | `crypto.ts`, guards |
| Tokens en una fuga de base de datos | Refresh tokens, invitaciones y enlaces de recuperación se guardan solo como hash SHA-256; el contenido del correo se borra tras enviarlo. | `identity.service.ts`, `mail-queue.service.ts` |
| Acceso a otro conjunto | API (pertenencia), Row Level Security y claves foráneas compuestas. | [Arquitectura](02-arquitectura.md#aislamiento-entre-conjuntos) |
| IDOR | Todo recurso se busca dentro del conjunto de la URL; un id ajeno responde 404. Las sesiones se revocan filtrando por el usuario autenticado. | servicios, pruebas de aislamiento |
| Permisos solo en la interfaz | Cada ruta declara sus permisos y el servidor los valida; sin declaración, se rechaza. | `tenant.guard.ts` |
| Inyección SQL | Solo consultas parametrizadas; los comodines de `LIKE` se escapan. | Drizzle, `pagination.ts` |
| XSS | React escapa todo el contenido; las variables de las plantillas de correo se escapan; no se usa HTML del usuario. | `mail-queue.service.ts` |
| CSRF | El access token viaja en un encabezado, no en una cookie. La única ruta que usa cookie (renovar sesión) exige además un encabezado propio y la cookie es `SameSite=Strict`. | `auth.controller.ts` |
| Datos inválidos o excesivos | Validación con esquemas en todas las entradas; cuerpo JSON limitado a 200 kB; paginación con tope. | `contracts`, `bootstrap.ts` |
| Fuga de detalles técnicos | Los errores inesperados responden un mensaje genérico con un identificador; el detalle queda en el log. | `all-exceptions.filter.ts` |
| Encabezados inseguros | Helmet en la API; `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` y `Permissions-Policy` en la web. | `bootstrap.ts`, `next.config.ts` |
| Secretos en el código | Toda la configuración viene de variables de entorno validadas al arrancar; la API se niega a iniciar en producción con los secretos de ejemplo o sin HTTPS. | `app-config.ts` |
| Cambios sin rastro | Bitácora de auditoría escrita en la misma transacción que el cambio; la API no puede modificarla ni borrarla. | `audit.service.ts`, `0001_security.sql` |

## Protección de datos personales (Ley 1581 de 2012 y Decreto 1377 de 2013)

Cada conjunto es **responsable** del tratamiento de los datos de sus residentes; la plataforma
actúa como **encargado**. Esto es una descripción técnica, no asesoría legal: antes de operar
comercialmente conviene que un abogado revise la política de tratamiento, el contrato de
transmisión de datos con cada conjunto y el registro ante la SIC cuando aplique.

| Obligación | Estado |
| --- | --- |
| **Autorización previa y expresa** | Implementado: al activar su cuenta la persona acepta el tratamiento; se guarda quién, cuándo, desde qué IP y qué versión de la política (`consents`). |
| **Prueba de la autorización** | Implementado: la tabla `consents` es consultable por titular. |
| **Finalidad y minimización** | Implementado: solo se piden nombres para registrar a una persona; correo, celular y documento son opcionales. No se guardan datos sensibles ni bancarios. |
| **Seguridad** | Implementado: controles de la tabla anterior. |
| **Acceso restringido** | Implementado: solo roles con `residents.read` ven datos de residentes, y solo de su conjunto. |
| **Aviso de privacidad** | Parcial: el texto de autorización se muestra al activar la cuenta. Pendiente: política completa editable por conjunto (`tenant_settings.privacy_policy_text`) y visible en el portal. |
| **Consultas y reclamos de titulares** (10 y 15 días hábiles) | Pendiente: la tabla `data_subject_requests` con fecha límite existe; falta la interfaz. |
| **Supresión y revocatoria** | Pendiente: proceso de anonimización de una persona conservando la integridad del historial. |
| **Retención** | Pendiente: definir plazos y tareas de depuración (sesiones vencidas, tokens usados, bitácora). |
| **Transferencia internacional** | A resolver al elegir proveedores de nube y correo: debe constar en la política. |

## Pendiente antes de producción

1. **HTTPS extremo a extremo** y HSTS en el proxy de entrada.
2. **Almacén compartido para el límite de peticiones** si se despliega más de una instancia.
3. **Content-Security-Policy** estricta en la web (requiere nonces para el script de tema).
4. **Respaldos automatizados** con recuperación a un punto en el tiempo y una restauración de
   prueba documentada.
5. **Rotación de la clave de cifrado** (`DATA_ENCRYPTION_KEY`): el formato cifrado ya lleva
   versión (`v1`) para permitirla.
6. **Aviso al usuario** por correo cuando cambia su contraseña o se detecta reutilización de un
   token de sesión.
7. **Validación de archivos** (tipo real, tamaño, antivirus) al construir el almacenamiento.
8. **Prueba de penetración** externa antes del lanzamiento comercial.

## Compromisos deliberados

- **El bloqueo de cuenta puede usarse para molestar** a un usuario conocido (bloquearlo
  fallando a propósito). Se aceptó porque el bloqueo es corto, el límite por IP lo encarece y la
  alternativa (no bloquear) es peor. Mitigación futura: CAPTCHA tras varios fallos.
- **Las tablas de identidad (`users`, `user_sessions`) no tienen RLS**: son globales por
  naturaleza y solo las toca el módulo de autenticación.
- **El SuperAdmin no ve datos de residentes.** Dar soporte a un conjunto exige que su
  administrador lo agregue, lo que deja rastro.
