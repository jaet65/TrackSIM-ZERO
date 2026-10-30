import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  DEFAULT_CONFIG,
  SEVERITIES,
  SEVERITY_ORDER,
  normalize,
  getCatalog,
  type CatalogConfig,
  type Entry,
  type Severity,
} from "../lib/catalog";
import { loadCatalog, saveCatalog } from "../lib/catalogStore";
import { CRITICAL_LIMIT, PENALTY_PER_ERROR_RATE, isAdminEmail } from "../lib/config";
import { listGroups, getActiveGroupId, type GroupDoc } from "../lib/groups";
import { useAuth } from "../components/AuthProvider";

const clone = (c: CatalogConfig): CatalogConfig => JSON.parse(JSON.stringify(c));

export default function Catalog() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const [groups, setGroups] = useState<GroupDoc[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(() => {
    const fromUrl = params.get("grupo");
    if (fromUrl !== null) return fromUrl;
    return getActiveGroupId() || "";
  });

  const [saved, setSaved] = useState<CatalogConfig | null>(null);
  const [draft, setDraft] = useState<CatalogConfig | null>(null);
  const [filter, setFilter] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingRules, setLoadingRules] = useState(true);
  const [copySourceId, setCopySourceId] = useState<string>("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );

  // Un grupo abierto puede ser configurado por el instructor/admin; un grupo cerrado es de solo lectura; la plantilla global requiere admin
  const isClosedGroup = selectedGroup?.status === "closed";
  const canEdit = selectedGroupId
    ? !isClosedGroup
    : isAdminEmail(user?.email);

  useEffect(() => {
    listGroups()
      .then((list) => {
        setGroups(list);
        // Si el grupo inicial (de localStorage) no existe en la lista, volver a plantilla global
        if (selectedGroupId && !list.some((g) => g.id === selectedGroupId)) {
          setSelectedGroupId("");
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoadingRules(true);
    setMsg(null);
    loadCatalog(false, selectedGroupId || null)
      .then((c) => {
        setSaved(clone(c));
        setDraft(clone(c));
      })
      .catch((e: Error) => setMsg({ ok: false, text: e.message }))
      .finally(() => setLoadingRules(false));
  }, [selectedGroupId]);

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);

  const handleGroupChange = (nextGroupId: string) => {
    if (dirty && !window.confirm("Tienes cambios sin guardar. ¿Deseas cambiar de grupo y descartarlos?")) {
      return;
    }
    setSelectedGroupId(nextGroupId);
    if (nextGroupId) {
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
      await loadCatalog(false, targetId);
      const sourceCfg = getCatalog(targetId);
      setDraft(clone(sourceCfg));
      setCopySourceId("");
      setMsg({
        ok: true,
        text: `Reglas copiadas desde ${sourceLabel}. Haz clic en «Guardar Cambios» para aplicarlas a ${
          selectedGroup ? `«${selectedGroup.name}»` : "la Plantilla Global"
        }.`,
      });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  if (!draft || loadingRules) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-500">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
          <span className="text-sm">{msg ? msg.text : "Cargando catálogo de errores…"}</span>
        </div>
      </div>
    );
  }

  const setWeight = (s: Severity, v: string) =>
    setDraft({ ...draft, weights: { ...draft.weights, [s]: v === "" ? 0 : Math.max(0, Number(v)) } });

  const updateEntry = (name: string, patch: Partial<Entry>) =>
    setDraft({ ...draft, entries: draft.entries.map((e) => (e.name === name ? { ...e, ...patch } : e)) });

  function addEntry() {
    const name = newName.trim();
    if (!name) return;
    if (draft!.entries.some((e) => normalize(e.name) === normalize(name))) {
      setMsg({ ok: false, text: "Ese error ya existe en el catálogo" });
      return;
    }
    setDraft({ ...draft!, entries: [...draft!.entries, { name, severity: "MODERADO" }] });
    setNewName("");
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await saveCatalog(draft!, user?.email ?? "", selectedGroupId || null);
      setSaved(clone(draft!));
      setMsg({
        ok: true,
        text: selectedGroup
          ? `Reglas de errores guardadas para el grupo «${selectedGroup.name}». Las calificaciones de este grupo se han recalculado.`
          : "Plantilla global de errores guardada con éxito.",
      });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const q = normalize(filter);
  const rows = draft.entries
    .filter((e) => !q || normalize(e.name).includes(q))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.name.localeCompare(b.name));

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
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
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900">Catálogo de Errores y Ponderaciones</h1>
            <p className="mt-1 text-xs text-slate-600 max-w-2xl leading-relaxed">
              Cada grupo mantiene sus propias reglas de errores y ponderaciones de forma independiente.
              La calificación final parte de 100 menos los puntos/min × {PENALTY_PER_ERROR_RATE}.
              Acumular {CRITICAL_LIMIT} o más errores críticos genera dictamen automático de <strong className="text-rose-700">NO APTO</strong>.
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

      {/* Selector de Grupo / Ámbito de Reglas */}
      <section className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-white to-blue-50/50 p-4 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs shrink-0">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <label htmlFor="catalog-group-select" className="block text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                Configurando Reglas de Errores para:
              </label>
              <select
                id="catalog-group-select"
                value={selectedGroupId}
                onChange={(e) => handleGroupChange(e.target.value)}
                className="mt-1 rounded-xl border border-indigo-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-900 shadow-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">🌐 Plantilla Global (Base para nuevos grupos)</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.status === "closed" ? "🔒" : "🟢"} Grupo: {g.name}
                    {g.id === getActiveGroupId() ? " (Activo)" : ""}
                    {g.status === "closed" ? " (Cerrado)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 border-t lg:border-t-0 pt-3 lg:pt-0 border-indigo-100">
              <span className="text-xs font-semibold text-slate-600">Copiar reglas desde:</span>
              <select
                value={copySourceId}
                onChange={(e) => handleCopyFrom(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs focus:border-indigo-500 focus:outline-none"
              >
                <option value="">-- Seleccionar origen para importar --</option>
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

      {/* Pesos por gravedad */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Ponderación Base por Nivel de Gravedad</h2>
          <span className="text-xs font-semibold text-indigo-600">
            {selectedGroup ? `Grupo: ${selectedGroup.name}` : "Plantilla Global"}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {SEVERITY_ORDER.map((s) => (
            <div key={s} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold ${SEVERITIES[s].badge}`}>
                {SEVERITIES[s].label}
              </span>
              <input
                type="number"
                min={0}
                step={0.5}
                disabled={!canEdit}
                value={draft.weights[s]}
                onChange={(e) => setWeight(s, e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100"
              />
              <span className="block text-[10px] text-slate-500">Puntos restados por incidencia</span>
            </div>
          ))}
        </div>
      </section>

      {/* Lista de Errores */}
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-bold text-slate-900">
            Errores Registrados ({draft.entries.length})
          </h2>
          <div className="relative">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Buscar error en catálogo…"
              className="w-full sm:w-64 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Descripción del Error</th>
                  <th className="px-4 py-3">Nivel de Gravedad</th>
                  <th className="px-4 py-3">Puntos Específicos</th>
                  <th className="px-4 py-3 text-right">Puntos Aplicados</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((e) => (
                  <tr key={e.name} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-medium text-slate-800">{e.name}</td>
                    <td className="px-4 py-3">
                      <select
                        disabled={!canEdit}
                        value={e.severity}
                        onChange={(ev) => updateEntry(e.name, { severity: ev.target.value as Severity })}
                        className={`rounded-lg border px-2 py-1 text-xs font-semibold focus:outline-none ${SEVERITIES[e.severity].badge} bg-white`}
                      >
                        {SEVERITY_ORDER.map((s) => (
                          <option key={s} value={s} className="bg-white text-slate-800">
                            {SEVERITIES[s].label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        disabled={!canEdit}
                        value={e.points ?? ""}
                        placeholder="— (Heredar)"
                        onChange={(ev) =>
                          updateEntry(e.name, {
                            points: ev.target.value === "" ? undefined : Math.max(0, Number(ev.target.value)),
                          })
                        }
                        className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-900 placeholder-slate-400 disabled:bg-slate-100"
                      />
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-indigo-700">
                      {e.points ?? draft.weights[e.severity]}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td className="p-6 text-center text-slate-500" colSpan={4}>
                      Sin resultados para la búsqueda actual.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {canEdit && (
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addEntry()}
              placeholder="Agregar nuevo error (texto exacto emitido por el simulador)"
              className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none"
            />
            <button
              onClick={addEntry}
              className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition"
            >
              Agregar
            </button>
          </div>
        )}
      </section>

      {canEdit && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={!dirty || busy}
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {busy
                ? "Guardando…"
                : selectedGroup
                ? `Guardar Reglas de «${selectedGroup.name}»`
                : "Guardar Plantilla Global"}
            </button>
            <button
              onClick={() => saved && setDraft(clone(saved))}
              disabled={!dirty || busy}
              className="rounded-xl border border-slate-200 bg-slate-100 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-40 transition"
            >
              Descartar
            </button>
            <button
              onClick={() =>
                window.confirm("¿Restablecer este catálogo a sus valores de fábrica por defecto?") &&
                setDraft(clone(DEFAULT_CONFIG))
              }
              disabled={busy}
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100 transition"
            >
              Restablecer Valores de Fábrica
            </button>
          </div>
          {dirty && (
            <span className="text-xs text-amber-700 font-medium flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              Hay cambios sin guardar
            </span>
          )}
        </div>
      )}

      {msg && (
        <div
          className={`rounded-xl border p-3 text-xs ${
            msg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {msg.text}
        </div>
      )}
    </main>
  );
}
