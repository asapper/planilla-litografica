# Manual de Usuario — Cargador de Planilla

**Versión:** 1.0  
**Idioma:** Español  
**Dirigido a:** Personal de planillas y recursos humanos sin conocimientos técnicos

---

## Contenido

1. [¿Qué hace esta aplicación?](#1-qué-hace-esta-aplicación)
2. [Requisitos del sistema](#2-requisitos-del-sistema)
3. [Cómo abrir la aplicación](#3-cómo-abrir-la-aplicación)
4. [Paso 1 — Cargar el archivo CSV](#4-paso-1--cargar-el-archivo-csv)
5. [Paso 2 — Seleccionar la quincena y el mes](#5-paso-2--seleccionar-la-quincena-y-el-mes)
6. [Paso 3 — Revisar y corregir los datos](#6-paso-3--revisar-y-corregir-los-datos)
7. [Paso 4 — Validar los datos](#7-paso-4--validar-los-datos)
8. [Paso 5 — Enviar los datos a la base de datos](#8-paso-5--enviar-los-datos-a-la-base-de-datos)
9. [Pantalla de resultados](#9-pantalla-de-resultados)
10. [Mensajes de error y cómo resolverlos](#10-mensajes-de-error-y-cómo-resolverlos)
11. [Preguntas frecuentes](#11-preguntas-frecuentes)

---

## 1. ¿Qué hace esta aplicación?

El **Cargador de Planilla** le permite enviar los datos de asistencia de sus empleados a la base de datos de la empresa de forma rápida y segura, sin necesidad de conocimientos técnicos.

El proceso completo tiene cinco pasos:

1. Cargue el archivo de reporte de asistencia (CSV) generado por el sistema de control de asistencia.
2. Seleccione la quincena y el mes correspondientes.
3. Revise los datos extraídos y corrija cualquier error si es necesario.
4. Valide los datos para detectar errores antes de enviar.
5. Envíe los datos a la base de datos.

---

## 2. Requisitos del sistema

- **Sistema operativo:** Windows 10 o Windows 11
- **Conexión a la red:** La computadora debe tener acceso a la red interna de la empresa (donde se encuentra la base de datos)
- **Archivo CSV:** El reporte de asistencia generado por el sistema de marcación de tiempo, en formato `.csv`

No se requiere instalación de programas adicionales. La aplicación incluye todo lo necesario.

---

## 3. Cómo abrir la aplicación

Haga doble clic en el ícono de **Cargador de Planilla** en el escritorio o en la carpeta donde fue instalada la aplicación.

> **[Captura: Ícono de la aplicación en el escritorio de Windows]**

La aplicación tardará unos segundos en iniciarse mientras prepara sus componentes internos. Verá una pantalla de carga. Una vez lista, aparecerá la pantalla de inicio.

> **[Captura: Pantalla de inicio mostrando el botón para cargar archivo y el área de arrastrar y soltar]**

---

## 4. Paso 1 — Cargar el archivo CSV

### Opción A: Arrastrar y soltar

1. Abra la carpeta donde tiene guardado su archivo de reporte de asistencia.
2. Haga clic sobre el archivo y, sin soltar el botón del mouse, arrástrelo hasta el centro de la pantalla de la aplicación.
3. Suelte el archivo sobre el área que dice **"Arrastre su archivo CSV aquí"**.

> **[Captura: Archivo CSV siendo arrastrado hacia la zona de carga de la aplicación]**

### Opción B: Seleccionar archivo con el botón

1. Haga clic en el botón **"Seleccionar archivo"** en el centro de la pantalla.
2. Se abrirá una ventana para buscar archivos. Navegue hasta la carpeta donde tiene su reporte de asistencia.
3. Seleccione el archivo `.csv` y haga clic en **Abrir**.

> **[Captura: Ventana de selección de archivo de Windows con un archivo CSV seleccionado]**

### Que esperar después de cargar

La aplicación procesará el archivo automáticamente. En pocos segundos verá la tabla con los datos de todos los empleados del reporte.

> **[Captura: Tabla de datos mostrando empleados con sus códigos, días no laborados y horas extras]**

---

### Errores al cargar el archivo

| Mensaje | Causa | Qué hacer |
|---|---|---|
| "Solo se aceptan archivos CSV" | El archivo seleccionado no es un `.csv` | Asegúrese de seleccionar el archivo de reporte de asistencia en formato CSV |
| "No se pudo leer el archivo" | El archivo está dañado o tiene un formato incorrecto | Verifique que el archivo fue generado por el sistema de control de asistencia de la empresa |
| "El archivo no contiene empleados válidos" | El archivo está vacío o no tiene el formato esperado | Contacte al encargado de sistemas |

---

## 5. Paso 2 — Seleccionar la quincena y el mes

Después de cargar el archivo, aparecerá una barra en la parte superior de la tabla donde deberá indicar a qué período de pago corresponden los datos.

> **[Captura: Barra de selección de quincena mostrando las opciones "Quincena 1" y "Quincena 2"]**

### Seleccionar la quincena

Haga clic en **Quincena 1** o **Quincena 2** según corresponda al período que está procesando.

- **Quincena 1:** del 1 al 15 del mes
- **Quincena 2:** del 16 al último día del mes

### Seleccionar el mes (si el archivo abarca dos meses)

Algunos reportes de asistencia cubren días de dos meses calendarios distintos (por ejemplo, del 16 de noviembre al 15 de diciembre). En ese caso, la aplicación mostrará pestañas con los meses presentes en el archivo.

> **[Captura: Pestañas de mes mostrando "Noviembre 2025" y "Diciembre 2025" cuando el archivo abarca dos meses]**

Haga clic en el mes que desea procesar. La tabla mostrará únicamente los empleados correspondientes a ese mes.

> **Nota:** Si el archivo abarca un solo mes, el mes y el año se muestran automáticamente y no es necesario seleccionarlos.

---

## 6. Paso 3 — Revisar y corregir los datos

La tabla muestra un registro por cada empleado extraído del reporte, con las siguientes columnas:

| Columna | Descripción |
|---|---|
| **Código Empleado** | Identificador único del empleado en el sistema |
| **Días no laborados** | Cantidad de días de ausencia en el período |
| **Horas extras simples** | Total de horas extras simples (redondeadas) |
| **Horas extras dobles** | Total de horas extras dobles (redondeadas) |
| **Mes** | Mes derivado del reporte (solo lectura) |
| **Año** | Año derivado del reporte (solo lectura) |

> **[Captura: Tabla de datos con varias filas de empleados, mostrando las columnas descritas]**

### Cómo editar un valor

Si necesita corregir un dato:

1. Haga clic sobre la celda que desea editar. La celda cambiará a modo edición.
2. Borre el valor actual y escriba el valor correcto.
3. Presione **Enter** o haga clic fuera de la celda para confirmar el cambio.

> **[Captura: Una celda en modo edición con el cursor activo]**

### Buscar un empleado específico

Si la tabla tiene muchos empleados, puede usar la barra de búsqueda en la parte superior para filtrar por nombre o código de empleado.

> **[Captura: Barra de búsqueda con texto ingresado y la tabla mostrando resultados filtrados]**

---

## 7. Paso 4 — Validar los datos

Antes de enviar, debe validar los datos para asegurarse de que estén correctos. Haga clic en el botón **"Validar"** en la barra inferior de la pantalla.

> **[Captura: Botón "Validar" en la barra inferior de la aplicación]**

La aplicación revisará todos los registros. El proceso tarda pocos segundos.

### Resultado de la validación

**Si todos los datos son correctos:**

Verá un mensaje verde que dice **"Validación exitosa"**. La aplicación también verificará que la base de datos esté disponible. Una vez confirmado, el botón cambiará a **"Enviar"**.

> **[Captura: Mensaje verde de validación exitosa y botón "Enviar" habilitado]**

**Si hay errores:**

Las filas con problemas se resaltarán en rojo. Haga clic sobre cualquier celda roja para ver la descripción del error.

> **[Captura: Filas con errores resaltadas en rojo con indicador visual en el lado izquierdo]**

Un mensaje en la parte inferior le indicará cuántos errores se encontraron. Corrija los valores indicados y vuelva a hacer clic en **"Validar"**.

**Si hay registros duplicados:**

Los registros que ya existen en la base de datos (ya enviados en un período anterior) se resaltarán en color **amarillo**. Estos registros serán omitidos automáticamente al enviar — no es necesario eliminarlos manualmente.

> **[Captura: Filas duplicadas resaltadas en amarillo, diferenciadas de los errores en rojo]**

---

## 8. Paso 5 — Enviar los datos a la base de datos

Una vez que la validación sea exitosa y el botón diga **"Enviar"**, haga clic en él para iniciar el proceso de envío.

> **[Captura: Botón "Enviar" activo en la barra inferior]**

### Durante el envío

Verá una pantalla de progreso que muestra cuántos registros se han procesado. El tiempo de envío depende de la cantidad de empleados en el reporte.

> **[Captura: Pantalla de progreso del envío con barra de avance y conteo de registros procesados]**

**No cierre la aplicación** mientras el envío está en curso.

---

## 9. Pantalla de resultados

Al completarse el envío, verá una pantalla de resultados con un resumen de lo ocurrido.

### Éxito total

Todos los registros fueron enviados correctamente.

> **[Captura: Pantalla de éxito mostrando el número de registros enviados exitosamente]**

### Éxito parcial

Algunos registros se enviaron correctamente pero otros tuvieron errores. La pantalla mostrará:
- Cantidad de registros enviados con éxito
- Lista de registros que fallaron con el motivo del error

> **[Captura: Pantalla de resultado parcial con registros exitosos y lista de los que fallaron]**

Puede hacer clic en **"Reintentar"** para volver a intentar los registros que fallaron.

### Error total

Ningún registro pudo ser enviado. La pantalla mostrará el motivo del error.

> **[Captura: Pantalla de error con mensaje descriptivo del problema]**

### Iniciar un nuevo envío

Para procesar otro archivo, haga clic en el botón **"Cargar nuevo archivo"** en la pantalla de resultados. Esto lo llevará de vuelta a la pantalla de inicio.

---

## 10. Mensajes de error y cómo resolverlos

### Error al cargar el archivo

| Mensaje | Causa probable | Solución |
|---|---|---|
| "Solo se aceptan archivos CSV" | Se seleccionó un archivo de otro tipo | Seleccione un archivo con extensión `.csv` |
| "El archivo no contiene empleados válidos" | El archivo no tiene el formato correcto | Verifique que el archivo fue exportado del sistema de control de asistencia de la empresa |

### Error de validación

| Mensaje | Causa probable | Solución |
|---|---|---|
| "Campo requerido" | Una celda obligatoria está vacía | Ingrese el valor correspondiente en la celda resaltada |
| "Debe ser un número entero" | Se ingresó un valor no numérico | Corrija el valor de la celda para que sea un número sin decimales |
| "Valor fuera del rango permitido" | El número ingresado es demasiado alto o demasiado bajo | Revise y corrija el valor de acuerdo a los límites permitidos |

### Errores de conexión

| Mensaje | Causa probable | Solución |
|---|---|---|
| "Base de datos no disponible" | La aplicación no puede alcanzar la base de datos de la empresa | Verifique que su computadora está conectada a la red interna; si el problema persiste, contacte al encargado de sistemas |
| "Error al conectar con el servidor" | El componente interno de la aplicación no responde | Cierre y vuelva a abrir la aplicación; si el problema continúa, contacte al encargado de sistemas |

---

## 11. Preguntas frecuentes

**¿Puedo cargar el mismo archivo dos veces?**  
Sí. La aplicación detecta automáticamente los registros que ya fueron enviados y los marca en amarillo. Solo se enviarán los registros nuevos — los duplicados serán omitidos sin generar un error.

**¿Qué pasa si cierro la aplicación durante el envío?**  
No cierre la aplicación mientras el envío está en curso. Si lo hace por accidente, vuelva a abrir la aplicación y cargue el archivo nuevamente. La aplicación detectará los registros que ya se enviaron como duplicados y solo enviará los que falten.

**¿Puedo editar los datos después de validar?**  
Sí. Si edita algún valor luego de validar, la validación se reinicia automáticamente y deberá volver a hacer clic en **"Validar"** antes de poder enviar.

**¿El mes y el año son editables?**  
No. El mes y el año se derivan automáticamente del archivo CSV y no pueden modificarse. Si el mes o el año son incorrectos, el archivo de reporte puede contener fechas erróneas — contacte al encargado de sistemas.

**¿Qué formatos de archivo acepta la aplicación?**  
Solo archivos `.csv` generados por el sistema de control de asistencia de la empresa. Archivos de Excel (`.xlsx`, `.xls`) u otros formatos no son compatibles.

**¿Qué hago si el archivo tiene empleados que no aparecen en la tabla?**  
Si un empleado del reporte no aparece en la tabla, es posible que su bloque de datos en el archivo esté incompleto o dañado. Contacte al encargado de sistemas para verificar el archivo fuente.

**¿Puedo cambiar la quincena después de haber validado?**  
Sí. Si cambia la quincena o el mes después de validar, la validación se reinicia y deberá volver a hacer clic en **"Validar"**.

---

*Para soporte técnico, contacte al encargado de sistemas de la empresa.*
