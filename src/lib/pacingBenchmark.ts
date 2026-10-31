import { exerciseKey } from "./exercises";
import type { TelemetryMetrics } from "./parse";

export type BenchmarkEvaluationInput = {
  unit?: string;
  exercise?: string;
  telemetry?: TelemetryMetrics;
};

export type ExerciseBenchmark = {
  exerciseKey: string;
  exerciseName: string;
  sampleCount: number;
  avgSpeed: number;        // km/h promedio en el grupo
  avgDistance: number;     // metros promedio en el grupo
  minSpeedThreshold: number;   // 60% de avgSpeed
  minDistanceThreshold: number; // 60% de avgDistance
};

export type PacingAnalysis = {
  hasBenchmark: boolean;
  benchmark?: ExerciseBenchmark;
  isPacingDeficit: boolean;
  speedRatio: number;      // 0 a 1 (o más)
  distanceRatio: number;   // 0 a 1 (o más)
  deficitRatio: number;    // 0 a 1 (cuánto le faltó para llegar al 60%)
  penaltyDeduction: number; // Puntos restados a la nota (escala 0 a 10)
  reason?: string;
};

/**
 * Calcula el benchmark promedio (velocidad y distancia) de cada ejercicio para un grupo específico.
 * Solo considera evaluaciones que tengan métricas de telemetría válidas (> 0).
 */
export function computeGroupBenchmarks(
  evalDocs: BenchmarkEvaluationInput[]
): Map<string, ExerciseBenchmark> {
  const benchmarks = new Map<string, ExerciseBenchmark>();
  const grouped = new Map<string, { name: string; speeds: number[]; distances: number[] }>();

  for (const doc of evalDocs) {
    const name = (doc.unit || doc.exercise || "").trim();
    if (!name) continue;
    const key = exerciseKey(name);
    if (!key) continue;

    const tel = doc.telemetry;
    const speed = tel?.averageSpeed ?? 0;
    const dist = tel?.distanceMeters ?? 0;

    // Solo acumular si reportó valores medibles (para evitar sesgar con ejercicios abortados o en blanco)
    if (speed <= 0 && dist <= 0) continue;

    const entry = grouped.get(key) || { name, speeds: [], distances: [] };
    if (speed > 0) entry.speeds.push(speed);
    if (dist > 0) entry.distances.push(dist);
    grouped.set(key, entry);
  }

  for (const [key, data] of grouped.entries()) {
    const validSpeeds = data.speeds;
    const validDistances = data.distances;
    const sampleCount = Math.max(validSpeeds.length, validDistances.length);

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

    benchmarks.set(key, {
      exerciseKey: key,
      exerciseName: data.name,
      sampleCount,
      avgSpeed: Math.round(avgSpeed * 10) / 10,
      avgDistance: Math.round(avgDistance),
      minSpeedThreshold: Math.round(avgSpeed * 0.60 * 10) / 10,
      minDistanceThreshold: Math.round(avgDistance * 0.60),
    });
  }

  return benchmarks;
}

/**
 * Analiza si la evaluación de un conductor cae por debajo del 60% de la media del grupo en velocidad o distancia.
 * Si cae por debajo, aplica una penalización progresiva de hasta 4.0 puntos en la escala 0 a 10.
 */
export function analyzePacing(
  exerciseName: string,
  telemetry?: { averageSpeed?: number; distanceMeters?: number },
  benchmarks?: Map<string, ExerciseBenchmark>
): PacingAnalysis {
  const emptyResult: PacingAnalysis = {
    hasBenchmark: false,
    isPacingDeficit: false,
    speedRatio: 1,
    distanceRatio: 1,
    deficitRatio: 0,
    penaltyDeduction: 0,
  };

  if (!benchmarks || !telemetry) return emptyResult;

  const key = exerciseKey(exerciseName);
  const bench = benchmarks.get(key);
  if (!bench || bench.sampleCount < 2) return emptyResult;

  const driverSpeed = telemetry.averageSpeed ?? 0;
  const driverDist = telemetry.distanceMeters ?? 0;

  // Ratios respecto al promedio del grupo
  const speedRatio = bench.avgSpeed > 0 ? driverSpeed / bench.avgSpeed : 1;
  const distanceRatio = bench.avgDistance > 0 ? driverDist / bench.avgDistance : 1;

  // Umbral estricto: 60% (0.60)
  const isSpeedSlow = bench.avgSpeed > 0 && speedRatio < 0.60;
  const isDistanceShort = bench.avgDistance > 0 && distanceRatio < 0.60;

  if (!isSpeedSlow && !isDistanceShort) {
    return {
      hasBenchmark: true,
      benchmark: bench,
      isPacingDeficit: false,
      speedRatio: Math.round(speedRatio * 100) / 100,
      distanceRatio: Math.round(distanceRatio * 100) / 100,
      deficitRatio: 0,
      penaltyDeduction: 0,
    };
  }

  // Cuál fue el factor más bajo
  const minRatio = Math.min(
    bench.avgSpeed > 0 ? speedRatio : 1,
    bench.avgDistance > 0 ? distanceRatio : 1
  );

  // Déficit relativo respecto al 60% (si hizo 0.30, le faltó la mitad del 60%: deficitRel = (0.60 - 0.30) / 0.60 = 0.50)
  const deficitRel = Math.max(0, Math.min(1, (0.60 - minRatio) / 0.60));

  // Penalización progresiva: base de 1.5 puntos por caer del 60%, escalando hasta 4.0 puntos máximos si casi no avanzó
  const maxPenalty = 4.0;
  const basePenalty = 1.5;
  const penaltyDeduction = Math.round((basePenalty + (maxPenalty - basePenalty) * deficitRel) * 10) / 10;

  const reasons: string[] = [];
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
    deficitRatio: Math.round(deficitRel * 100) / 100,
    penaltyDeduction,
    reason: reasons.join(" y "),
  };
}

