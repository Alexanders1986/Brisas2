# 5. Diseño UX/UI

## Idea central: la fachada

Quien administra un conjunto piensa en edificios, pisos y apartamentos, no en filas de una
tabla. La interfaz dibuja cada torre como una fachada: una cuadrícula de ventanas, con el piso
más alto arriba. Una ventana encendida es una unidad ocupada; una apagada, una libre. Es la
pantalla de unidades, el resumen del inicio y el motivo visual del inicio de sesión.

Todo lo demás es deliberadamente sobrio, para que ese sea el elemento que se recuerda.

## Sistema visual

Definido como variables CSS en [apps/web/src/app/globals.css](../apps/web/src/app/globals.css).

| Token | Claro | Oscuro | Uso |
| --- | --- | --- | --- |
| `bg` | `#F4F6F7` | `#11161C` | Fondo de la aplicación |
| `surface` | `#FFFFFF` | `#19212A` | Tarjetas, formularios, menú |
| `surface-2` | `#EEF1F3` | `#222C37` | Hover, fondos secundarios |
| `line` | `#DDE3E7` | `#2E3A47` | Bordes |
| `ink` | `#1B2430` | `#E8EDF1` | Texto principal |
| `muted` | `#5B6876` | `#9AA8B5` | Texto secundario |
| `brand` | `#0F766E` | igual | **Lo sobrescribe cada conjunto** con su color |
| `warn` / `danger` / `ok` | `#B45309` / `#B42318` / `#157F3B` | versiones claras | Estados |

- **La marca es del conjunto.** `--brand` se redefine con el color configurado para cada
  conjunto; botones, estados activos y ventanas encendidas cambian con él. Brisas del Parque se
  ve verde azulado y Altos de la Colina, índigo, sin una sola regla CSS adicional.
- **Tipografía:** Bricolage Grotesque para títulos (carácter, cifras grandes) e Instrument Sans
  para texto e interfaz. Cuerpo de 15 px; títulos de página de 28 px.
- **Forma:** controles con radio de 10 px, tarjetas de 16 px, estados en píldora. Bordes en
  lugar de sombras; la sombra se reserva para lo que flota (menús, diálogos).
- **Movimiento:** solo como respuesta a una acción (abrir un diálogo, avanzar la barra de
  ocupación). Se respeta `prefers-reduced-motion`.
- **Modo claro y oscuro**, con el tema guardado por dispositivo.

## Componentes reutilizables

En [apps/web/src/components/ui.tsx](../apps/web/src/components/ui.tsx): `Button`, `IconButton`,
`Field` (etiqueta, ayuda y error enlazados), `Input`, `Select`, `ChoiceCard`, `Toggle`, `Card`,
`Badge`, `Skeleton`, `EmptyState`, `PageHeader` (con ruta de navegación), `Dialog` y
`ConfirmDialog`. Además `Shell` (menú, barra superior), `Facade` y `PasswordInput`.

## Reglas de interacción

- **Validación en tiempo real** con el mismo esquema que valida el servidor; el error aparece
  junto al campo, en español y diciendo cómo corregirlo.
- **Los errores del servidor vuelven al campo** que los causó, y en el asistente llevan al paso
  correspondiente.
- **Estados vacíos** que explican qué hacer y ofrecen la acción.
- **Esqueletos de carga** con la forma del contenido que viene.
- **Confirmación** solo para lo que afecta a otras personas o no tiene vuelta atrás; el botón
  nombra la acción ("Desactivar acceso"), no "Aceptar".
- **La misma palabra de principio a fin:** el botón "Registrar residente" produce el aviso
  "Residente registrado".
- **Los filtros viven en la URL**: se pueden compartir y sobreviven a recargar.

## Accesibilidad (WCAG 2.2 AA)

- Foco visible en todos los controles; enlace "Saltar al contenido".
- Controles de al menos 44 px de alto; menús y diálogos sobre primitivas Radix (teclado, foco
  atrapado, `Esc`).
- Los estados combinan texto e ícono: nunca dependen solo del color.
- Errores con `role="alert"` y enlazados al campo con `aria-describedby`.
- Idioma declarado (`lang="es"`), jerarquía de encabezados y regiones (`nav`, `main`).

Pendiente: auditoría con lector de pantalla y verificación automática de contraste para los
colores que elija cada conjunto (fase 2, al construir la personalización).

## Navegación

```text
/login · /recuperar · /restablecer · /invitacion      públicas
/conjuntos                                            elegir conjunto (si hay más de uno)
/c/<conjunto>                                         Inicio: panel o portal según permisos
/c/<conjunto>/residentes                              lista con búsqueda y filtros
/c/<conjunto>/residentes/nuevo                        asistente de registro
/c/<conjunto>/residentes/<id>                         detalle, edición, acceso, historial
/c/<conjunto>/unidades                                fachadas, torres y unidades
/plataforma                                           conjuntos (SuperAdmin)
/cuenta                                               contraseña, dos pasos, sesiones
```

Menú administrativo actual: **Inicio**, **Residentes**, **Torres y unidades**. Menú previsto al
completar las fases: Inicio, Comunicados, PQR, Proyectos, Residentes, Torres y unidades,
Documentos, Reportes, Configuración.

Tareas frecuentes, en pasos:

| Tarea | Camino |
| --- | --- |
| Registrar residente | Inicio → Registrar residente → asistente → Guardar |
| Crear una torre completa | Torres y unidades → Nueva torre → Generar unidades |
| Quitar el acceso a alguien | Residentes → persona → Desactivar acceso → confirmar |
| Buscar a una persona | Barra superior → escribir → Enter |

## Wireframes

**Panel administrativo (escritorio)**

```text
┌──────────────┬───────────────────────────────────────────────────────────┐
│ [BD] Brisas  │ [🔍 Buscar residente…]                        [☾] [PR ▾]  │
│     del Parq.├───────────────────────────────────────────────────────────┤
│              │ Hola, Patricia                      [ Registrar residente ]│
│ ▣ Inicio     │ Así está tu conjunto hoy.                                  │
│ ○ Residentes │ ┌───────────────────────────┐ ┌───────────┐ ┌───────────┐ │
│ ○ Torres y   │ │ Unidades ocupadas         │ │Residentes │ │Con acceso │ │
│   unidades   │ │ 3 de 40                   │ │ 3         │ │ 1         │ │
│              │ │ ▓▓░░░░░░░░░░░░  8 %       │ ├───────────┤ ├───────────┤ │
│              │ └───────────────────────────┘ │Parqueader.│ │Mascotas   │ │
│              │ ┌─────────────────────────────┴───────────┴─┴───────────┐ │
│              │ │ El conjunto de un vistazo      ■ Ocupada □ Libre      │ │
│              │ │ Torre 1                  Torre 2                      │ │
│              │ │ Piso 5 [501][502][503][504]   [501][502][503][504]    │ │
│              │ │ Piso 3 [301][■302][303][304]  [301][302][303][304]    │ │
│ [« contraer] │ │ Piso 1 [■101][102][103][104]  [101][102][103][104]    │ │
└──────────────┴─┴───────────────────────────────────────────────────────┴─┘
```

**Asistente de registro**

```text
Residentes › Registrar
Registrar residente
▓▓▓▓▓▓ ▓▓▓▓▓▓ ░░░░░░ ░░░░░░ ░░░░░░ ░░░░░░
1. Datos  2. Unidad  3. Parq.  4. Mascotas  5. Documentos  6. Confirmación
┌──────────────────────────────────────────────────────────┐
│ Unidad                                                   │
│ Torre o bloque  [Torre 2      ▾]  Apartamento [202    ▾] │
│ Fecha de vinculación [13/10/2026] Personas en la unidad [2]│
└──────────────────────────────────────────────────────────┘
[← Atrás]                                       [Continuar →]
```

**Portal del residente (celular)**

```text
┌──────────────────────────┐
│ ☰                 ☾ (LG) │
│ ┌──────────────────────┐ │
│ │ Altos de la Colina   │ │   color del conjunto
│ │ Hola, Laura          │ │
│ │ Tu conjunto, siempre │ │
│ │ a la mano.           │ │
│ └──────────────────────┘ │
│ Administración           │
│ 🕒 Horario de atención   │
│ 📍 Dirección             │
│ 📞 Teléfono   ✉ Correo   │
│ ── fases siguientes ──   │
│ [Pagar administración]   │
│ Comunicados · Mis PQR    │
│ Documentos · Proyectos   │
└──────────────────────────┘
```

La aplicación móvil (fase 7) no será esta web encogida: usará navegación por pestañas
inferiores (Inicio, Comunicados, PQR, Más), gestos nativos y notificaciones push, sobre la
misma API.
