import jsPDF from "jspdf";
import JSZip from "jszip";
import { driverData, type EvaluationView } from "./db";
import { phaseName, CRITICAL_LIMIT } from "./config";
import { SEVERITIES, SEVERITY_ORDER, type Severity } from "./catalog";
import { computeTelemetryAxes } from "./telemetryRadar";
import { TRACKSIM_LOGO_BASE64 } from "./logoBase64";
import type { DisplayRow } from "../pages/Home";

// Paleta corporativa idéntica al diseño en pantalla
const COLOR_PRIMARY = [15, 23, 42]; // slate-900
const COLOR_MUTED = [100, 116, 139]; // slate-500
const COLOR_BORDER = [226, 232, 240]; // slate-200
const COLOR_BG_LIGHT = [248, 250, 252]; // slate-50
const COLOR_INDIGO = [79, 70, 229]; // indigo-600

function drawHeader(doc: jsPDF, title: string, subtitle?: string) {
  // Fondo de barra superior (#fe7443)
  doc.setFillColor(254, 116, 67);
  doc.rect(0, 0, 210, 20, "F");

  // Logo Oficial TrackSIM
  try {
    doc.addImage(TRACKSIM_LOGO_BASE64, "PNG", 12, 2, 16, 16);
  } catch (e) {
    console.error("Error cargando logo en PDF:", e);
  }

  // Título de la app
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("TrackSIM Report", 32, 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(255, 245, 240);
  doc.text("Sistema de Telemetría y Evaluación en Simulador", 72, 12);

  const nowStr = new Date().toLocaleDateString("es-MX", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  doc.text(`Generado: ${nowStr}`, 196, 12, { align: "right" });

  let y = 30;
  doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, 14, y);

  if (subtitle) {
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(subtitle, 14, y);
  }

  y += 5;
  doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
  doc.setLineWidth(0.5);
  doc.line(14, y, 196, y);

  return y + 6;
}

function drawFooter(doc: jsPDF, pageNum: number, totalPages: number) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
  doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
  doc.line(14, 285, 196, 285);
  doc.text("TrackSIM Report — Documento Oficial de Evaluación", 14, 290);
  doc.text(`Página ${pageNum} de ${totalPages}`, 196, 290, { align: "right" });
}

// -------------------------------------------------------------
// 1. REPORTE GLOBAL (Tabla de conductores con filtros activos)
// -------------------------------------------------------------
export function generateGlobalReportPdf(
  rows: DisplayRow[],
  filterSubtitle: string,
  metrics: { total: number; promedio: number; aptos: number; noAptos: number }
): Uint8Array {
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  let y = drawHeader(doc, "Reporte Global de Evaluaciones", filterSubtitle);

  // Tarjetas métricas
  doc.setFillColor(COLOR_BG_LIGHT[0], COLOR_BG_LIGHT[1], COLOR_BG_LIGHT[2]);
  doc.roundedRect(14, y, 42, 16, 2, 2, "F");
  doc.roundedRect(60, y, 42, 16, 2, 2, "F");
  doc.roundedRect(106, y, 42, 16, 2, 2, "F");
  doc.roundedRect(152, y, 44, 16, 2, 2, "F");

  doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
  doc.roundedRect(14, y, 42, 16, 2, 2, "S");
  doc.roundedRect(60, y, 42, 16, 2, 2, "S");
  doc.roundedRect(106, y, 42, 16, 2, 2, "S");
  doc.roundedRect(152, y, 44, 16, 2, 2, "S");

  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
  doc.text("TOTAL CONDUCTORES", 18, y + 4.5);
  doc.text("PROMEDIO GENERAL", 64, y + 4.5);
  doc.text("APTOS", 110, y + 4.5);
  doc.text("NO APTOS", 156, y + 4.5);

  doc.setFontSize(12);
  doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
  doc.text(String(metrics.total), 18, y + 12);

  doc.setTextColor(COLOR_INDIGO[0], COLOR_INDIGO[1], COLOR_INDIGO[2]);
  doc.text(`${metrics.promedio} pts`, 64, y + 12);

  doc.setTextColor(16, 185, 129);
  doc.text(String(metrics.aptos), 110, y + 12);

  doc.setTextColor(244, 63, 94);
  doc.text(String(metrics.noAptos), 156, y + 12);

  y += 22;

  // Cabecera de la tabla
  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 7.5, "F");
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);

  doc.text("CONDUCTOR", 17, y + 5);
  doc.text("AVANCE / EJERCICIOS", 68, y + 5);
  doc.text("ERRORES", 116, y + 5);
  doc.text("CRÍT.", 133, y + 5);
  doc.text("NOTA", 148, y + 5);
  doc.text("DICTAMEN", 193, y + 5, { align: "right" });

  y += 7.5;

  rows.forEach((r, idx) => {
    if (y > 270) {
      doc.addPage();
      y = drawHeader(doc, "Reporte Global de Evaluaciones (Cont.)", filterSubtitle);
      doc.setFillColor(241, 245, 249);
      doc.rect(14, y, 182, 7.5, "F");
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
      doc.text("CONDUCTOR", 17, y + 5);
      doc.text("AVANCE / EJERCICIOS", 68, y + 5);
      doc.text("ERRORES", 116, y + 5);
      doc.text("CRÍT.", 133, y + 5);
      doc.text("NOTA", 148, y + 5);
      doc.text("DICTAMEN", 193, y + 5, { align: "right" });
      y += 7.5;
    }

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, y, 182, 8, "F");
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
    const dName = r.driver.length > 28 ? `${r.driver.substring(0, 26)}…` : r.driver;
    doc.text(dName, 17, y + 5.2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(`${r.badgeText} (${r.exercisesText})`, 68, y + 5.2);

    doc.text(String(r.errors), 120, y + 5.2);

    if (r.criticalErrors > 0) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(225, 29, 72);
      doc.text(String(r.criticalErrors), 136, y + 5.2);
    } else {
      doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
      doc.text("0", 136, y + 5.2);
    }

    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
    doc.text(`${r.avgScore}`, 150, y + 5.2);

    const isApto = r.verdict.startsWith("APTO") && !r.verdict.includes("OBSERVACIONES");
    const isObs = r.verdict.includes("OBSERVACIONES");
    if (isApto) doc.setTextColor(16, 185, 129);
    else if (isObs) doc.setTextColor(217, 119, 6);
    else doc.setTextColor(225, 29, 72);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    // Para no desbordar, abreviar "APTO CON OBSERVACIONES" si es necesario o dibujar a la derecha
    const verdictLabel = isObs ? "APTO C/ OBSERVACIONES" : r.verdict;
    doc.text(verdictLabel, 193, y + 5.2, { align: "right" });

    doc.setDrawColor(241, 245, 249);
    doc.line(14, y + 8, 196, y + 8);
    y += 8;
  });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, i, totalPages);
  }

  return doc.output("arraybuffer") as unknown as Uint8Array;
}

// -------------------------------------------------------------
// 2. EXPEDIENTE INDIVIDUAL IDÉNTICO AL EXPEDIENTE DE PANTALLA
// -------------------------------------------------------------
export async function generateDriverReportPdf(driverId: string): Promise<Uint8Array | null> {
  const data = await driverData(driverId);
  if (!data) return null;

  const doc = new jsPDF({ format: "a4", unit: "mm" });
  let y = 14;

  // Header con Logo Oficial TrackSIM y Avatar
  try {
    doc.addImage(TRACKSIM_LOGO_BASE64, "PNG", 14, y - 2, 16, 16);
  } catch (e) {
    console.error("Error cargando logo en PDF de conductor:", e);
  }

  // Avatar redondo con inicial
  doc.setFillColor(79, 70, 229); // Indigo
  doc.roundedRect(33, y, 12, 12, 3, 3, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(data.name.charAt(0).toUpperCase(), 39, y + 8, { align: "center" });

  // Nombre y subtítulo
  doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
  doc.setFontSize(15);
  doc.text(data.name, 49, y + 6);

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
  doc.text("Expediente de Desempeño y Telemetría — TrackSIM ZERO", 49, y + 11);

  // Badge de Dictamen Oficial a la derecha
  const isApto = data.verdict === "APTO";
  const isObs = data.verdict.includes("OBSERVACIONES");
  const badgeColor = isApto ? [16, 185, 129] : isObs ? [217, 119, 6] : [225, 29, 72];
  const badgeBg = isApto ? [236, 253, 245] : isObs ? [254, 243, 199] : [255, 241, 242];

  doc.setFillColor(badgeBg[0], badgeBg[1], badgeBg[2]);
  doc.roundedRect(140, y + 1, 56, 10, 5, 5, "F");
  doc.setDrawColor(badgeColor[0], badgeColor[1], badgeColor[2]);
  doc.setLineWidth(0.3);
  doc.roundedRect(140, y + 1, 56, 10, 5, 5, "S");

  doc.setTextColor(badgeColor[0], badgeColor[1], badgeColor[2]);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text(data.verdict, 168, y + 7.5, { align: "center" });

  y += 18;

  // -------------------------------------------------------------
  // Tarjetas principales (Main Score Card & Total de Ejercicios)
  // -------------------------------------------------------------
  // Tarjeta 1: Calificación Global Promediada
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(14, y, 122, 34, 3, 3, "F");
  doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
  doc.roundedRect(14, y, 122, 34, 3, 3, "S");

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
  doc.text("CALIFICACIÓN GLOBAL PROMEDIADA", 20, y + 7);

  doc.setFontSize(26);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
  doc.text(String(data.overall), 20, y + 20);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
  doc.text("/ 100 pts", 54, y + 18.5);

  doc.setFontSize(7);
  doc.text(
    `Calculada sobre ${data.phases.length} fase(s) registradas con ponderación compuesta (70% destreza + 30% eco).`,
    20,
    y + 26
  );

  // Alerta de faltas críticas dentro de la tarjeta
  doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
  doc.line(20, y + 28, 130, y + 28);
  if (data.criticalErrors > 0) {
    doc.setFillColor(225, 29, 72);
    doc.circle(23, y + 31, 1.2, "F");
    doc.setTextColor(225, 29, 72);
    doc.setFont("helvetica", "bold");
    doc.text(
      `${data.criticalErrors} error(es) crítico(s) acumulados${data.criticalErrors >= CRITICAL_LIMIT ? " — Causa dictamen eliminatorio" : ""}`,
      26,
      y + 32
    );
  } else {
    doc.setFillColor(16, 185, 129);
    doc.circle(23, y + 31, 1.2, "F");
    doc.setTextColor(16, 185, 129);
    doc.setFont("helvetica", "normal");
    doc.text("Sin faltas críticas en su historial", 26, y + 32);
  }

  // Tarjeta 2: Total de Ejercicios
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(140, y, 56, 34, 3, 3, "F");
  doc.roundedRect(140, y, 56, 34, 3, 3, "S");

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
  doc.text("TOTAL DE EJERCICIOS", 146, y + 7);

  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
  doc.text(String(data.evals.length), 146, y + 19);

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
  doc.text(`Fases evaluadas: `, 146, y + 28);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
  doc.text(`${data.phases.length} de 6`, 172, y + 28);

  y += 40;

  // -------------------------------------------------------------
  // Sección: Resumen por Fase (Grid de tarjetas)
  // -------------------------------------------------------------
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
  doc.text("Progreso por Fase", 14, y);
  y += 4;

  const cardW = 89; // 2 columnas por fila para dar amplio espacio
  const cardH = 26;
  const cardGap = 4;

  data.phases.forEach((p, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cardX = 14 + col * (cardW + cardGap);
    const cardY = y + row * (cardH + 3);

    // Calcular ejes de telemetría de esta fase
    const phaseEvals = data.evals.filter((e) => e.phase === p.phase);
    const telemetries = phaseEvals.map((e) => e.telemetry);
    const firstExName = phaseEvals[0]?.exercise || "";
    const radarData = computeTelemetryAxes(telemetries, firstExName);
    const axes = radarData.axes;

    doc.setFillColor(255, 255, 255);
    doc.roundedRect(cardX, cardY, cardW, cardH, 2.5, 2.5, "F");
    doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
    doc.roundedRect(cardX, cardY, cardW, cardH, 2.5, 2.5, "S");

    // LADO IZQUIERDO: Información de la fase (ancho: 52mm)
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_INDIGO[0], COLOR_INDIGO[1], COLOR_INDIGO[2]);
    doc.text(`FASE ${p.phase}`, cardX + 3.5, cardY + 4.5);

    doc.setFontSize(7.5);
    doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
    const pName = phaseName(p.phase);
    doc.text(pName.length > 24 ? `${pName.substring(0, 22)}…` : pName, cardX + 3.5, cardY + 9);

    // Badge fase
    const pApto = p.verdict.startsWith("APTO") && !p.verdict.includes("OBSERVACIONES");
    const pObs = p.verdict.includes("OBSERVACIONES");
    const pCol = pApto ? [16, 185, 129] : pObs ? [217, 119, 6] : [225, 29, 72];
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(pCol[0], pCol[1], pCol[2]);
    doc.text(p.verdict, cardX + 54, cardY + 4.5, { align: "right" });

    // Línea divisoria izquierda
    doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
    doc.line(cardX + 3.5, cardY + 11.5, cardX + 54, cardY + 11.5);

    // Métricas en 2 líneas
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(`${p.exercises}/${p.expected} ejercicios`, cardX + 3.5, cardY + 16);
    doc.text(`${p.errors} infracciones`, cardX + 3.5, cardY + 20.5);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_INDIGO[0], COLOR_INDIGO[1], COLOR_INDIGO[2]);
    doc.text(`Nota: ${p.avgScore} pts`, cardX + 32, cardY + 16);
    doc.text(`Eco: ${radarData.ecoScore}/100`, cardX + 32, cardY + 20.5);

    // Divisor vertical entre texto y radar
    doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
    doc.line(cardX + 56, cardY + 3, cardX + 56, cardY + cardH - 3);

    // LADO DERECHO: Radar de Telemetría (ancho disponible: 33mm)
    const rcX = cardX + 72;
    const rcY = cardY + 13;
    const rRadius = 9;

    const getPdfCoord = (i: number, val: number, cr = rRadius) => {
      const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
      const dist = (val / 100) * cr;
      return {
        x: rcX + dist * Math.cos(angle),
        y: rcY + dist * Math.sin(angle),
      };
    };

    // Fondo y círculo exterior del radar
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    // Guía 100% y ejes
    for (let i = 0; i < 5; i++) {
      const p1 = getPdfCoord(i, 100);
      const p2 = getPdfCoord((i + 1) % 5, 100);
      doc.line(p1.x, p1.y, p2.x, p2.y);
      doc.line(rcX, rcY, p1.x, p1.y);
    }
    // Guía 50%
    for (let i = 0; i < 5; i++) {
      const p1 = getPdfCoord(i, 50);
      const p2 = getPdfCoord((i + 1) % 5, 50);
      doc.line(p1.x, p1.y, p2.x, p2.y);
    }

    // Polígono de telemetría de la fase
    doc.setDrawColor(79, 70, 229); // indigo
    doc.setLineWidth(0.4);
    for (let i = 0; i < 5; i++) {
      const p1 = getPdfCoord(i, axes[i].value);
      const p2 = getPdfCoord((i + 1) % 5, axes[(i + 1) % 5].value);
      doc.line(p1.x, p1.y, p2.x, p2.y);
      doc.setFillColor(79, 70, 229);
      doc.circle(p1.x, p1.y, 0.5, "F");
    }

    // Etiquetas abreviadas de los 5 ejes
    doc.setFontSize(4);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    const shortLabels = ["Verde", "Freno", "Ret.", "Inercia", "Acel."];
    for (let i = 0; i < 5; i++) {
      const lp = getPdfCoord(i, 138);
      doc.text(shortLabels[i], lp.x, lp.y + 0.6, { align: "center" });
    }
  });

  const totalPhaseRows = Math.ceil(data.phases.length / 2);
  y += totalPhaseRows * (cardH + 3) + 4;

  // -------------------------------------------------------------
  // Sección: Puntos Débiles (Análisis por Gravedad con Stacked Bar)
  // -------------------------------------------------------------
  // Agrupamiento por severidad
  const bySev: Record<Severity, typeof data.breakdown> = {
    CRITICO: [],
    GRAVE: [],
    MODERADO: [],
    LEVE: [],
  };
  let totalErrorsSum = 0;
  for (const item of data.breakdown) {
    bySev[item.severity].push(item);
    totalErrorsSum += item.count;
  }

  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
  doc.text("Puntos Débiles (Análisis por Gravedad)", 14, y);
  y += 4;

  if (totalErrorsSum > 0) {
    // Tarjeta del gráfico visual apilado
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(14, y, 182, 22, 3, 3, "F");
    doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
    doc.roundedRect(14, y, 182, 22, 3, 3, "S");

    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(`Proporción de Incidencias Totales (${totalErrorsSum} eventos acumulados)`, 18, y + 5.5);

    // Barra compuesta horizontal
    const barX = 18;
    const barY = y + 7.5;
    const barW = 174;
    const barH = 3.5;

    let curX = barX;
    SEVERITY_ORDER.forEach((s) => {
      const itemsInS = bySev[s];
      const sum = itemsInS.reduce((a, b) => a + b.count, 0);
      const segW = totalErrorsSum > 0 ? (sum / totalErrorsSum) * barW : 0;
      if (segW > 0) {
        const segColor =
          s === "CRITICO"
            ? [244, 63, 94]
            : s === "GRAVE"
              ? [249, 115, 22]
              : s === "MODERADO"
                ? [245, 158, 11]
                : [148, 163, 184];
        doc.setFillColor(segColor[0], segColor[1], segColor[2]);
        doc.rect(curX, barY, segW, barH, "F");
        curX += segW;
      }
    });

    // Leyenda de 4 columnas
    const legY = y + 17;
    const legCols = [18, 62, 106, 150];
    SEVERITY_ORDER.forEach((s, idx) => {
      const sum = bySev[s].reduce((a, b) => a + b.count, 0);
      const pct = totalErrorsSum > 0 ? ((sum / totalErrorsSum) * 100).toFixed(1) : "0";
      const segColor =
        s === "CRITICO"
          ? [244, 63, 94]
          : s === "GRAVE"
            ? [249, 115, 22]
            : s === "MODERADO"
              ? [245, 158, 11]
              : [148, 163, 184];

      doc.setFillColor(segColor[0], segColor[1], segColor[2]);
      doc.circle(legCols[idx], legY - 1, 1.2, "F");

      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
      doc.text(`${SEVERITIES[s].label}:`, legCols[idx] + 3, legY);

      doc.setFont("helvetica", "bold");
      doc.text(String(sum), legCols[idx] + 20, legY);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
      doc.text(`(${pct}%)`, legCols[idx] + 27, legY);
    });

    y += 26;
  }

  // -------------------------------------------------------------
  // Tarjetas agrupadas por Nivel de Gravedad con barras individuales
  // -------------------------------------------------------------
  const maxErrCount = Math.max(...data.breakdown.map((b) => b.count), 1);

  SEVERITY_ORDER.forEach((sev) => {
    const items = bySev[sev];
    if (items.length === 0) return;

    // Si no cabe, saltar a página 2
    if (y + 16 + items.length * 8 > 275) {
      drawFooter(doc, doc.getNumberOfPages(), 0);
      doc.addPage();
      y = drawHeader(doc, `Expediente: ${data.name} (Puntos Débiles Cont.)`, "Continuación del análisis de incidencias");
    }

    const cardHeight = 11 + items.length * 8.5;
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(14, y, 182, cardHeight, 2.5, 2.5, "F");
    doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
    doc.roundedRect(14, y, 182, cardHeight, 2.5, 2.5, "S");

    // Cabecera del nivel
    const dotColor =
      sev === "CRITICO"
        ? [244, 63, 94]
        : sev === "GRAVE"
          ? [249, 115, 22]
          : sev === "MODERADO"
            ? [245, 158, 11]
            : [148, 163, 184];
    doc.setFillColor(dotColor[0], dotColor[1], dotColor[2]);
    doc.circle(18, y + 4.5, 1.2, "F");

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
    doc.text(`Nivel ${SEVERITIES[sev].label}`, 22, y + 5.5);

    const totalInLevel = items.reduce((a, b) => a + b.count, 0);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(`${totalInLevel} incidencias en total`, 192, y + 5.5, { align: "right" });

    doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
    doc.line(18, y + 8, 192, y + 8);

    let rowY = y + 12;
    items.forEach((b) => {
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
      const desc = b.description.length > 70 ? `${b.description.substring(0, 68)}…` : b.description;
      doc.text(desc, 18, rowY);

      doc.text(`${b.count}× veces`, 192, rowY, { align: "right" });

      // Barra visual de error
      const barLen = Math.max(10, Math.round((b.count / maxErrCount) * 174));
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(18, rowY + 1.5, 174, 1.5, 0.7, 0.7, "F");
      doc.setFillColor(dotColor[0], dotColor[1], dotColor[2]);
      doc.roundedRect(18, rowY + 1.5, barLen, 1.5, 0.7, 0.7, "F");

      rowY += 8.5;
    });

    y += cardHeight + 4;
  });

  // -------------------------------------------------------------
  // Sección: Desglose de Ejercicios Evaluados (Tabla completa idéntica a pantalla)
  // -------------------------------------------------------------
  if (y > 200) {
    drawFooter(doc, doc.getNumberOfPages(), 0);
    doc.addPage();
    y = drawHeader(doc, `Expediente: ${data.name} (Desglose de Ejercicios)`, "Historial cronológico de simulaciones");
  }

  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
  doc.text("Desglose de Ejercicios Evaluados", 14, y);
  y += 4;

  doc.setFillColor(241, 245, 249);
  doc.rect(14, y, 182, 7, "F");
  doc.setFontSize(7);
  doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
  doc.text("FASE", 17, y + 4.8);
  doc.text("EJERCICIO / UNIDAD", 32, y + 4.8);
  doc.text("FECHA", 88, y + 4.8);
  doc.text("INSTRUCTOR", 114, y + 4.8);
  doc.text("DURACIÓN", 146, y + 4.8);
  doc.text("ERRORES", 164, y + 4.8);
  doc.text("CALIF. FINAL", 193, y + 4.8, { align: "right" });
  y += 7;

  data.evals.forEach((e: EvaluationView, idx: number) => {
    if (y > 270) {
      doc.addPage();
      y = drawHeader(doc, `Expediente: ${data.name} (Desglose Cont.)`, "Continuación de ejercicios evaluados");
      doc.setFillColor(241, 245, 249);
      doc.rect(14, y, 182, 7, "F");
      doc.setFontSize(7);
      doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
      doc.text("FASE", 17, y + 4.8);
      doc.text("EJERCICIO / UNIDAD", 32, y + 4.8);
      doc.text("FECHA", 88, y + 4.8);
      doc.text("INSTRUCTOR", 114, y + 4.8);
      doc.text("DURACIÓN", 146, y + 4.8);
      doc.text("ERRORES", 164, y + 4.8);
      doc.text("CALIF. FINAL", 193, y + 4.8, { align: "right" });
      y += 7;
    }

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, y, 182, 7.5, "F");
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(COLOR_INDIGO[0], COLOR_INDIGO[1], COLOR_INDIGO[2]);
    doc.text(`F${e.phase}`, 17, y + 5);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
    const exTitle = e.exercise.length > 30 ? `${e.exercise.substring(0, 28)}…` : e.exercise;
    doc.text(exTitle, 32, y + 5);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(e.date || "—", 88, y + 5);

    const inst = (e.instructor || "—").length > 14 ? `${(e.instructor || "").substring(0, 12)}…` : e.instructor || "—";
    doc.text(inst, 114, y + 5);

    const min = Math.floor(e.durationSec / 60);
    const sec = String(e.durationSec % 60).padStart(2, "0");
    doc.text(`${min}:${sec}`, 148, y + 5);

    if (e.errorCount > 0) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(225, 29, 72);
      doc.text(String(e.errorCount), 168, y + 5);
    } else {
      doc.setTextColor(16, 185, 129);
      doc.text("0", 168, y + 5);
    }

    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_INDIGO[0], COLOR_INDIGO[1], COLOR_INDIGO[2]);
    doc.text(`${e.score}`, 193, y + 5, { align: "right" });

    doc.setDrawColor(241, 245, 249);
    doc.line(14, y + 7.5, 196, y + 7.5);
    y += 7.5;
  });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    drawFooter(doc, i, totalPages);
  }

  return doc.output("arraybuffer") as unknown as Uint8Array;
}

// -------------------------------------------------------------
// 3. DESCARGA DIRECTA DEL EXPEDIENTE INDIVIDUAL EN PDF
// -------------------------------------------------------------
export async function downloadDriverPdf(driverId: string, driverName: string): Promise<void> {
  const bytes = await generateDriverReportPdf(driverId);
  if (!bytes) return;

  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const cleanName = driverName.replace(/[^\w\s-]/gi, "").trim().replace(/\s+/g, "_");
  a.download = `Expediente_${cleanName}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// -------------------------------------------------------------
// 4. GENERADOR DE PAQUETE ZIP (Global + Expedientes independientes)
// -------------------------------------------------------------
export async function downloadBulkReportsZip(
  rows: DisplayRow[],
  filterSubtitle: string,
  metrics: { total: number; promedio: number; aptos: number; noAptos: number },
  onProgress?: (current: number, total: number, currentName: string) => void
): Promise<void> {
  const zip = new JSZip();

  // 1. Generar reporte global
  if (onProgress) onProgress(0, rows.length, "Generando Reporte Global consolidado");
  const globalPdfBytes = generateGlobalReportPdf(rows, filterSubtitle, metrics);
  zip.file("00_Reporte_Global_Resultados.pdf", globalPdfBytes);

  // Carpeta para expedientes individuales
  const expedientesFolder = zip.folder("Expedientes_Individuales");

  // 2. Generar expediente independiente de cada conductor
  let count = 0;
  for (const row of rows) {
    count++;
    if (onProgress) onProgress(count, rows.length, row.driver);
    try {
      const driverPdfBytes = await generateDriverReportPdf(row.driverId);
      if (driverPdfBytes && expedientesFolder) {
        const cleanName = row.driver.replace(/[^\w\s-]/gi, "").trim().replace(/\s+/g, "_");
        expedientesFolder.file(`Expediente_${cleanName}.pdf`, driverPdfBytes);
      }
    } catch (err) {
      console.error(`Error generando expediente para ${row.driver}:`, err);
    }
  }

  // 3. Empaquetar y descargar ZIP
  if (onProgress) onProgress(rows.length, rows.length, "Comprimiendo archivo ZIP...");
  const content = await zip.generateAsync({ type: "blob" });

  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `TrackSIM_Reportes_${dateStr}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
