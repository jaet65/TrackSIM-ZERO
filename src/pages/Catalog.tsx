import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  DEFAULT_CONFIG, SEVERITIES, SEVERITY_ORDER, normalize,
  type CatalogConfig, type Entry, type Severity,
} from "../lib/catalog";
import { loadCatalog, saveCatalog } from "../lib/catalogStore";
import { CRITICAL_LIMIT, PENALTY_PER_ERROR_RATE, VERDICTS, isAdminEmail } from "../lib/config";
import { useAuth } from "../components/AuthProvider";

const clone = (c: CatalogConfig): CatalogConfig => JSON.parse(JSON.stringify(c));

export default function Catalog() {
  const { user } = useAuth();
  const canEdit = isAdminEmail(user?.email);
  const [saved, setSaved] = useState<CatalogConfig | null>(null);
  const [draft, setDraft] = useState<CatalogConfig | null>(null);
  const [filter, setFilter] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    loadCatalog()
      .then((c) => {
        setSaved(c);
        setDraft(clone(c));
      })
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, []);

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);

  if (!draft) {
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
      await saveCatalog(draft!, user?.email ?? "");
      setSaved(clone(draft!));
      setMsg({ ok: true, text: "Catálogo guardado con éxito. Las calificaciones se han recalculado." });
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
          to="/"
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
              Cada error resta puntos según su gravedad. La calificación final parte de 100 menos los puntos/min × {PENALTY_PER_ERROR_RATE}.
              Acumular {CRITICAL_LIMIT} o más errores críticos genera dictamen automático de <strong className="text-rose-700">NO APTO</strong>.
            </p>
          </div>
          {!canEdit && (
            <span className="rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-800">
              Modo solo lectura
            </span>
          )}
        </div>
      </div>

      {/* Pesos por gravedad */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-slate-900">Ponderación Base por Nivel de Gravedad</h2>
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
              {busy ? "Guardando…" : "Guardar Cambios"}
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
                window.confirm("¿Restablecer el catálogo a sus valores de fábrica por defecto?") &&
                setDraft(clone(DEFAULT_CONFIG))
              }
              disabled={busy}
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100 transition"
            >
              Restablecer Valores
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
