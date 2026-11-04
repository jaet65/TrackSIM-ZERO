import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../components/AuthProvider";
import { isAdminEmail } from "../lib/config";
import {
  exerciseKey,
  loadExercises,
  saveExercises,
  getExercises,
  getExerciseEnvironments,
  getExerciseDescriptions,
  getPhaseNames,
  getPhasesList,
  getGroupType,
  setGlobalTypeMemory,
  setGroupTypeMemory,
  detectEnvironmentFromName,
  type ExerciseConfig,
  type ExerciseEnvironment,
  type ExerciseEnvironmentsMap,
  type ExerciseDescriptionsMap,
  type PhaseNamesMap,
} from "../lib/exercises";
import {
  listGroups,
  getActiveGroupId,
  setActiveGroupId,
  updateGroupType,
  type GroupDoc,
  type GroupType,
} from "../lib/groups";
import { listUploadedExerciseNames } from "../lib/db";
import { exportExercisesToCsv, parseExerciseCsv, type ParsedExerciseCsvRow } from "../lib/exerciseCsv";
import PhaseAssignmentModal from "../components/PhaseAssignmentModal";

export default function Exercises() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const [groups, setGroups] = useState<GroupDoc[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(() => {
    const fromUrl = params.get("grupo");
    if (fromUrl !== null) return fromUrl;
    return getActiveGroupId() || "";
  });

  const [cfg, setCfg] = useState<ExerciseConfig | null>(null);
  const [envs, setEnvs] = useState<ExerciseEnvironmentsMap>({});
  const [descriptions, setDescriptions] = useState<ExerciseDescriptionsMap>({});
  const [phaseNamesState, setPhaseNamesState] = useState<PhaseNamesMap>({});
  const [editingPhaseNameId, setEditingPhaseNameId] = useState<number | null>(null);
  const [phaseNameInput, setPhaseNameInput] = useState("");
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [draftEnvs, setDraftEnvs] = useState<Record<number, ExerciseEnvironment>>({});
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingRules, setLoadingRules] = useState(true);
  const [copySourceId, setCopySourceId] = useState<string>("");
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);

  // Estado para Import / Export CSV
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingCsvRows, setPendingCsvRows] = useState<ParsedExerciseCsvRow[]>([]);
  const [isPhaseModalOpen, setIsPhaseModalOpen] = useState(false);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );

  const phasesList = useMemo(() => {
    if (!cfg) return [];
    return getPhasesList(selectedGroupId || null, cfg).map((p) => ({
      ...p,
      name: phaseNamesState[p.id]?.trim() || p.name,
    }));
  }, [selectedGroupId, cfg, phaseNamesState]);

  // Modalidad para la plantilla global cuando no hay grupo seleccionado
  const [globalTypeState, setGlobalTypeState] = useState<GroupType>(() => getGroupType(null));

  const isClosedGroup = selectedGroup?.status === "closed";
  const groupType: GroupType = selectedGroupId ? (selectedGroup?.type || "escuela") : globalTypeState;
  const isCurso = groupType === "curso";
  const canEdit = selectedGroupId
    ? !isClosedGroup
    : isAdminEmail(user?.email);

  const toggleGroupType = async (newType: GroupType) => {
    if (newType === groupType) return;
    if (!selectedGroupId) {
      if (dirty && !window.confirm("Tienes cambios sin guardar en esta modalidad. ¿Deseas cambiar de modalidad y descartarlos?")) {
        return;
      }
      setGlobalTypeState(newType);
      setGlobalTypeMemory(newType);
      const newCfg = getExercises(null, newType);
      const newEnvs = getExerciseEnvironments(null, newType);
      const newDescs = getExerciseDescriptions(null, newType);
      const newNames = getPhaseNames(null, newType);
      setCfg(structuredClone(newCfg));
      setEnvs(structuredClone(newEnvs));
      setDescriptions(structuredClone(newDescs));
      setPhaseNamesState(structuredClone(newNames));
      setDirty(false);
      setMsg(`Mostrando Plantilla Global de «${newType === "curso" ? "Curso (Sin Fases)" : "Escuela (Con Fases)"}».`);
      return;
    }
    if (isClosedGroup) return;
    if (!window.confirm(`¿Deseas cambiar la modalidad de «${selectedGroup?.name}» a «${newType === "curso" ? "Curso (Sin Fases)" : "Escuela (Con Fases)"}»? Deberás hacer clic en «Guardar Ejercicios» para aplicar el cambio.`)) {
      return;
    }
    setGroups((prev) =>
      prev.map((g) => (g.id === selectedGroupId ? { ...g, type: newType } : g))
    );
    setGroupTypeMemory(selectedGroupId, newType);
    setDirty(true);
    setMsg(`Modalidad cambiada temporalmente a «${newType === "curso" ? "Curso (Sin Fases)" : `Escuela (${phasesList.length} Fases)`}». Haz clic en «Guardar Ejercicios» para confirmar.`);
  };

  useEffect(() => {
    listGroups()
      .then((list) => {
        setGroups(list);
        if (selectedGroupId && !list.some((g) => g.id === selectedGroupId)) {
          setSelectedGroupId("");
        }
      })
      .catch(() => { });
    // Solo al montar: valida el grupo inicial una única vez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoadingRules(true);
    setMsg("");
    setDirty(false);
    const effectiveGlobalType = !selectedGroupId ? getGroupType(null) : undefined;
    Promise.all([
      loadExercises(true, selectedGroupId || null, effectiveGlobalType),
      listUploadedExerciseNames(selectedGroupId || null).catch(() => [] as string[]),
    ])
      .then(([c, detected]) => {
        setCfg(structuredClone(c));
        setEnvs(structuredClone(getExerciseEnvironments(selectedGroupId || null, effectiveGlobalType)));
        setDescriptions(structuredClone(getExerciseDescriptions(selectedGroupId || null, effectiveGlobalType)));
        setPhaseNamesState(structuredClone(getPhaseNames(selectedGroupId || null, effectiveGlobalType)));
        if (!selectedGroupId) {
          setGlobalTypeState(effectiveGlobalType || "escuela");
        }
        setUploadedNames(detected);
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setLoadingRules(false));
  }, [selectedGroupId]);

  const handleGroupChange = (nextGroupId: string) => {
    if (dirty && !window.confirm("Tienes cambios sin guardar. ¿Deseas cambiar de grupo y descartarlos?")) {
      return;
    }
    setSelectedGroupId(nextGroupId);
    if (nextGroupId) {
      setActiveGroupId(nextGroupId);
      setParams({ grupo: nextGroupId });
    } else {
      setParams({});
    }
  };

  const handleCopyFrom = async (sourceId: string) => {
    if (!sourceId) return;
    const targetId = sourceId === "__GLOBAL__" ? null : sourceId;
    const sourceLabel =
      sourceId === "__GLOBAL__"
        ? "la Plantilla Global"
        : `el grupo «${groups.find((g) => g.id === sourceId)?.name || sourceId}»`;

    try {
      await loadExercises(false, targetId, groupType);
      setCfg(structuredClone(getExercises(targetId, groupType)));
      setEnvs(structuredClone(getExerciseEnvironments(targetId, groupType)));
      setDescriptions(structuredClone(getExerciseDescriptions(targetId, groupType)));
      setPhaseNamesState(structuredClone(getPhaseNames(targetId, groupType)));
      setDirty(true);
      setCopySourceId("");
      setMsg(
        `Ejercicios copiados desde ${sourceLabel}. Haz clic en «Guardar Catálogo» para aplicarlos a ${selectedGroup ? `«${selectedGroup.name}»` : "la Plantilla Global"
        }.`
      );
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  if (!cfg || loadingRules) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-500">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <span className="text-sm">{msg || "Cargando catálogo de ejercicios…"}</span>
        </div>
      </div>
    );
  }

  const update = (
    next: ExerciseConfig,
    nextEnvs?: ExerciseEnvironmentsMap,
    nextDescs?: ExerciseDescriptionsMap
  ) => {
    setCfg(next);
    if (nextEnvs) setEnvs(nextEnvs);
    if (nextDescs) setDescriptions(nextDescs);
    setDirty(true);
    setMsg("");
  };

  const add = (phase: number, explicitName?: string) => {
    const name = (explicitName ?? drafts[phase] ?? "").trim();
    if (!name) return;
    const list = cfg[phase] ?? [];
    if (list.some((n) => exerciseKey(n) === exerciseKey(name))) return setMsg("Ese ejercicio ya está en la fase.");

    const key = exerciseKey(name);
    const chosenEnv = draftEnvs[phase] || envs[key] || "AUTO";
    const nextEnvs = { ...envs, [key]: chosenEnv };

    // Quitar de cualquier otra fase donde estuviera asignado previamente para evitar duplicados entre fases
    const nextCfg: ExerciseConfig = {};
    for (const [p, pList] of Object.entries(cfg)) {
      if (Number(p) === phase) continue;
      nextCfg[p] = (pList ?? []).filter((n) => exerciseKey(n) !== key);
    }
    nextCfg[phase] = [...list, name];

    update(nextCfg, nextEnvs);
    if (!explicitName) {
      setDrafts({ ...drafts, [phase]: "" });
      setDraftEnvs({ ...draftEnvs, [phase]: "AUTO" });
    }
  };

  const movePhase = (fromPhase: number, toPhase: number, name: string) => {
    if (fromPhase === toPhase) return;
    const key = exerciseKey(name);
    const nextCfg: ExerciseConfig = { ...cfg };
    nextCfg[fromPhase] = (cfg[fromPhase] ?? []).filter((n) => exerciseKey(n) !== key);
    const targetList = (cfg[toPhase] ?? []).filter((n) => exerciseKey(n) !== key);
    nextCfg[toPhase] = [...targetList, name];
    update(nextCfg, envs);
  };

  const remove = (phase: number, name: string) => {
    const key = exerciseKey(name);
    const nextEnvs = { ...envs };
    delete nextEnvs[key];
    update({ ...cfg, [phase]: (cfg[phase] ?? []).filter((n) => n !== name) }, nextEnvs);
  };

  const setEnvForExercise = (name: string, env: ExerciseEnvironment) => {
    const key = exerciseKey(name);
    const nextEnvs = { ...envs, [key]: env };
    setEnvs(nextEnvs);
    setDirty(true);
    setMsg("");
  };

  const handleStartRenamePhase = (phaseId: number, currentName: string) => {
    setEditingPhaseNameId(phaseId);
    setPhaseNameInput(currentName);
  };

  const handleSavePhaseName = (phaseId: number) => {
    const trimmed = phaseNameInput.trim();
    if (!trimmed) {
      // Si está vacío, resetear a la fase por defecto
      const nextNames = { ...phaseNamesState };
      delete nextNames[phaseId];
      setPhaseNamesState(nextNames);
    } else {
      setPhaseNamesState({ ...phaseNamesState, [phaseId]: trimmed });
    }
    setEditingPhaseNameId(null);
    setDirty(true);
    setMsg("");
  };

  const handleAddPhase = () => {
    if (!cfg) return;
    const existingIds = phasesList.map((p) => p.id);
    const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
    if (nextId > 30) {
      alert("Se ha alcanzado el límite máximo de 30 fases.");
      return;
    }
    const nextCfg = { ...cfg, [nextId]: [] };
    const nextNames = { ...phaseNamesState, [nextId]: `Fase ${nextId}` };
    setPhaseNamesState(nextNames);
    update(nextCfg, envs);
    setMsg(`Fase ${nextId} agregada exitosamente.`);
  };

  const handleRemovePhase = (phaseId: number) => {
    if (!cfg) return;
    const count = (cfg[phaseId] ?? []).length;
    if (count > 0 && !window.confirm(`La Fase ${phaseId} contiene ${count} ejercicio(s). Si la eliminas, sus ejercicios también se quitarán del catálogo. ¿Deseas continuar?`)) {
      return;
    }
    if (phasesList.length <= 1) {
      alert("Debe existir al menos una fase configurada en el modo Escuela.");
      return;
    }

    const nextCfg = { ...cfg };
    delete nextCfg[phaseId];
    delete nextCfg[String(phaseId)];
    const nextNames = { ...phaseNamesState };
    delete nextNames[phaseId];
    setPhaseNamesState(nextNames);
    update(nextCfg, envs);
    setMsg(`Fase ${phaseId} eliminada.`);
  };

  const handleExportCsv = () => {
    if (!cfg) return;
    const csvContent = exportExercisesToCsv(cfg, isCurso, envs, descriptions, phasesList);
    const dateStr = new Date().toISOString().slice(0, 10);
    const scopeLabel = selectedGroup ? selectedGroup.name.replace(/[^a-zA-Z0-9_-]/g, "_") : "plantilla_global";
    const fileName = `catalogo_ejercicios_${scopeLabel}_${dateStr}.csv`;

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseExerciseCsv(text);
      if (parsed.length === 0) {
        alert("El archivo CSV no contiene ejercicios reconocibles.");
        return;
      }

      if (isCurso) {
        // En los grupos tipo curso se agregan directamente
        const currentList = cfg?.[1] ?? [];
        const nextList = [...currentList];
        const nextEnvs = { ...envs };
        const nextDescs = { ...descriptions };
        let addedCount = 0;

        for (const item of parsed) {
          const key = exerciseKey(item.nombre);
          if (!nextList.some((n) => exerciseKey(n) === key)) {
            nextList.push(item.nombre);
            nextEnvs[key] = item.entorno || (detectEnvironmentFromName(item.nombre) as ExerciseEnvironment);
            if (item.descripcion) {
              nextDescs[key] = item.descripcion;
            }
            addedCount++;
          }
        }

        update({ ...cfg, 1: nextList }, nextEnvs, nextDescs);
        setMsg(`Se importaron ${addedCount} ejercicio(s) directamente al curso.`);
      } else {
        // En los grupos tipo escuela se abre modal extra para seleccionar fase
        setPendingCsvRows(parsed);
        setIsPhaseModalOpen(true);
      }
    } catch (err) {
      alert("Error al leer el archivo CSV: " + (err as Error).message);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleConfirmPhaseImport = (
    assignments: Array<{ name: string; phase: number; env?: string; descripcion?: string }>
  ) => {
    if (!cfg) return;

    const nextCfg: ExerciseConfig = { ...cfg };
    const nextEnvs: ExerciseEnvironmentsMap = { ...envs };
    const nextDescs: ExerciseDescriptionsMap = { ...descriptions };

    for (const item of assignments) {
      const key = exerciseKey(item.name);
      const chosenEnv = (item.env as ExerciseEnvironment) || detectEnvironmentFromName(item.name);
      nextEnvs[key] = chosenEnv;
      if (item.descripcion) {
        nextDescs[key] = item.descripcion;
      }

      // Quitar de cualquier otra fase para evitar duplicados
      for (const p of Object.keys(nextCfg)) {
        nextCfg[p] = (nextCfg[p] ?? []).filter((n) => exerciseKey(n) !== key);
      }

      const pKey = String(item.phase);
      const list = nextCfg[pKey] ?? [];
      nextCfg[pKey] = [...list, item.name];
    }

    update(nextCfg, nextEnvs, nextDescs);
    setIsPhaseModalOpen(false);
    setPendingCsvRows([]);
    setMsg(`Se importaron e integraron ${assignments.length} ejercicio(s) en sus fases correspondientes.`);
  };

  const save = async () => {
    setBusy(true);
    try {
      if (selectedGroupId && selectedGroup?.type) {
        await updateGroupType(selectedGroupId, selectedGroup.type);
      }
      await saveExercises(
        cfg,
        user?.email ?? "",
        envs,
        selectedGroupId || null,
        descriptions,
        phaseNamesState,
        selectedGroupId ? undefined : globalTypeState
      );
      setDirty(false);
      setMsg(
        selectedGroup
          ? `Catálogo y configuración guardados para el grupo «${selectedGroup.name}».`
          : "Plantilla global de ejercicios guardada correctamente."
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const envBadge = (effectiveEnv: "CARRETERA" | "MONTANA" | "CIUDAD", isAuto: boolean) => {
    if (effectiveEnv === "MONTANA") {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-200" title={isAuto ? "Auto-detectado por nombre" : "Asignado manualmente"}>
          🏔️ Montaña {isAuto && <span className="text-[9px] text-amber-600 font-normal">(Auto)</span>}
        </span>
      );
    }
    if (effectiveEnv === "CIUDAD") {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800 border border-blue-200" title={isAuto ? "Auto-detectado por nombre" : "Asignado manualmente"}>
          🏙️ Ciudad {isAuto && <span className="text-[9px] text-blue-600 font-normal">(Auto)</span>}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 border border-emerald-200" title={isAuto ? "Auto-detectado por nombre" : "Asignado manualmente"}>
        🛣️ Carretera {isAuto && <span className="text-[9px] text-emerald-600 font-normal">(Auto)</span>}
      </span>
    );
  };

  return (
    <main className="w-full space-y-6 px-4 py-8 sm:px-8 xl:px-12">
      <div>
        <Link
          to={selectedGroupId ? `/?grupo=${selectedGroupId}` : "/"}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition mb-3"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Volver a resultados
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">Catálogo de Ejercicios</h1>
            <p className="mt-1 text-xs text-slate-600 max-w-2xl leading-relaxed">
              Define los ejercicios obligatorios por fase y el entorno operativo (<strong>Carretera</strong>, <strong>Montaña</strong> o <strong>Ciudad</strong>) para cada grupo de evaluación de forma independiente.
            </p>
          </div>
          {isClosedGroup ? (
            <span className="rounded-full bg-slate-100 border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700">
              🔒 Grupo Cerrado — Solo lectura
            </span>
          ) : !canEdit ? (
            <span className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-800">
              Modo solo lectura
            </span>
          ) : null}
        </div>
      </div>

      {/* Selector de Grupo / Ámbito de Ejercicios */}
      <section className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-white to-blue-50/50 p-4 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs shrink-0">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <label htmlFor="exercises-group-select" className="block text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                Configurando Ejercicios para:
              </label>
              <select
                id="exercises-group-select"
                value={selectedGroupId}
                onChange={(e) => handleGroupChange(e.target.value)}
                className="mt-1 rounded-xl border border-indigo-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-900 shadow-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">🌐 Plantilla Global (Base para nuevos grupos)</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.status === "closed" ? "🔒" : "🟢"} {g.type === "curso" ? "[Curso]" : "[Escuela]"} Grupo: {g.name}
                    {g.id === getActiveGroupId() ? " (Activo)" : ""}
                    {g.status === "closed" ? " (Cerrado)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(!selectedGroupId || !isClosedGroup) && (
            <div className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white p-1">
              <span className="text-[11px] font-bold text-slate-500 px-2 uppercase tracking-wider">
                Modalidad:
              </span>
              <button
                type="button"
                onClick={() => toggleGroupType("escuela")}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition ${!isCurso
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`}
              >
                🏫 Escuela ({phasesList.length} Fases)
              </button>
              <button
                type="button"
                onClick={() => toggleGroupType("curso")}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition ${isCurso
                    ? "bg-purple-600 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`}
              >
                🎯 Curso
              </button>
            </div>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 border-t lg:border-t-0 pt-3 lg:pt-0 border-indigo-100">
              {/* Acciones de Import / Export CSV */}
              <div className="flex items-center gap-1.5 mr-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".csv,text/csv"
                  className="hidden"
                  id="csv-file-input"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-xs hover:bg-indigo-50 hover:border-indigo-300 transition cursor-pointer"
                  title="Importar catálogo de ejercicios desde archivo CSV"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Importar CSV
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 hover:border-slate-300 transition cursor-pointer"
                  title="Descargar configuración actual de ejercicios en CSV"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Exportar CSV
                </button>
              </div>

              <span className="text-xs font-semibold text-slate-600">Copiar desde:</span>
              <select
                value={copySourceId}
                onChange={(e) => handleCopyFrom(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs focus:border-indigo-500 focus:outline-none"
              >
                <option value="">-- Seleccionar origen --</option>
                {selectedGroupId !== "" && (
                  <option value="__GLOBAL__">🌐 Plantilla Global</option>
                )}
                {groups
                  .filter((g) => g.id !== selectedGroupId)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      📋 Grupo: {g.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
        </div>
      </section>

      {/* Listado de Ejercicios: Fases (Escuela) o Lista Directa (Curso) */}
      {isCurso ? (
        <section className="rounded-2xl border border-purple-200/80 bg-white p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-100 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-100 border border-purple-200 text-purple-700 text-sm font-bold">
                🎯
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Ejercicios Obligatorios del Curso
                </h2>
                <p className="text-xs text-slate-500">
                  Modalidad Curso: Evaluación directa de ejercicios sin separación de fases.
                </p>
              </div>
            </div>
            <span className="rounded-full bg-purple-50 border border-purple-200 px-3 py-1 text-xs font-bold text-purple-700 font-mono">
              {(cfg[1] ?? []).length} ejercicio(s) configurado(s)
            </span>
          </div>

          {(() => {
            const list = cfg[1] ?? [];
            return (
              <div className="space-y-3">
                {list.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-purple-200 p-4 text-xs text-slate-500 bg-purple-50/30 text-center">
                    No hay ejercicios configurados para este curso. Agrega los ejercicios que componen la evaluación abajo.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {list.map((n) => {
                      const key = exerciseKey(n);
                      const rawSetting = envs[key] ?? "AUTO";
                      const isAuto = rawSetting === "AUTO";
                      const effective = isAuto ? detectEnvironmentFromName(n) : rawSetting;

                      return (
                        <li
                          key={n}
                          className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 text-xs text-slate-800"
                        >
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2.5">
                              <span className="font-semibold text-slate-900 truncate text-sm">{n}</span>
                              {envBadge(effective, isAuto)}
                            </div>
                            {descriptions[key] && (
                              <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5" title={descriptions[key]}>
                                {descriptions[key]}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 ml-auto">
                            {canEdit ? (
                              <select
                                value={rawSetting}
                                onChange={(e) => setEnvForExercise(n, e.target.value as ExerciseEnvironment)}
                                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-xs focus:border-indigo-500 focus:outline-none"
                                title="Configurar tipo de entorno para telemetría"
                              >
                                <option value="AUTO">⚡ Auto-detectar</option>
                                <option value="CARRETERA">🛣️ Carretera / Plano</option>
                                <option value="MONTANA">🏔️ Montaña / Sierra</option>
                                <option value="CIUDAD">🏙️ Ciudad / Maniobras</option>
                              </select>
                            ) : (
                              <span className="text-[11px] text-slate-400 font-medium">
                                {rawSetting === "AUTO" ? "Automático" : rawSetting}
                              </span>
                            )}

                            {canEdit && (
                              <button
                                onClick={() => remove(1, n)}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                                title="Quitar ejercicio del curso"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {canEdit && (
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <div className="flex flex-wrap sm:flex-nowrap gap-2">
                      <input
                        value={drafts[1] ?? ""}
                        onChange={(e) => setDrafts({ ...drafts, [1]: e.target.value })}
                        onKeyDown={(e) => e.key === "Enter" && add(1)}
                        placeholder="Nombre exacto del ejercicio (ej. 01 - Control Inicial)"
                        className="flex-1 min-w-[200px] rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                      />
                      <select
                        value={draftEnvs[1] ?? "AUTO"}
                        onChange={(e) => setDraftEnvs({ ...draftEnvs, [1]: e.target.value as ExerciseEnvironment })}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="AUTO">⚡ Auto-detectar</option>
                        <option value="CARRETERA">🛣️ Carretera</option>
                        <option value="MONTANA">🏔️ Montaña</option>
                        <option value="CIUDAD">🏙️ Ciudad</option>
                      </select>
                      <button
                        onClick={() => add(1)}
                        className="rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-700 transition shadow-xs"
                      >
                        Agregar Ejercicio
                      </button>
                    </div>

                    {uploadedNames.filter((u) => !list.some((n) => exerciseKey(n) === exerciseKey(u))).length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-2">
                        <span className="text-[11px] font-medium text-slate-400">
                          Detectados en evaluaciones de simulador (clic para agregar):
                        </span>
                        {uploadedNames
                          .filter((u) => !list.some((n) => exerciseKey(n) === exerciseKey(u)))
                          .map((u) => (
                            <button
                              key={u}
                              type="button"
                              onClick={() => add(1, u)}
                              className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50/70 px-2.5 py-1 text-[11px] font-semibold text-purple-700 hover:bg-purple-100 transition cursor-pointer"
                            >
                              <span>+ {u}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </section>
      ) : (
        <div className="space-y-4">
          {/* Barra superior de control de fases */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-800">
                Estructura de Fases ({phasesList.length} fase{phasesList.length === 1 ? "" : "s"} configurada{phasesList.length === 1 ? "" : "s"})
              </span>
              <span className="text-[11px] text-slate-500">
                · Puedes editar el nombre o agregar/quitar fases según tu plan de capacitación
              </span>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={handleAddPhase}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 transition cursor-pointer"
                title="Agregar una nueva fase a la estructura"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                + Nueva Fase
              </button>
            )}
          </div>

          <div className="grid gap-4">
            {phasesList.map((p) => {
              const list = cfg[p.id] ?? [];
              const isEditing = editingPhaseNameId === p.id;

              return (
                <section
                  key={p.id}
                  className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 flex-1 min-w-[240px]">
                      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold shrink-0">
                        {p.id}
                      </span>

                      {isEditing ? (
                        <div className="flex items-center gap-2 flex-1 max-w-md">
                          <input
                            type="text"
                            value={phaseNameInput}
                            autoFocus
                            onChange={(e) => setPhaseNameInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSavePhaseName(p.id);
                              if (e.key === "Escape") setEditingPhaseNameId(null);
                            }}
                            className="flex-1 rounded-xl border border-indigo-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            placeholder="Nombre descriptivo de la fase..."
                          />
                          <button
                            type="button"
                            onClick={() => handleSavePhaseName(p.id)}
                            className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-indigo-700 transition"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingPhaseNameId(null)}
                            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-bold text-slate-900">
                            Fase {p.id}: {p.name}
                          </h2>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleStartRenamePhase(p.id, p.name)}
                              className="rounded-md p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition"
                              title="Editar nombre de esta fase"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-500 font-mono">
                        {list.length} ejercicio(s)
                      </span>
                      {canEdit && phasesList.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemovePhase(p.id)}
                          className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                          title={`Eliminar Fase ${p.id}`}
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {list.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 p-3 text-xs text-slate-500 bg-slate-50/50">
                      Sin ejercicios asignados a esta fase.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {list.map((n) => {
                        const key = exerciseKey(n);
                        const rawSetting = envs[key] ?? "AUTO";
                        const isAuto = rawSetting === "AUTO";
                        const effective = isAuto ? detectEnvironmentFromName(n) : rawSetting;

                        return (
                          <li
                            key={n}
                            className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 text-xs text-slate-800"
                          >
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-2.5">
                                <span className="font-semibold text-slate-900 truncate">{n}</span>
                                {envBadge(effective, isAuto)}
                              </div>
                              {descriptions[key] && (
                                <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5" title={descriptions[key]}>
                                  {descriptions[key]}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-2 ml-auto">
                              {canEdit && (
                                <select
                                  value={p.id}
                                  onChange={(e) => movePhase(p.id, Number(e.target.value), n)}
                                  className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-2 py-1 text-[11px] font-bold text-indigo-700 shadow-xs focus:border-indigo-500 focus:outline-none"
                                  title="Mover ejercicio a otra fase"
                                >
                                  {phasesList.map((ph) => (
                                    <option key={ph.id} value={ph.id}>
                                      Fase {ph.id}
                                    </option>
                                  ))}
                                </select>
                              )}

                              {canEdit ? (
                                <select
                                  value={rawSetting}
                                  onChange={(e) => setEnvForExercise(n, e.target.value as ExerciseEnvironment)}
                                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-xs focus:border-indigo-500 focus:outline-none"
                                  title="Configurar tipo de entorno para telemetría"
                                >
                                  <option value="AUTO">⚡ Auto-detectar</option>
                                  <option value="CARRETERA">🛣️ Carretera / Plano</option>
                                  <option value="MONTANA">🏔️ Montaña / Sierra</option>
                                  <option value="CIUDAD">🏙️ Ciudad / Maniobras</option>
                                </select>
                              ) : (
                                <span className="text-[11px] text-slate-400 font-medium">
                                  {rawSetting === "AUTO" ? "Automático" : rawSetting}
                                </span>
                              )}

                              {canEdit && (
                                <button
                                  onClick={() => remove(p.id, n)}
                                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-rose-600 transition"
                                  title="Quitar ejercicio"
                                >
                                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {canEdit && (
                    <div className="space-y-2 pt-1">
                      <div className="flex flex-wrap sm:flex-nowrap gap-2">
                        <input
                          value={drafts[p.id] ?? ""}
                          onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })}
                          onKeyDown={(e) => e.key === "Enter" && add(p.id)}
                          placeholder="Ej. 02 - Montaña o 03C - Autopista"
                          className="flex-1 min-w-[200px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
                        />
                        <select
                          value={draftEnvs[p.id] ?? "AUTO"}
                          onChange={(e) => setDraftEnvs({ ...draftEnvs, [p.id]: e.target.value as ExerciseEnvironment })}
                          className="rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="AUTO">⚡ Auto-detectar</option>
                          <option value="CARRETERA">🛣️ Carretera</option>
                          <option value="MONTANA">🏔️ Montaña</option>
                          <option value="CIUDAD">🏙️ Ciudad</option>
                        </select>
                        <button
                          onClick={() => add(p.id)}
                          className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
                        >
                          Agregar
                        </button>
                      </div>

                      {uploadedNames.filter((u) => !list.some((n) => exerciseKey(n) === exerciseKey(u))).length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[11px] font-medium text-slate-400">
                            Ejercicios detectados en reportes (clic para asignar a Fase {p.id}):
                          </span>
                          {uploadedNames
                            .filter((u) => !list.some((n) => exerciseKey(n) === exerciseKey(u)))
                            .map((u) => {
                              const assignedPhase = Object.entries(cfg).find(
                                ([ph, phList]) => Number(ph) !== p.id && (phList ?? []).some((n) => exerciseKey(n) === exerciseKey(u))
                              )?.[0];
                              return (
                                <button
                                  key={u}
                                  type="button"
                                  onClick={() => add(p.id, u)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/60 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
                                  title={assignedPhase ? `Mover de Fase ${assignedPhase} a Fase ${p.id}` : `Agregar a Fase ${p.id}`}
                                >
                                  <span>+ {u}</span>
                                  {assignedPhase && (
                                    <span className="text-[9px] font-normal text-indigo-500">(en F{assignedPhase})</span>
                                  )}
                                </button>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {canEdit && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={!dirty || busy}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {busy
                ? "Guardando…"
                : selectedGroup
                  ? `Guardar Ejercicios de «${selectedGroup.name}»`
                  : "Guardar Plantilla Global"}
            </button>
            {dirty && (
              <span className="text-xs text-amber-700 font-medium flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                Cambios pendientes sin guardar
              </span>
            )}
          </div>
          {msg && <span className="text-xs text-emerald-700 font-medium">{msg}</span>}
        </div>
      )}

      {/* Modal de asignación de fase para importación en grupos Escuela */}
      <PhaseAssignmentModal
        isOpen={isPhaseModalOpen}
        onClose={() => {
          setIsPhaseModalOpen(false);
          setPendingCsvRows([]);
        }}
        parsedRows={pendingCsvRows}
        onConfirm={handleConfirmPhaseImport}
        phasesList={phasesList}
      />
    </main>
  );
}
