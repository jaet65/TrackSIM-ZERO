# Especificación de Exportación hacia TrackSIM-CLOUD (V1.0.0)

Este documento detalla el contrato, la arquitectura de datos, el flujo de cierre/congelamiento, el mecanismo de autorización entre proyectos y la forma de consumir las exportaciones inmutables generadas por **TrackSIM-ZERO** para **TrackSIM-CLOUD**.

---

## 1. Arquitectura y Modelo de Datos

En lugar de requerir que TrackSIM-CLOUD vuelva a procesar PDFs individuales (expedientes V2) o dependa de recalcular sobre el catálogo cambiante, TrackSIM-ZERO genera proyecciones inmutables en Firestore al congelar y cerrar un grupo.

### Estructura en Firestore

```text
cloud_exports/{groupId}
  ├── [Documento Maestro] (Metadatos del grupo, schemaVersion, estado, contadores)
  └── evaluations/{evaluationId}
        ├── [Expediente Conductor 1] (Esquema compatible con Evaluation de CLOUD)
        ├── [Expediente Conductor 2]
        └── ...
```

### Por qué esta estructura:
1. **Subcolección separada**: Cada conductor tiene su propio documento en `cloud_exports/{groupId}/evaluations/{evaluationId}`. Esto previene exceder el límite de 1 MB por documento de Firestore ante grupos con decenas o cientos de participantes.
2. **IDs deterministas**:
   - `groupId`: ID canónico del grupo (ej. `grp_1730000000_abcde`).
   - `evaluationId`: `eval_{groupId}_{sanitizedDriverId}` (ej. `eval_grp_1730000000_abcde_juan_perez`).
   - Reintentar una exportación es **100% idempotente** y no duplica documentos.
3. **Inmutabilidad y Fuente de Verdad**:
   - Se utilizan las evaluaciones congeladas (`frozen: true`, `frozenScore`, `frozenMarks`, etc.).
   - Modificaciones posteriores a los catálogos globales no alteran los snapshots exportados.

---

## 2. Contrato de Datos de Cada Expediente (`schemaVersion: "1.0.0"`)

Cada documento en `cloud_exports/{groupId}/evaluations/{evaluationId}` implementa la interfaz `CloudExportEvaluationDoc`, compatible con el modelo `Evaluation` de TrackSIM-CLOUD:

```typescript
export interface CloudExportEvaluationDoc {
  schemaVersion: "1.0.0";

  // Identidad
  id: string;                               // "eval_{groupId}_{driverId}"
  folio: string;                            // "EXP-YYYYMMDD-XXXX-YYYY" (idéntico al PDF)
  conductor: string;                        // Nombre completo del conductor
  operador: string;                         // Alias para interoperabilidad con CLOUD
  groupId: string;                          // ID del grupo en ZERO
  groupName: string;                        // Nombre descriptivo del grupo
  folioGrupo: string | null;                // Folio o identificador del grupo

  // Contexto operativo
  empresa: string | null;                   // null en ZERO (ver sección de limitaciones)
  sede: string | null;                      // null en ZERO
  ciudad: string | null;                    // null en ZERO
  instructor: string | null;                // Nombre del instructor principal
  fecha: string | null;                     // Fecha de la última sesión (YYYY-MM-DD)
  fechaCapacitacion: string | null;         // Fecha de capacitación
  fechaCapacitacionFormato: string | null;  // Fecha formateada
  fechaReporte: string;                     // Fecha de generación del snapshot
  tipoEvaluacion: string;                   // "Expediente individual V2"
  tipoLicencia: string | null;              // null en ZERO
  cursoCodigo: string | null;               // null en ZERO
  cursoNombre: string;                      // Nombre del grupo o curso evaluado

  // Resultado
  evaluacionFinalPuntos: number;            // Calificación global promediada (escala 0-10)
  calificacionExacta: number;               // Calificación exacta promediada
  promedioScore: number;                    // Calificación promediada
  estado: "Aprobado" | "Reforzar" | "No Aprobado" | "Pendiente";
  clasificacion: string;                    // Dictamen original de ZERO ("APTO", etc.)

  // Métricas reales verificables de TrackSIM-ZERO
  destrezaPuntos: number;                   // Destreza calculada (70% ponderado)
  destrezaMax: number;                      // 7.0
  ecoDrivingPuntos: number;                 // Eco-Driving calculado (30% ponderado)
  ecoDrivingMax: number;                    // 3.0
  habilidadesManejoPct: number | null;      // null (no aplica en V2)
  practicaSimuladorPct: number | null;      // null (no aplica en V2)

  // Incidentes cuantificables
  colisiones: number;                       // Total de colisiones e impactos
  totalColisiones: number;                  // Conteo homologado
  accidentesCriticos: number;               // Errores con severidad crítica
  fatalidades: number;                      // Vuelcos, atropellos a peatones o salidas en montaña
  vehiculoFueraVia: number;                 // Salidas de vía en carretera o ciudad
  totalInfracciones: number;                // Suma total de errores cometidos

  // Desglose de ejercicios
  ejercicios: CloudExportExerciseItem[];
  simulacionesDetalle: Record<string, number>;        // { simulacion_1: 8.5, ... }
  nombresSimulaciones: Record<string | number, string>; // { 1: "Curvas y frenado", ... }
  erroresFrecuentes: CloudExportFrequentMistakeItem[]; // Lista de faltas cometidas con repeticiones

  // Metadatos de procedencia
  origen: "TrackSIM-ZERO-V2";
  sourceGroupId: string;
  sourceDriverId: string;
  sourceEvaluationIds: string[];            // IDs de las evaluaciones fuente en evaluations/{id}
  creadoEn: number;                         // Timestamp en milisegundos
  createdAt: string;                        // ISO 8601
  actualizadoEn: number;
  updatedAt: string;
}
```

---

## 3. Estados de Exportación e Integridad

El documento maestro `cloud_exports/{groupId}` gestiona la visibilidad del snapshot:

| Estado | Significado para CLOUD |
| :--- | :--- |
| `pending` | **Ignorar**. La exportación está en progreso escribiendo documentos. |
| `complete` | **Listo para lectura/ingesta**. Todos los expedientes fueron persistidos exitosamente. |
| `error` | **Ignorar**. Ocurrió un error en la escritura. ZERO ofrece un botón de reintento. |

### Flujo de Cierre y Escritura en Lotes (Batches)
1. Al invocar `closeAndFreezeGroup(groupId, user)`, ZERO congela las evaluaciones del grupo en `evaluations/{id}`.
2. Marca el grupo como cerrado (`status: "closed"`).
3. Registra `cloud_exports/{groupId}` con `status: "pending"`, `expectedCount: N` y `exportedCount: 0`.
4. Divide las escrituras de la subcolección en lotes seguros (máximo 200 documentos por batch, inferior al límite de 500 de Firestore).
5. Tras completar todos los lotes, actualiza `cloud_exports/{groupId}` con `status: "complete"` y `completedAt: Date.now()`.
6. Si alguna operación falla, actualiza el estado a `status: "error"`, guarda `errorMessage` y permite reintentar con `retryCloudExport(groupId, user)` de forma idempotente.

---

## 4. Cómo debe Consultar TrackSIM-CLOUD

Para garantizar que CLOUD **nunca consuma datos a medio escribir**, debe consultar exclusivamente exportaciones con `status == 'complete'`:

```typescript
import { collection, query, where, getDocs, doc } from "firebase/firestore";

// 1. Obtener grupos exportados y listos
const exportsQuery = query(
  collection(zeroDb, "cloud_exports"),
  where("status", "==", "complete")
);
const readyGroupsSnapshot = await getDocs(exportsQuery);

for (const groupDoc of readyGroupsSnapshot.docs) {
  const groupMeta = groupDoc.data();
  console.log(`Grupo listo: ${groupMeta.groupName} (${groupMeta.exportedCount} expedientes)`);

  // 2. Leer los expedientes individuales de la subcolección
  const evalsSnapshot = await getDocs(
    collection(zeroDb, "cloud_exports", groupDoc.id, "evaluations")
  );

  const evaluations = evalsSnapshot.docs.map((d) => d.data());
  // Procesar o sincronizar directamente en CLOUD
}
```

---

## 5. Seguridad y Acceso entre Proyectos (Cross-Project Security)

TrackSIM-ZERO (`tracksim-zero`) y TrackSIM-CLOUD (`tracksim-cloud`) residen en proyectos Firebase distintos.

### Políticas de Acceso:
1. **Reglas de Firestore en ZERO (`firestore.rules`)**:
   - `cloud_exports/{groupId}` y su subcolección `/evaluations` permiten lectura **únicamente a personal staff verificado** (`@corporativomaf.com` con `email_verified == true`).
   - Se rechaza terminantemente cualquier lectura anónima o no autenticada.
2. **Acceso Seguro desde CLOUD**:
   - **Administradores y Staff**: Si un usuario corporativo de `@corporativomaf.com` inicia sesión en CLOUD, puede consultar directamente el proyecto secundario `tracksim-zero` inicializado con el SDK cliente.
   - **Clientes / Usuarios con restricción de empresa**: Para clientes que no pertenezcan al dominio corporativo, el acceso **NO** debe realizarse desde el navegador cliente (frontend), sino a través de un **backend confiable de solo lectura** (Cloud Function o Cloud Run en CLOUD).
   - El backend seguro utiliza una cuenta de servicio autorizada con rol `roles/datastore.viewer` en el proyecto `tracksim-zero`.
   - **Nunca publicar claves privadas de cuentas de servicio en el frontend de CLOUD ni de ZERO**.

---

## 6. Mapeo de Campos y Limitaciones respecto a Ingesta V2

| Campo en CLOUD `Evaluation` | Disponibilidad en ZERO | Manejo en la Exportación |
| :--- | :---: | :--- |
| `conductor`, `operador` | ✅ Disponible | Nombre del conductor registrado en simulador. |
| `folio` | ✅ Disponible | Folio determinista `EXP-YYYYMMDD-XXXX-YYYY` idéntico al PDF. |
| `evaluacionFinalPuntos` | ✅ Disponible | Calificación global promediada congelada. |
| `destrezaPuntos`, `destrezaMax` | ✅ Disponible | Ponderación de destreza al 70% sobre 7.0 puntos. |
| `ecoDrivingPuntos`, `ecoDrivingMax`| ✅ Disponible | Ponderación de telemetría al 30% sobre 3.0 puntos. |
| `colisiones`, `fatalidades`, `vehiculoFueraVia` | ✅ Disponible | Calculados a partir de los errores congelados y el entorno. |
| `accidentesCriticos` | ✅ Disponible | Conteo de errores críticos acumulados. |
| `totalInfracciones` | ✅ Disponible | Suma de faltas cometidas en todas las evaluaciones. |
| `ejercicios` | ✅ Disponible | Lista completa de ejercicios obligatorios (realizados y no realizados). |
| `erroresFrecuentes` | ✅ Disponible | Errores agrupados por frecuencia y nivel de gravedad. |
| `empresa`, `sede` | ❌ No disponible | `null`. ZERO opera a nivel simulador/grupo y no almacena empresa/sede en el log. CLOUD las asigna durante la ingesta. |
| `ciudad` | ❌ No disponible | `null`. |
| `tipoLicencia` | ❌ No disponible | `null`. |
| `cursoCodigo` | ❌ No disponible | `null`. |
| `distanciaTotal` | ❌ No disponible | `null`. El simulador emite tiempos de recorrido pero no odómetro fiable uniforme. |
| `habilidadesManejoPct` | ❌ No disponible | `null` (campo de la versión 1 de expedientes, no aplicable en V2). |
| `practicaSimuladorPct` | ❌ No disponible | `null` (campo de la versión 1 de expedientes, no aplicable en V2). |

