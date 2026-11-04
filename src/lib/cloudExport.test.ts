import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  collection,
  doc,
  query,
  where,
  setDoc,
  updateDoc,
  writeBatch,
  safeGetDoc,
  safeGetDocs,
  fastWrite,
  batchSet,
  batchDelete,
  batchCommit,
  deleteDoc,
} = vi.hoisted(() => {
  const bSet = vi.fn();
  const bDelete = vi.fn();
  const bCommit = vi.fn(() => Promise.resolve());
  return {
    collection: vi.fn((_db: unknown, ...names: string[]) => ({ path: names.join("/") })),
    doc: vi.fn((_first: unknown, ...parts: string[]) => {
      const basePath = typeof _first === "object" && _first !== null && "path" in _first ? (_first as { path: string }).path : "";
      const fullParts = basePath ? [basePath, ...parts] : parts;
      return {
        path: fullParts.join("/"),
        id: parts[parts.length - 1],
      };
    }),
    query: vi.fn((col: unknown, ...constraints: unknown[]) => ({ col, constraints })),
    where: vi.fn((field: string, op: string, val: unknown) => ({ field, op, val })),
    setDoc: vi.fn(() => Promise.resolve()),
    updateDoc: vi.fn(() => Promise.resolve()),
    deleteDoc: vi.fn(() => Promise.resolve()),
    writeBatch: vi.fn(() => ({ set: bSet, delete: bDelete, commit: bCommit })),
    safeGetDoc: vi.fn(),
    safeGetDocs: vi.fn(),
    fastWrite: vi.fn((promise: Promise<unknown>) => promise),
    batchSet: bSet,
    batchDelete: bDelete,
    batchCommit: bCommit,
  };
});

vi.mock("./firebase", () => ({
  getDb: vi.fn(() => ({})),
  firestore: {},
  safeGetDoc,
  safeGetDocs,
  fastWrite,
}));

vi.mock("firebase/firestore", () => ({
  collection,
  doc,
  query,
  where,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  orderBy: vi.fn(),
}));

import {
  buildCloudExportEvaluation,
  calculateDestrezaAndEco,
  countIncidents,
  deleteCloudExport,
  exportClosedGroupToCloud,
  getCloudExport,
  getCloudExportEvaluations,
  mapZeroVerdictToCloudEstado,
  toCloudEvaluationId,
  toFriendlyExportId,
} from "./cloudExport";
import type { DriverData } from "./db";
import type { GroupDoc } from "./groups";

describe("cloudExport - Contrato y Conversión de Datos a CLOUD", () => {
  const sampleGroup: GroupDoc = {
    id: "grp_1001",
    name: "Grupo Alfa Bimbo",
    status: "closed",
    createdAt: 1700000000000,
    closedAt: 1700010000000,
    createdBy: "Instructor Staff",
    createdByEmail: "staff@corporativomaf.com",
    closedBy: "Admin Staff",
    closedByEmail: "admin@corporativomaf.com",
    type: "escuela",
  };

  const sampleDriverData: DriverData = {
    name: "Juan Perez",
    overall: 8.5,
    rawOverall: 8.5,
    completedExercises: 2,
    expectedExercises: 3,
    criticalErrors: 0,
    verdict: "APTO CON OBSERVACIONES",
    color: "bg-amber-500",
    groupType: "escuela",
    groupEvals: [],
    missingExercises: [{ phase: 2, exercise: "Maniobras en reversa" }],
    phases: [],
    breakdown: [
      {
        description: "Colisión con un objeto",
        rawDescription: "Colisión con un objeto",
        count: 2,
        environment: "CIUDAD",
        severity: "GRAVE",
        weight: 3,
      },
      {
        description: "Salirse de la vía (en carretera / ciudad)",
        rawDescription: "Salirse de la vía",
        count: 1,
        environment: "CARRETERA",
        severity: "MODERADO",
        weight: 1,
      },
    ],
    evals: [
      {
        phase: 1,
        driverId: "juan-perez",
        driverName: "Juan Perez",
        fileName: "reporte_f1.rep",
        docId: "f1_reporte_f1.rep",
        lesson: "L1",
        unit: "U1",
        exercise: "Curvas y frenado",
        vehicle: "Kenworth T680",
        instructor: "Carlos Martinez",
        instructorEmail: "carlos@corporativomaf.com",
        date: "2026-10-15",
        durationSec: 154,
        errorCount: 3,
        criticalCount: 0,
        score: 9.0,
        errorScore: 9.0,
        telemetryScore: 8.0,
        marks: [
          { time: "01:10", type: "ERROR", description: "Colisión con un objeto" },
          { time: "01:45", type: "ERROR", description: "Colisión con un objeto" },
        ],
        createdAt: 1700001000000,
        groupId: "grp_1001",
        frozen: true,
      },
      {
        phase: 3,
        driverId: "juan-perez",
        driverName: "Juan Perez",
        fileName: "reporte_f3.rep",
        docId: "f3_reporte_f3.rep",
        lesson: "L3",
        unit: "U3",
        exercise: "Incorporación en autopista",
        vehicle: "Kenworth T680",
        instructor: "Carlos Martinez",
        instructorEmail: "carlos@corporativomaf.com",
        date: "2026-10-16",
        durationSec: 200,
        errorCount: 1,
        criticalCount: 0,
        score: 8.0,
        errorScore: 8.0,
        telemetryScore: 7.5,
        marks: [
          { time: "02:10", type: "ERROR", description: "Salirse de la vía" },
        ],
        createdAt: 1700002000000,
        groupId: "grp_1001",
        frozen: true,
      },
    ],
  };

  it("1. Convierte datos congelados de ZERO al contrato compatible con Evaluation de CLOUD", () => {
    const folio = "EXP-20261016-ABCD-1234";
    const cloudDoc = buildCloudExportEvaluation(sampleGroup, sampleDriverData, folio, 1700020000000);

    // Identidad
    expect(cloudDoc.schemaVersion).toBe("1.0.0");
    expect(cloudDoc.id).toBe("eval_Grupo_Alfa_Bimbo_1001_juan-perez");
    expect(cloudDoc.folio).toBe(folio);
    expect(cloudDoc.conductor).toBe("Juan Perez");
    expect(cloudDoc.operador).toBe("Juan Perez");
    expect(cloudDoc.groupId).toBe("Grupo_Alfa_Bimbo_1001");
    expect(cloudDoc.groupName).toBe("Grupo Alfa Bimbo");
    expect(cloudDoc.folioGrupo).toBeNull();

    // Resultado
    expect(cloudDoc.evaluacionFinalPuntos).toBe(8.5);
    expect(cloudDoc.calificacionExacta).toBe(8.5);
    expect(cloudDoc.promedioScore).toBe(8.5);
    expect(cloudDoc.estado).toBe("Reforzar"); // "APTO CON OBSERVACIONES" mapea a "Reforzar"
    expect(cloudDoc.clasificacion).toBe("APTO CON OBSERVACIONES");

    // Métricas verificables ZERO
    expect(cloudDoc.destrezaMax).toBe(7.0);
    expect(cloudDoc.ecoDrivingMax).toBe(3.0);
    expect(cloudDoc.destrezaPuntos).toBeGreaterThan(0);
    expect(cloudDoc.ecoDrivingPuntos).toBeGreaterThan(0);

    // Incidentes
    expect(cloudDoc.colisiones).toBe(2);
    expect(cloudDoc.totalColisiones).toBe(2);
    expect(cloudDoc.accidentesCriticos).toBe(0);
    expect(cloudDoc.vehiculoFueraVia).toBe(1);
    expect(cloudDoc.fatalidades).toBe(0);
    expect(cloudDoc.totalInfracciones).toBe(4);

    // Desglose de ejercicios
    expect(cloudDoc.ejercicios).toHaveLength(3);
    const completedEx = cloudDoc.ejercicios.find((e) => e.nombre === "Curvas y frenado");
    expect(completedEx).toBeDefined();
    expect(completedEx?.estado).toBe("Realizado");
    expect(completedEx?.noRealizado).toBe(false);
    expect(completedEx?.tiempo).toBe("2:34");
    expect(completedEx?.colisiones).toBe(2);

    const missingEx = cloudDoc.ejercicios.find((e) => e.nombre === "Maniobras en reversa");
    expect(missingEx).toBeDefined();
    expect(missingEx?.estado).toBe("No Realizado");
    expect(missingEx?.noRealizado).toBe(true);
    expect(missingEx?.calificacion).toBeUndefined();

    // Procedencia
    expect(cloudDoc.origen).toBe("TrackSIM-ZERO-V2");
    expect(cloudDoc.sourceEvaluationIds).toEqual(["f1_reporte_f1.rep", "f3_reporte_f3.rep"]);
  });

  it("2. Maneja campos ausentes en ZERO con tipos nulos explícitos y consistencia de métricas", () => {
    const cloudDoc = buildCloudExportEvaluation(sampleGroup, sampleDriverData, "EXP-1", 1700020000000);

    // Campos que ZERO no registra deben ser null (no undefined ni cadenas vacías inventadas)
    expect(cloudDoc.empresa).toBeNull();
    expect(cloudDoc.sede).toBeNull();
    expect(cloudDoc.ciudad).toBeNull();
    expect(cloudDoc.tipoLicencia).toBeNull();
    expect(cloudDoc.cursoCodigo).toBeNull();
    expect(cloudDoc.habilidadesManejoPct).toBeNull();
    expect(cloudDoc.practicaSimuladorPct).toBeNull();

    // Mapeo exhaustivo de veredictos
    expect(mapZeroVerdictToCloudEstado("APTO")).toBe("Aprobado");
    expect(mapZeroVerdictToCloudEstado("APTO CON OBSERVACIONES")).toBe("Reforzar");
    expect(mapZeroVerdictToCloudEstado("NO APTO")).toBe("No Aprobado");
    expect(mapZeroVerdictToCloudEstado("NO REALIZADO")).toBe("No Aprobado");
    expect(mapZeroVerdictToCloudEstado("INCOMPLETO")).toBe("Pendiente");
    expect(mapZeroVerdictToCloudEstado("SIN CONFIGURAR")).toBe("Pendiente");

    // Cálculo de destreza y eco
    const metrics = calculateDestrezaAndEco([], 0);
    expect(metrics).toEqual({ destrezaPuntos: 0, destrezaMax: 7.0, ecoDrivingPuntos: 0, ecoDrivingMax: 3.0 });
  });

  it("3. Maneja fatalidades y salidas de vía según entorno y severidad", () => {
    const fatalBreakdown: DriverData["breakdown"] = [
      {
        description: "Salirse de la vía",
        rawDescription: "Salirse de la vía",
        count: 1,
        environment: "MONTANA",
        severity: "CRITICO",
        weight: 32,
      },
      {
        description: "Atropello de un peatón",
        rawDescription: "Atropello de un peatón",
        count: 1,
        environment: "CIUDAD",
        severity: "CRITICO",
        weight: 32,
      },
    ];

    const counts = countIncidents(fatalBreakdown, [], 2);
    expect(counts.fatalidades).toBe(2); // Salida de vía en montaña (crítica) + atropello de peatón
    expect(counts.accidentesCriticos).toBe(2);
    expect(counts.vehiculoFueraVia).toBe(0);
  });

  it("4. Genera IDs deterministas e independientes de caracteres especiales", () => {
    const id1 = toCloudEvaluationId("grp_2026/01", "conductor 1 (norte)");
    const id2 = toCloudEvaluationId("grp_2026/01", "conductor 1 (norte)");
    expect(id1).toBe(id2);
    expect(id1).not.toContain("/");
    expect(id1).not.toContain("(");
    expect(id1).not.toContain(" ");

    // Test de generación de exportId amigable
    const friendly1 = toFriendlyExportId({ name: "Almex 2026 Prueba", id: "grp_1793743986790_l1dka" });
    expect(friendly1).toBe("Almex_2026_Prueba_l1dka");

    const friendly2 = toFriendlyExportId({ name: "Grupo Bimbo CDMX #2", id: "grp_12345_abcde" });
    expect(friendly2).toBe("Grupo_Bimbo_CDMX_2_abcde");
  });
});

describe("cloudExport - Flujo de Exportación, Batches e Idempotencia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("5. Rechaza exportar un grupo que no esté cerrado", async () => {
    safeGetDoc.mockResolvedValueOnce({
      exists: () => true,
      id: "grp_open",
      data: () => ({ name: "Grupo Abierto", status: "open", createdAt: 100 }),
    });

    await expect(
      exportClosedGroupToCloud("grp_open", { name: "Admin", email: "admin@corporativomaf.com" })
    ).rejects.toThrow("no está cerrado");
  });

  it("6. Exportación idempotente: escribe metadata 'pending' y finaliza en 'complete'", async () => {
    safeGetDoc.mockResolvedValueOnce({
      exists: () => true,
      id: "grp_closed",
      data: () => ({
        name: "Grupo Cerrado",
        status: "closed",
        createdAt: 100,
        closedAt: 200,
        createdBy: "Staff",
        createdByEmail: "staff@corporativomaf.com",
      }),
    });

    safeGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: "eval_1",
          data: () => ({
            phase: 1,
            driverId: "d1",
            driverName: "Conductor 1",
            fileName: "f1.rep",
            exercise: "Ruta 1",
            score: 9.0,
            errorCount: 0,
            marks: [],
            groupId: "grp_closed",
            frozen: true,
            frozenScore: 9.0,
          }),
        },
      ],
    });

    const res = await exportClosedGroupToCloud("grp_closed", {
      name: "Admin",
      email: "admin@corporativomaf.com",
    });

    expect(res.status).toBe("complete");
    expect(res.exportedCount).toBe(1);

    // Verificamos que se escribió inicialmente con pending
    expect(setDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "pending",
        groupId: "Grupo_Cerrado_closed",
        sourceGroupId: "grp_closed",
      })
    );

    // Verificamos que el batch escribió el documento del conductor
    expect(batchSet).toHaveBeenCalledTimes(1);

    // Verificamos que al finalizar se actualizó a complete
    expect(updateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "complete", exportedCount: 1 })
    );
  });

  it("7. Maneja grupos grandes dividiendo en múltiples batches seguros", async () => {
    safeGetDoc.mockResolvedValueOnce({
      exists: () => true,
      id: "grp_large",
      data: () => ({
        name: "Grupo Grande Flota",
        status: "closed",
        createdAt: 100,
        closedAt: 200,
        createdBy: "Staff",
        createdByEmail: "staff@corporativomaf.com",
      }),
    });

    // Crear 25 conductores
    const mockDocs = Array.from({ length: 25 }, (_, i) => ({
      id: `eval_${i}`,
      data: () => ({
        phase: 1,
        driverId: `driver_${i}`,
        driverName: `Conductor ${i}`,
        fileName: `f_${i}.rep`,
        exercise: "Ruta 1",
        score: 8.0,
        errorCount: 0,
        marks: [],
        groupId: "grp_large",
        frozen: true,
        frozenScore: 8.0,
      }),
    }));

    safeGetDocs.mockResolvedValueOnce({ docs: mockDocs });

    // Ejecutar con chunkSize = 10 para forzar 3 batches (10 + 10 + 5)
    const res = await exportClosedGroupToCloud(
      "grp_large",
      { name: "Admin", email: "admin@corporativomaf.com" },
      10
    );

    expect(res.status).toBe("complete");
    expect(res.exportedCount).toBe(25);
    expect(batchCommit).toHaveBeenCalledTimes(3);
  });

  it("8. Si falla una escritura, marca el export como error y permite reintentar", async () => {
    safeGetDoc.mockResolvedValueOnce({
      exists: () => true,
      id: "grp_fail",
      data: () => ({
        name: "Grupo Con Error",
        status: "closed",
        createdAt: 100,
        closedAt: 200,
        createdBy: "Staff",
        createdByEmail: "staff@corporativomaf.com",
      }),
    });

    safeGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: "eval_fail",
          data: () => ({
            phase: 1,
            driverId: "d_fail",
            driverName: "Conductor Falla",
            fileName: "fail.rep",
            exercise: "Ruta",
            score: 5,
            errorCount: 0,
            marks: [],
            groupId: "grp_fail",
            frozen: true,
          }),
        },
      ],
    });

    batchCommit.mockRejectedValueOnce(new Error("Simulated Firestore write failure"));

    await expect(
      exportClosedGroupToCloud("grp_fail", { name: "Admin", email: "admin@corporativomaf.com" })
    ).rejects.toThrow("Simulated Firestore write failure");

    // Verificar que se registró el error
    expect(updateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "error", errorMessage: "Simulated Firestore write failure" })
    );
  });

  it("9. CLOUD ignora exportaciones incompletas o en error", async () => {
    // 1. Export inexistente
    safeGetDoc.mockResolvedValueOnce({ exists: () => false }); // directSnap
    safeGetDoc.mockResolvedValueOnce({ exists: () => false }); // grpSnap
    const none = await getCloudExportEvaluations("grp_none");
    expect(none).toEqual([]);

    safeGetDoc.mockResolvedValueOnce({ exists: () => false }); // directSnap
    safeGetDoc.mockResolvedValueOnce({ exists: () => false }); // grpSnap
    const noneMeta = await getCloudExport("grp_none");
    expect(noneMeta).toBeNull();

    // 2. Export en estado pending
    safeGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ status: "pending", groupId: "grp_pending" }),
    });
    const pending = await getCloudExportEvaluations("grp_pending");
    expect(pending).toEqual([]);

    // 3. Export en estado error
    safeGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ status: "error", groupId: "grp_error" }),
    });
    const errored = await getCloudExportEvaluations("grp_error");
    expect(errored).toEqual([]);

    // 4. Export complete -> sí retorna documentos
    safeGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ status: "complete", groupId: "grp_ready" }),
    });
    safeGetDocs.mockResolvedValueOnce({
      docs: [
        {
          data: () => ({ id: "eval_grp_ready_d1", conductor: "Conductor 1" }),
        },
      ],
    });
    const complete = await getCloudExportEvaluations("grp_ready");
    expect(complete).toHaveLength(1);
    expect(complete[0].conductor).toBe("Conductor 1");
  });

  it("10. deleteCloudExport elimina el documento maestro y las evaluaciones de la subcolección", async () => {
    // 1. Simular búsqueda de getCloudExport para un grupo con friendly exportId
    safeGetDoc.mockResolvedValueOnce({ exists: () => false }); // directSnap no coincide
    safeGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ name: "Almex Prueba", id: "grp_test", cloudExportId: "Almex_Prueba_grp_test" }),
    }); // grpSnap
    safeGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ status: "complete", groupId: "Almex_Prueba_grp_test" }),
    }); // friendlySnap

    // 2. Simular subcolección con 2 expedientes para eliminar
    safeGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [
        { ref: { path: "cloud_exports/Almex_Prueba_grp_test/evaluations/eval_1" } },
        { ref: { path: "cloud_exports/Almex_Prueba_grp_test/evaluations/eval_2" } },
      ],
    });

    // 3. Fallback para ID crudo vacío
    safeGetDocs.mockResolvedValueOnce({ empty: true, docs: [] });

    await deleteCloudExport("grp_test");

    expect(batchDelete).toHaveBeenCalledTimes(2);
    expect(batchCommit).toHaveBeenCalled();
    expect(deleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: "cloud_exports/Almex_Prueba_grp_test" })
    );
  });
});
