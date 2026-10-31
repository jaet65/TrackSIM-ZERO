import type { TelemetryMetrics } from "./parse";
import { resolveExerciseEnvironment } from "./exercises";

export type TelemetryItemInput = {
  telemetry?: TelemetryMetrics;
  exercise?: string;
  unit?: string;
  groupId?: string | null;
};

export type RadarAxis = {
  label: string;
  value: number; // 0 to 100
  raw: string;
  meta?: string;
  breakdown?: {
    green: number;
    yellow: number;
    red: number;
    low: number;
    isSlippery: boolean;
    penalty: number;
  };
};

export type PhaseRadarSummary = {
  axes: RadarAxis[];
  ecoScore: number;
  environment: string; // "CARRETERA" | "MONTANA" | "CIUDAD" | "MIXTO"
  environments: string[]; // Lista de entornos detectados en la fase, ej: ["CARRETERA", "MONTANA"]
  environmentLabel: string; // Etiqueta descriptiva formateada con emojis
  hasSlipperyRoad: boolean;
  slipperyCount: number;
  totalExercises: number;
  greenTarget: number;
  metrics: {
    avgPctGreen: number;
    avgPctYellow: number;
    avgPctRed: number;
    avgPctLow: number;
    avgHarshBrakes: number;
    avgAuxBrakeSec: number;
    avgInRatioPct: number;
    optInertiaPct: number;
    avgThrottleSec: number;
    avgConsumption?: number;
    avgSpeed?: number;
    maxSpeed?: number;
    maxRpm?: number;
    gearChanges?: number;
  };
};

/**
 * Calcula los 5 ejes de telemetría multidimensional para una evaluación o conjunto de evaluaciones.
 * Soporta fases heterogéneas / multientorno (Carretera, Montaña, Urbano/Ciudad), aplicando las metas
 * y penalizaciones calibradas de cada entorno ejercicio por ejercicio y luego promediando los índices de rendimiento.
 */
export function computeTelemetryAxes(
  inputList: (TelemetryMetrics | TelemetryItemInput | undefined)[],
  fallbackExerciseName = "",
  fallbackGroupId?: string | null
): PhaseRadarSummary {
  // Normalizar la entrada a una lista de items con telemetría y su entorno individual
  type NormalizedItem = {
    t: TelemetryMetrics;
    env: "CARRETERA" | "MONTANA" | "CIUDAD";
  };

  const validItems: NormalizedItem[] = [];

  for (const item of inputList) {
    if (!item) continue;

    let tel: TelemetryMetrics | undefined;
    let exName = fallbackExerciseName;
    let grpId = fallbackGroupId;

    if (typeof item === "object" && "telemetry" in item) {
      tel = (item as TelemetryItemInput).telemetry;
      exName = (item as TelemetryItemInput).exercise || (item as TelemetryItemInput).unit || fallbackExerciseName;
      grpId = (item as TelemetryItemInput).groupId ?? fallbackGroupId;
    } else {
      tel = item as TelemetryMetrics;
    }

    if (tel && Object.keys(tel).length > 0) {
      const itemEnv = resolveExerciseEnvironment(exName, grpId);
      validItems.push({ t: tel, env: itemEnv });
    }
  }

  if (validItems.length === 0) {
    return {
      axes: [
        { label: "Zona Verde", value: 0, raw: "N/D", meta: "meta ≥75%" },
        { label: "Freno Suave", value: 0, raw: "N/D", meta: "meta 0" },
        { label: "Retarder", value: 0, raw: "N/D", meta: "meta 20s" },
        { label: "Inercia", value: 0, raw: "N/D", meta: "meta ≥35%" },
        { label: "Acel. Suave", value: 0, raw: "N/D", meta: "meta 0s" },
      ],
      ecoScore: 0,
      environment: "CARRETERA",
      environments: ["CARRETERA"],
      environmentLabel: "🛣️ Entorno Carretera / Plano",
      hasSlipperyRoad: false,
      slipperyCount: 0,
      totalExercises: 0,
      greenTarget: 75,
      metrics: {
        avgPctGreen: 0,
        avgPctYellow: 0,
        avgPctRed: 0,
        avgPctLow: 0,
        avgHarshBrakes: 0,
        avgAuxBrakeSec: 0,
        avgInRatioPct: 0,
        optInertiaPct: 35,
        avgThrottleSec: 0,
      },
    };
  }

  const n = validItems.length;
  const uniqueEnvs = Array.from(new Set(validItems.map((item) => item.env)));
  const isMultiEnv = uniqueEnvs.length > 1;

  // Formatear etiqueta de entorno
  let primaryEnv = uniqueEnvs[0];
  let envLabel = "";
  if (isMultiEnv) {
    primaryEnv = "MIXTO" as any;
    const parts = uniqueEnvs.map((e) =>
      e === "MONTANA" ? "Montaña" : e === "CIUDAD" ? "Ciudad" : "Carretera"
    );
    envLabel = `🌐 Entorno Mixto (${parts.join(" + ")})`;
  } else {
    envLabel =
      primaryEnv === "MONTANA"
        ? "🏔️ Entorno Montaña / Sierra"
        : primaryEnv === "CIUDAD"
        ? "🏙️ Entorno Ciudad / Maniobras"
        : "🛣️ Entorno Carretera / Plano";
  }

  // Acumuladores de cálculo por ejercicio
  let sumAxisRpm = 0;
  let sumRpmPenalty = 0;
  let sumAxisBrake = 0;
  let sumAxisRetarder = 0;
  let sumAxisInertia = 0;
  let sumAxisAccel = 0;
  let sumGreenTarget = 0;
  let sumOptInertia = 0;

  let totalPctGreen = 0;
  let totalPctYellow = 0;
  let totalPctRed = 0;
  let totalHarshBrakes = 0;
  let totalAuxBrakeSec = 0;
  let totalDist = 0;
  let totalCoast = 0;
  let totalThrottleAbove60Sec = 0;
  let slipperyCount = 0;

  for (const { t, env } of validItems) {
    const isExSlippery = Boolean(t.hasSlipperyRoad);
    if (isExSlippery) slipperyCount++;

    const pctGreen = t.pctGreenZone || 0;
    const pctYellow = t.pctYellowZone || 0;
    const pctRed = t.pctRedZone || 0;
    const harshBrakes = t.brakeAbove60Uses || 0;
    const auxBrakeSec = t.auxBrakeTimeSec || 0;

    totalPctGreen += pctGreen;
    totalPctYellow += pctYellow;
    totalPctRed += pctRed;
    totalHarshBrakes += harshBrakes;
    totalAuxBrakeSec += auxBrakeSec;

    if (t.distanceMeters && t.distanceMeters > 50 && t.coastDistanceMeters !== undefined) {
      totalDist += t.distanceMeters;
      totalCoast += t.coastDistanceMeters;
    }

    if (t.throttleAbove60Time && t.throttleAbove60Time !== "00:00") {
      const parts = t.throttleAbove60Time.split(":").map(Number);
      totalThrottleAbove60Sec += (parts[0] || 0) * 60 + (parts[1] || 0);
    }

    // 1. Zona Verde con meta de su propio entorno
    const exGreenTarget = env === "MONTANA" ? 48 : env === "CIUDAD" ? 58 : 75;
    sumGreenTarget += exGreenTarget;
    const rawRpmRatio = (pctGreen / exGreenTarget) * 100;
    let exRpmPenalty = pctRed * 25;

    if (pctYellow > 0) {
      if (isExSlippery) {
        // En pavimento resbaladizo del ejercicio: se tolera zona amarilla hasta 25% por retención de marcha/compresión
        if (pctYellow > 25) exRpmPenalty += (pctYellow - 25) * 1.5;
      } else if (auxBrakeSec <= 1) {
        exRpmPenalty += pctYellow * 5;
      } else {
        if (env === "MONTANA") {
          if (pctYellow > 20) exRpmPenalty += (pctYellow - 20) * 3;
        } else {
          if (pctYellow > 8) exRpmPenalty += (pctYellow - 8) * 3;
        }
      }
    }
    sumRpmPenalty += exRpmPenalty;
    const exAxisRpm = Math.max(0, Math.min(100, Math.round(rawRpmRatio - exRpmPenalty)));
    sumAxisRpm += exAxisRpm;

    // 2. Freno Suave con tolerancia de su propio entorno
    let exBrakePenalty = 0;
    if (env === "CIUDAD") {
      if (harshBrakes > 3) exBrakePenalty = (harshBrakes - 3) * 5;
    } else if (env === "MONTANA") {
      if (harshBrakes > 1) exBrakePenalty = (harshBrakes - 1) * 8;
    } else {
      exBrakePenalty = harshBrakes * 10;
    }
    const exAxisBrake = Math.max(0, Math.round(100 - exBrakePenalty));
    sumAxisBrake += exAxisBrake;

    // Tiempo de freno de servicio en segundos
    let serviceBrakeSec = 0;
    if (t.brakeTime && t.brakeTime !== "00:00") {
      const bParts = t.brakeTime.split(":").map(Number);
      serviceBrakeSec = (bParts[0] || 0) * 60 + (bParts[1] || 0);
    }
    const totalBrakingSec = auxBrakeSec + serviceBrakeSec;

    // 3. Retarder evaluado con el clima, entorno y ratio de asistencia (Retarder vs Freno de Servicio)
    let exAxisRetarder = 100;
    if (isExSlippery) {
      // Regla de piso resbaladizo (lluvia/nieve): retarder desactivado (<= 3s) es 100%, de lo contrario riesgo tijera
      if (auxBrakeSec <= 3) {
        exAxisRetarder = 100;
      } else {
        exAxisRetarder = Math.max(10, Math.round(100 - Math.min(90, auxBrakeSec * 4)));
      }
    } else if (env === "CIUDAD") {
      // Entorno CIUDAD / URBANO / MANIOBRAS:
      // El retarder está prohibido en zonas urbanas por ruido y en patio/maniobras no aplica.
      // Si no usó retarder (<= 3s), tiene 100%. Si lo usó indebidamente en zona urbana, se penaliza.
      if (auxBrakeSec <= 3) {
        exAxisRetarder = 100;
      } else {
        exAxisRetarder = Math.max(20, Math.round(100 - auxBrakeSec * 3));
      }
    } else {
      // Entornos de carretera abierta y montaña (seco):
      // Ratio de asistencia = Retarder / (Retarder + Freno de Servicio)
      const targetRatio = env === "MONTANA" ? 0.60 : 0.40; // Montaña meta ≥60%, Carretera meta ≥40%
      if (totalBrakingSec <= 5) {
        // Apenas hubo necesidad de frenar en el ejercicio
        exAxisRetarder = 100;
      } else {
        const actualRatio = auxBrakeSec / totalBrakingSec;
        if (actualRatio >= targetRatio) {
          exAxisRetarder = 100;
        } else {
          // Si en montaña casi no usó retarder (< 5s) a pesar de haber frenado bastante con pedal
          if (env === "MONTANA" && auxBrakeSec < 5 && serviceBrakeSec > 15) {
            exAxisRetarder = 25; // Alerta de cristalización
          } else {
            exAxisRetarder = Math.max(20, Math.min(100, Math.round((actualRatio / targetRatio) * 100)));
          }
        }
      }
    }
    sumAxisRetarder += exAxisRetarder;

    // 4. Inercia con meta de su entorno
    const exOptInertia = env === "MONTANA" ? 0.25 : env === "CIUDAD" ? 0.20 : 0.35;
    sumOptInertia += exOptInertia;
    const exInRatio =
      t.distanceMeters && t.distanceMeters > 50 && t.coastDistanceMeters !== undefined
        ? t.coastDistanceMeters / t.distanceMeters
        : 0.25;
    const exAxisInertia = Math.min(100, Math.round((exInRatio / exOptInertia) * 100));
    sumAxisInertia += exAxisInertia;

    // 5. Aceleración Suave
    let exThrottleSec = 0;
    if (t.throttleAbove60Time && t.throttleAbove60Time !== "00:00") {
      const parts = t.throttleAbove60Time.split(":").map(Number);
      exThrottleSec = (parts[0] || 0) * 60 + (parts[1] || 0);
    }
    let exAxisAccel = 100;
    if (exThrottleSec > 0) {
      exAxisAccel = Math.max(20, Math.round(100 - exThrottleSec * 5));
    }
    sumAxisAccel += exAxisAccel;
  }

  // Promedios finales
  const hasSlippery = slipperyCount > 0;
  const isPartiallySlippery = slipperyCount > 0 && slipperyCount < n;
  const avgPctGreen = totalPctGreen / n;
  const avgPctYellow = totalPctYellow / n;
  const avgPctRed = totalPctRed / n;
  const avgHarshBrakes = totalHarshBrakes / n;
  const avgAuxBrakeSec = totalAuxBrakeSec / n;
  const avgInRatio = totalDist > 0 ? totalCoast / totalDist : 0.25;
  const avgThrottleSec = totalThrottleAbove60Sec / n;

  const avgGreenTarget = Math.round(sumGreenTarget / n);
  const avgOptInertiaPct = Math.round((sumOptInertia / n) * 100);
  const avgInRatioPct = Math.round(avgInRatio * 100);

  const axisRpm = Math.round(sumAxisRpm / n);
  const axisBrake = Math.round(sumAxisBrake / n);
  const axisRetarder = Math.round(sumAxisRetarder / n);
  const axisInertia = Math.round(sumAxisInertia / n);
  const axisAccel = Math.round(sumAxisAccel / n);
  const avgRpmPenalty = Math.round(sumRpmPenalty / n);

  // Textos y etiquetas descriptivas
  let retarderRaw = `${Math.round(avgAuxBrakeSec)}s`;
  if (hasSlippery) {
    if (isPartiallySlippery) {
      retarderRaw = `${Math.round(avgAuxBrakeSec)}s (${slipperyCount}/${n} c/lluvia)`;
    } else {
      retarderRaw = avgAuxBrakeSec <= 3 ? `${Math.round(avgAuxBrakeSec)}s (Seguro ✓)` : `${Math.round(avgAuxBrakeSec)}s (Riesgo tijera ⚠️)`;
    }
  } else if (primaryEnv === "CIUDAD" && !isMultiEnv) {
    retarderRaw = avgAuxBrakeSec <= 3 ? `${Math.round(avgAuxBrakeSec)}s (Urbano/Prohibido ✓)` : `${Math.round(avgAuxBrakeSec)}s (Uso indebido ⚠️)`;
  } else {
    const avgTargetPct = Math.round((validItems.reduce((acc, i) => acc + (i.env === "MONTANA" ? 60 : i.env === "CIUDAD" ? 0 : 40), 0) / n));
    retarderRaw = `${Math.round(avgAuxBrakeSec)}s (meta ratio ≥${avgTargetPct}%)`;
  }

  let accelRaw = "0s (meta 0s)";
  if (avgThrottleSec > 0) {
    accelRaw = `${Math.round(avgThrottleSec)}s (>60% ⚠️)`;
  }

  const brakeToleranceLabel = isMultiEnv
    ? "meta adaptada"
    : primaryEnv === "CIUDAD"
    ? "meta ≤3"
    : primaryEnv === "MONTANA"
    ? "meta ≤1"
    : "meta 0";

  // Promedios complementarios (consumo, velocidad, etc.)
  const withCons = validItems.map((v) => v.t).filter((t) => t.averageConsumption !== undefined);
  const avgConsumption =
    withCons.length > 0
      ? Math.round((withCons.reduce((acc, t) => acc + (t.averageConsumption || 0), 0) / withCons.length) * 10) / 10
      : undefined;

  const withSpeed = validItems.map((v) => v.t).filter((t) => t.averageSpeed !== undefined);
  const avgSpeed =
    withSpeed.length > 0
      ? Math.round((withSpeed.reduce((acc, t) => acc + (t.averageSpeed || 0), 0) / withSpeed.length) * 10) / 10
      : undefined;

  const maxSpeed = validItems.reduce((max, v) => Math.max(max, v.t.maxSpeed || 0), 0) || undefined;
  const maxRpm = validItems.reduce((max, v) => Math.max(max, v.t.maxRpm || 0), 0) || undefined;
  const totalGears = validItems.reduce((acc, v) => acc + (v.t.gearChanges || 0), 0);
  const avgGears = Math.round(totalGears / n);

  const avgPctLow = Math.max(0, 100 - avgPctGreen - avgPctYellow - avgPctRed);

  const axes: RadarAxis[] = [
    {
      label: "Zona Verde",
      value: axisRpm,
      raw: `${Math.round(avgPctGreen)}%`,
      meta: `meta ≥${avgGreenTarget}%`,
      breakdown: {
        green: Math.round(avgPctGreen),
        yellow: Math.round(avgPctYellow),
        red: Math.round(avgPctRed),
        low: Math.round(avgPctLow),
        isSlippery: hasSlippery,
        penalty: avgRpmPenalty > 0 ? avgRpmPenalty : 0,
      },
    },
    { label: "Freno Suave", value: axisBrake, raw: `${avgHarshBrakes.toFixed(1)} f. bruscas`, meta: brakeToleranceLabel },
    { label: hasSlippery ? "Retarder Seg." : "Retarder", value: axisRetarder, raw: retarderRaw },
    { label: "Inercia", value: axisInertia, raw: `${avgInRatioPct}%`, meta: `meta ≥${avgOptInertiaPct}%` },
    { label: "Acel. Suave", value: axisAccel, raw: accelRaw, meta: "meta 0s" },
  ];

  const ecoScore = Math.round(((axes.reduce((a, b) => a + b.value, 0) / axes.length) / 10) * 10) / 10;

  return {
    axes,
    ecoScore,
    environment: primaryEnv,
    environments: uniqueEnvs,
    environmentLabel: envLabel,
    hasSlipperyRoad: hasSlippery,
    slipperyCount,
    totalExercises: n,
    greenTarget: avgGreenTarget,
    metrics: {
      avgPctGreen: Math.round(avgPctGreen),
      avgPctYellow: Math.round(avgPctYellow),
      avgPctRed: Math.round(avgPctRed),
      avgPctLow: Math.round(avgPctLow),
      avgHarshBrakes: Math.round(avgHarshBrakes * 10) / 10,
      avgAuxBrakeSec: Math.round(avgAuxBrakeSec),
      avgInRatioPct: avgInRatioPct,
      optInertiaPct: avgOptInertiaPct,
      avgThrottleSec: Math.round(avgThrottleSec),
      avgConsumption,
      avgSpeed,
      maxSpeed,
      maxRpm,
      gearChanges: avgGears,
    },
  };
}
