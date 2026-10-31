import { collection, doc, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { firestore, getDb, safeGetDoc, safeGetDocs, fastWrite } from "./firebase";
import type { Mark, ParsedReport, TelemetryMetrics } from "./parse";
import { evaluateMarks, normalizeRpmZones } from "./parse";
import { classify } from "./catalog";
import { loadCatalog } from "./catalogStore";
import { CRITICAL_LIMIT, verdictFor } from "./config";
import {
  exerciseKey,
  getExercises,
  getGroupType,
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
  // Verificar también el formato legado sin prefijo de grupo para evitar duplicar registros antiguos del mismo grupo
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
};

// Con CRITICAL_LIMIT o más errores críticos el dictamen es NO APTO; con menos solo pesan en la calificación.
export function dictamen(score: number, criticalErrors: number) {
  return criticalErrors >= CRITICAL_LIMIT ? verdictFor(0) : verdictFor(score);
}

// Asegura coherencia entre la calificación y el dictamen: un NO APTO nunca debe tener calificación verde/aprobatoria (escala 0-10)
export function adjustScoreForCritical(score: number, criticalErrors: number): number {
  if (criticalErrors >= CRITICAL_LIMIT) {
    return Math.min(score, 5.9);
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
  
  // Si la evaluación ya fue congelada, sus métricas son inalterables (normalizando a escala 0-10 si se congeló en escala 0-100)
  if (d.frozen && typeof d.frozenScore === "number") {
    const toScale10 = (val?: number) =>
      val !== undefined ? (val > 10 ? Math.round((val / 10) * 10) / 10 : val) : undefined;
    return {
      ...d,
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

  // Analizar si el conductor circuló a un ritmo evasivo / excesivamente lento respecto al grupo
  let finalScore = ev.score;
  let pacing: PacingAnalysis | undefined;
  if (benchmarks && telemetry) {
    pacing = analyzePacing(exerciseName, telemetry, benchmarks);
    if (pacing.isPacingDeficit && pacing.penaltyDeduction > 0) {
      finalScore = Math.max(0, Math.round((finalScore - pacing.penaltyDeduction) * 10) / 10);
    }
  }

  return {
    ...d,
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
          (e) => !usedDocs.has(e) && exerciseKey(e.exercise) === exerciseKey(expectedName)
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

    const totalScore = counted.reduce((a, e) => a + e.score, 0);
    const rawAvg = expected > 0 ? Math.round((totalScore / expected) * 10) / 10 : 0;
    const criticalErrors = counted.reduce((a, e) => a + e.criticalCount, 0);
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
        errors: counted.reduce((a, e) => a + e.errorCount, 0),
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
      // Emparejar estrictamente por nombre de ejercicio esperado en la configuración de esta fase
      for (const expectedName of expectedList) {
        const candidates = latestAll.filter(
          (e) => !usedDocs.has(e) && exerciseKey(e.exercise) === exerciseKey(expectedName)
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

    const totalScore = counted.reduce((a, e) => a + e.score, 0);
    const rawAvg = expected > 0 ? Math.round((totalScore / expected) * 10) / 10 : 0;
    const criticalErrors = counted.reduce((a, e) => a + e.criticalCount, 0);
    const avgScore = adjustScoreForCritical(rawAvg, criticalErrors);
    const isNotDone = counted.length === 0;
    const isIncomplete = counted.length > 0 && counted.length < expected;
    const v = isNotDone
      ? { label: "NO REALIZADO", color: "bg-slate-100 text-slate-600 border border-slate-300" }
      : isIncomplete
        ? { label: "INCOMPLETO", color: "bg-amber-50 text-amber-700 border border-amber-200" }
        : dictamen(avgScore, criticalErrors);

    return {
      driverId,
      driver: driverName,
      phase,
      exercises: counted.length,
      expected,
      countedEvals: counted,
      missingExercises: unmatchedNames,
      errors: counted.reduce((a, e) => a + e.errorCount, 0),
      criticalErrors,
      totalScore,
      avgScore,
      verdict: v.label,
      color: v.color,
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

  // Si hay un grupo especificado o si las evaluaciones pertenecen a grupos, calcular los benchmarks del grupo
  let groupBenchmarks: Map<string, ExerciseBenchmark> | undefined;
  const targetGroupId = filter?.groupId || (field === "driverId" && rawDocs[0]?.doc?.groupId);
  if (targetGroupId) {
    // Si estamos filtrando por un solo conductor (field === "driverId"), necesitamos las evaluaciones de todo el grupo
    // para poder calcular la media de todos los conductores del grupo.
    let groupRawDocs: EvaluationDoc[] = [];
    if (field === "driverId") {
      const groupQ = query(evaluations(), where("groupId", "==", targetGroupId));
      const groupSnap = await safeGetDocs(groupQ);
      groupRawDocs = groupSnap.docs.map((d) => d.data() as EvaluationDoc);
    } else {
      groupRawDocs = rawDocs
        .map((r) => r.doc)
        .filter((d) => d.groupId === targetGroupId);
    }
    groupBenchmarks = computeGroupBenchmarks(groupRawDocs);
  }

  const docs = rawDocs.map(({ doc, id }) =>
    withCurrentScore(doc, filter?.groupId, id, groupBenchmarks)
  );
  
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
    const totalExercises = pSummaries.reduce((acc, p) => acc + p.exercises, 0);
    const totalExerciseScore = pSummaries.reduce((acc, p) => acc + p.totalScore, 0);

    // El promedio general se calcula sobre el total de ejercicios configurados del grupo (los no realizados valen 0)
    const denominator = Math.max(1, expectedExercises);
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
    });
  }

  return results.sort((a, b) => a.driver.localeCompare(b.driver));
}

export async function driverData(driverId: string, filter?: DateFilter) {
  const rawEvals = (await fetchEvaluations("driverId", driverId, filter)).sort(
    (a, b) => a.phase - b.phase || a.date.localeCompare(b.date) || a.createdAt - b.createdAt,
  );
  if (!rawEvals.length) return null;

  const phases = summarizeDriverPhases(driverId, rawEvals[0].driverName, rawEvals, filter?.groupId);
  const countedFromPhases = phases.flatMap((p) => p.countedEvals ?? []);
  // Usar estrictamente las evaluaciones que pertenecen a los ejercicios configurados en las fases
  const evals = countedFromPhases.sort(
    (a, b) => a.phase - b.phase || a.date.localeCompare(b.date) || a.createdAt - b.createdAt,
  );

  // Agrupar incidencias considerando el entorno del ejercicio donde ocurrieron y las reglas del grupo
  const incidentMap = new Map<string, { description: string; environment: string; groupId?: string; count: number }>();

  for (const e of evals) {
    const env = resolveExerciseEnvironment(e.exercise || e.unit, filter?.groupId || e.groupId);
    for (const m of e.marks) {
      if (m.type !== "ERROR" || m.ignored) continue;
      const key = `${m.description}|${env}`;
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
      const isOffRoad = item.description.toLowerCase().includes("salirse de la via");
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
  const expectedExercises = phases.reduce((a, p) => a + p.expected, 0);
  const completedExercises = phases.reduce((a, p) => a + p.exercises, 0);
  const totalExerciseScore = phases.reduce((a, p) => a + p.totalScore, 0);
  const rawOverall = expectedExercises > 0 ? Math.round((totalExerciseScore / expectedExercises) * 10) / 10 : 0;
  const criticalErrors = phases.reduce((a, p) => a + p.criticalErrors, 0);
  const overall = adjustScoreForCritical(rawOverall, criticalErrors);
  const v =
    expectedExercises === 0
      ? { label: "SIN CONFIGURAR", color: "bg-slate-100 text-slate-600 border border-slate-300" }
      : completedExercises === 0
        ? { label: "NO REALIZADO", color: "bg-slate-100 text-slate-600 border border-slate-300" }
        : dictamen(overall, criticalErrors);

  const isCurso = getGroupType(filter?.groupId || rawEvals[0].groupId) === "curso";

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

  return {
    name: rawEvals[0].driverName,
    evals,
    missingExercises,
    phases,
    breakdown,
    overall,
    completedExercises,
    expectedExercises,
    criticalErrors,
    verdict: v.label,
    color: v.color,
    groupType: isCurso ? ("curso" as const) : ("escuela" as const),
    groupEvals,
  };
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

  const updatedView = withCurrentScore(
    { ...evalView, marks: cleanMarks },
    fallbackGroupId,
    docId
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
