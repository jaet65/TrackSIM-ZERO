import { useState, useEffect } from "react";
import {
  checkStreamDBStatus,
  countSimulatorSessions,
  extractSimulatorSessions,
  saveStreamDBConfig,
  type StreamDBStatus,
} from "../lib/streamdbClient";
import { parseReport } from "../lib/parse";
import { saveEvaluation } from "../lib/db";
import { loadCatalog } from "../lib/catalogStore";
import { loadExercises, phaseForExercise } from "../lib/exercises";
import { getActiveGroupId, getGroup, type GroupDoc } from "../lib/groups";
import { useAuth } from "./AuthProvider";

export default function SimulatorSyncModal({
  isOpen,
  onClose,
  onSyncComplete,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSyncComplete: () => void;
}) {
  const { user } = useAuth();
  const today = new Date().toISOString().split("T")[0];

  const [status, setStatus] = useState<StreamDBStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [includeAnon, setIncludeAnon] = useState(false);

  // Verificación y conteo previo
  const [counting, setCounting] = useState(false);
  const [countResult, setCountResult] = useState<{ total: number; min_date?: string | null; max_date?: string | null } | null>(null);
  const [countError, setCountError] = useState("");

  // Progreso de extracción e ingesta
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; detail: string } | null>(null);
  const [syncSummary, setSyncSummary] = useState<{ saved: number; duplicate: number; failed: number } | null>(null);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);

  // Configuración de host/puerto (modal o acordeón)
  const [showConfig, setShowConfig] = useState(false);
  const [dbHost, setDbHost] = useState("");
  const [dbPort, setDbPort] = useState("5496");
  const [dbUser, setDbUser] = useState("administrator");
  const [dbPass, setDbPass] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState("");

  // Grupo Activo
  const [activeGroup, setActiveGroup] = useState<GroupDoc | null>(null);

  useEffect(() => {
    if (isOpen) {
      refreshStatus();
      const grpId = getActiveGroupId();
      if (grpId) {
        getGroup(grpId).then((g) => {
          if (g && g.status === "open") setActiveGroup(g);
          else setActiveGroup(null);
        }).catch(() => setActiveGroup(null));
      } else {
        setActiveGroup(null);
      }
    }
  }, [isOpen]);

  async function refreshStatus() {
    setCheckingStatus(true);
    setCountResult(null);
    setCountError("");
    const st = await checkStreamDBStatus();
    setStatus(st);
    if (st.config) {
      setDbHost(st.config.host || "");
      setDbPort(st.config.port || "5496");
      setDbUser(st.config.user || "administrator");
    }
    setCheckingStatus(false);
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    setSavingConfig(true);
    setConfigMessage("");
    const res = await saveStreamDBConfig({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPass,
    });
    if (res.ok) {
      setConfigMessage("✅ Configuración guardada. Verificando...");
      await refreshStatus();
    } else {
      setConfigMessage(`❌ Error: ${res.error}`);
    }
    setSavingConfig(false);
  }

  async function handleVerifyCount() {
    setCounting(true);
    setCountError("");
    setCountResult(null);
    try {
      const res = await countSimulatorSessions(startDate, endDate, includeAnon);
      setCountResult({
        total: res.total,
        min_date: res.min_date,
        max_date: res.max_date,
      });
    } catch (err) {
      setCountError((err as Error).message);
    } finally {
      setCounting(false);
    }
  }

  async function handleStartSync() {
    if (!activeGroup) {
      alert("No hay un Grupo Activo seleccionado. Selecciona o crea un grupo antes de sincronizar.");
      return;
    }

    setSyncing(true);
    setProgress({ current: 0, total: 1, detail: "Consultando sesiones en el simulador..." });
    setSyncSummary(null);
    setSyncLogs([]);

    try {
      await Promise.all([loadCatalog(), loadExercises()]);
      
      const extract = await extractSimulatorSessions(startDate, endDate, includeAnon);
      if (!extract.ok) throw new Error(extract.error || "Fallo en la extracción");

      const sessions = extract.sessions || [];
      if (!sessions.length) {
        setProgress(null);
        setSyncSummary({ saved: 0, duplicate: 0, failed: 0 });
        setSyncLogs(["No se encontraron sesiones para extraer en el rango seleccionado."]);
        setSyncing(false);
        return;
      }

      let saved = 0;
      let duplicate = 0;
      let failed = 0;
      const logs: string[] = [];

      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        setProgress({
          current: i + 1,
          total: sessions.length,
          detail: `Procesando (${i + 1}/${sessions.length}): ${s.driver || "Sesión " + s.id}`,
        });

        if (s.error || !s.csv) {
          failed++;
          logs.push(`❌ Sesión #${s.id} (${s.driver}): Error de exportación - ${s.error}`);
          continue;
        }

        try {
          const report = parseReport(s.csv);
          const phase = phaseForExercise(report.exercise);
          if (!phase) {
            failed++;
            logs.push(`⚠️ Sesión #${s.id} (${report.driver}): Ejercicio «${report.exercise}» no catalogado.`);
            continue;
          }

          const activeGrpId = getActiveGroupId() || undefined;
          const saveStatus = await saveEvaluation(
            phase,
            s.filename,
            report,
            {
              name: user?.displayName || user?.email || "Sincronizador Lander",
              email: user?.email || "",
            },
            activeGrpId
          );

          if (saveStatus === "saved") {
            saved++;
            logs.push(`✅ [Fase ${phase}] ${report.driver} - ${report.exercise} (Calif: ${report.score})`);
          } else {
            duplicate++;
            logs.push(`ℹ️ ${s.filename} ya estaba registrado en Firestore.`);
          }
        } catch (procErr) {
          failed++;
          logs.push(`❌ Error procesando ${s.filename}: ${(procErr as Error).message}`);
        }
      }

      setSyncSummary({ saved, duplicate, failed });
      setSyncLogs(logs);
      onSyncComplete();
    } catch (err) {
      setSyncLogs((prev) => [...prev, `❌ Error general de sincronización: ${(err as Error).message}`]);
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        {/* Header Modal */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-slate-50 to-indigo-50/30 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-600/30">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7M4 7c0-2 1.5-3 3.5-3h9c2 0 3.5 1 3.5 3M4 7h16m-5 4h.01M9 15h6" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Sincronización Directa Lander DB</h2>
              <p className="text-xs text-slate-500">Conexión con la base de datos del simulador en red</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={syncing}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Indicador de Grupo Activo */}
          {!activeGroup ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <svg className="h-5 w-5 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="text-xs text-amber-900">
                  <span className="font-bold block">Sincronización Bloqueada</span>
                  Debes seleccionar o crear un Grupo Activo antes de sincronizar datos con Lander DB.
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Asignando evaluaciones al grupo: <strong className="text-indigo-600 font-bold">{activeGroup.name}</strong></span>
              </div>
            </div>
          )}
          {/* Tarjeta de Estado del Servicio y BD */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-3 w-3 rounded-full ${
                    status?.service === "running"
                      ? status.db_connected
                        ? "bg-emerald-500 shadow-sm shadow-emerald-500/50"
                        : "bg-amber-500 shadow-sm shadow-amber-500/50"
                      : "bg-rose-500 shadow-sm shadow-rose-500/50"
                  }`}
                />
                <span className="text-xs font-bold text-slate-800">
                  {status?.service === "running"
                    ? status.db_connected
                      ? "Conectado a la BD Lander"
                      : "Servicio activo · Sin conexión a la BD Lander"
                    : "Servicio local detenido"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={refreshStatus}
                  disabled={checkingStatus || syncing}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition shadow-xs"
                >
                  {checkingStatus ? "Verificando..." : "Reintentar"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfig(!showConfig)}
                  className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 transition"
                >
                  {showConfig ? "Ocultar IP" : "Configurar IP"}
                </button>
              </div>
            </div>

            {status?.service === "stopped" && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-xs text-rose-800">
                <p className="font-semibold">El servicio local no está respondiendo en el puerto 5005.</p>
                <p className="mt-1 text-[11px] text-rose-700">
                  Para iniciarlo, ejecuta el archivo <span className="font-mono font-bold">iniciar_servicio_lander.bat</span> en la carpeta del proyecto o <span className="font-mono">python local_server.py</span>.
                </p>
              </div>
            )}

            {status?.service === "running" && !status.db_connected && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-800">
                <p className="font-semibold">No se pudo contactar a la base de datos Lander:</p>
                <p className="mt-1 font-mono text-[11px] text-amber-900 bg-amber-100/50 p-1.5 rounded-lg break-all">
                  {status.error || "Timeout o rechazo de conexión en " + (status.config?.host || "192.168.153.2")}
                </p>
                <p className="mt-2 text-[11px]">
                  Verifica que la máquina esté en la misma red local que el simulador y que la IP sea accesible.
                </p>
              </div>
            )}

            {/* Formulario de Configuración IP expandible */}
            {showConfig && (
              <form onSubmit={handleSaveConfig} className="mt-3 border-t border-slate-200 pt-3 space-y-3">
                <h4 className="text-xs font-bold text-slate-800">Parámetros de Red PostgreSQL (Lander)</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-500 mb-1 font-medium">Host / IP del Simulador</label>
                    <input
                      type="text"
                      value={dbHost}
                      onChange={(e) => setDbHost(e.target.value)}
                      placeholder="192.168.153.2"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1 font-medium">Puerto</label>
                    <input
                      type="text"
                      value={dbPort}
                      onChange={(e) => setDbPort(e.target.value)}
                      placeholder="5496"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1 font-medium">Usuario</label>
                    <input
                      type="text"
                      value={dbUser}
                      onChange={(e) => setDbUser(e.target.value)}
                      placeholder="administrator"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1 font-medium">Contraseña</label>
                    <input
                      type="password"
                      value={dbPass}
                      onChange={(e) => setDbPass(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
                {configMessage && (
                  <p className="text-xs font-medium text-indigo-700">{configMessage}</p>
                )}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingConfig}
                    className="rounded-xl bg-slate-800 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 transition disabled:opacity-50"
                  >
                    {savingConfig ? "Guardando..." : "Guardar Parámetros"}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Formulario de Selección de Rango y Extracción */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Rango de Sesiones a Sincronizar
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Fecha Inicio</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setStartDate(today)}
                    className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
                  >
                    Hoy
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Fecha Fin</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setEndDate(today)}
                    className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
                  >
                    Hoy
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="includeAnon"
                checked={includeAnon}
                onChange={(e) => setIncludeAnon(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="includeAnon" className="text-xs text-slate-700 cursor-pointer">
                Incluir sesiones anónimas (conductor "anonymous" o "anónimo")
              </label>
            </div>

            {/* Botón de Comprobación Previa */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleVerifyCount}
                disabled={counting || syncing || !status?.db_connected}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {counting ? "Consultando conteo..." : "Verificar Sesiones Disponibles"}
              </button>

              {countResult && (
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
                  {countResult.total} sesión(es) encontradas
                  {countResult.min_date ? ` (${countResult.min_date} a ${countResult.max_date})` : ""}
                </span>
              )}
              {countError && (
                <span className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-xl">
                  {countError}
                </span>
              )}
            </div>
          </div>

          {/* Barra de Progreso si está en curso */}
          {syncing && progress && (
            <div className="space-y-2 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4">
              <div className="flex justify-between text-xs font-semibold text-indigo-900">
                <span>{progress.detail}</span>
                <span>
                  {progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-indigo-200/60">
                <div
                  className="h-full bg-gradient-to-r from-indigo-600 to-blue-600 transition-all duration-300"
                  style={{
                    width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Resumen de resultados */}
          {syncSummary && (
            <div className="grid grid-cols-3 gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-center">
              <div>
                <span className="block text-lg font-bold text-emerald-600">{syncSummary.saved}</span>
                <span className="text-[11px] font-medium text-slate-500">Nuevas Evaluaciones</span>
              </div>
              <div>
                <span className="block text-lg font-bold text-slate-600">{syncSummary.duplicate}</span>
                <span className="text-[11px] font-medium text-slate-500">Ya Existentes</span>
              </div>
              <div>
                <span className="block text-lg font-bold text-rose-600">{syncSummary.failed}</span>
                <span className="text-[11px] font-medium text-slate-500">Omitidas / Error</span>
              </div>
            </div>
          )}

          {/* Registro / Logs de sincronización */}
          {syncLogs.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold text-slate-600">Registro de la Sincronización:</h4>
              <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-slate-900 p-3 font-mono text-[11px] text-slate-200 space-y-1">
                {syncLogs.map((log, idx) => (
                  <div key={idx} className="leading-tight">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Modal con Acciones */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={syncing}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-xs disabled:opacity-50"
          >
            Cerrar
          </button>

          <button
            type="button"
            onClick={handleStartSync}
            disabled={syncing || !status?.db_connected || !activeGroup}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/25 hover:from-indigo-700 hover:to-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {syncing ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Sincronizando con Simulador…</span>
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Iniciar Sincronización Automática</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
