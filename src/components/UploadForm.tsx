import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { decodeCsv, parseReport } from "../lib/parse";
import { saveEvaluation } from "../lib/db";
import { loadCatalog } from "../lib/catalogStore";
import { loadExercises, phaseForExercise } from "../lib/exercises";
import {
  getActiveGroupId,
  getGroup,
  listGroups,
  createGroup,
  setActiveGroupId,
  type GroupDoc,
} from "../lib/groups";
import { useAuth } from "./AuthProvider";
import SimulatorSyncModal from "./SimulatorSyncModal";
import ConfigureExercisesModal from "./ConfigureExercisesModal";
import { isElectronApp } from "../lib/streamdbClient";

const GITHUB_OWNER = "jaet65";
const GITHUB_REPO = "TrackSIM-ZERO";
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

type Result = {
  file: string;
  phase?: number;
  status: string;
  driver?: string;
  errors?: number;
  score?: number;
  message?: string;
  uncataloged?: string[];
};

export default function UploadForm({
  selectedGroupId,
  onDone,
}: {
  selectedGroupId?: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
    percent: number;
  } | null>(null);
  const { user } = useAuth();
  const [results, setResults] = useState<Result[]>([]);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [fileCount, setFileCount] = useState<number>(0);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showDesktopModal, setShowDesktopModal] = useState(false);
  const [activeGroup, setActiveGroup] = useState<GroupDoc | null>(null);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const isDesktop = isElectronApp();

  // Modal para abrir / crear grupo directamente
  const [showOpenGroupModal, setShowOpenGroupModal] = useState(false);
  const [openGroupsList, setOpenGroupsList] = useState<GroupDoc[]>([]);
  const [selectedExistingGroupId, setSelectedExistingGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [newGroupType, setNewGroupType] = useState<"escuela" | "curso">("escuela");
  const [sourceGroupId, setSourceGroupId] = useState("");
  const [allGroupsList, setAllGroupsList] = useState<GroupDoc[]>([]);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState("");

  // Modal para configurar ejercicios si no han sido definidos
  const [showConfigExercisesModal, setShowConfigExercisesModal] = useState(false);

  const refreshActiveGroup = async (explicitGroupId?: string) => {
    setLoadingGroup(true);
    const grpId = explicitGroupId !== undefined ? explicitGroupId : getActiveGroupId();
    if (grpId) {
      try {
        const grp = await getGroup(grpId);
        if (grp && grp.status === "open") {
          setActiveGroup(grp);
        } else {
          setActiveGroup(null);
        }
      } catch {
        setActiveGroup(null);
      }
    } else {
      setActiveGroup(null);
    }
    setLoadingGroup(false);
  };

  useEffect(() => {
    refreshActiveGroup(selectedGroupId);
  }, [selectedGroupId]);

  const handleLaunchDesktopApp = () => {
    let appLaunched = false;
    const onBlur = () => {
      appLaunched = true;
    };
    window.addEventListener("blur", onBlur, { once: true });

    // Invoca el protocolo personalizado registrado por el instalador NSIS
    window.location.href = "tracksim://open";

    // Si tras 1.2s la ventana no perdió el foco, el protocolo no está instalado -> mostramos el modal de descarga
    setTimeout(() => {
      window.removeEventListener("blur", onBlur);
      if (!appLaunched && document.visibilityState === "visible") {
        setShowDesktopModal(true);
      }
    }, 1200);
  };

  const handleOpenModal = async () => {
    setModalError("");
    setModalBusy(true);
    setShowOpenGroupModal(true);
    try {
      const all = await listGroups();
      setAllGroupsList(all);
      const openOnly = all.filter((g) => g.status === "open");
      setOpenGroupsList(openOnly);
      if (openOnly.length > 0) {
        setSelectedExistingGroupId(openOnly[0].id);
        setIsCreatingNew(false);
      } else {
        setIsCreatingNew(true);
      }
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setModalBusy(false);
    }
  };

  const handleConfirmGroupSelection = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalBusy(true);
    setModalError("");

    try {
      if (isCreatingNew) {
        if (!newGroupName.trim()) throw new Error("Ingresa el nombre del nuevo grupo.");
        const created = await createGroup(
          newGroupName,
          newGroupDesc,
          {
            name: user?.displayName || user?.email || "",
            email: user?.email || "",
          },
          sourceGroupId || null,
          newGroupType
        );
        setActiveGroup(created);
      } else {
        if (!selectedExistingGroupId) throw new Error("Selecciona un grupo existente.");
        const chosen = openGroupsList.find((g) => g.id === selectedExistingGroupId);
        if (chosen) {
          setActiveGroupId(chosen.id);
          setActiveGroup(chosen);
        }
      }
      setShowOpenGroupModal(false);
      setNewGroupName("");
      setNewGroupDesc("");
      setNewGroupType("escuela");
      setSourceGroupId("");
      onDone();
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setModalBusy(false);
    }
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeGroup) {
      handleOpenModal();
      return;
    }

    const form = e.currentTarget;
    const files = Array.from(new FormData(form).getAll("files")).filter((f): f is File => f instanceof File);
    if (!files.length) return;

    // Verificar si el grupo activo ya tiene ejercicios configurados
    try {
      const currentExercises = await loadExercises(false, activeGroup.id);
      const totalExercisesConfigured = Object.values(currentExercises || {}).reduce(
        (acc, list) => acc + (list?.length || 0),
        0
      );
      if (totalExercisesConfigured === 0) {
        setShowConfigExercisesModal(true);
        return;
      }
    } catch (e) {
      console.warn("No se pudieron verificar los ejercicios del grupo:", e);
    }

    setBusy(true);
    setUploadProgress({ current: 0, total: files.length, percent: 0 });
    const out: Result[] = [];

    try {
      await Promise.all([
        loadCatalog(false, activeGroup.id),
        loadExercises(false, activeGroup.id),
      ]);
    } catch {}

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const report = parseReport(decodeCsv(await f.arrayBuffer()), activeGroup.id);
        const phase = phaseForExercise(report.exercise, activeGroup.id);
        if (!phase) throw new Error(`La unidad «${report.exercise}» no está en el catálogo de ejercicios del grupo «${activeGroup.name}».`);
        
        const status = await saveEvaluation(
          phase,
          f.name,
          report,
          {
            name: user?.displayName || user?.email || "",
            email: user?.email ?? "",
          },
          activeGroup.id
        );
        out.push({
          file: f.name,
          phase,
          status,
          driver: report.driver,
          errors: report.errorCount,
          score: report.score,
          uncataloged: report.uncataloged,
        });
      } catch (err) {
        out.push({ file: f.name, status: "error", message: (err as Error).message });
      }
      const completed = i + 1;
      setUploadProgress({
        current: completed,
        total: files.length,
        percent: Math.round((completed / files.length) * 100),
      });
    }
    setResults(out);
    setShowResultsModal(true);
    form.reset();
    setFileCount(0);
    setBusy(false);
    setUploadProgress(null);
    onDone();
  }

  // SI NO HAY GRUPO ACTIVO: Se oculta toda la sección de carga y se muestra el botón para Abrir Grupo
  if (!activeGroup && !loadingGroup) {
    return (
      <>
        <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-white to-blue-50/60 p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-600/30 shrink-0">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Iniciar Sesión de Evaluación</h3>
                <p className="text-xs text-slate-500">
                  Abre o selecciona un grupo de trabajo para habilitar la carga de archivos CSV y sincronización con Lander DB.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleOpenModal}
              className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-3 text-xs font-bold text-white shadow-md shadow-indigo-600/25 hover:from-indigo-700 hover:to-blue-700 active:scale-98 transition shrink-0"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Abrir Grupo de Trabajo</span>
            </button>
          </div>
        </div>

        {/* Modal Directo: Abrir Grupo */}
        {showOpenGroupModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-900">Abrir Grupo de Evaluación</h3>
                <button
                  onClick={() => setShowOpenGroupModal(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  ✕
                </button>
              </div>

              {modalError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
                  {modalError}
                </div>
              )}

              <form onSubmit={handleConfirmGroupSelection} className="space-y-4">
                {openGroupsList.length > 0 && (
                  <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setIsCreatingNew(false)}
                      className={`flex-1 rounded-lg py-1.5 transition ${
                        !isCreatingNew
                          ? "bg-white text-indigo-700 shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Elegir Existente
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreatingNew(true)}
                      className={`flex-1 rounded-lg py-1.5 transition ${
                        isCreatingNew
                          ? "bg-white text-indigo-700 shadow-xs"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      Crear Nuevo
                    </button>
                  </div>
                )}

                {!isCreatingNew && openGroupsList.length > 0 ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Selecciona un grupo abierto:
                    </label>
                    <select
                      value={selectedExistingGroupId}
                      onChange={(e) => setSelectedExistingGroupId(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      {openGroupsList.map((g) => (
                        <option key={g.id} value={g.id}>
                          🟢 {g.name} (Creado: {new Date(g.createdAt).toLocaleDateString("es-MX")})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Nombre del Grupo *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Ej. Generación Octubre 2026"
                        value={newGroupName}
                        onChange={(e) => setNewGroupName(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Descripción (Opcional)
                      </label>
                      <input
                        type="text"
                        placeholder="Observaciones o sede..."
                        value={newGroupDesc}
                        onChange={(e) => setNewGroupDesc(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Modalidad del Catálogo *
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setNewGroupType("escuela")}
                          className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition ${
                            newGroupType === "escuela"
                              ? "border-indigo-600 bg-indigo-50/70 text-indigo-900 ring-1 ring-indigo-600"
                              : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                          }`}
                        >
                          <span className="text-xs font-bold flex items-center gap-1">
                            🏫 Escuela
                          </span>
                          <span className="text-[10px] text-slate-500 mt-0.5">
                            Estructura de 6 Fases
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setNewGroupType("curso")}
                          className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition ${
                            newGroupType === "curso"
                              ? "border-indigo-600 bg-indigo-50/70 text-indigo-900 ring-1 ring-indigo-600"
                              : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                          }`}
                        >
                          <span className="text-xs font-bold flex items-center gap-1">
                            🎯 Curso
                          </span>
                          <span className="text-[10px] text-slate-500 mt-0.5">
                            Sin fases (directo)
                          </span>
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Reglas iniciales (Errores y Ejercicios)
                      </label>
                      <select
                        value={sourceGroupId}
                        onChange={(e) => setSourceGroupId(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">🌐 Copiar de Plantilla Global (Por defecto)</option>
                        {allGroupsList.map((g) => (
                          <option key={g.id} value={g.id}>
                            📋 Copiar reglas de «{g.name}»
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    disabled={modalBusy}
                    onClick={() => setShowOpenGroupModal(false)}
                    className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={modalBusy}
                    className="rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50 transition"
                  >
                    {modalBusy ? "Guardando..." : "Abrir Grupo"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </>
    );
  }

  // SI HAY GRUPO ACTIVO: Se muestra la barra de carga normal y el grupo asociado
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-4">
      {activeGroup && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-slate-800">
              Grupo de Trabajo Activo: <span className="text-indigo-600 font-extrabold">{activeGroup.name}</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            {results.length > 0 && (
              <button
                type="button"
                onClick={() => setShowResultsModal(true)}
                className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 underline"
              >
                Ver último registro ({results.length})
              </button>
            )}
            <Link
              to="/grupos"
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 underline"
            >
              Administrar Grupos
            </Link>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-1.5 sm:flex-row sm:items-center">
          <label className="relative flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-2.5 text-xs font-medium text-slate-700 hover:border-indigo-500 hover:bg-indigo-50/40 transition">
            <svg className="h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>
              {fileCount > 0
                ? `${fileCount} archivo(s) seleccionado(s)`
                : "Seleccionar archivos CSV del simulador"}
            </span>
            <input
              type="file"
              name="files"
              accept=".csv"
              multiple
              required
              disabled={busy}
              className="sr-only"
              onChange={(e) => setFileCount(e.target.files?.length || 0)}
            />
          </label>
          <span className="text-[11px] text-slate-500">
            Detección inteligente de fase automática según el catálogo de ejercicios.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isDesktop ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowSyncModal(true)}
              className="flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-xs"
            >
              <svg className="h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7M4 7c0-2 1.5-3 3.5-3h9c2 0 3.5 1 3.5 3M4 7h16m-5 4h.01M9 15h6" />
              </svg>
              <span>Sincronizar Lander DB</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={handleLaunchDesktopApp}
              className="flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-4 py-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-xs"
              title="Abrir la versión de escritorio para sincronizar con Lander DB o descargar el instalador"
            >
              <svg className="h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span>Abrir App de Escritorio</span>
            </button>
          )}

          <button
            type="submit"
            disabled={busy || fileCount === 0}
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm shadow-indigo-600/20 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {busy ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>
                  Procesando telemetría…{" "}
                  {uploadProgress
                    ? `${uploadProgress.percent}% (${uploadProgress.current}/${uploadProgress.total})`
                    : "0%"}
                </span>
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>Subir y Evaluar CSV</span>
              </>
            )}
          </button>
        </div>
      </form>

      {isDesktop && (
        <SimulatorSyncModal
          isOpen={showSyncModal}
          onClose={() => setShowSyncModal(false)}
          onSyncComplete={() => {
            onDone();
          }}
        />
      )}

      {/* Modal de configuración obligatoria de ejercicios si el grupo está vacío */}
      <ConfigureExercisesModal
        isOpen={showConfigExercisesModal}
        onClose={() => setShowConfigExercisesModal(false)}
        group={activeGroup}
        onSaved={async () => {
          if (activeGroup) {
            await loadExercises(true, activeGroup.id);
          }
        }}
      />

      {/* Modal para versión Web: Abrir App de Escritorio o Descargar Instalador */}
      {!isDesktop && showDesktopModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-600/25">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">TrackSIM ZERO para Escritorio</h3>
                  <p className="text-xs text-slate-500">
                    Conexión directa a Lander DB sin depender de Python
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDesktopModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3.5 text-xs text-slate-700 space-y-2">
              <p className="font-semibold text-indigo-950">
                1. ¿Ya tienes instalada la aplicación en esta PC?
              </p>
              <p className="text-slate-600">
                Si tu navegador mostró el aviso <strong>«¿Abrir TrackSIM ZERO?»</strong>, confírmalo para iniciar la aplicación.
              </p>
              <a
                href="tracksim://open"
                className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-2xs hover:bg-indigo-50 transition"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Volver a intentar abrir TrackSIM ZERO
              </a>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-3">
              <div>
                <p className="font-semibold text-slate-900">
                  2. ¿No tienes instalado TrackSIM ZERO en esta PC?
                </p>
                <p className="mt-0.5 text-slate-500">
                  Descarga e instala la versión de escritorio para Windows (incluye sincronización nativa con PostgreSQL Lander DB y actualizaciones automáticas).
                </p>
              </div>

              <a
                href={GITHUB_RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-600/25 hover:from-indigo-700 hover:to-blue-700 transition"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Descargar Instalador para Windows (.exe)</span>
              </a>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowDesktopModal(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Directo: Cambiar / Abrir Grupo */}
      {showOpenGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Cambiar Grupo Activo</h3>
              <button
                onClick={() => setShowOpenGroupModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
                {modalError}
              </div>
            )}

            <form onSubmit={handleConfirmGroupSelection} className="space-y-4">
              {openGroupsList.length > 0 && (
                <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setIsCreatingNew(false)}
                    className={`flex-1 rounded-lg py-1.5 transition ${
                      !isCreatingNew
                        ? "bg-white text-indigo-700 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Elegir Existente
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreatingNew(true)}
                    className={`flex-1 rounded-lg py-1.5 transition ${
                      isCreatingNew
                        ? "bg-white text-indigo-700 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Crear Nuevo
                  </button>
                </div>
              )}

              {!isCreatingNew && openGroupsList.length > 0 ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Selecciona un grupo abierto:
                  </label>
                  <select
                    value={selectedExistingGroupId}
                    onChange={(e) => setSelectedExistingGroupId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {openGroupsList.map((g) => (
                      <option key={g.id} value={g.id}>
                        🟢 {g.name} (Creado: {new Date(g.createdAt).toLocaleDateString("es-MX")})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nombre del Grupo *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej. Generación Octubre 2026"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Descripción (Opcional)
                    </label>
                    <input
                      type="text"
                      placeholder="Observaciones o sede..."
                      value={newGroupDesc}
                      onChange={(e) => setNewGroupDesc(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Modalidad del Catálogo *
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setNewGroupType("escuela")}
                        className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition ${
                          newGroupType === "escuela"
                            ? "border-indigo-600 bg-indigo-50/70 text-indigo-900 ring-1 ring-indigo-600"
                            : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        <span className="text-xs font-bold flex items-center gap-1">
                          🏫 Escuela
                        </span>
                        <span className="text-[10px] text-slate-500 mt-0.5">
                          Estructura de 6 Fases
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setNewGroupType("curso")}
                        className={`flex flex-col items-start p-2.5 rounded-xl border text-left transition ${
                          newGroupType === "curso"
                            ? "border-indigo-600 bg-indigo-50/70 text-indigo-900 ring-1 ring-indigo-600"
                            : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                        }`}
                      >
                        <span className="text-xs font-bold flex items-center gap-1">
                          🎯 Curso
                        </span>
                        <span className="text-[10px] text-slate-500 mt-0.5">
                          Sin fases (directo)
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={modalBusy}
                  onClick={() => setShowOpenGroupModal(false)}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={modalBusy}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50 transition"
                >
                  {modalBusy ? "Guardando..." : "Aplicar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Registro de Carga al finalizar el procesamiento */}
      {showResultsModal && results.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Registro de Carga ({results.length} {results.length === 1 ? "archivo" : "archivos"})
                </h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 font-semibold text-emerald-700 border border-emerald-200">
                    ✓ {results.filter((r) => r.status === "saved").length} guardados
                  </span>
                  {results.some((r) => r.status === "duplicate") && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-600 border border-slate-200">
                      • {results.filter((r) => r.status === "duplicate").length} omitidos (duplicados)
                    </span>
                  )}
                  {results.some((r) => r.status === "error") && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 font-semibold text-rose-700 border border-rose-200">
                      ✕ {results.filter((r) => r.status === "error").length} con error
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowResultsModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                title="Cerrar ventana"
              >
                ✕
              </button>
            </div>

            <div className="my-4 flex-1 overflow-y-auto pr-1">
              <ul className="space-y-2 text-xs">
                {results.map((r) => (
                  <li
                    key={r.file}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-slate-800 font-medium break-all">{r.file}</span>
                      <div>
                        {r.status === "saved" && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Fase {r.phase} · {r.driver} (Calif: {r.score}, {r.errors} errores)
                          </span>
                        )}
                        {r.status === "duplicate" && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-200/80 px-2.5 py-0.5 text-[11px] text-slate-600">
                            Ya cargado previamente (omitido)
                          </span>
                        )}
                        {r.status === "error" && (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700 border border-rose-200">
                            {r.message}
                          </span>
                        )}
                      </div>
                    </div>
                    {!!r.uncataloged?.length && (
                      <div className="mt-2 rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-800 border border-amber-200">
                        ⚠️ Errores sin catalogar (evaluados por defecto como moderados): {r.uncataloged.join("; ")}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => {
                  setResults([]);
                  setShowResultsModal(false);
                }}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition"
              >
                Limpiar registro
              </button>
              <button
                type="button"
                onClick={() => setShowResultsModal(false)}
                className="rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:from-indigo-700 hover:to-blue-700 transition"
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
