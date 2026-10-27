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

  if (!draft) return <p className="p-6 text-gray-500">{msg ? msg.text : "Cargando…"}</p>;

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
      setMsg({ ok: true, text: "Catálogo guardado. Las calificaciones se recalculan con estos valores." });
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
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <Link to="/" className="text-sm text-blue-700 hover:underline">← Volver</Link>
      <h1 className="text-2xl font-bold">Catálogo de errores</h1>
      <p className="text-sm text-gray-600">
        Cada error resta puntos según su gravedad. La calificación del ejercicio es 100 menos los puntos por minuto × {PENALTY_PER_ERROR_RATE}.
        Con {CRITICAL_LIMIT} o más errores críticos en una fase el dictamen es NO APTO sin importar el promedio.
        Dictamen: {VERDICTS.map((v) => `${v.label} (${v.min}+)`).join(" · ")}.
        {!canEdit && " Solo los administradores pueden editar el catálogo."}
      </p>

      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold">Puntos por nivel de gravedad</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          {SEVERITY_ORDER.map((s) => (
            <label key={s} className="text-sm">
              <span className={`mb-1 inline-block rounded px-2 py-0.5 text-xs ${SEVERITIES[s].badge}`}>{SEVERITIES[s].label}</span>
              <input
                type="number" min={0} step={0.5} disabled={!canEdit}
                value={draft.weights[s]}
                onChange={(e) => setWeight(s, e.target.value)}
                className="w-full rounded border px-2 py-1 disabled:bg-gray-100"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">Errores ({draft.entries.length})</h2>
          <input
            value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar…"
            className="rounded border px-2 py-1 text-sm"
          />
        </div>

        <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
          <thead className="bg-gray-100 text-left">
            <tr>
              <th className="p-2">Error</th>
              <th className="p-2">Gravedad</th>
              <th className="p-2">Puntos propios <span className="font-normal text-gray-500">(opcional)</span></th>
              <th className="p-2">Puntos que resta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.name} className="border-t">
                <td className="p-2">{e.name}</td>
                <td className="p-2">
                  <select
                    disabled={!canEdit} value={e.severity}
                    onChange={(ev) => updateEntry(e.name, { severity: ev.target.value as Severity })}
                    className={`rounded border px-1 py-0.5 text-xs ${SEVERITIES[e.severity].badge}`}
                  >
                    {SEVERITY_ORDER.map((s) => <option key={s} value={s}>{SEVERITIES[s].label}</option>)}
                  </select>
                </td>
                <td className="p-2">
                  <input
                    type="number" min={0} step={0.5} disabled={!canEdit}
                    value={e.points ?? ""} placeholder="—"
                    onChange={(ev) => updateEntry(e.name, { points: ev.target.value === "" ? undefined : Math.max(0, Number(ev.target.value)) })}
                    className="w-24 rounded border px-2 py-0.5 disabled:bg-gray-100"
                  />
                </td>
                <td className="p-2 font-semibold">{e.points ?? draft.weights[e.severity]}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="p-3 text-gray-500" colSpan={4}>Sin resultados.</td></tr>}
          </tbody>
        </table>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <input
              value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addEntry()}
              placeholder="Agregar un error nuevo (texto exacto del simulador)"
              className="min-w-80 flex-1 rounded border px-2 py-1 text-sm"
            />
            <button onClick={addEntry} className="rounded border px-3 py-1 text-sm hover:bg-gray-50">Agregar</button>
          </div>
        )}
      </section>

      {canEdit && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-gray-50 py-3">
          <button onClick={save} disabled={!dirty || busy} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "Guardando…" : "Guardar cambios"}
          </button>
          <button onClick={() => saved && setDraft(clone(saved))} disabled={!dirty || busy} className="rounded border px-3 py-2 text-sm disabled:opacity-50">
            Descartar
          </button>
          <button
            onClick={() => window.confirm("¿Volver a los valores originales del catálogo? Debes guardar para aplicarlo.") && setDraft(clone(DEFAULT_CONFIG))}
            disabled={busy}
            className="rounded border px-3 py-2 text-sm text-red-700"
          >
            Restablecer valores originales
          </button>
          {dirty && <span className="text-sm text-amber-700">Hay cambios sin guardar</span>}
        </div>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</p>}
    </main>
  );
}
