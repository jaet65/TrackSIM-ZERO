import { collection, deleteDoc, doc, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { firestore, getDb, safeGetDoc, safeGetDocs, fastWrite } from "./firebase";
import type { Mark, ParsedReport, TelemetryMetrics } from "./parse";
import { evaluateMarks, normalizeRpmZones } from "./parse";
import { classify, isOffRoadError, type Severity } from "./catalog";
import { loadCatalog } from "./catalogStore";
import { CRITICAL_LIMIT, verdictFor } from "./config";
import {
  areExercisesEquivalent,
  exerciseKey,
  getExerciseDescription,
  getExercises,
  getGroupType,
  isExerciseUnevaluated,
  loadExercises,
  phaseForExercise,
  resolveExerciseEnvironment,
} from "./exercises";
import { listGroups } from "./groups";
import {
  computeGroupBenchmarks,
  analyzePacing,
  type ExerciseBenchmark,
  type PacingAnalysis,
} from "./pacingBenchmark";
import { autoAccentDriverName } from "./driverName";

export type EvaluationDoc = {
  phase: number;
  driverId: string;
  driverName: string;
  fileName: string;
  lesson: string;
  unit: string;
  exercise: string;
  vehicle: string;
  instructor: string;
  instructorEmail: string;
  date: string;
  durationSec: number;
  errorCount: number;
  score: number;
  marks: Mark[];
  telemetry?: TelemetryMetrics;
  createdAt: number;
  // Campos de grupos y congelación
  groupId?: string;
  frozen?: boolean;
  frozenAt?: number;
  frozenByEmail?: string;
  frozenScore?: number;
  frozenErrorCount?: number;
  frozenCriticalCount?: number;
  frozenErrorScore?: number;
  frozenTelemetryScore?: number;
  frozenMarks?: Mark[];
};

const evaluations = () => collection(getDb(), "evaluations");

export function driverSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ID determinista (grupo + fase + archivo) para que re-cargar el mismo CSV en el mismo grupo no duplique resultados,
// pero permita cargar sesiones en grupos distintos de forma independiente.
function evaluationId(phase: number, fileName: string, groupId?: string) {
  const cleanFile = fileName.replace(/[^\w.-]+/g, "_");
  if (groupId) {
    return `${groupId}_f${phase}_${cleanFile}`;
  }
  return `f${phase}_${cleanFile}`;
}

export type Instructor = { name: string; email: string };

export async function saveEvaluation(
  phase: number,
  fileName: string,
  r: ParsedReport,
  instructor: Instructor,
  groupId?: string,
): Promise<"saved" | "duplicate"> {
  // 1. Verificación por nombre de archivo / ID
  const legacyRef = doc(evaluations(), evaluationId(phase, fileName));
  const legacySnap = await safeGetDoc(legacyRef, 1500);
  if (legacySnap.exists()) {
    const existingGroup = (legacySnap.data() as EvaluationDoc).groupId || "";
    if (existingGroup === (groupId || "")) {
      return "duplicate";
    }
  }

  const ref = doc(evaluations(), evaluationId(phase, fileName, groupId));
  if (groupId && (await safeGetDoc(ref, 1500)).exists()) return "duplicate";

  // 2. Detección Inteligente de duplicados por contenido:
  // Si ya existe una evaluación del mismo conductor + misma fecha/hora + misma ruta/ejercicio
  try {
    const dSlug = driverSlug(r.driver);
    const exKeyVal = exerciseKey(r.exercise || r.unit);
    const duplicateContentQ = groupId
      ? query(evaluations(), where("groupId", "==", groupId), where("driverId", "==", dSlug), where("date", "==", r.date))
      : query(evaluations(), where("driverId", "==", dSlug), where("date", "==", r.date));
    
    const duplicateSnap = await safeGetDocs(duplicateContentQ);
    const isSameExercise = duplicateSnap.docs.some((d) => {
      const data = d.data() as EvaluationDoc;
      return exerciseKey(data.exercise || data.unit) === exKeyVal;
    });

    if (isSameExercise) {
      return "duplicate";
    }
  } catch (err) {
    console.warn("No se pudo completar la verificación extendida de duplicados:", err);
  }

  const data: EvaluationDoc = {
    phase,
    driverId: driverSlug(r.driver),
    driverName: r.driver,
    fileName,
    lesson: r.lesson,
    unit: r.unit,
    exercise: r.exercise,
    vehicle: r.vehicle,
    instructor: instructor.name,
    instructorEmail: instructor.email,
    date: r.date,
    durationSec: r.durationSec,
    errorCount: r.errorCount,
    score: r.score,
    marks: r.marks,
    createdAt: Date.now(),
  };

  if (groupId) {
    data.groupId = groupId;
  }

  if (r.telemetry && Object.keys(r.telemetry).length > 0) {
    // Limpiar claves con valor undefined para cumplir con las restricciones de Firestore
    const cleanTelemetry: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.telemetry)) {
      if (v !== undefined) {
        cleanTelemetry[k] = v;
      }
    }
    if (Object.keys(cleanTelemetry).length > 0) {
      data.telemetry = cleanTelemetry as TelemetryMetrics;
    }
  }

  await fastWrite(setDoc(ref, data), 2000);
  return "saved";
}

export type PhaseSummary = {
  driverId: string;
  driver: string;
  phase: number;
  exercises: number;
  expected: number;
  countedEvals?: EvaluationView[];
  missingExercises?: string[];
  errors: number;
  criticalErrors: number;
  totalScore: number;
  avgScore: number;
  verdict: string;
  color: string;
  lastDate?: string;
  lastCreatedAt?: number;
};

export type DriverOverallSummary = {
  driverId: string;
  driver: string;
  phasesEvaluated: number;
  expectedPhases: number;
  totalExercises: number;
  expectedExercises: number;
  totalErrors: number;
  criticalErrors: number;
  avgScore: number;
  verdict: string;
  color: string;
  lastDate?: string;
  lastCreatedAt?: number;
};

// Con CRITICAL_LIMIT o más errores críticos el dictamen es NO APTO; con menos solo pesan en la calificación.
export function dictamen(score: number, criticalErrors: number) {
  return criticalErrors >= CRITICAL_LIMIT ? verdictFor(0) : verdictFor(score);
}

// Asegura coherencia entre la calificación y el dictamen: un NO APTO nunca debe tener calificación verde/aprobatoria (escala 0-10)
// Con CRITICAL_LIMIT (2 errores críticos) el techo máximo es 5.9 (reprobatorio).
// Por cada error crítico adicional más allá de 2, el techo baja escalonadamente (-0.5 pts por cada choque/crítico extra: 3->5.4, 4->4.9, 5->4.4, 6->3.9).
// A partir de la 7ª falta crítica (>= 7), la calificación cae automáticamente a 0.0.
// Además, la calificación final modula proporcionalmente sobre ese techo según el resto de la conducción (errores leves/moderados, telemetría y ritmo).
export function adjustScoreForCritical(score: number, criticalErrors: number): number {
  if (criticalErrors >= 7) {
    return 0;
  }
  if (criticalErrors >= CRITICAL_LIMIT) {
    const extraCriticals = criticalErrors - CRITICAL_LIMIT;
    const maxAllowed = Math.max(0, 5.9 - extraCriticals * 0.5);
    // Escalamiento proporcional sobre el techo máximo según el desempeño general del conductor
    const factor = Math.max(0, Math.min(10, score)) / 10;
    const adjusted = maxAllowed * factor;
    return Math.round(adjusted * 10) / 10;
  }
  return score;
}

// Calificación calculada desde las marcas y telemetría, o respetando la congelada si el grupo está cerrado
export type EvaluationView = EvaluationDoc & {
  docId?: string;
  criticalCount: number;
  errorScore: number;
  telemetryScore?: number;
  pacing?: PacingAnalysis;
};

export function withCurrentScore(
  d: EvaluationDoc,
  fallbackGroupId?: string | null,
  docId?: string,
  benchmarks?: Map<string, ExerciseBenchmark>
): EvaluationView {
  const exerciseName = d.unit || d.exercise;
  const effectiveGroupId = d.groupId || fallbackGroupId || undefined;
  const resolvedDocId = docId || evaluationId(d.phase, d.fileName, d.groupId);
  const resolvedDriverName = autoAccentDriverName(d.driverName);
  
  // Si la evaluación ya fue congelada, sus métricas son inalterables (normalizando a escala 0-10 si se congeló en escala 0-100)
  if (d.frozen && typeof d.frozenScore === "number") {
    const toScale10 = (val?: number) =>
      val !== undefined ? (val > 10 ? Math.round((val / 10) * 10) / 10 : val) : undefined;
    return {
      ...d,
      driverName: resolvedDriverName,
      docId: resolvedDocId,
      exercise: exerciseName,
      errorCount: d.frozenErrorCount ?? d.errorCount,
      criticalCount: d.frozenCriticalCount ?? 0,
      errorScore: toScale10(d.frozenErrorScore ?? d.score) ?? 0,
      telemetryScore: toScale10(d.frozenTelemetryScore),
      score: toScale10(d.frozenScore) ?? 0,
      marks: d.frozenMarks ?? d.marks,
    };
  }

  // Si la telemetría no traía hasSlipperyRoad (ej. guardada antes), detectarlo dinámicamente de d.marks
  let telemetry = d.telemetry;
  if (telemetry) {
    let hasSlipperyRoad = telemetry.hasSlipperyRoad ?? false;
    let slipperyCondition = telemetry.slipperyCondition;
    if (!hasSlipperyRoad && d.marks) {
      for (const m of d.marks) {
        const lower = (m.description || "").toLowerCase();
        if (
          lower.includes("lluvia") ||
          lower.includes("nieve") ||
          lower.includes("hielo") ||
          lower.includes("mojad") ||
          lower.includes("deslizante")
        ) {
          hasSlipperyRoad = true;
          if (!slipperyCondition) {
            slipperyCondition = lower.includes("nieve") ? "Nieve" : lower.includes("hielo") ? "Hielo" : "Lluvia / Pavimento mojado";
          }
          break;
        }
      }
    }
    telemetry = normalizeRpmZones({ ...telemetry, hasSlipperyRoad, slipperyCondition });
  }

  const ev = evaluateMarks(d.marks, d.durationSec, telemetry, exerciseName, effectiveGroupId);
  const resolvedPhase = phaseForExercise(exerciseName, effectiveGroupId) ?? d.phase;

  // Analizar si el conductor circuló a un ritmo evasivo / excesivamente lento o duró mucho menos respecto al grupo
  let finalScore = ev.score;
  let pacing: PacingAnalysis | undefined;
  if (benchmarks) {
    pacing = analyzePacing(exerciseName, telemetry, benchmarks, d.durationSec);
    if (pacing.isPacingDeficit && pacing.penaltyDeduction > 0) {
      finalScore = Math.max(0, Math.round((finalScore - pacing.penaltyDeduction) * 10) / 10);
    }
  }

  return {
    ...d,
    driverName: resolvedDriverName,
    docId: resolvedDocId,
    phase: resolvedPhase,
    telemetry,
    exercise: exerciseName,
    errorCount: ev.errorCount,
    criticalCount: ev.criticalCount,
    errorScore: ev.errorScore,
    telemetryScore: ev.telemetryScore,
    score: finalScore,
    pacing,
  };
}

function summarizeDriverPhases(
  driverId: string,
  driverName: string,
  docs: EvaluationView[],
  fallbackGroupId?: string | null,
  onlyPhase?: number
): PhaseSummary[] {
  const grpId = fallbackGroupId || docs[0]?.groupId;
  const isCurso = getGroupType(grpId) === "curso";
  const exercisesMap = getExercises(grpId);

  // En modalidad "curso", agrupamos todos los ejercicios en un único bloque sin fases (id 0)
  if (isCurso) {
    const expectedList = Object.values(exercisesMap).flat();
    const latestAll = [...docs].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    const usedDocs = new Set<EvaluationView>();
    let counted: EvaluationView[] = [];
    let expected = latestAll.length;
    const unmatchedNames: string[] = [];

    if (expectedList.length > 0) {
      expected = expectedList.length;
      for (const expectedName of expectedList) {
        const candidates = latestAll.filter(
          (e) => !usedDocs.has(e) && (exerciseKey(e.exercise) === exerciseKey(expectedName) || areExercisesEquivalent(e.exercise, expectedName))
        );
        const match = candidates.pop();
        if (match) {
          usedDocs.add(match);
          counted.push({ ...match, phase: 0 });
        } else {
          unmatchedNames.push(expectedName);
        }
      }
    } else {
      const uniqueByKey = new Map<string, EvaluationView>();
      for (const e of latestAll) {
        uniqueByKey.set(exerciseKey(e.exercise), e);
      }
      counted = [...uniqueByKey.values()];
      expected = Math.max(1, counted.length);
    }

    const evaluatedCounted = counted.filter(
      (e) => !isExerciseUnevaluated(e.exercise || e.unit, grpId)
    );
    const evaluatedExpected = expectedList.length > 0
      ? expectedList.filter((name) => !isExerciseUnevaluated(name, grpId)).length
      : evaluatedCounted.length;

    const totalScore = evaluatedCounted.reduce((a, e) => a + e.score, 0);
    const rawAvg = evaluatedExpected > 0 ? Math.round((totalScore / evaluatedExpected) * 10) / 10 : 0;
    const criticalErrors = evaluatedCounted.reduce((a, e) => a + e.criticalCount, 0);
    const avgScore = adjustScoreForCritical(rawAvg, criticalErrors);
    const isNotDone = counted.length === 0;
    const isIncomplete = counted.length > 0 && counted.length < expected;
    const v = isNotDone
      ? { label: "NO REALIZADO", color: "bg-slate-100 text-slate-600 border border-slate-300" }
      : isIncomplete
        ? { label: "INCOMPLETO", color: "bg-amber-50 text-amber-700 border border-amber-200" }
        : dictamen(avgScore, criticalErrors);

    return [
      {
        driverId,
        driver: driverName,
        phase: 0,
        exercises: counted.length,
        expected,
        countedEvals: counted,
        missingExercises: unmatchedNames,
        errors: evaluatedCounted.reduce((a, e) => a + e.errorCount, 0),
        criticalErrors,
        totalScore,
        avgScore,
        verdict: v.label,
        color: v.color,
      },
    ];
  }

  const configuredPhases = Object.entries(exercisesMap)
    .filter(([, list]) => Array.isArray(list) && list.length > 0)
    .map(([p]) => Number(p))
    .sort((a, b) => a - b);

  const phasesToEvaluate: number[] =
    onlyPhase !== undefined ? [onlyPhase] : configuredPhases;

  const latestAll = [...docs].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const usedDocs = new Set<EvaluationView>();

  return phasesToEvaluate.map((phase) => {
    const expectedList = exercisesMap[String(phase)] ?? [];
    const phaseDocs = latestAll.filter((e) => e.phase === phase);

    let counted: EvaluationView[] = [];
    let expected = phaseDocs.length;
    const unmatchedNames: string[] = [];

    if (expectedList.length > 0) {
      expected = expectedList.length;
      // Emparejar estrictamente por nombre de ejercicio esperado en la configuración de esta fase (o equivalente sin vehículo)
      for (const expectedName of expectedList) {
        const candidates = latestAll.filter(
          (e) => !usedDocs.has(e) && (exerciseKey(e.exercise) === exerciseKey(expectedName) || areExercisesEquivalent(e.exercise, expectedName))
        );
        const match = candidates.filter((e) => e.phase === phase).pop() ?? candidates.pop();
        if (match) {
          usedDocs.add(match);
          counted.push({ ...match, phase });
        } else {
          unmatchedNames.push(expectedName);
        }
      }
    } else {
      // Sin catálogo configurado para esta fase: agrupar por ejercicio único realizado
      const uniqueByKey = new Map<string, EvaluationView>();
      for (const e of phaseDocs) {
        uniqueByKey.set(exerciseKey(e.exercise), e);
      }
      counted = [...uniqueByKey.values()];
      expected = Math.max(1, counted.length);
    }

    const evaluatedCounted = counted.filter(
      (e) => !isExerciseUnevaluated(e.exercise || e.unit, grpId)
    );
    const evaluatedExpected = expectedList.length > 0
      ? expectedList.filter((name) => !isExerciseUnevaluated(name, grpId)).length
      : evaluatedCounted.length;

    const totalScore = evaluatedCounted.reduce((a, e) => a + e.score, 0);
    const rawAvg = evaluatedExpected > 0 ? Math.round((totalScore / evaluatedExpected) * 10) / 10 : 0;
    const criticalErrors = evaluatedCounted.reduce((a, e) => a + e.criticalCount, 0);
    const avgScore = adjustScoreForCritical(rawAvg, criticalErrors);
    const isNotDone = counted.length === 0;
    const isIncomplete = counted.length > 0 && counted.length < expected;
    const v = isNotDone
      ? { label: "NO REALIZADO", color: "bg-slate-100 text-slate-600 border border-slate-300" }
      : isIncomplete
        ? { label: "INCOMPLETO", color: "bg-amber-50 text-amber-700 border border-amber-200" }
        : dictamen(avgScore, criticalErrors);

    // Determinar la fecha y timestamp de la última conducción de esta fase
    const phaseEvalsWithDate = [...counted].sort(
      (a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0)
    );
    const lastDate = phaseEvalsWithDate[0]?.date || undefined;
    const lastCreatedAt = phaseEvalsWithDate[0]?.createdAt || undefined;

    return {
      driverId,
      driver: driverName,
      phase,
      exercises: counted.length,
      expected,
      countedEvals: counted,
      missingExercises: unmatchedNames,
      errors: evaluatedCounted.reduce((a, e) => a + e.errorCount, 0),
      criticalErrors,
      totalScore,
      avgScore,
      verdict: v.label,
      color: v.color,
      lastDate,
      lastCreatedAt,
    };
  });
}

function summarize(docs: EvaluationView[], fallbackGroupId?: string | null, onlyPhase?: number): PhaseSummary[] {
  const byDriver = new Map<string, EvaluationView[]>();
  for (const e of docs) {
    byDriver.set(e.driverId, [...(byDriver.get(e.driverId) ?? []), e]);
  }
  const out: PhaseSummary[] = [];
  for (const [driverId, driverDocs] of byDriver.entries()) {
    const summaries = summarizeDriverPhases(
      driverId,
      driverDocs[0].driverName,
      driverDocs,
      fallbackGroupId,
      onlyPhase
    );
    out.push(...summaries);
  }
  return out.sort((a, b) => a.driver.localeCompare(b.driver) || a.phase - b.phase);
}

export type DateFilter = {
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  groupId?: string | null;
};

function matchesDateRange(dateStr: string, filter?: DateFilter): boolean {
  if (!filter || (!filter.startDate && !filter.endDate)) return true;
  const itemDate = dateStr.slice(0, 10);
  if (filter.startDate && itemDate < filter.startDate) return false;
  if (filter.endDate && itemDate > filter.endDate) return false;
  return true;
}

async function fetchEvaluations(field?: "phase" | "driverId", value?: number | string, filter?: DateFilter) {
  await Promise.all([
    loadCatalog(true, filter?.groupId),
    loadExercises(true, filter?.groupId),
    listGroups(),
  ]);
  const q = field !== undefined && value !== undefined
    ? query(evaluations(), where(field, "==", value))
    : query(evaluations());

  const snap = await safeGetDocs(q);
  const rawDocs = snap.docs.map((d) => ({
    doc: d.data() as EvaluationDoc,
    id: d.id,
  }));

  // Calcular benchmarks por grupo para aplicar penalizaciones de ritmo de forma consistente
  const benchmarksByGroup = new Map<string, Map<string, ExerciseBenchmark>>();

  if (field === "driverId") {
    // Si estamos consultando un conductor individual, cargamos las evaluaciones de su grupo
    // para obtener el benchmark completo del grupo al que pertenece.
    const targetGroupId = filter?.groupId || rawDocs[0]?.doc?.groupId;
    if (targetGroupId) {
      const groupQ = query(evaluations(), where("groupId", "==", targetGroupId));
      const groupSnap = await safeGetDocs(groupQ);
      const groupRawDocs = groupSnap.docs.map((d) => d.data() as EvaluationDoc);
      benchmarksByGroup.set(targetGroupId, computeGroupBenchmarks(groupRawDocs));
    }
  } else {
    // En consultas globales o de fase, agrupamos todas las evaluaciones leídas por groupId
    // y calculamos los benchmarks específicos de cada grupo presente.
    const docsByGroup = new Map<string, EvaluationDoc[]>();
    for (const { doc } of rawDocs) {
      const gId = doc.groupId || filter?.groupId;
      if (!gId) continue;
      const list = docsByGroup.get(gId) || [];
      list.push(doc);
      docsByGroup.set(gId, list);
    }
    for (const [gId, gDocs] of docsByGroup.entries()) {
      benchmarksByGroup.set(gId, computeGroupBenchmarks(gDocs));
    }
  }

  const docs = rawDocs.map(({ doc, id }) => {
    const effectiveGId = doc.groupId || filter?.groupId;
    const groupBenchmarks = effectiveGId ? benchmarksByGroup.get(effectiveGId) : undefined;
    return withCurrentScore(doc, filter?.groupId, id, groupBenchmarks);
  });
  
  return docs.filter((d) => {
    if (!matchesDateRange(d.date, filter)) return false;
    // Si se especifica un filtro de grupo:
    if (filter?.groupId) {
      if (d.groupId !== filter.groupId) return false;
    }
    return true;
  });
}

export async function phaseSummaries(phase: number, dateFilter?: DateFilter) {
  // Si hay un grupo filtrado y esta fase tiene ejercicios esperados, evaluar a todos los conductores del grupo en esta fase
  const allDocs = await fetchEvaluations(undefined, undefined, dateFilter);
  const grpExercises = getExercises(dateFilter?.groupId)[String(phase)] ?? [];
  if (dateFilter?.groupId && grpExercises.length > 0) {
    return summarize(allDocs, dateFilter.groupId, phase);
  }
  const phaseDocs = allDocs.filter((d) => d.phase === phase);
  return summarize(phaseDocs, dateFilter?.groupId, phase);
}

// Devuelve los IDs de fases que tienen ejercicios configurados en el grupo
export async function getPhasesWithEvaluations(dateFilter?: DateFilter): Promise<number[]> {
  await fetchEvaluations(undefined, undefined, dateFilter);
  // Si el grupo es de tipo "curso", no maneja fases
  if (dateFilter?.groupId && getGroupType(dateFilter.groupId) === "curso") {
    return [];
  }

  const exercisesMap = getExercises(dateFilter?.groupId);
  const configuredPhases = Object.entries(exercisesMap)
    .filter(([, list]) => Array.isArray(list) && list.length > 0)
    .map(([p]) => Number(p))
    .sort((a, b) => a - b);

  return configuredPhases;
}

// Devuelve los nombres únicos de ejercicios detectados en las evaluaciones subidas (del grupo o globales)
export async function listUploadedExerciseNames(groupId?: string | null): Promise<string[]> {
  const snap = await safeGetDocs(query(evaluations()));
  const byKey = new Map<string, string>();
  // Priorizar los del grupo seleccionado y luego incluir el resto
  const allDocs = snap.docs.map((d) => d.data() as EvaluationDoc);
  const sortedDocs = groupId
    ? [...allDocs.filter((d) => d.groupId === groupId), ...allDocs.filter((d) => d.groupId !== groupId)]
    : allDocs;
  for (const d of sortedDocs) {
    const name = (d.unit || d.exercise || "").trim();
    if (!name) continue;
    const key = exerciseKey(name);
    if (key && !byKey.has(key)) {
      byKey.set(key, name);
    }
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

export type ReportExerciseSummary = {
  phase: number;
  name: string;
  description?: string;
  drivers: number;
  avgScore: number;
  isUnevaluated?: boolean;
};

export async function listReportExercises(
  dateFilter?: DateFilter,
  onlyPhase?: number
): Promise<ReportExerciseSummary[]> {
  const docs = await fetchEvaluations(undefined, undefined, dateFilter);
  const exerciseMap = new Map<
    string,
    ReportExerciseSummary & { driverIds: Set<string>; scoreTotal: number; evaluationCount: number }
  >();

  for (const evaluation of docs) {
    const evaluationGroupId = evaluation.groupId || dateFilter?.groupId;
    const phase = evaluationGroupId && getGroupType(evaluationGroupId) === "curso"
      ? 0
      : evaluation.phase;
    if (onlyPhase !== undefined && phase !== onlyPhase) continue;
    const name = (evaluation.unit || evaluation.exercise || "").trim();
    if (!name) continue;

    const key = `${phase}:${exerciseKey(name)}`;
    const uneval = isExerciseUnevaluated(name, evaluationGroupId);
    let exercise = exerciseMap.get(key);
    if (!exercise) {
      exercise = {
        phase,
        name,
        description: getExerciseDescription(name, evaluationGroupId),
        drivers: 0,
        driverIds: new Set<string>(),
        avgScore: 0,
        scoreTotal: 0,
        evaluationCount: 0,
        isUnevaluated: uneval,
      };
      exerciseMap.set(key, exercise);
    }
    exercise.driverIds.add(evaluation.driverId);
    if (!uneval) {
      exercise.scoreTotal += evaluation.score;
      exercise.evaluationCount++;
    }
  }

  return [...exerciseMap.values()]
    .map(({ driverIds, scoreTotal, evaluationCount, ...exercise }) => ({
      ...exercise,
      drivers: driverIds.size,
      avgScore: evaluationCount > 0 ? Math.round((scoreTotal / evaluationCount) * 10) / 10 : 0,
    }))
    .sort((a, b) => a.phase - b.phase || a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

// Resumen del Promedio General agrupando todos los conductores en todas las fases con filtros
export async function overallSummaries(dateFilter?: DateFilter): Promise<DriverOverallSummary[]> {
  const allDocs = await fetchEvaluations(undefined, undefined, dateFilter);
  const driverMap = new Map<string, EvaluationView[]>();
  for (const doc of allDocs) {
    const list = driverMap.get(doc.driverId) || [];
    list.push(doc);
    driverMap.set(doc.driverId, list);
  }

  const results: DriverOverallSummary[] = [];

  for (const [driverId, docs] of driverMap.entries()) {
    const pSummaries = summarizeDriverPhases(driverId, docs[0].driverName, docs, dateFilter?.groupId);
    if (!pSummaries.length) {
      results.push({
        driverId,
        driver: docs[0].driverName,
        phasesEvaluated: 0,
        expectedPhases: 0,
        totalExercises: 0,
        expectedExercises: 0,
        totalErrors: 0,
        criticalErrors: 0,
        avgScore: 0,
        verdict: "SIN CONFIGURAR",
        color: "bg-slate-100 text-slate-600 border border-slate-300",
      });
      continue;
    }

    const expectedExercises = pSummaries.reduce((acc, p) => acc + p.expected, 0);
    const evaluatedExpectedExercises = pSummaries.reduce((acc, p) => {
      const exMap = getExercises(dateFilter?.groupId || docs[0]?.groupId);
      const pList = p.phase === 0 ? Object.values(exMap).flat() : exMap[String(p.phase)] ?? [];
      if (pList.length > 0) {
        return acc + pList.filter((name) => !isExerciseUnevaluated(name, dateFilter?.groupId || docs[0]?.groupId)).length;
      }
      const evalCount = (p.countedEvals ?? []).filter((e) => !isExerciseUnevaluated(e.exercise || e.unit, dateFilter?.groupId || docs[0]?.groupId)).length;
      return acc + evalCount;
    }, 0);
    const totalExercises = pSummaries.reduce((acc, p) => acc + p.exercises, 0);
    const totalExerciseScore = pSummaries.reduce((acc, p) => acc + p.totalScore, 0);

    // El promedio general se calcula sobre el total de ejercicios configurados evaluables del grupo (los no realizados valen 0)
    const denominator = Math.max(1, evaluatedExpectedExercises);
    const rawAvg = Math.round((totalExerciseScore / denominator) * 10) / 10;
    const criticalErrors = pSummaries.reduce((acc, p) => acc + p.criticalErrors, 0);
    const avgScore = adjustScoreForCritical(rawAvg, criticalErrors);
    const totalErrors = pSummaries.reduce((acc, p) => acc + p.errors, 0);
    const phasesEvaluated = pSummaries.filter((p) => p.exercises > 0).length;
    const expectedPhases = pSummaries.length;
    const v =
      totalExercises === 0
        ? { label: "NO REALIZADO", color: "bg-slate-100 text-slate-600 border border-slate-300" }
        : dictamen(avgScore, criticalErrors);

    // Determinar la fecha y timestamp de la última conducción registrada del conductor
    const sortedDocs = [...docs].sort(
      (a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0)
    );
    const lastDate = sortedDocs[0]?.date || undefined;
    const lastCreatedAt = sortedDocs[0]?.createdAt || undefined;

    results.push({
      driverId,
      driver: docs[0].driverName,
      phasesEvaluated,
      expectedPhases,
      totalExercises,
      expectedExercises,
      totalErrors,
      criticalErrors,
      avgScore,
      verdict: v.label,
      color: v.color,
      lastDate,
      lastCreatedAt,
    });
  }

  return results.sort((a, b) => a.driver.localeCompare(b.driver));
}

export type DriverData = {
  name: string;
  evals: EvaluationView[];
  missingExercises: { phase: number; exercise: string }[];
  phases: PhaseSummary[];
  breakdown: {
    description: string;
    rawDescription: string;
    count: number;
    environment: string;
    severity: Severity;
    weight: number;
  }[];
  overall: number;
  rawOverall: number;
  completedExercises: number;
  expectedExercises: number;
  criticalErrors: number;
  verdict: string;
  color: string;
  groupType: "curso" | "escuela";
  groupEvals: EvaluationView[];
};

export function buildDriverDataFromEvals(
  driverId: string,
  rawEvals: EvaluationView[],
  filter?: DateFilter,
  groupEvals: EvaluationView[] = []
): DriverData | null {
  if (!rawEvals.length) return null;

  const phases = summarizeDriverPhases(driverId, rawEvals[0].driverName, rawEvals, filter?.groupId);
  const countedFromPhases = phases.flatMap((p) => p.countedEvals ?? []);
  // Usar estrictamente las evaluaciones que pertenecen a los ejercicios configurados en las fases
  const evals = countedFromPhases.sort(
    (a, b) => a.phase - b.phase || a.date.localeCompare(b.date) || a.createdAt - b.createdAt,
  );

  // Agrupar incidencias considerando el entorno del ejercicio solo cuando afecta la severidad y el texto visible (ej. salirse de la vía en montaña vs carretera)
  const incidentMap = new Map<string, { description: string; environment: string; groupId?: string; count: number }>();

  const grpId = filter?.groupId || rawEvals[0]?.groupId;
  for (const e of evals) {
    if (isExerciseUnevaluated(e.exercise || e.unit, grpId || e.groupId)) continue;
    const env = resolveExerciseEnvironment(e.exercise || e.unit, filter?.groupId || e.groupId);
    for (const m of e.marks) {
      if (m.type !== "ERROR" || m.ignored) continue;
      const isOffRoad = isOffRoadError(m.description);
      // Solo diferenciamos el key por entorno si es salida de vía (ya que en montaña cambia a riesgo de precipicio y severidad crítica).
      // Para todos los demás errores (como colisiones), se agrupan juntos sin importar el ejercicio.
      const key = isOffRoad ? `${m.description}|${env}` : m.description;
      const existing = incidentMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        incidentMap.set(key, { description: m.description, environment: env, groupId: e.groupId, count: 1 });
      }
    }
  }

  const breakdown = [...incidentMap.values()]
    .map((item) => {
      const cls = classify(item.description, item.environment, filter?.groupId || item.groupId);
      const isOffRoad = isOffRoadError(item.description);
      // Si es salida de vía, aclarar en el texto del desglose el contexto de peligro
      const displayDescription = isOffRoad
        ? item.environment === "MONTANA"
          ? `${item.description} (en montaña / riesgo de precipicio)`
          : `${item.description} (en carretera / ciudad)`
        : item.description;

      return {
        description: displayDescription,
        rawDescription: item.description,
        count: item.count,
        environment: item.environment,
        ...cls,
      };
    })
    .sort((a, b) => b.weight * b.count - a.weight * a.count || b.count - a.count)
    .slice(0, 20);

  const missingExercises: { phase: number; exercise: string }[] = [];
  for (const p of phases) {
    if (p.missingExercises) {
      for (const ex of p.missingExercises) {
        missingExercises.push({ phase: p.phase, exercise: ex });
      }
    }
  }
  const evaluatedPhasesExpected = phases.reduce((a, p) => {
    // Tomar en cuenta la configuración de ejercicios no evaluados
    const exMap = getExercises(filter?.groupId || rawEvals[0]?.groupId);
    const pList = p.phase === 0 ? Object.values(exMap).flat() : exMap[String(p.phase)] ?? [];
    if (pList.length > 0) {
      return a + pList.filter((name) => !isExerciseUnevaluated(name, filter?.groupId || rawEvals[0]?.groupId)).length;
    }
    const evalCount = (p.countedEvals ?? []).filter((e) => !isExerciseUnevaluated(e.exercise || e.unit, filter?.groupId || rawEvals[0]?.groupId)).length;
    return a + evalCount;
  }, 0);
  const totalExercises = phases.reduce((a, p) => a + p.exercises, 0);
  const expectedExercises = phases.reduce((a, p) => a + p.expected, 0);
  const completedExercises = totalExercises;
  const totalExerciseScore = phases.reduce((a, p) => a + p.totalScore, 0);
  const rawOverall = evaluatedPhasesExpected > 0 ? Math.round((totalExerciseScore / evaluatedPhasesExpected) * 10) / 10 : 0;
  const criticalErrors = phases.reduce((a, p) => a + p.criticalErrors, 0);
  const overall = adjustScoreForCritical(rawOverall, criticalErrors);
  const v =
    expectedExercises === 0
      ? { label: "SIN CONFIGURAR", color: "bg-slate-100 text-slate-600 border border-slate-300" }
      : completedExercises === 0
        ? { label: "NO REALIZADO", color: "bg-slate-100 text-slate-600 border border-slate-300" }
        : dictamen(overall, criticalErrors);

  const isCurso = getGroupType(filter?.groupId || rawEvals[0].groupId) === "curso";

  return {
    name: rawEvals[0].driverName,
    evals,
    missingExercises,
    phases,
    breakdown,
    overall,
    rawOverall,
    completedExercises,
    expectedExercises,
    criticalErrors,
    verdict: v.label,
    color: v.color,
    groupType: isCurso ? ("curso" as const) : ("escuela" as const),
    groupEvals,
  };
}

export async function driverData(driverId: string, filter?: DateFilter): Promise<DriverData | null> {
  const rawEvals = (await fetchEvaluations("driverId", driverId, filter)).sort(
    (a, b) => a.phase - b.phase || a.date.localeCompare(b.date) || a.createdAt - b.createdAt,
  );
  if (!rawEvals.length) return null;

  // Obtener telemetrías del resto del grupo para benchmark comparativo si existe un grupo
  let groupEvals: EvaluationView[] = [];
  const targetGroupId = filter?.groupId || rawEvals[0]?.groupId;
  try {
    const allGroupDocs = await fetchEvaluations(undefined, undefined, targetGroupId ? { groupId: targetGroupId } : undefined);
    if (targetGroupId) {
      groupEvals = allGroupDocs.filter((d) => d.groupId === targetGroupId);
    } else {
      // Si no hay grupo asignado o filtrado, comparar contra todas las evaluaciones disponibles (flota global)
      groupEvals = allGroupDocs;
    }
  } catch (e) {
    console.warn("No se pudieron cargar evaluaciones del grupo para benchmark:", e);
  }

  return buildDriverDataFromEvals(driverId, rawEvals, filter, groupEvals);
}

export type CertificateRecipient = {
  driverId: string;
  name: string;
  score: number;
  lastEvaluationDate: string | null;
};

export async function getLatestEvaluationYear(): Promise<string> {
  const snap = await safeGetDocs(query(evaluations()));
  const dates = snap.docs.map((d) => (d.data() as EvaluationDoc).date?.slice(0, 10))
    .filter((date): date is string => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  const latestDate = dates.at(-1);
  if (!latestDate) throw new Error("No se pudo determinar el año: no hay fechas de evaluación disponibles.");
  return latestDate.slice(0, 4);
}

export async function listCertificateRecipients(groupId: string): Promise<CertificateRecipient[]> {
  if (!groupId) throw new Error("Selecciona un grupo para emitir documentos.");
  const evaluations = await fetchEvaluations(undefined, undefined, { groupId });
  return buildCertificateRecipients(groupId, evaluations);
}

export function buildCertificateRecipients(groupId: string, evaluations: EvaluationView[]): CertificateRecipient[] {
  const byDriver = new Map<string, EvaluationView[]>();
  for (const evaluation of evaluations) {
    if (evaluation.groupId !== groupId) continue;
    const items = byDriver.get(evaluation.driverId) ?? [];
    items.push(evaluation);
    byDriver.set(evaluation.driverId, items);
  }
  return [...byDriver.entries()].map(([driverId, items]) => {
    const data = buildDriverDataFromEvals(driverId, items, { groupId });
    if (!data) throw new Error(`No se pudo calcular la calificación de ${driverId}.`);
    const dates = items.map((item) => item.date.slice(0, 10))
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
    return { driverId, name: data.name, score: data.overall, lastEvaluationDate: dates.at(-1) ?? null };
  }).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/**
 * Actualiza las marcas de una evaluación (ej. al anular falsos positivos o agregar errores manuales)
 * y recalcula su calificación y conteo de errores en Firestore.
 */
export async function updateEvaluationMarks(
  evalView: EvaluationView,
  newMarks: Mark[],
  fallbackGroupId?: string | null
): Promise<EvaluationView> {
  if (evalView.frozen) {
    throw new Error("Esta evaluación pertenece a un grupo cerrado y congelado, por lo que no puede modificarse.");
  }

  const docId = evalView.docId || evaluationId(evalView.phase, evalView.fileName, evalView.groupId);
  const ref = doc(evaluations(), docId);

  // Limpiar claves undefined de cada marca para cumplir con Firestore
  const cleanMarks: Mark[] = newMarks.map((m) => {
    const clean: Mark = {
      time: m.time,
      type: m.type,
      description: m.description,
    };
    if (m.ignored !== undefined) clean.ignored = m.ignored;
    if (m.ignoredBy !== undefined) clean.ignoredBy = m.ignoredBy;
    if (m.ignoredAt !== undefined) clean.ignoredAt = m.ignoredAt;
    if (m.manual !== undefined) clean.manual = m.manual;
    if (m.addedBy !== undefined) clean.addedBy = m.addedBy;
    if (m.addedAt !== undefined) clean.addedAt = m.addedAt;
    return clean;
  });

  const effectiveGroupId = evalView.groupId || fallbackGroupId;
  let groupBenchmarks: Map<string, ExerciseBenchmark> | undefined;
  if (effectiveGroupId) {
    try {
      const groupQ = query(evaluations(), where("groupId", "==", effectiveGroupId));
      const groupSnap = await safeGetDocs(groupQ);
      if (!groupSnap.empty) {
        const groupRawDocs = groupSnap.docs.map((d) => d.data() as EvaluationDoc);
        groupBenchmarks = computeGroupBenchmarks(groupRawDocs);
      }
    } catch {}
  }

  const updatedView = withCurrentScore(
    { ...evalView, marks: cleanMarks },
    fallbackGroupId,
    docId,
    groupBenchmarks
  );

  await fastWrite(
    updateDoc(ref, {
      marks: cleanMarks,
      errorCount: updatedView.errorCount,
      score: updatedView.score,
    }),
    2000
  );

  return updatedView;
}

// Elimina una evaluación específica por su ID de documento o por sus parámetros clave (fase, archivo, grupo).
export async function deleteEvaluation(docIdOrParams: string | { phase: number; fileName: string; groupId?: string }): Promise<void> {
  const docId = typeof docIdOrParams === "string" 
    ? docIdOrParams 
    : evaluationId(docIdOrParams.phase, docIdOrParams.fileName, docIdOrParams.groupId);
  const ref = doc(evaluations(), docId);
  await fastWrite(deleteDoc(ref), 2000);
}

// Elimina todas las evaluaciones en lotes de hasta 400 documentos por batch.
export async function deleteAllEvaluations(): Promise<number> {
  const snap = await safeGetDocs(evaluations());
  if (snap.empty) return 0;

  let totalDeleted = 0;
  const docs = snap.docs;
  const chunkSize = 400;

  for (let i = 0; i < docs.length; i += chunkSize) {
    const chunk = docs.slice(i, i + chunkSize);
    const batch = writeBatch(firestore);
    for (const d of chunk) {
      batch.delete(d.ref);
    }
    await fastWrite(batch.commit());
    totalDeleted += chunk.length;
  }

  return totalDeleted;
}
