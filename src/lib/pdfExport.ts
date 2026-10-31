import jsPDF from "jspdf";
import JSZip from "jszip";
import { driverData, type DateFilter, type EvaluationView } from "./db";
import { phaseName, CRITICAL_LIMIT } from "./config";
import { SEVERITIES, SEVERITY_ORDER, type Severity } from "./catalog";
import { computeTelemetryAxes } from "./telemetryRadar";
import { generatePedagogicalRecommendations } from "./recommendations";
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
  metrics?: { total: number; promedio: number; aptos: number; noAptos: number }
): Uint8Array {
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  let y = drawHeader(doc, "Reporte Global de Evaluaciones", filterSubtitle);

  // Cálculos detallados y enriquecidos sobre las filas reales
  const total = rows.length;
  const aptosDirectos = rows.filter(
    (r) => r.verdict.startsWith("APTO") && !r.verdict.includes("OBSERVACIONES")
  ).length;
  const aptosObs = rows.filter((r) => r.verdict.includes("OBSERVACIONES")).length;
  const noAptos = rows.filter((r) => r.verdict.includes("NO APTO")).length;
  const incompletos = rows.filter(
    (r) => r.verdict === "INCOMPLETO" || r.verdict === "NO REALIZADO"
  ).length;

  const totalErrors = rows.reduce((acc, r) => acc + (r.errors || 0), 0);
  const totalCriticos = rows.reduce((acc, r) => acc + (r.criticalErrors || 0), 0);
  const sumaScore = rows.reduce((acc, r) => acc + (r.avgScore || 0), 0);
  const promedio = total > 0 ? Math.round((sumaScore / total) * 10) / 10 : 0;
  const approvalRate = total > 0 ? Math.round(((aptosDirectos + aptosObs) / total) * 100) : 0;

  // -------------------------------------------------------------
  // Panel Ejecutivo de Métricas (KPI Cards Corporativas)
  // -------------------------------------------------------------
  const cardW = 34.5;
  const cardH = 21;
  const cardGap = 2.4;
  const startX = 14;

  const kpis = [
    {
      title: "TOTAL EVALUADOS",
      value: String(total),
      sub: "Conductores",
      valColor: COLOR_PRIMARY,
      bg: COLOR_BG_LIGHT,
      border: COLOR_BORDER,
    },
    {
      title: "PROMEDIO GENERAL",
      value: `${promedio}`,
      sub: "sobre 10.0 pts",
      valColor: COLOR_INDIGO,
      bg: COLOR_BG_LIGHT,
      border: COLOR_BORDER,
    },
    {
      title: "APTOS / APROBADOS",
      value: `${aptosDirectos + aptosObs}`,
      sub: `${approvalRate}% tasa éxito`,
      valColor: [16, 185, 129],
      bg: [240, 253, 244],
      border: [187, 247, 208],
    },
    {
      title: "NO APTOS",
      value: String(noAptos),
      sub: total > 0 ? `${Math.round((noAptos / total) * 100)}% en riesgo` : "0%",
      valColor: [225, 29, 72],
      bg: [255, 241, 242],
      border: [254, 205, 211],
    },
    {
      title: "FALTAS CRÍTICAS",
      value: String(totalCriticos),
      sub: `${totalErrors} infracc. totales`,
      valColor: totalCriticos > 0 ? [225, 29, 72] : COLOR_MUTED,
      bg: totalCriticos > 0 ? [255, 241, 242] : COLOR_BG_LIGHT,
      border: totalCriticos > 0 ? [254, 205, 211] : COLOR_BORDER,
    },
  ];

  kpis.forEach((k, idx) => {
    const cx = startX + idx * (cardW + cardGap);
    doc.setFillColor(k.bg[0], k.bg[1], k.bg[2]);
    doc.roundedRect(cx, y, cardW, cardH, 2.5, 2.5, "F");
    doc.setDrawColor(k.border[0], k.border[1], k.border[2]);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, y, cardW, cardH, 2.5, 2.5, "S");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.8);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(k.title, cx + 3.5, y + 5);

    doc.setFontSize(13);
    doc.setTextColor(k.valColor[0], k.valColor[1], k.valColor[2]);
    doc.text(k.value, cx + 3.5, y + 13.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.2);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(k.sub, cx + 3.5, y + 18.2);
  });

  y += cardH + 4;

  // Mini barra segmentada visual de distribución de dictámenes
  if (total > 0) {
    const barW = 182;
    const barH = 3.5;
    const pApto = (aptosDirectos / total) * barW;
    const pObs = (aptosObs / total) * barW;
    const pNoApto = (noAptos / total) * barW;
    const pInc = (incompletos / total) * barW;

    // Fondo gris base
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(14, y, barW, barH, 1.5, 1.5, "F");

    let currentX = 14;
    if (pApto > 0) {
      doc.setFillColor(16, 185, 129); // Verde
      doc.rect(currentX, y, pApto, barH, "F");
      currentX += pApto;
    }
    if (pObs > 0) {
      doc.setFillColor(245, 158, 11); // Ámbar
      doc.rect(currentX, y, pObs, barH, "F");
      currentX += pObs;
    }
    if (pNoApto > 0) {
      doc.setFillColor(225, 29, 72); // Rojo
      doc.rect(currentX, y, pNoApto, barH, "F");
      currentX += pNoApto;
    }
    if (pInc > 0) {
      doc.setFillColor(148, 163, 184); // Slate
      doc.rect(currentX, y, pInc, barH, "F");
    }

    // Contorno estético redondeado para suavizar
    doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
    doc.setLineWidth(0.2);
    doc.roundedRect(14, y, barW, barH, 1.5, 1.5, "S");

    // Leyenda de la barra
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");

    doc.setFillColor(16, 185, 129);
    doc.circle(16, y + 7, 1.2, "F");
    doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
    doc.text(`Apto (${aptosDirectos})`, 19, y + 7.8);

    doc.setFillColor(245, 158, 11);
    doc.circle(48, y + 7, 1.2, "F");
    doc.text(`Con Observaciones (${aptosObs})`, 51, y + 7.8);

    doc.setFillColor(225, 29, 72);
    doc.circle(96, y + 7, 1.2, "F");
    doc.text(`No Apto (${noAptos})`, 99, y + 7.8);

    if (incompletos > 0) {
      doc.setFillColor(148, 163, 184);
      doc.circle(136, y + 7, 1.2, "F");
      doc.text(`Incompleto / Pendiente (${incompletos})`, 139, y + 7.8);
    }

    y += 11;
  }

  // -------------------------------------------------------------
  // Función para dibujar encabezado de tabla estilizado
  // -------------------------------------------------------------
  const drawTableHeader = (posY: number) => {
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(14, posY, 182, 8, 1.5, 1.5, "F");
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.roundedRect(14, posY, 182, 8, 1.5, 1.5, "S");

    doc.setFontSize(6.8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(71, 85, 105);

    doc.text("CONDUCTOR", 18, posY + 5.2);
    doc.text("AVANCE / EJERCICIOS", 68, posY + 5.2);
    doc.text("INFRACC.", 114, posY + 5.2, { align: "center" });
    doc.text("CRÍTICAS", 132, posY + 5.2, { align: "center" });
    doc.text("NOTA", 149, posY + 5.2, { align: "center" });
    doc.text("DICTAMEN OFICIAL", 193, posY + 5.2, { align: "right" });
    return posY + 8.5;
  };

  y = drawTableHeader(y);

  // -------------------------------------------------------------
  // Filas de Conductores con Badges y Barras de Progreso
  // -------------------------------------------------------------
  const rowHeight = 8.5;

  rows.forEach((r, idx) => {
    if (y > 272) {
      doc.addPage();
      y = drawHeader(doc, "Reporte Global de Evaluaciones (Cont.)", filterSubtitle);
      y = drawTableHeader(y);
    }

    // Color de fila cebra
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(14, y, 182, rowHeight, "F");
    }

    // Mini Avatar con Inicial
    const initial = (r.driver || "?").charAt(0).toUpperCase();
    doc.setFillColor(238, 242, 255); // Indigo 50
    doc.roundedRect(17, y + 1.8, 5, 5, 1.2, 1.2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.5);
    doc.setTextColor(COLOR_INDIGO[0], COLOR_INDIGO[1], COLOR_INDIGO[2]);
    doc.text(initial, 19.5, y + 5.3, { align: "center" });

    // Nombre del conductor
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
    const maxChars = 24;
    const dName = r.driver.length > maxChars ? `${r.driver.substring(0, maxChars - 1)}…` : r.driver;
    doc.text(dName, 24, y + 5.4);

    // Barra de Progreso Gráfica y Texto
    const totalExMatch = r.exercisesText.match(/(\d+)\/(\d+)/);
    const doneEx = totalExMatch ? parseInt(totalExMatch[1], 10) : 0;
    const maxEx = totalExMatch ? Math.max(parseInt(totalExMatch[2], 10), 1) : 1;
    const progressRatio = Math.min(Math.max(doneEx / maxEx, 0), 1);

    // Micro-barra de progreso (20mm de ancho)
    const barProgW = 20;
    const barProgH = 2.4;
    const barProgX = 68;
    const barProgY = y + 3.2;

    doc.setFillColor(226, 232, 240); // Fondo barra
    doc.roundedRect(barProgX, barProgY, barProgW, barProgH, 1, 1, "F");

    if (progressRatio > 0) {
      const fillW = Math.max(barProgW * progressRatio, 1.5);
      if (progressRatio >= 1) {
        doc.setFillColor(16, 185, 129); // Verde completo
      } else {
        doc.setFillColor(245, 158, 11); // Ámbar parcial
      }
      doc.roundedRect(barProgX, barProgY, fillW, barProgH, 1, 1, "F");
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.2);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(`${r.exercisesText}`, barProgX + barProgW + 2.5, y + 5.3);

    // Errores / Infracciones
    doc.setFontSize(6.8);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(String(r.errors || 0), 114, y + 5.3, { align: "center" });

    // Faltas Críticas (con pastilla si > 0)
    if (r.criticalErrors > 0) {
      doc.setFillColor(255, 241, 242);
      doc.roundedRect(127, y + 2, 10, 4.5, 1.2, 1.2, "F");
      doc.setDrawColor(254, 205, 211);
      doc.setLineWidth(0.2);
      doc.roundedRect(127, y + 2, 10, 4.5, 1.2, 1.2, "S");

      doc.setFont("helvetica", "bold");
      doc.setTextColor(225, 29, 72);
      doc.text(String(r.criticalErrors), 132, y + 5.3, { align: "center" });
    } else {
      doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
      doc.text("0", 132, y + 5.3, { align: "center" });
    }

    // Nota / Calificación (con badge redondeado)
    const scoreVal = typeof r.avgScore === "number" ? r.avgScore : parseFloat(r.avgScore) || 0;
    const scoreBg = scoreVal >= 8 ? [240, 253, 244] : scoreVal >= 7 ? [254, 243, 199] : [255, 241, 242];
    const scoreColor = scoreVal >= 8 ? [16, 185, 129] : scoreVal >= 7 ? [217, 119, 6] : [225, 29, 72];

    doc.setFillColor(scoreBg[0], scoreBg[1], scoreBg[2]);
    doc.roundedRect(143.5, y + 2, 11, 4.5, 1.2, 1.2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(scoreColor[0], scoreColor[1], scoreColor[2]);
    doc.text(`${scoreVal.toFixed(1)}`, 149, y + 5.3, { align: "center" });

    // Pastilla Oficial de Dictamen (Estilo Expediente)
    const isApto = r.verdict.startsWith("APTO") && !r.verdict.includes("OBSERVACIONES");
    const isObs = r.verdict.includes("OBSERVACIONES");
    const isNoApto = r.verdict.includes("NO APTO");

    let badgeBg = [241, 245, 249];
    let badgeTextCol = [100, 116, 139];
    let badgeBorder = [226, 232, 240];
    let labelText = r.verdict;

    if (isApto) {
      badgeBg = [236, 253, 245];
      badgeTextCol = [5, 150, 105];
      badgeBorder = [167, 243, 208];
      labelText = "APTO";
    } else if (isObs) {
      badgeBg = [254, 243, 199];
      badgeTextCol = [180, 83, 9];
      badgeBorder = [253, 230, 138];
      labelText = "APTO C/ OBSERV.";
    } else if (isNoApto) {
      badgeBg = [255, 241, 242];
      badgeTextCol = [225, 29, 72];
      badgeBorder = [254, 205, 211];
      labelText = "NO APTO";
    } else if (r.verdict === "INCOMPLETO") {
      badgeBg = [254, 249, 195];
      badgeTextCol = [161, 98, 7];
      badgeBorder = [254, 240, 138];
      labelText = "INCOMPLETO";
    }

    if (r.isIncomplete && isApto) {
      labelText = "APTO (INCOMPLETO)";
    }

    // Dibujar Badge Rectangular Redondeado a la derecha
    const badgeW = 34;
    const badgeH = 5;
    const badgeX = 160;
    const badgeY = y + 1.8;

    doc.setFillColor(badgeBg[0], badgeBg[1], badgeBg[2]);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.5, 1.5, "F");
    doc.setDrawColor(badgeBorder[0], badgeBorder[1], badgeBorder[2]);
    doc.setLineWidth(0.2);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.5, 1.5, "S");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.8);
    doc.setTextColor(badgeTextCol[0], badgeTextCol[1], badgeTextCol[2]);
    doc.text(labelText, badgeX + badgeW / 2, badgeY + 3.6, { align: "center" });

    // Línea separadora sutil
    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.2);
    doc.line(14, y + rowHeight, 196, y + rowHeight);

    y += rowHeight;
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
export async function generateDriverReportPdf(driverId: string, filter?: DateFilter): Promise<Uint8Array | null> {
  const data = await driverData(driverId, filter);
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
  doc.text("Expediente de Desempeño y Telemetría — TrackSIM", 49, y + 11);

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

  if (data.completedExercises < data.expectedExercises) {
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(217, 119, 6);
    doc.text("EJERCICIOS INCOMPLETOS", 168, y + 14.2, { align: "center" });
  }

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
  doc.text("/ 10 pts", 54, y + 18.5);

  doc.setFontSize(7);
  doc.text(
    `Calculada sobre ${data.expectedExercises} ejercicio(s) esperados en ${data.phases.length} fase(s) (70% destreza + 30% eco).`,
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

  const isCursoGroup = data.phases.length === 1 && data.phases[0].phase === 0;

  // Tarjeta 2: Total de Ejercicios
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(140, y, 56, 34, 3, 3, "F");
  doc.roundedRect(140, y, 56, 34, 3, 3, "S");

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
  doc.text("EJERCICIOS REALIZADOS", 146, y + 7);

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
  doc.text(`${data.completedExercises} / ${data.expectedExercises}`, 146, y + 19);

  const phasesWithActivity = data.phases.filter((p) => p.exercises > 0).length;
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
  if (isCursoGroup) {
    doc.text(`Modalidad: `, 146, y + 28);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(147, 51, 234); // Purple 600
    doc.text("Curso (Sin Fases)", 165, y + 28);
  } else {
    doc.text(`Fases evaluadas: `, 146, y + 28);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
    doc.text(`${phasesWithActivity} de ${data.phases.length}`, 172, y + 28);
  }

  y += 40;

  // -------------------------------------------------------------
  // Sección: Progreso por Fase con Perfil Radar Completo y Telemetría
  // -------------------------------------------------------------
  const sectionTitle = isCursoGroup ? "Evaluación Integral del Curso" : "Progreso por Fase";
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
  doc.text(sectionTitle, 14, y);
  y += 4;

  const cardW = 182; // Ancho completo (1 columna)
  const cardH = 50;  // Altura suficiente para radar completo, desglose RPM y métricas

  data.phases.forEach((p) => {
    // Si no cabe la tarjeta completa, salto de página
    if (y + cardH > 275) {
      drawFooter(doc, doc.getNumberOfPages(), 0);
      doc.addPage();
      y = drawHeader(doc, `Expediente: ${data.name} (Progreso por Fase Cont.)`, "Continuación del desempeño por fase");
    }

    const cardX = 14;
    const cardY = y;

    // Calcular ejes de telemetría de esta fase (con soporte multientorno)
    const phaseEvals = data.evals.filter((e) => e.phase === p.phase);
    const phaseGroupId = phaseEvals[0]?.groupId || filter?.groupId || null;
    const radarData = computeTelemetryAxes(phaseEvals, "", phaseGroupId);
    const axes = radarData.axes;
    const rpmAxis = axes.find((a) => a.label === "Zona Verde");
    const bd = rpmAxis?.breakdown;

    // Benchmark del grupo o flota para esta fase / curso
    const isCursoGroup = data.groupType === "curso" || p.phase === 0;
    const groupPhaseEvals = (data.groupEvals || []).filter(
      (ge) => isCursoGroup || ge.phase === p.phase
    );
    const groupRadar = groupPhaseEvals.length > 0 ? computeTelemetryAxes(groupPhaseEvals, "", phaseGroupId) : null;
    const groupAxes = groupRadar?.axes;

    // Contenedor principal de la fase
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(cardX, cardY, cardW, cardH, 2.5, 2.5, "F");
    doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
    doc.roundedRect(cardX, cardY, cardW, cardH, 2.5, 2.5, "S");

    // ENCABEZADO DE LA FASE O DEL CURSO:
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    if (p.phase === 0) {
      doc.setTextColor(147, 51, 234);
      doc.text("EVALUACIÓN DEL CURSO", cardX + 3.5, cardY + 4.5);
    } else {
      doc.setTextColor(COLOR_INDIGO[0], COLOR_INDIGO[1], COLOR_INDIGO[2]);
      doc.text(`FASE ${p.phase}`, cardX + 3.5, cardY + 4.5);
    }

    doc.setFontSize(8);
    doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
    const pName = p.phase === 0 ? "Ejercicios Directos del Curso" : phaseName(p.phase);
    doc.text(pName.length > 28 ? `${pName.substring(0, 26)}…` : pName, cardX + 3.5, cardY + 9);

    // Badge de la fase (solo si son múltiples fases para no duplicar en Curso)
    if (p.phase !== 0 && !isCursoGroup) {
      const pApto = p.verdict.startsWith("APTO") && !p.verdict.includes("OBSERVACIONES");
      const pObs = p.verdict.includes("OBSERVACIONES");
      const pIncomplete = p.verdict === "INCOMPLETO";
      const pNotDone = p.verdict === "NO REALIZADO";
      const pCol = pApto ? [16, 185, 129] : pObs || pIncomplete ? [217, 119, 6] : pNotDone ? COLOR_MUTED : [225, 29, 72];

      const vText = p.verdict;
      doc.setFontSize(vText.length > 12 ? 5.2 : 6.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(pCol[0], pCol[1], pCol[2]);
      doc.text(vText, cardX + 54.5, cardY + 4.5, { align: "right" });
    }

    // Métricas rápidas de la fase (lado izquierdo)
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(`Ejercicios: `, cardX + 3.5, cardY + 14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
    doc.text(`${p.exercises} de ${p.expected}`, cardX + 16, cardY + 14);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text(`Infracciones: `, cardX + 3.5, cardY + 18.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(p.errors > 0 ? 225 : 16, p.errors > 0 ? 29 : 185, p.errors > 0 ? 72 : 129);
    doc.text(`${p.errors} err.`, cardX + 18, cardY + 18.5);

    // Cuadro Calificación y Puntaje Eco
    doc.setFillColor(245, 247, 255);
    doc.roundedRect(cardX + 3.5, cardY + 22, 50, 11, 1.5, 1.5, "F");
    doc.setDrawColor(224, 231, 255);
    doc.roundedRect(cardX + 3.5, cardY + 22, 50, 11, 1.5, 1.5, "S");

    doc.setFontSize(5.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_INDIGO[0], COLOR_INDIGO[1], COLOR_INDIGO[2]);
    doc.text("CALIFICACIÓN", cardX + 5.5, cardY + 25.5);
    doc.text("PUNTAJE ECO", cardX + 33, cardY + 25.5);

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_INDIGO[0], COLOR_INDIGO[1], COLOR_INDIGO[2]);
    doc.text(String(p.avgScore), cardX + 5.5, cardY + 31);
    doc.setFontSize(6.5);
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text("/10", cardX + 13.5, cardY + 31);

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_INDIGO[0], COLOR_INDIGO[1], COLOR_INDIGO[2]);
    doc.text(p.exercises > 0 ? `${radarData.ecoScore}/10` : "—", cardX + 33, cardY + 31);

    // Entorno especificado
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    const cleanEnvLabel = radarData.environmentLabel.replace(/[^\w\s-()+/·]/gi, "").trim();
    doc.text(cleanEnvLabel, cardX + 3.5, cardY + 37);
    doc.text(`Meta Verde: ${radarData.greenTarget}%`, cardX + 3.5, cardY + 40.5);

    // Divisor vertical 1 (traslado al gráfico radar)
    doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
    doc.line(cardX + 56, cardY + 3, cardX + 56, cardY + cardH - 3);

    // GRÁFICO RADAR (Centro) - Ancho aprox: 46mm
    const rcX = cardX + 80;
    const rcY = cardY + 25;
    const rRadius = 16;

    const getPdfCoord = (i: number, val: number, cr = rRadius) => {
      const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
      const dist = (val / 100) * cr;
      return {
        x: rcX + dist * Math.cos(angle),
        y: rcY + dist * Math.sin(angle),
      };
    };

    // Guías del radar (50% y 100%)
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    for (let i = 0; i < 5; i++) {
      const p1 = getPdfCoord(i, 100);
      const p2 = getPdfCoord((i + 1) % 5, 100);
      doc.line(p1.x, p1.y, p2.x, p2.y);
      doc.line(rcX, rcY, p1.x, p1.y);
    }
    for (let i = 0; i < 5; i++) {
      const p1 = getPdfCoord(i, 50);
      const p2 = getPdfCoord((i + 1) % 5, 50);
      doc.line(p1.x, p1.y, p2.x, p2.y);
    }

    // Polígono del Grupo / Flota (Azul punteado tenue de benchmark)
    if (groupAxes && groupPhaseEvals.length > 0) {
      doc.setDrawColor(147, 197, 253); // Azul claro tenue (sky-300 / blue-300)
      doc.setLineWidth(0.35);
      const dashStep = 1.0;
      for (let i = 0; i < 5; i++) {
        const p1 = getPdfCoord(i, groupAxes[i].value);
        const p2 = getPdfCoord((i + 1) % 5, groupAxes[(i + 1) % 5].value);

        // Trazar línea punteada manual
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.floor(dist / (dashStep * 2)));
        for (let s = 0; s < steps; s++) {
          const t1 = (s * 2) / (steps * 2);
          const t2 = (s * 2 + 1) / (steps * 2);
          doc.line(p1.x + dx * t1, p1.y + dy * t1, p1.x + dx * t2, p1.y + dy * t2);
        }
      }
    }

    // Polígono de telemetría de la fase del operador
    if (p.exercises > 0) {
      doc.setDrawColor(5, 150, 105); // emerald
      doc.setLineWidth(0.5);
      for (let i = 0; i < 5; i++) {
        const p1 = getPdfCoord(i, axes[i].value);
        const p2 = getPdfCoord((i + 1) % 5, axes[(i + 1) % 5].value);
        doc.line(p1.x, p1.y, p2.x, p2.y);
        doc.setFillColor(5, 150, 105);
        doc.circle(p1.x, p1.y, 0.7, "F");
      }
    } else {
      doc.setFontSize(6);
      doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
      doc.text("Sin realizar", rcX, rcY + 1, { align: "center" });
    }

    // Etiquetas y porcentajes de los 5 vértices
    doc.setFontSize(4.5);
    doc.setFont("helvetica", "bold");
    axes.forEach((a, i) => {
      const lp = getPdfCoord(i, 128);
      doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
      doc.text(a.label, lp.x, lp.y, { align: "center" });

      const valColor = a.value >= 75 ? [5, 150, 105] : a.value >= 50 ? [217, 119, 6] : [225, 29, 72];
      doc.setTextColor(valColor[0], valColor[1], valColor[2]);
      doc.text(p.exercises > 0 ? `${a.value}%` : "—", lp.x, lp.y + 2, { align: "center" });
    });

    // Divisor vertical 2 (traslado a las tarjetas de valores reales)
    doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
    doc.line(cardX + 106, cardY + 3, cardX + 106, cardY + cardH - 3);

    // LADO DERECHO: Tarjetas de valores reales y Desglose de RPM (X: cardX + 109, Ancho: 70mm)
    const dX = cardX + 109;

    // 1. Desglose de RPM
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
    doc.text("ZONA VERDE & RPM:", dX, cardY + 5.5);

    const rpmCols = [
      { label: "Bajas", val: bd ? `${bd.low}%` : "—", bg: [248, 250, 252], text: COLOR_PRIMARY },
      { label: "Verde", val: bd ? `${bd.green}%` : "—", bg: [236, 253, 245], text: [5, 150, 105] },
      { label: "Amarilla", val: bd ? `${bd.yellow}%` : "—", bg: [254, 243, 199], text: [217, 119, 6] },
      { label: "Roja", val: bd ? `${bd.red}%` : "—", bg: [255, 241, 242], text: [225, 29, 72] },
    ];

    const boxW = 16.5;
    const boxH = 7.5;
    rpmCols.forEach((c, idx) => {
      const bX = dX + idx * (boxW + 1);
      doc.setFillColor(c.bg[0], c.bg[1], c.bg[2]);
      doc.roundedRect(bX, cardY + 7, boxW, boxH, 1, 1, "F");
      doc.setFontSize(4.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
      doc.text(c.label, bX + boxW / 2, cardY + 9.5, { align: "center" });
      doc.setFontSize(5.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(c.text[0], c.text[1], c.text[2]);
      doc.text(c.val, bX + boxW / 2, cardY + 13.2, { align: "center" });
    });

    // 2. Grid de 4 ejes restantes
    const otherAxes = axes.filter((a) => a.label !== "Zona Verde");
    otherAxes.forEach((a, idx) => {
      const axCol = idx % 2;
      const axRow = Math.floor(idx / 2);
      const aX = dX + axCol * 35.5;
      const aY = cardY + 16.5 + axRow * 11;

      doc.setFillColor(248, 250, 252);
      doc.roundedRect(aX, aY, 34, 9.5, 1, 1, "F");

      doc.setFontSize(5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
      doc.text(a.label, aX + 2, aY + 3.2);

      const valCol = a.value >= 75 ? [5, 150, 105] : a.value >= 50 ? [217, 119, 6] : [225, 29, 72];
      doc.setTextColor(valCol[0], valCol[1], valCol[2]);
      doc.text(p.exercises > 0 ? `${a.value}%` : "—", aX + 32, aY + 3.2, { align: "right" });

      doc.setFontSize(4.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
      const rawText = a.raw.length > 22 ? `${a.raw.substring(0, 20)}…` : a.raw;
      doc.text(rawText, aX + 2, aY + 6.2);

      // Barrita miniatura
      doc.setFillColor(226, 232, 240);
      doc.roundedRect(aX + 2, aY + 7.5, 30, 1, 0.5, 0.5, "F");
      if (p.exercises > 0 && a.value > 0) {
        doc.setFillColor(valCol[0], valCol[1], valCol[2]);
        doc.roundedRect(aX + 2, aY + 7.5, Math.round((a.value / 100) * 30), 1, 0.5, 0.5, "F");
      }
    });

    // 3. Barra resumen inferior de métricas de telemetría (Consumo / Velocidad / RPM)
    const mY = cardY + 39.5;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(dX, mY, 70, 7.5, 1, 1, "F");

    doc.setFontSize(4.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
    doc.text("Consumo Med.", dX + 2, mY + 2.8);
    doc.text("Vel. Med/Max", dX + 25, mY + 2.8);
    doc.text("RPM Max / Cambios", dX + 47, mY + 2.8);

    doc.setFontSize(5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
    const consStr = radarData.metrics.avgConsumption !== undefined ? `${radarData.metrics.avgConsumption} l/100` : "—";
    const speedStr = `${radarData.metrics.avgSpeed || "—"} / ${radarData.metrics.maxSpeed || "—"} km/h`;
    const rpmStr = `${radarData.metrics.maxRpm || "—"} rpm · ${radarData.metrics.gearChanges ?? "—"} c.`;

    doc.text(consStr, dX + 2, mY + 6);
    doc.text(speedStr, dX + 25, mY + 6);
    doc.text(rpmStr, dX + 47, mY + 6);

    y += cardH + 3.5;
  });

  y += 2;

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

  const pdfExerciseRows = [
    ...data.evals.map((e: EvaluationView) => ({ type: "done" as const, phase: e.phase, eval: e })),
    ...(data.missingExercises || []).map((m: { phase: number; exercise: string }) => ({
      type: "missing" as const,
      phase: m.phase,
      exercise: m.exercise,
    })),
  ].sort((a, b) => a.phase - b.phase || (a.type === "done" && b.type === "missing" ? -1 : a.type === "missing" && b.type === "done" ? 1 : 0));

  pdfExerciseRows.forEach((row, idx: number) => {
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

    if (row.type === "done") {
      const e = row.eval;
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
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
      doc.text(`F${row.phase}`, 17, y + 5);

      const rawTitle = `${row.exercise} (NO REALIZADO)`;
      const exTitle = rawTitle.length > 34 ? `${rawTitle.substring(0, 32)}…` : rawTitle;
      doc.text(exTitle, 32, y + 5);

      doc.setFont("helvetica", "normal");
      doc.text("—", 88, y + 5);
      doc.text("—", 114, y + 5);
      doc.text("—", 148, y + 5);
      doc.text("—", 168, y + 5);

      doc.setFont("helvetica", "bold");
      doc.text("0", 193, y + 5, { align: "right" });
    }

    doc.setDrawColor(241, 245, 249);
    doc.line(14, y + 7.5, 196, y + 7.5);
    y += 7.5;
  });

  // -------------------------------------------------------------
  // Sección: Recomendaciones Pedagógicas y Plan de Mejora
  // -------------------------------------------------------------
  const allAxes = data.phases.flatMap((p) => {
    const phaseEvals = data.evals.filter((e) => e.phase === p.phase);
    return computeTelemetryAxes(phaseEvals, "", phaseEvals[0]?.groupId || filter?.groupId || null).axes;
  });

  const pdfRecs = generatePedagogicalRecommendations({
    overall: data.overall,
    verdict: data.verdict,
    criticalErrors: data.criticalErrors,
    breakdown: data.breakdown,
    radarAxes: allAxes,
    completedExercises: data.completedExercises,
    expectedExercises: data.expectedExercises,
  });

  if (pdfRecs.length > 0) {
    if (y > 230) {
      doc.addPage();
      y = drawHeader(doc, `Expediente: ${data.name} (Recomendaciones)`, "Plan de mejora y directrices pedagógicas");
    } else {
      y += 6;
    }

    doc.setFontSize(10.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
    doc.text("Recomendaciones Automatizadas y Plan de Mejora", 14, y);
    y += 4;

    pdfRecs.forEach((rec) => {
      // Calcular dimensiones dinámicas para que el texto nunca salga trunco
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "normal");
      const descLines = doc.splitTextToSize(rec.description, 172) as string[];

      const actLines = doc.splitTextToSize(rec.actionItem, 142) as string[];

      const baseHeaderH = 5.5;
      const descBlockH = descLines.length * 3.2;
      const actBlockH = Math.max(4.5, actLines.length * 3.2);
      const totalCardH = Math.max(16, baseHeaderH + descBlockH + actBlockH + 4.5);

      if (y + totalCardH > 275) {
        doc.addPage();
        y = drawHeader(doc, `Expediente: ${data.name} (Recomendaciones Cont.)`, "Plan de mejora y directrices pedagógicas");
      }

      doc.setFillColor(255, 255, 255);
      doc.roundedRect(14, y, 182, totalCardH, 2, 2, "F");
      doc.setDrawColor(COLOR_BORDER[0], COLOR_BORDER[1], COLOR_BORDER[2]);
      doc.roundedRect(14, y, 182, totalCardH, 2, 2, "S");

      // Categoría / Prioridad Badge
      const prioColor = rec.priority === "ALTA" ? [225, 29, 72] : rec.priority === "MEDIA" ? [217, 119, 6] : [5, 150, 105];
      doc.setFontSize(5.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(prioColor[0], prioColor[1], prioColor[2]);
      doc.text(`[${rec.category} · PRIORIDAD ${rec.priority}]`, 18, y + 4.5);

      // Título
      doc.setFontSize(7.5);
      doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
      doc.text(rec.title, 60, y + 4.5);

      // Descripción multilínea completa (sin truncar)
      let curTextY = y + 8.5;
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(COLOR_MUTED[0], COLOR_MUTED[1], COLOR_MUTED[2]);
      descLines.forEach((line) => {
        doc.text(line, 18, curTextY);
        curTextY += 3.2;
      });

      // Acción Sugerida multilínea completa
      curTextY += 1.0;
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(COLOR_INDIGO[0], COLOR_INDIGO[1], COLOR_INDIGO[2]);
      doc.text("Acción pedagógica:", 18, curTextY);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
      actLines.forEach((line, idx) => {
        if (idx === 0) {
          doc.text(line, 43, curTextY);
        } else {
          doc.text(line, 18, curTextY + idx * 3.2);
        }
      });

      y += totalCardH + 3.0;
    });
  }

  // Firmas y Validación Oficial al pie de la última sección
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
export async function downloadDriverPdf(driverId: string, driverName: string, filter?: DateFilter): Promise<void> {
  const bytes = await generateDriverReportPdf(driverId, filter);
  if (!bytes) return;

  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const cleanName = driverName.replace(/[^\w\s-]/gi, "").trim().replace(/\s+/g, "_");
  a.download = `${cleanName}_expediente.pdf`;
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
  onProgress?: (current: number, total: number, currentName: string) => void,
  filter?: DateFilter
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
      const driverPdfBytes = await generateDriverReportPdf(row.driverId, filter);
      if (driverPdfBytes && expedientesFolder) {
        const cleanName = row.driver.replace(/[^\w\s-]/gi, "").trim().replace(/\s+/g, "_");
        expedientesFolder.file(`${cleanName}_expediente.pdf`, driverPdfBytes);
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
