import type { DisplayRow } from "../pages/Home";
import type { ReportExerciseSummary } from "../lib/db";
import { getPhaseName } from "../lib/exercises";
import { useEscapeKey } from "../lib/useEscapeKey";

type ExecutiveSummaryPreviewModalProps = {
  groupName: string;
  rows: DisplayRow[];
  filterSubtitle: string;
  metrics: { total: number; promedio: number; aptos: number; noAptos: number };
  exercises: ReportExerciseSummary[];
  onClose: () => void;
  onDownload: () => void;
};

export default function ExecutiveSummaryPreviewModal({
  groupName,
  rows,
  filterSubtitle,
  metrics,
  exercises,
  onClose,
  onDownload,
}: ExecutiveSummaryPreviewModalProps) {
  useEscapeKey(true, onClose);

  const total = rows.length;
  const aptos = rows.filter((row) => row.verdict.startsWith("APTO") && !row.verdict.includes("OBSERVACIONES")).length;
  const aptosObs = rows.filter((row) => row.verdict.includes("OBSERVACIONES")).length;
  const noAptos = rows.filter((row) => row.verdict.includes("NO APTO")).length;
  const incompleteRows = rows.filter(
    (row) => row.isIncomplete || row.verdict === "INCOMPLETO" || row.verdict === "NO REALIZADO"
  );
  const criticalRows = rows.filter((row) => row.criticalErrors > 0);
  const observationRows = rows.filter((row) => row.verdict.includes("OBSERVACIONES"));
  const followUpRows = rows.filter(
    (row) =>
      row.criticalErrors > 0 ||
      row.verdict.includes("NO APTO") ||
      row.verdict.includes("OBSERVACIONES") ||
      row.isIncomplete ||
      row.verdict === "INCOMPLETO" ||
      row.verdict === "NO REALIZADO"
  );
  const avgGlobal = metrics.promedio;
  const totalCritical = rows.reduce((sum, row) => sum + (row.criticalErrors || 0), 0);
  const passRate = total > 0 ? Math.round(((aptos + aptosObs) / total) * 100) : 0;
  const exerciseTotals = rows.reduce(
    (totals, row) => {
      const match = row.exercisesText.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        totals.completed += Number(match[1]);
        totals.expected += Number(match[2]);
      }
      return totals;
    },
    { completed: 0, expected: 0 }
  );
  const completionRate = exerciseTotals.expected > 0
    ? Math.round((exerciseTotals.completed / exerciseTotals.expected) * 100)
    : 0;
  const evaluatedScores = rows
    .filter((row) => row.progressValue > 0 && Number.isFinite(row.avgScore))
    .map((row) => row.avgScore)
    .sort((a, b) => a - b);
  const evaluatedCount = evaluatedScores.length;
  const medianScore = evaluatedCount > 0
    ? evaluatedCount % 2 === 0
      ? Math.round(((evaluatedScores[evaluatedCount / 2 - 1] + evaluatedScores[evaluatedCount / 2]) / 2) * 10) / 10
      : evaluatedScores[Math.floor(evaluatedCount / 2)]
    : 0;

  const insight = total === 0
    ? "No hay conductores en el alcance seleccionado. Ajuste los filtros o complete evaluaciones para generar un diagnóstico."
    : evaluatedCount === 0
      ? `Hay ${total} conductores en el alcance, pero ninguno registra ejercicios completados. Complete o configure las evaluaciones antes de interpretar el promedio del grupo.`
      : followUpRows.length === 0
        ? `El grupo registra ${passRate}% de aprobación y no presenta casos con señales de intervención en este alcance. El promedio es ${avgGlobal}/10 y la mediana de los ${evaluatedCount} conductores evaluados es ${medianScore}/10.`
        : `La aprobación es de ${passRate}% y ${followUpRows.length} de ${total} conductores requieren seguimiento. El foco prioritario son ${criticalRows.length} casos con faltas críticas; además, ${noAptos} tienen dictamen no apto y ${incompleteRows.length} presentan avance incompleto.`;

  const actionRows = [
    {
      label: "Faltas críticas",
      count: criticalRows.length,
      action: "Revisar los expedientes involucrados y definir refuerzo de seguridad antes de la siguiente validación.",
    },
    {
      label: "Dictamen no apto",
      count: noAptos,
      action: "Revisar el expediente, definir un plan correctivo y programar reevaluación conforme a los criterios operativos vigentes.",
    },
    {
      label: "Avance incompleto",
      count: incompleteRows.length,
      action: "Completar los ejercicios pendientes para contar con resultados comparables y un dictamen integral.",
    },
    {
      label: "Con observaciones",
      count: observationRows.length,
      action: "Dar seguimiento a las observaciones y verificar su cierre en la próxima evaluación.",
    },
  ].filter((item) => item.count > 0);

  if (actionRows.length === 0) {
    actionRows.push({
      label: evaluatedCount === 0 ? "Evaluación pendiente" : "Seguimiento regular",
      count: total,
      action: evaluatedCount === 0
        ? "Configurar y completar los ejercicios del grupo para generar resultados y definir prioridades de capacitación."
        : "Mantener el seguimiento periódico y conservar estos resultados como línea base del grupo.",
    });
  }

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="executive-preview-title"
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">Vista previa del reporte</p>
            <h2 id="executive-preview-title" className="mt-1 text-xl font-extrabold text-slate-900">
              Resumen Ejecutivo de Capacitación
            </h2>
            <p className="mt-1 text-xs text-slate-600">Grupo: {groupName}</p>
            <p className="mt-1 text-xs text-slate-500">Alcance: {filterSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Cerrar vista previa"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-7">
          <article className="mx-auto max-w-4xl space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Promedio del grupo", value: `${avgGlobal}/10`, detail: "Calificación promedio", color: "text-indigo-600" },
                { label: "Aprobación", value: `${passRate}%`, detail: `${aptos + aptosObs} de ${total} conductores`, color: "text-emerald-600" },
                { label: "Con seguimiento", value: String(followUpRows.length), detail: "Casos con señales de atención", color: "text-amber-600" },
                { label: "Faltas críticas", value: String(totalCritical), detail: `${criticalRows.length} conductores involucrados`, color: "text-rose-600" },
              ].map((kpi) => (
                <div key={kpi.label} className="rounded-xl border border-slate-200 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{kpi.label}</p>
                  <p className={`mt-2 text-2xl font-black ${kpi.color}`}>{kpi.value}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{kpi.detail}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-slate-900">Resultado del grupo</h3>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <p>Apto: <strong>{aptos}</strong></p>
                  <p>Observaciones: <strong>{aptosObs}</strong></p>
                  <p>No apto: <strong>{noAptos}</strong></p>
                  <p>Incompleto: <strong>{rows.filter((row) => row.verdict === "INCOMPLETO").length}</strong></p>
                  <p>No realizado: <strong>{rows.filter((row) => row.verdict === "NO REALIZADO").length}</strong></p>
                  <p>Sin configurar: <strong>{rows.filter((row) => row.verdict === "SIN CONFIGURAR").length}</strong></p>
                </div>
              </section>
              <section className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-slate-900">Cobertura y desempeño</h3>
                <p className="mt-3 text-xs text-slate-600">
                  Avance de ejercicios: <strong>{exerciseTotals.completed} de {exerciseTotals.expected}</strong>
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-indigo-600" style={{ width: `${completionRate}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {exerciseTotals.expected > 0 ? `${completionRate}% completado` : "Sin ejercicios configurados"}
                </p>
                <p className="mt-3 text-[11px] text-slate-500">
                  {evaluatedCount > 0
                    ? `Mediana: ${medianScore}/10 · Rango: ${evaluatedScores[0]}–${evaluatedScores[evaluatedScores.length - 1]}`
                    : "Sin calificaciones disponibles"}
                </p>
              </section>
            </div>

            <section className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
              <h3 className="text-sm font-bold text-indigo-700">Lectura ejecutiva</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-700">{insight}</p>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-bold text-slate-900">Prioridades de acción</h3>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full min-w-140 text-left text-xs">
                  <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Señal</th>
                      <th className="px-3 py-2 text-center">Casos</th>
                      <th className="px-3 py-2">Acción sugerida</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {actionRows.map((item) => (
                      <tr key={item.label}>
                        <td className="px-3 py-3 font-semibold text-slate-800">{item.label}</td>
                        <td className="px-3 py-3 text-center font-bold text-slate-700">{item.count}</td>
                        <td className="px-3 py-3 leading-relaxed text-slate-600">{item.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-bold text-slate-900">Ejercicios realizados</h3>
              {exercises.length === 0 ? (
                <p className="text-xs text-slate-500">No se encontraron ejercicios realizados con los filtros seleccionados.</p>
              ) : (
                <ul className="space-y-2">
                  {exercises.map((exercise, index) => (
                    <li key={`${exercise.phase}-${exercise.name}-${index}`} className="border-l-2 border-indigo-500 pl-3">
                      <p className="text-xs font-semibold text-slate-800">
                        {exercise.phase > 0 ? `${getPhaseName(exercise.phase)} · ` : ""}
                        {exercise.name}
                        <span className="font-normal text-slate-500">
                          {" "}· Promedio: {exercise.avgScore}/10 · {exercise.drivers} cond.
                        </span>
                      </p>
                      {exercise.description && (
                        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{exercise.description}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <p className="border-t border-slate-200 pt-3 text-[11px] text-slate-500">
              Los conteos no son excluyentes. Consulte el Reporte Global para el detalle por conductor.
            </p>
          </article>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            Generar y descargar PDF
          </button>
        </footer>
      </section>
    </div>
  );
}
