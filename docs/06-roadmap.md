# 6. Roadmap y estado

Última actualización: 13 de octubre de 2026.

## Resumen

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1. Fundamentos | Arquitectura, monorepo, base de datos, autenticación, multi-conjunto, roles, diseño base, navegación | **Terminada** |
| 2. Administración residencial | Torres, unidades, residentes, hogar, vehículos, parqueaderos, depósitos, mascotas; configuración del conjunto | **Parcial** (ver abajo) |
| 3. Contenido institucional | Documentos, comunicados, horarios, enlace de pagos | Pendiente |
| 4. PQR | Radicación, bandeja, conversación, adjuntos, notificaciones | **Parcial**: todo menos los adjuntos |
| 5. Mantenimientos y proyectos | Registro, hitos, evidencias, avance | Pendiente |
| 6. Analítica | Indicadores, gráficas, exportaciones | **Parcial**: indicadores de PQR |
| 7. Aplicación móvil | iOS y Android con Expo | Pendiente |
| 8. Calidad y despliegue | Pruebas E2E de interfaz, CI/CD, monitoreo, despliegue | Parcial (CI definido) |

**MVP comercial** = fases 1 a 4: con ellas un conjunto puede operar su día a día
(residentes, comunicación, documentos y PQR). Las fases 5 a 7 amplían el producto.

## Lo que funciona hoy

Verificado con 93 pruebas automatizadas (14 de contratos, 79 de la API contra PostgreSQL real)
y un recorrido en navegador de los flujos principales.

**Autenticación y cuenta**
- Inicio de sesión con correo y contraseña; mostrar u ocultar contraseña.
- Access token de 15 minutos y refresh token rotativo en cookie httpOnly; detección de
  reutilización del refresh token.
- Bloqueo temporal tras 5 intentos fallidos; límite de peticiones por IP.
- Recuperación de contraseña por correo con enlace de un solo uso.
- Invitaciones: la persona crea su contraseña y acepta el tratamiento de datos.
- Verificación en dos pasos (TOTP) con códigos de recuperación; exigible a administradores.
- Lista de dispositivos con sesión abierta, cierre individual y cierre de las demás.

**Multi-conjunto y permisos**
- Un usuario puede pertenecer a varios conjuntos con roles distintos y cambiar entre ellos.
- Siete roles del sistema y 26 permisos, validados en el servidor en cada petición.
- Aislamiento en tres capas: API, Row Level Security y claves foráneas compuestas.

**Plataforma (SuperAdmin)**
- Crear conjuntos con plan e invitación a su primer administrador.
- Activar y desactivar conjuntos; métricas globales; búsqueda.
- Límite de unidades según el plan.

**Torres y unidades**
- Crear, renombrar y eliminar torres; generar todas las unidades de una torre de una vez.
- Agregar unidades sueltas (casas, locales); activar y desactivar.
- Vista de fachada con ocupación.

**Residentes**
- Asistente de seis pasos que guarda todo en una sola transacción.
- Aviso de duplicados al escribir y vinculación de una persona existente a otra unidad.
- Parqueaderos, depósitos y mascotas; indicador del certificado de libertad y tradición.
- Lista con búsqueda, filtros por torre, vinculación y estado, y paginación.
- Edición, activación y desactivación del acceso, fin de vinculación con historial de
  ocupación, e historial de cambios con autor y fecha.

**Hogar y vehículos**
- El residente registra desde el portal a quienes viven con él: parentesco, género, fecha de
  nacimiento (la edad se calcula), celular y correo opcionales, y una casilla para que esa
  persona también reciba notificaciones (exige celular o correo).
- El celular es obligatorio para el residente principal; género y fecha de nacimiento, opcionales.
- Vehículos con tipo, placa, marca, línea, año, color y motor (combustión, eléctrico, híbrido o
  sin motor). La placa es obligatoria para carros y motos y única en el conjunto.
- Mascotas con nombre, tipo de animal, raza, sexo, color y si tienen las vacunas al día.
- Un vecino no puede ver ni modificar el hogar de otra unidad; la administración sí.

**PQR**
- El residente radica (tipo, categoría, asunto, descripción, unidad) y recibe un número
  `PQR-AAAA-NNNNNN`, único incluso con radicaciones simultáneas.
- Estados por revisar, en trámite, resuelta y cerrada, con fechas e historial de cambios.
- Conversación entre el residente y la administración, con notas internas que el residente
  nunca recibe. La primera respuesta de la administración pone la solicitud en trámite.
- Bandeja en lista y en tablero por estados (arrastrar una tarjeta cambia el estado), con
  búsqueda por radicado, asunto o residente y filtros por estado, tipo, prioridad y asignación.
- Responsable y prioridad por solicitud.
- Correos automáticos al radicar, al responder, al comentar el residente, al cambiar de estado,
  al resolver y al cerrar; uno solo por hecho.

**Reportes**
- Indicadores de PQR por periodo: recibidas, pendientes, resueltas, tiempo promedio de primera
  respuesta y de resolución, distribución por estado, categoría, torre y tipo, y tendencia
  mensual. La pantalla explica cómo se calcula cada uno.

**Portal del residente**
- Inicio con la identidad del conjunto, accesos a Mis solicitudes y Mi hogar, y los datos de
  contacto de la administración.

**Infraestructura**
- Cola de correos con reintentos e idempotencia; plantillas de invitación y recuperación.
- Bitácora de auditoría; logs estructurados; documentación OpenAPI generada del código.

## Lo que falta de la fase 2

| Pendiente | Nota |
| --- | --- |
| Personalización del conjunto (nombre, logo, colores, contacto, horarios, URL de pagos) con previsualización | La API ya entrega estos datos; falta la pantalla de edición. El logo depende del almacenamiento (fase 3). |
| Invitar personal y asignar roles | Los roles existen y se validan; falta la interfaz. |
| Editar parqueaderos, depósitos y mascotas después del registro | Hoy solo se crean en el asistente. |
| Adjuntar el certificado de libertad y tradición | Hoy se registra si está disponible; el archivo llega con el almacenamiento. |
| Reenviar una invitación desde el detalle del residente | La persona puede pedirla desde "Olvidé mi contraseña". |

## Lo que falta de las fases 4 y 6

| Pendiente | Nota |
| --- | --- |
| Adjuntar imágenes, PDF y videos a una PQR | Depende del almacenamiento privado (fase 3). |
| Exportar reportes a Excel y PDF | Los indicadores ya existen; falta la exportación. |
| Indicadores de proyectos | Llegan con el módulo de proyectos (fase 5). |
| Enviar notificaciones a las personas del hogar que marcaron la casilla | La preferencia ya se guarda. Hoy los correos de PQR van a quien radicó; los comunicados (fase 3) y un canal de SMS o WhatsApp la usarán. |
| El residente edita sus propios datos (celular, género, fecha de nacimiento) | Hoy los edita la administración. |
| Respuestas rápidas predefinidas en la bandeja | — |

## Fases siguientes: criterios de aceptación

**Fase 3 — Contenido institucional.** Depende de: almacenamiento privado con URLs firmadas.
- Un administrador sube, reemplaza (nueva versión) y archiva un PDF, y decide qué roles lo ven.
- Un residente busca, filtra por categoría, visualiza y descarga solo lo que su rol permite.
- Un comunicado pasa por borrador, previsualización, publicación (inmediata o programada) y
  archivo; el contenido enriquecido se sanea en el servidor.
- El botón "Pagar administración" abre la URL configurada, validada como HTTPS.

**Fase 4 — PQR.** Depende de: fase 3 (adjuntos).
- Radicar genera un número único `PQR-AAAA-NNNNNN` sin colisiones bajo concurrencia.
- Conversación con mensajes públicos y notas internas que el residente nunca ve.
- Bandeja en tablero por estados y en lista filtrable; asignación de responsable.
- Seis correos automáticos (creación, cambio de estado, respuesta, comentario, resolución,
  cierre) sin duplicados.

**Fase 5 — Proyectos.** Estados con texto e ícono, barra de avance, hitos, galería y
actualizaciones públicas o internas.

**Fase 6 — Analítica.** Cada indicador con su definición escrita; filtros de fecha coherentes
con la zona horaria del conjunto; exportación a Excel y PDF.

**Fase 7 — Móvil.** Extraer `packages/api-client`; inicio de sesión con refresh token en
almacenamiento seguro del dispositivo (la API ya lo admite con `client: "mobile"`);
notificaciones push sobre la cola existente.

**Fase 8 — Calidad y despliegue.** Pruebas E2E de interfaz con Playwright en CI; despliegue con
contenedores; monitoreo y alertas; respaldos automatizados y prueba de restauración.

## Deuda técnica conocida

- Actualizar a NestJS 12 y TypeScript 7 cuando `nestjs-zod` lo permita.
- El límite de peticiones guarda sus contadores en memoria: con más de una instancia de la API
  debe pasar a un almacén compartido.
- El código TOTP no se marca como usado: puede repetirse dentro de su ventana de 30 segundos.
- `npm audit --omit=dev` no reporta vulnerabilidades en lo que se despliega. `npm audit` completo
  sí reporta 38 avisos (9 moderados, 29 altos) en herramientas de desarrollo: dependencias
  transitivas de Jest 29 y drizzle-kit. Se resuelven actualizando a Jest 30.
- El flujo de CI está escrito pero no se ha ejecutado en GitHub; su modo de base de datos
  externa sí se probó localmente.
