import type { RadarAxis, PhaseRadarSummary } from "./telemetryRadar";
import type { Severity } from "./catalog";

export type PedagogicalRecommendation = {
  id: string;
  category: "SEGURIDAD" | "EFICIENCIA" | "MECANICA" | "DESTREZA";
  priority: "ALTA" | "MEDIA" | "SUGERENCIA";
  title: string;
  description: string;
  actionItem: string;
  icon: string;
};

export type DriverEvaluationInput = {
  overall: number;
  verdict: string;
  criticalErrors: number;
  breakdown: Array<{
    description: string;
    rawDescription?: string;
    count: number;
    severity: Severity;
    environment?: string;
  }>;
  radarAxes?: RadarAxis[];
  radarSummary?: PhaseRadarSummary;
  completedExercises?: number;
  expectedExercises?: number;
};

/**
 * Genera recomendaciones pedagógicas automatizadas y personalizadas
 * basadas en el perfil de errores y los 5 ejes de telemetría del operador.
 */
export function generatePedagogicalRecommendations(
  data: DriverEvaluationInput
): PedagogicalRecommendation[] {
  const recommendations: PedagogicalRecommendation[] = [];

  // 1. RECOMENDACIONES DE SEGURIDAD (Faltas Críticas y Graves)
  const criticalItems = data.breakdown.filter((b) => b.severity === "CRITICO" && b.count > 0);
  const graveItems = data.breakdown.filter((b) => b.severity === "GRAVE" && b.count > 0);

  // Detección de salida de vía / carril
  const offRoadErrors = data.breakdown.filter((b) =>
    (b.rawDescription || b.description).toLowerCase().includes("salirse de la via") ||
    (b.rawDescription || b.description).toLowerCase().includes("cambio indebido de carril")
  );
  if (offRoadErrors.length > 0) {
    const totalOffRoad = offRoadErrors.reduce((acc, curr) => acc + curr.count, 0);
    const hasMountain = offRoadErrors.some((e) => e.environment === "MONTANA" || e.description.includes("montaña"));
    recommendations.push({
      id: "lane_discipline",
      category: "SEGURIDAD",
      priority: "ALTA",
      icon: "⚠️",
      title: "Disciplina de Carril y Trayectoria",
      description: `Se detectaron ${totalOffRoad} incidente(s) de invasión o salida de carril${
        hasMountain ? " con exposición a zonas de pendiente o montaña" : ""
      }.`,
      actionItem: "Reforzar el uso de espejos retrovisores y anticipación en curvas pronunciadas antes de ingresar a sectores estrechos.",
    });
  }

  // Detección de colisiones o no respetar señales
  const collisionOrSignals = data.breakdown.filter((b) => {
    const text = (b.rawDescription || b.description).toLowerCase();
    return text.includes("colision") || text.includes("choque") || text.includes("semaforo") || text.includes("alto") || text.includes("prioridad");
  });
  if (collisionOrSignals.length > 0) {
    recommendations.push({
      id: "defensive_driving",
      category: "SEGURIDAD",
      priority: "ALTA",
      icon: "🛡️",
      title: "Manejo Defensivo y Distancia de Seguimiento",
      description: "Incidencias registradas relacionadas con colisiones potenciales o inobservancia de señalización vial prioritaria.",
      actionItem: "Practicar la regla de los 4 segundos de distancia y explorar visualmente 15 segundos hacia adelante en la ruta.",
    });
  } else if (criticalItems.length > 0) {
    const topCritical = criticalItems[0];
    recommendations.push({
      id: "critical_faults",
      category: "SEGURIDAD",
      priority: "ALTA",
      icon: "🛑",
      title: `Atención Prioritaria: ${topCritical.description}`,
      description: `Se acumularon faltas críticas eliminatorias (${topCritical.count}× ${topCritical.description}).`,
      actionItem: "Realizar una sesión de reevaluación focalizada en el simulador repasando el protocolo estricto de seguridad.",
    });
  }

  // 2. RECOMENDACIONES DE TELEMETRÍA Y EFICIENCIA (Ejes del Radar)
  const axes = data.radarAxes || data.radarSummary?.axes;
  if (axes && axes.length > 0) {
    const greenAxis = axes.find((a) => a.label === "Zona Verde");
    const brakeAxis = axes.find((a) => a.label === "Freno Suave");
    const retarderAxis = axes.find((a) => a.label.includes("Retarder"));
    const inertiaAxis = axes.find((a) => a.label === "Inercia");
    const accelAxis = axes.find((a) => a.label.includes("Acel"));

    // Zona Verde / Manejo de RPM
    if (greenAxis && greenAxis.value < 70) {
      const isVeryLow = greenAxis.value < 50;
      recommendations.push({
        id: "rpm_green_zone",
        category: "EFICIENCIA",
        priority: isVeryLow ? "ALTA" : "MEDIA",
        icon: "🌱",
        title: "Optimización en Zona Verde del Motor",
        description: `El tiempo en rango de torque óptimo fue de solo ${greenAxis.value}%. ${greenAxis.raw}`,
        actionItem: "Efectuar cambios de marcha ascendentes progresivos entre 1,100 y 1,500 RPM para evitar sobre-revoluciones y sobreconsumo de diésel.",
      });
    }

    // Freno de Servicio Brusco
    if (brakeAxis && brakeAxis.value < 70) {
      recommendations.push({
        id: "harsh_braking",
        category: "MECANICA",
        priority: "MEDIA",
        icon: "🛑",
        title: "Suavidad en Frenado y Preservación de Balatas",
        description: `Se detectó alta frecuencia de frenadas bruscas (${brakeAxis.raw}).`,
        actionItem: "Anticipar las desaceleraciones levantando el acelerador con tiempo y dosificando la presión neumática del pedal de servicio.",
      });
    }

    // Uso de Retarder / Freno Auxiliar
    if (retarderAxis && retarderAxis.value < 65) {
      recommendations.push({
        id: "aux_brake_usage",
        category: "MECANICA",
        priority: "MEDIA",
        icon: "⚙️",
        title: "Aprovechamiento del Freno Auxiliar / Retarder",
        description: `El aprovechamiento del retarder fue insuficiente (${retarderAxis.raw}), sobrecargando el freno de servicio.`,
        actionItem: "Accionar el freno de motor/retarder escalonadamente en pendientes descendentes para evitar el calentamiento y fatiga (brake fade) de las zapatas.",
      });
    }

    // Inercia / Aprovechamiento Cinético
    if (inertiaAxis && inertiaAxis.value < 60) {
      recommendations.push({
        id: "inertia_coasting",
        category: "EFICIENCIA",
        priority: "SUGERENCIA",
        icon: "⚡",
        title: "Aprovechamiento de la Inercia Cinética",
        description: `Tiempo de marcha por inercia por debajo de la meta recomendada (${inertiaAxis.raw}).`,
        actionItem: "Soltar el acelerador 100-200 metros antes de zonas de frenada o curvas para rodar con consumo de inyección cero.",
      });
    }

    // Aceleración Progresiva
    if (accelAxis && accelAxis.value < 65) {
      recommendations.push({
        id: "smooth_acceleration",
        category: "EFICIENCIA",
        priority: "SUGERENCIA",
        icon: "🎯",
        title: "Dosificación Progresiva del Acelerador",
        description: `Presencia de aceleraciones a fondo o intempestivas (${accelAxis.raw}).`,
        actionItem: "Presionar el pedal de aceleración de manera suave y progresiva, permitiendo que el turbocompresor cargue sin quemar combustible innecesario.",
      });
    }
  }

  // 3. CASO DE EXCELENCIA (APTO sin incidencias críticas y con excelente telemetría)
  if (recommendations.length === 0) {
    if (data.verdict === "APTO" && data.overall >= 8.5) {
      recommendations.push({
        id: "driver_excellence",
        category: "DESTREZA",
        priority: "SUGERENCIA",
        icon: "🏆",
        title: "Desempeño Sobresaliente en Conducción Integral",
        description: "El operador demostró excelente control del tren motriz, apego estricto a las normas viales y conducción técnico-económica de alto nivel.",
        actionItem: "Candidato idóneo para liderar rutas de alta exigencia o desempeñarse como tutor de nuevos operadores.",
      });
    } else {
      recommendations.push({
        id: "continuous_improvement",
        category: "DESTREZA",
        priority: "SUGERENCIA",
        icon: "📈",
        title: "Mantenimiento del Estándar Operativo",
        description: "El operador cumple satisfactoriamente con los parámetros generales de la prueba.",
        actionItem: "Continuar con capacitaciones periódicas de actualización y auditorías de telemetría en ruta real.",
      });
    }
  }

  // Devolver máximo las 4 recomendaciones más relevantes para mantener concisión y legibilidad
  return recommendations.slice(0, 4);
}

