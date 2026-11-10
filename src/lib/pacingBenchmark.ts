import { exerciseKey, isExerciseUnevaluated } from "./exercises";
import { getCatalog, normalize } from "./catalog";
import type { Mark, TelemetryMetrics } from "./parse";

export type BenchmarkEvaluationInput = {
  unit?: string;
  exercise?: string;
  durationSec?: number;
  telemetry?: TelemetryMetrics;
  groupId?: string;
  marks?: Mark[];
  frozen?: boolean;
  frozenMarks?: Mark[];
};

export type ExerciseBenchmark = {
  exerciseKey: string;
  exerciseName: string;
  sampleCount: number;
  avgSpeed: number;        // km/h promedio en el grupo
  avgDistance: number;     // metros promedio en el grupo
  avgDurationSec: number;  // segundos promedio en el grupo
  minSpeedThreshold: number;   // 60% de avgSpeed
  minDistanceThreshold: number; // 60% de avgDistance
  minDurationThreshold: number; // 60% de avgDurationSec (mínimo 60% del tiempo de conducción)
};

export type PacingAnalysis = {
  hasBenchmark: boolean;
  benchmark?: ExerciseBenchmark;
  isPacingDeficit: boolean;
  speedRatio: number;      // 0 a 1 (o más)
  distanceRatio: number;   // 0 a 1 (o más)
  durationRatio: number;   // 0 a 1 (o más)
  deficitRatio: number;    // 0 a 1 (cuánto le faltó para llegar al umbral)
  penaltyDeduction: number; // Puntos restados a la nota (escala 0 a 10)
  reason?: string;
};

/**
 * Calcula el benchmark promedio (velocidad, distancia y duración) de cada ejercicio para un grupo específico.
 * Excluye evaluaciones con marcas activas de exceso de velocidad y solo considera
 * métricas de telemetría/duración válidas (> 0).
 */
export function computeGroupBenchmarks(
  evalDocs: BenchmarkEvaluationInput[]
): Map<string, ExerciseBenchmark> {
  const benchmarks = new Map<string, ExerciseBenchmark>();
  const grouped = new Map<string, { name: string; speeds: number[]; distances: number[]; durations: number[] }>();

  for (const doc of evalDocs) {
    const name = (doc.unit || doc.exercise || "").trim();
    if (!name) continue;
    if (isExerciseUnevaluated(name, doc.groupId)) continue;
    const key = exerciseKey(name);
    if (!key) continue;

    const marks = doc.frozen ? doc.frozenMarks ?? doc.marks : doc.marks;
    const speedingEntry = getCatalog(doc.groupId).entries.find(
      (entry) => normalize(entry.name) === "exceso de velocidad"
    );
    const speedingAliases = new Set((speedingEntry?.aliases ?? []).map(normalize));
    if (marks?.some((mark) => {
      if (mark.type !== "ERROR" || mark.ignored) return false;
      const description = normalize(mark.description);
      return /^exceso de velocidad\b/.test(description) || speedingAliases.has(description);
    })) continue;

    const tel = doc.telemetry;
    const speed = tel?.averageSpeed ?? 0;
    const dist = tel?.distanceMeters ?? 0;
    const duration = doc.durationSec ?? 0;

    // Solo acumular si reportó valores medibles (para evitar sesgar con ejercicios abortados o en blanco)
    if (speed <= 0 && dist <= 0 && duration <= 0) continue;

    const entry = grouped.get(key) || { name, speeds: [], distances: [], durations: [] };
    if (speed > 0) entry.speeds.push(speed);
    if (dist > 0) entry.distances.push(dist);
    if (duration > 0) entry.durations.push(duration);
    grouped.set(key, entry);
  }

  for (const [key, data] of grouped.entries()) {
    const validSpeeds = data.speeds;
    const validDistances = data.distances;
    const validDurations = data.durations;
    const sampleCount = Math.max(validSpeeds.length, validDistances.length, validDurations.length);

    // Mínimo 2 muestras para considerar un benchmark representativo del grupo
    if (sampleCount < 2) continue;

    const avgSpeed =
      validSpeeds.length > 0
        ? validSpeeds.reduce((a, b) => a + b, 0) / validSpeeds.length
        : 0;

    const avgDistance =
      validDistances.length > 0
        ? validDistances.reduce((a, b) => a + b, 0) / validDistances.length
        : 0;

    const avgDuration =
      validDurations.length > 0
        ? validDurations.reduce((a, b) => a + b, 0) / validDurations.length
        : 0;

    benchmarks.set(key, {
      exerciseKey: key,
      exerciseName: data.name,
      sampleCount,
      avgSpeed: Math.round(avgSpeed * 10) / 10,
      avgDistance: Math.round(avgDistance),
      avgDurationSec: Math.round(avgDuration),
      minSpeedThreshold: Math.round(avgSpeed * 0.60 * 10) / 10,
      minDistanceThreshold: Math.round(avgDistance * 0.60),
      // Mínimo 60% de duración respecto a la media del grupo
      minDurationThreshold: Math.round(avgDuration * 0.60),
    });
  }

  return benchmarks;
}

/**
 * Analiza si la evaluación de un conductor cae por debajo de la media del grupo:
 * - Velocidad < 60% de la media
 * - Distancia < 60% de la media
 * - Duración de conducción < 60% de la media (para ejercicios terminados abruptamente o abortados)
 * Si cae por debajo, aplica una penalización progresiva de hasta 4.0 puntos en la escala 0 a 10.
 */
export function analyzePacing(
  exerciseName: string,
  telemetry?: { averageSpeed?: number; distanceMeters?: number },
  benchmarks?: Map<string, ExerciseBenchmark>,
  durationSec?: number
): PacingAnalysis {
  const emptyResult: PacingAnalysis = {
    hasBenchmark: false,
    isPacingDeficit: false,
    speedRatio: 1,
    distanceRatio: 1,
    durationRatio: 1,
    deficitRatio: 0,
    penaltyDeduction: 0,
  };

  if (!benchmarks) return emptyResult;

  const key = exerciseKey(exerciseName);
  const bench = benchmarks.get(key);
  if (!bench || bench.sampleCount < 2) return emptyResult;

  const driverSpeed = telemetry?.averageSpeed ?? 0;
  const driverDist = telemetry?.distanceMeters ?? 0;
  const driverDuration = durationSec ?? 0;

  // Ratios respecto al promedio del grupo
  const speedRatio = bench.avgSpeed > 0 ? driverSpeed / bench.avgSpeed : 1;
  const distanceRatio = bench.avgDistance > 0 ? driverDist / bench.avgDistance : 1;
  const durationRatio = bench.avgDurationSec > 0 && driverDuration > 0 ? driverDuration / bench.avgDurationSec : 1;

  // Umbral estricto: 60% (0.60) para velocidad, distancia y duración
  const isSpeedSlow = bench.avgSpeed > 0 && speedRatio < 0.60;
  const isDistanceShort = bench.avgDistance > 0 && distanceRatio < 0.60;
  const isDurationShort = bench.avgDurationSec > 0 && driverDuration > 0 && durationRatio < 0.60;

  if (!isSpeedSlow && !isDistanceShort && !isDurationShort) {
    return {
      hasBenchmark: true,
      benchmark: bench,
      isPacingDeficit: false,
      speedRatio: Math.round(speedRatio * 100) / 100,
      distanceRatio: Math.round(distanceRatio * 100) / 100,
      durationRatio: Math.round(durationRatio * 100) / 100,
      deficitRatio: 0,
      penaltyDeduction: 0,
    };
  }

  // Déficit relativo respecto al 60% (0.60)
  const speedDeficit = isSpeedSlow ? (0.60 - speedRatio) / 0.60 : 0;
  const distDeficit = isDistanceShort ? (0.60 - distanceRatio) / 0.60 : 0;
  const durationDeficit = isDurationShort ? (0.60 - durationRatio) / 0.60 : 0;

  // Máximo déficit relativo entre las dimensiones afectadas
  const maxDeficitRel = Math.max(0, Math.min(1, Math.max(speedDeficit, distDeficit, durationDeficit)));

  // Penalización progresiva: base de 1.5 puntos por caer del umbral, escalando hasta 4.0 puntos máximos si casi no avanzó/duró
  const maxPenalty = 4.0;
  const basePenalty = 1.5;
  const penaltyDeduction = Math.round((basePenalty + (maxPenalty - basePenalty) * maxDeficitRel) * 10) / 10;

  const reasons: string[] = [];
  if (isDurationShort) {
    const minDurStr = `${Math.floor(bench.minDurationThreshold / 60)}m ${bench.minDurationThreshold % 60}s`;
    const avgDurStr = `${Math.floor(bench.avgDurationSec / 60)}m ${bench.avgDurationSec % 60}s`;
    const driverDurStr = `${Math.floor(driverDuration / 60)}m ${driverDuration % 60}s`;
    reasons.push(
      `Duración (${driverDurStr}) inferior al 60% del grupo (${minDurStr}, prom. ${avgDurStr}, ejercicio posiblemente inconcluso o abortado)`
    );
  }
  if (isSpeedSlow) {
    reasons.push(
      `Velocidad media (${driverSpeed} km/h) inferior al 60% del grupo (${bench.minSpeedThreshold} km/h, prom. ${bench.avgSpeed} km/h)`
    );
  }
  if (isDistanceShort) {
    reasons.push(
      `Distancia recorrida (${Math.round(driverDist)} m) inferior al 60% del grupo (${bench.minDistanceThreshold} m, prom. ${bench.avgDistance} m)`
    );
  }

  return {
    hasBenchmark: true,
    benchmark: bench,
    isPacingDeficit: true,
    speedRatio: Math.round(speedRatio * 100) / 100,
    distanceRatio: Math.round(distanceRatio * 100) / 100,
    durationRatio: Math.round(durationRatio * 100) / 100,
    deficitRatio: Math.round(maxDeficitRel * 100) / 100,
    penaltyDeduction,
    reason: reasons.join(" y "),
  };
}
