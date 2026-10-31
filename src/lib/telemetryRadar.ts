import type { TelemetryMetrics } from "./parse";
import { resolveExerciseEnvironment } from "./exercises";

export type RadarAxis = {
  label: string;
  value: number; // 0 to 100
  raw: string;
};

export type PhaseRadarSummary = {
  axes: RadarAxis[];
  ecoScore: number;
  environment: string;
  hasSlipperyRoad: boolean;
};

/**
 * Calcula los 5 ejes de telemetría multidimensional para una evaluación o conjunto de evaluaciones.
 */
export function computeTelemetryAxes(
  telemetryList: (TelemetryMetrics | undefined)[],
  exerciseName = "",
  groupId?: string | null
): PhaseRadarSummary {
  const valid = telemetryList.filter((t): t is TelemetryMetrics => Boolean(t && Object.keys(t).length > 0));
  if (valid.length === 0) {
    return {
      axes: [
        { label: "Zona Verde", value: 0, raw: "N/D" },
        { label: "Freno Suave", value: 0, raw: "N/D" },
        { label: "Retarder", value: 0, raw: "N/D" },
        { label: "Inercia", value: 0, raw: "N/D" },
        { label: "Acel. Suave", value: 0, raw: "N/D" },
      ],
      ecoScore: 0,
      environment: "CARRETERA",
      hasSlipperyRoad: false,
    };
  }

  const env = resolveExerciseEnvironment(exerciseName, groupId);
  const n = valid.length;

  // Promediar métricas brutas
  const avgPctGreen = valid.reduce((acc, t) => acc + (t.pctGreenZone || 0), 0) / n;
  const avgPctYellow = valid.reduce((acc, t) => acc + (t.pctYellowZone || 0), 0) / n;
  const avgPctRed = valid.reduce((acc, t) => acc + (t.pctRedZone || 0), 0) / n;
  const avgHarshBrakes = valid.reduce((acc, t) => acc + (t.brakeAbove60Uses || 0), 0) / n;
  const avgAuxBrakeSec = valid.reduce((acc, t) => acc + (t.auxBrakeTimeSec || 0), 0) / n;
  const hasSlippery = valid.some((t) => t.hasSlipperyRoad);

  let totalDist = 0;
  let totalCoast = 0;
  valid.forEach((t) => {
    if (t.distanceMeters && t.distanceMeters > 50 && t.coastDistanceMeters !== undefined) {
      totalDist += t.distanceMeters;
      totalCoast += t.coastDistanceMeters;
    }
  });
  const avgInRatio = totalDist > 0 ? totalCoast / totalDist : 0.25;

  let totalThrottleAbove60Sec = 0;
  valid.forEach((t) => {
    if (t.throttleAbove60Time && t.throttleAbove60Time !== "00:00") {
      const parts = t.throttleAbove60Time.split(":").map(Number);
      totalThrottleAbove60Sec += (parts[0] || 0) * 60 + (parts[1] || 0);
    }
  });
  const avgThrottleSec = totalThrottleAbove60Sec / n;

  // 1. Rango RPM (Zona verde vs meta, castigada por zona roja y zona amarilla sin freno de motor)
  const greenTarget = env === "MONTANA" ? 48 : env === "CIUDAD" ? 58 : 75;
  const rawRpmRatio = (avgPctGreen / greenTarget) * 100;
  
  // Penalización por zona roja
  let rpmPenalty = avgPctRed * 25;
  
  // Penalización por zona amarilla:
  // En lluvia/nieve es permisivo porque no se debe usar retarder y la retención se hace con marcha baja
  if (avgPctYellow > 0) {
    if (hasSlippery) {
      if (avgPctYellow > 25) rpmPenalty += (avgPctYellow - 25) * 1.5;
    } else if (avgAuxBrakeSec <= 1) {
      rpmPenalty += avgPctYellow * 5;
    } else {
      if (env === "MONTANA") {
        if (avgPctYellow > 20) rpmPenalty += (avgPctYellow - 20) * 3;
      } else {
        if (avgPctYellow > 8) rpmPenalty += (avgPctYellow - 8) * 3;
      }
    }
  }

  const axisRpm = Math.max(0, Math.min(100, Math.round(rawRpmRatio - rpmPenalty)));

  // 2. Control de Frenado Suave
  const brakeTolerance = env === "CIUDAD" ? 3 : env === "MONTANA" ? 1 : 0;
  let brakePenalty = 0;
  if (env === "CIUDAD") {
    if (avgHarshBrakes > 3) brakePenalty = (avgHarshBrakes - 3) * 5;
  } else if (env === "MONTANA") {
    if (avgHarshBrakes > 1) brakePenalty = (avgHarshBrakes - 1) * 8;
  } else {
    brakePenalty = avgHarshBrakes * 10;
  }
  const axisBrake = Math.max(0, Math.round(100 - brakePenalty));
  const brakeTargetLabel = brakeTolerance > 0 ? `meta ≤${brakeTolerance}` : "meta 0";

  // 3. Freno Auxiliar / Retarder
  let axisRetarder = 100;
  let retarderRaw = `${Math.round(avgAuxBrakeSec)}s`;
  if (hasSlippery) {
    if (avgAuxBrakeSec <= 3) {
      axisRetarder = 100;
      retarderRaw = `${Math.round(avgAuxBrakeSec)}s (Seguro ✓)`;
    } else {
      axisRetarder = Math.max(10, Math.round(100 - Math.min(90, avgAuxBrakeSec * 4)));
      retarderRaw = `${Math.round(avgAuxBrakeSec)}s (Riesgo tijera ⚠️)`;
    }
  } else {
    const retarderTarget = env === "MONTANA" ? 45 : 20;
    if (env === "MONTANA" && avgAuxBrakeSec < 5) {
      axisRetarder = 25;
      retarderRaw = `${Math.round(avgAuxBrakeSec)}s (Riesgo cristaliz. ⚠️)`;
    } else {
      axisRetarder = Math.min(100, Math.round((avgAuxBrakeSec / retarderTarget) * 100));
      retarderRaw = `${Math.round(avgAuxBrakeSec)}s (meta ${retarderTarget}s)`;
    }
  }

  // 4. Aprovechamiento de Inercia
  const optInertia = env === "MONTANA" ? 0.25 : env === "CIUDAD" ? 0.20 : 0.35;
  const axisInertia = Math.min(100, Math.round((avgInRatio / optInertia) * 100));
  const inRatioPct = Math.round(avgInRatio * 100);
  const optInertiaPct = Math.round(optInertia * 100);

  // 5. Aceleración Suave
  let axisAccel = 100;
  let accelRaw = "0s (meta 0s)";
  if (avgThrottleSec > 0) {
    axisAccel = Math.max(20, Math.round(100 - avgThrottleSec * 5));
    accelRaw = `${Math.round(avgThrottleSec)}s (>60% ⚠️)`;
  }

  const axes: RadarAxis[] = [
    { label: "Zona Verde", value: axisRpm, raw: `${Math.round(avgPctGreen)}% (meta ${greenTarget}%)` },
    { label: "Freno Suave", value: axisBrake, raw: `${avgHarshBrakes.toFixed(1)} f.b. (${brakeTargetLabel})` },
    { label: hasSlippery ? "Retarder Seg." : "Retarder", value: axisRetarder, raw: retarderRaw },
    { label: "Inercia", value: axisInertia, raw: `${inRatioPct}% (meta ≥${optInertiaPct}%)` },
    { label: "Acel. Suave", value: axisAccel, raw: accelRaw },
  ];

  const ecoScore = Math.round(((axes.reduce((a, b) => a + b.value, 0) / axes.length) / 10) * 10) / 10;

  return {
    axes,
    ecoScore,
    environment: env,
    hasSlipperyRoad: hasSlippery,
  };
}
