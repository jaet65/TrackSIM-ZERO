import { useCallback, useEffect, useMemo, useState } from "react";
import DriverModal from "../components/DriverModal";
import { useAuth } from "../components/AuthProvider";
import {
  listReportExercises,
  overallSummaries,
  type DriverOverallSummary,
} from "../lib/db";
import {
  listGroups,
  retryCloudExport,
  type GroupDoc,
} from "../lib/groups";
import { downloadBulkReportsZip } from "../lib/pdfExport";

export default function History() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<GroupDoc[]>([]);
  const [groupAverages, setGroupAverages] = useState<Record<string, number>>({});
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [drivers, setDrivers] = useState<DriverOverallSummary[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [retryingGroupId, setRetryingGroupId] = useState<string | null>(null);
  const [exportingGroupId, setExportingGroupId] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadGroups = useCallback(async () => {
    setError("");
    try {
      const allGroups = await listGroups();
      const closedGroups = allGroups.filter((group) => group.status === "closed");
      setGroups(closedGroups);
      setSelectedGroupId((current) =>
        closedGroups.some((group) => group.id === current) ? current : ""
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el historial.");
    } finally {
      setLoadingGroups(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
    const handleRefresh = () => void loadGroups();
    window.addEventListener("tracksim:firestore-data-refreshed", handleRefresh);
    return () => window.removeEventListener("tracksim:firestore-data-refreshed", handleRefresh);
  }, [loadGroups]);

  useEffect(() => {
    if (groups.length === 0) {
      setGroupAverages({});
      return;
    }

    let active = true;
    overallSummaries({ includeClosed: true })
      .then((summaries) => {
        if (!active) return;
        const totals = new Map<string, { score: number; count: number }>();
        for (const summary of summaries) {
          if (!summary.groupId) continue;
          const current = totals.get(summary.groupId) ?? { score: 0, count: 0 };
          current.score += summary.avgScore;
          current.count++;
          totals.set(summary.groupId, current);
        }
        setGroupAverages(Object.fromEntries(
          [...totals].map(([groupId, total]) => [
            groupId,
            Math.round((total.score / total.count) * 10) / 10,
          ])
        ));
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los promedios finales.");
        }
      });

    return () => {
      active = false;
    };
  }, [groups]);

  useEffect(() => {
    if (!selectedGroupId) {
      setDrivers([]);
      return;
    }
    let active = true;
    setLoadingDrivers(true);
    setError("");
    overallSummaries({ groupId: selectedGroupId })
      .then((summaries) => {
        if (active) setDrivers(summaries);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar las evaluaciones del grupo.");
      })
      .finally(() => {
        if (active) setLoadingDrivers(false);
      });
    return () => {
      active = false;
    };
  }, [selectedGroupId]);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );
  const selectedDriverIndex = drivers.findIndex((driver) => driver.driverId === selectedDriverId);
  const handleRetryExport = async (group: GroupDoc) => {
    setRetryingGroupId(group.id);
    setError("");
    setSuccess("");
    try {
      const result = await retryCloudExport(group.id, {
        name: user?.displayName || user?.email || "",
        email: user?.email || "",
      });
      setSuccess(`Exportación a CLOUD de «${group.name}» completada (${result.exportedCount} expedientes).`);
      await loadGroups();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "No se pudo exportar el grupo a CLOUD.");
    } finally {
      setRetryingGroupId(null);
    }
  };

  const handleExportZip = async (group: GroupDoc) => {
    if (exportingGroupId) return;
    setExportingGroupId(group.id);
    setExportProgress(null);
    setError("");
    setSuccess("");
    try {
      const filter = { groupId: group.id, includeClosed: true };
      const summaries = await overallSummaries(filter);
      const rows = summaries.map((driver) => ({
        driverId: driver.driverId,
        groupId: driver.groupId,
        driver: driver.driver,
        badgeText: `${driver.phasesEvaluated} de ${driver.expectedPhases} fases`,
        exercisesText: `${driver.totalExercises}/${driver.expectedExercises} ejercicio(s)`,
        progressValue: driver.totalExercises,
        isIncomplete: driver.totalExercises < driver.expectedExercises,
        errors: driver.totalErrors,
        criticalErrors: driver.criticalErrors,
        avgScore: driver.avgScore,
        verdict: driver.verdict,
        color: driver.color,
        lastDate: driver.lastDate,
        lastCreatedAt: driver.lastCreatedAt,
      }));
      if (rows.length === 0) {
        setError(`El grupo «${group.name}» no tiene evaluaciones para exportar.`);
        return;
      }

      const total = rows.length;
      const promedio = Math.round(
        (rows.reduce((sum, row) => sum + row.avgScore, 0) / total) * 10,
      ) / 10;
      const aptos = rows.filter(
        (row) => row.verdict.toUpperCase().includes("APTO") && !row.verdict.toUpperCase().includes("NO"),
      ).length;
      const noAptos = rows.filter((row) => row.verdict.toUpperCase().includes("NO APTO")).length;
      const exercises = await listReportExercises(filter);

      await downloadBulkReportsZip(
        rows,
        `Grupo: ${group.name} · Promedio General (Todas las fases) · Histórico completo`,
        { total, promedio, aptos, noAptos },
        (current, totalRows) => setExportProgress({ current, total: totalRows }),
        filter,
        group.name,
        exercises,
      );
      setSuccess(`ZIP de expedientes de «${group.name}» descargado.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "No se pudo generar el ZIP de expedientes.");
    } finally {
      setExportingGroupId(null);
      setExportProgress(null);
    }
  };

  return (
    <main className="w-full space-y-6 px-4 py-8 sm:px-8 xl:px-12">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Historial</h1>
          <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
            Grupos cerrados
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Consulta grupos finalizados y revisa los expedientes congelados de sus conductores.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">
          {success}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-bold text-slate-800">Grupos finalizados</h2>
          <span className="text-xs text-slate-500">{groups.length} grupo(s)</span>
        </div>
        {loadingGroups ? (
          <div className="py-12 text-center text-xs text-slate-500">Cargando historial…</div>
        ) : groups.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            Aún no hay grupos cerrados. Los grupos aparecerán aquí al cerrarse.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-xs text-slate-600">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Grupo</th>
                  <th className="px-4 py-3">Cerrado</th>
                  <th className="px-4 py-3">Conductores</th>
                  <th className="px-4 py-3">Promedio final</th>
                  <th className="px-4 py-3">Exportación CLOUD</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groups.map((group) => (
                  <tr key={group.id} className={selectedGroupId === group.id ? "bg-indigo-50/50" : "hover:bg-slate-50/60"}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{group.name}</div>
                      {group.description && <div className="mt-0.5 text-[11px] text-slate-500">{group.description}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {group.closedAt ? new Date(group.closedAt).toLocaleDateString("es-MX", { dateStyle: "medium" }) : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono">{group.driverCount ?? "—"}</td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">
                      {groupAverages[group.id] !== undefined ? `${groupAverages[group.id]}/10` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {group.cloudExportStatus === "complete"
                        ? <span className="font-semibold text-emerald-700">☁️ Exportado ({group.cloudExportCount ?? 0})</span>
                        : group.cloudExportStatus === "pending"
                          ? <span className="font-semibold text-amber-700">☁️ Exportando…</span>
                          : group.cloudExportStatus === "error"
                            ? <span className="font-semibold text-rose-700" title={group.cloudExportError || "Error de exportación"}>☁️ Error</span>
                            : <span className="text-slate-500">☁️ Sin exportar</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedGroupId((current) => current === group.id ? "" : group.id)}
                          className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                        >
                          {selectedGroupId === group.id ? "Ocultar conductores" : "Ver conductores"}
                        </button>
                        <button
                          type="button"
                          disabled={exportingGroupId !== null}
                          onClick={() => void handleExportZip(group)}
                          className="rounded-lg border border-indigo-200 bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                          title="Descargar reporte global, resumen ejecutivo, expedientes y diplomas del grupo"
                        >
                          {exportingGroupId === group.id
                            ? `Generando ZIP${exportProgress ? ` (${exportProgress.current}/${exportProgress.total})` : "…"}`
                            : "Descargar ZIP"}
                        </button>
                        {group.cloudExportStatus !== "pending" && (
                          <button
                            type="button"
                            disabled={retryingGroupId === group.id}
                            onClick={() => void handleRetryExport(group)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {retryingGroupId === group.id ? "Exportando…" : "☁️ Reintentar"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedGroup && (
        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-bold text-slate-800">Expedientes · {selectedGroup.name}</h2>
            <p className="mt-1 text-xs text-slate-500">Selecciona un conductor para consultar su expediente congelado.</p>
          </div>
          {loadingDrivers ? (
            <div className="py-10 text-center text-xs text-slate-500">Cargando conductores…</div>
          ) : drivers.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">Este grupo no tiene expedientes registrados.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs text-slate-600">
                <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Conductor</th>
                    <th className="px-4 py-3">Ejercicios</th>
                    <th className="px-4 py-3">Errores críticos</th>
                    <th className="px-4 py-3 text-right">Calificación final</th>
                    <th className="px-4 py-3 text-right">Dictamen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {drivers.map((driver) => (
                    <tr
                      key={driver.driverId}
                      onClick={() => setSelectedDriverId(driver.driverId)}
                      className="cursor-pointer hover:bg-indigo-50/40"
                    >
                      <td className="px-4 py-3 font-semibold text-slate-900">{driver.driver}</td>
                      <td className="px-4 py-3">{driver.totalExercises}/{driver.expectedExercises}</td>
                      <td className="px-4 py-3">{driver.criticalErrors}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">{driver.avgScore}/10</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${driver.color}`}>
                          {driver.verdict}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {selectedGroup && selectedDriverId && (
        <DriverModal
          isOpen
          driverId={selectedDriverId}
          groupId={selectedGroup.id}
          onClose={() => setSelectedDriverId(null)}
          onNavigatePrev={() => {
            if (selectedDriverIndex > 0) setSelectedDriverId(drivers[selectedDriverIndex - 1].driverId);
          }}
          onNavigateNext={() => {
            if (selectedDriverIndex >= 0 && selectedDriverIndex < drivers.length - 1) {
              setSelectedDriverId(drivers[selectedDriverIndex + 1].driverId);
            }
          }}
          hasPrev={selectedDriverIndex > 0}
          hasNext={selectedDriverIndex >= 0 && selectedDriverIndex < drivers.length - 1}
          currentIndex={selectedDriverIndex >= 0 ? selectedDriverIndex : undefined}
          totalDrivers={drivers.length}
        />
      )}
    </main>
  );
}
