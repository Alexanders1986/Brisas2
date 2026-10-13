# 1. Visión del producto

Brisas reúne en un solo lugar lo que hoy un conjunto residencial resuelve con hojas de
cálculo, grupos de WhatsApp y carpetas de PDF. Hay tres experiencias sobre los mismos datos.

## Para quien administra

Patricia administra un conjunto de 40 apartamentos. No es técnica y no debería necesitar serlo.

- **Entra y ve su conjunto.** La pantalla de inicio dibuja cada torre como un edificio: las
  ventanas encendidas son apartamentos ocupados. De un vistazo sabe cuántas unidades están
  ocupadas, cuántos residentes hay y quién no ha aceptado su invitación.
- **Registra a un residente con un asistente de seis pasos**: datos personales, unidad,
  parqueaderos y depósitos, mascotas, documentos y acceso, y un resumen antes de guardar. Si la
  persona ya existe, el asistente lo avisa mientras escribe y ofrece vincularla en lugar de
  duplicarla.
- **Da y quita acceso con un botón.** Al dar acceso, la persona recibe un correo para crear su
  contraseña. Al quitarlo, deja de entrar en ese mismo instante.
- **Nunca toca nada técnico.** Crear una torre con sus 60 apartamentos es un formulario de tres
  campos. No hay SQL, archivos de configuración ni pantallas de "ajustes avanzados".

## Para quien vive en el conjunto

Laura es propietaria en un conjunto y arrendataria en otro, con una sola cuenta.

- Inicia sesión y elige a cuál conjunto entrar; cada uno se ve con su propio color y nombre.
- Encuentra el horario de atención, la dirección, el teléfono, el WhatsApp y el correo de la
  administración.
- En las fases siguientes: comunicados, documentos del conjunto, sus PQR con conversación,
  avance de las obras y el botón para pagar la administración.

## Para el equipo de la plataforma

El SuperAdmin crea conjuntos, les asigna un plan (que limita el número de unidades), invita a
su primer administrador y puede desactivar un conjunto sin borrar sus datos. No tiene acceso
implícito a los datos de los residentes: para entrar a un conjunto necesita que lo agreguen.

## Principios que guían cada decisión

1. **Todo se opera desde la interfaz.** Si una tarea cotidiana requiere a un desarrollador, es
   un defecto del producto.
2. **Pocas decisiones por pantalla.** Formularios guiados, valores por defecto sensatos y
   confirmación solo para lo que no tiene vuelta atrás.
3. **Los errores dicen qué pasó y qué hacer.** "El parqueadero P-01 ya está asignado a
   Torre 1 · Apto 101", no "Error 409".
4. **La seguridad no depende de esconder botones.** La interfaz oculta lo que el rol no puede
   usar, pero quien decide es siempre el servidor, y debajo de él la base de datos.
5. **Lo que no está construido no se muestra como si lo estuviera.** El menú solo tiene lo que
   funciona.
