import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listGroups,
  createGroup,
  closeAndFreezeGroup,
  deleteGroup,
  updateGroupType,
  updateGroupDetails,
  getActiveGroupId,
  setActiveGroupId,
  type GroupDoc,
  type GroupType,
} from "../lib/groups";
import { useAuth } from "../components/AuthProvider";
import { isAdminEmail } from "../lib/config";

export default function Groups() {
  const { user } = useAuth();
  const isAdmin = isAdminEmail(user?.email);

  const [groups, setGroups] = useState<GroupDoc[]>([]);
  const [activeGroupId, setActiveId] = useState<string | null>(getActiveGroupId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Crear nuevo grupo
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [newGroupType, setNewGroupType] = useState<GroupType>("escuela");
  const [sourceGroupId, setSourceGroupId] = useState("");
  const [creating, setCreating] = useState(false);

  // Cerrar y congelar grupo
  const [closingGroup, setClosingGroup] = useState<GroupDoc | null>(null);
  const [closing, setClosing] = useState(false);

  // Editar nombre del grupo
  const [editingGroup, setEditingGroup] = useState<GroupDoc | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Eliminar grupo
  const [deletingGroup, setDeletingGroup] = useState<GroupDoc | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteText, setConfirmDeleteText] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const list = await listGroups();
      setGroups(list);
      // Validar si el activeGroupId sigue existiendo
      const currentActive = getActiveGroupId();
      if (currentActive && !list.some((g) => g.id === currentActive)) {
        setActiveGroupId(null);
        setActiveId(null);
      } else {
        setActiveId(currentActive);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const handleSelectActive = (groupId: string | null) => {
    setActiveGroupId(groupId);
    setActiveId(groupId);
    setSuccess(
      groupId
        ? "Grupo activo seleccionado. Las nuevas evaluaciones y sincronizaciones se asignarán a este grupo."
        : "Sin grupo activo asignado por defecto."
    );
    setTimeout(() => setSuccess(""), 4000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;

    setCreating(true);
    setError("");
    try {
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
      setShowCreateModal(false);
      setNewGroupName("");
      setNewGroupDesc("");
      setNewGroupType("escuela");
      setSourceGroupId("");
      setActiveId(created.id);
      setSuccess(`Grupo «${created.name}» creado y fijado como grupo de trabajo activo.`);
      setTimeout(() => setSuccess(""), 4000);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleCloseGroup = async () => {
    if (!closingGroup) return;
    setClosing(true);
    setError("");
    try {
      const res = await closeAndFreezeGroup(closingGroup.id, {
        name: user?.displayName || user?.email || "",
        email: user?.email || "",
      });
      setSuccess(`Grupo «${closingGroup.name}» cerrado exitosamente. Se congelaron ${res.evaluationsFrozen} evaluaciones.`);
      setTimeout(() => setSuccess(""), 5000);
      setClosingGroup(null);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClosing(false);
    }
  };

  const handleStartEdit = (g: GroupDoc) => {
    setEditingGroup(g);
    setEditName(g.name);
    setEditDesc(g.description || "");
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGroup || !editName.trim()) return;

    setSavingEdit(true);
    setError("");
    try {
      await updateGroupDetails(editingGroup.id, editName, editDesc);
      setSuccess(`Grupo actualizado a «${editName.trim()}» correctamente.`);
      setTimeout(() => setSuccess(""), 4000);
      setEditingGroup(null);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!deletingGroup) return;
    if (confirmDeleteText !== deletingGroup.name) {
      setError("El nombre de confirmación no coincide.");
      return;
    }

    setDeleting(true);
    setError("");
    try {
      await deleteGroup(deletingGroup.id);
      setSuccess(`Grupo «${deletingGroup.name}» y sus registros eliminados correctamente.`);
      setTimeout(() => setSuccess(""), 4000);
      setDeletingGroup(null);
      setConfirmDeleteText("");
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Grupos de Evaluación</h1>
            <span className="rounded-md bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-xs font-bold text-indigo-700">
              Control de Versiones & Congelación
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Organiza las generaciones o cursos de evaluación. Al cerrar un grupo, sus calificaciones y desgloses quedan congelados y protegidos ante cualquier cambio de catálogo o ponderación.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm shadow-indigo-600/20 hover:from-indigo-700 hover:to-blue-700 transition"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Nuevo Grupo</span>
        </button>
      </div>

      {/* Banner de Notificación */}
      {success && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-medium text-emerald-800 flex items-center justify-between animate-in fade-in">
          <span>{success}</span>
          <button onClick={() => setSuccess("")} className="text-emerald-600 hover:text-emerald-900 font-bold">✕</button>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-medium text-rose-800 flex items-center justify-between animate-in fade-in">
          <span>{error}</span>
          <button onClick={() => setError("")} className="text-rose-600 hover:text-rose-900 font-bold">✕</button>
        </div>
      )}

      {/* Selector de Grupo de Trabajo Activo */}
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/60 to-blue-50/40 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-indigo-600 animate-pulse" />
              <h2 className="text-sm font-bold text-slate-900">Grupo Activo para Nuevas Cargas</h2>
            </div>
            <p className="text-xs text-slate-600">
              Todas las evaluaciones que se importen por CSV o se sincronicen desde Lander DB se asignarán a este grupo:
            </p>
          </div>

          <div className="flex items-center gap-3">
            <select
              value={activeGroupId || ""}
              onChange={(e) => handleSelectActive(e.target.value || null)}
              className="rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">-- Sin Grupo Asignado (General) --</option>
              {groups
                .filter((g) => g.status === "open")
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    🟢 {g.name} (Abierto)
                  </option>
                ))}
            </select>
            {activeGroupId && (
              <button
                onClick={() => handleSelectActive(null)}
                className="text-xs text-slate-500 hover:text-slate-800 underline"
              >
                Desactivar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Lista de Grupos */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
          <h2 className="text-sm font-bold text-slate-800">Catálogo de Grupos Registrados</h2>
          <span className="text-xs text-slate-500">{groups.length} grupo(s) en total</span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500">Cargando grupos...</div>
        ) : groups.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-500">
            No se han registrado grupos aún. Crea uno para comenzar a organizar tus evaluaciones.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3 px-4">Grupo</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4">Reglas del Grupo</th>
                  <th className="py-3 px-4">Creado</th>
                  <th className="py-3 px-4">Cierre & Congelación</th>
                  <th className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {groups.map((g) => {
                  const isClosed = g.status === "closed";
                  const isActive = activeGroupId === g.id;
                  const exerciseCount = g.exercises?.phases
                    ? Object.values(g.exercises.phases).reduce((acc, list) => acc + (Array.isArray(list) ? list.length : 0), 0)
                    : null;
                  const errorRulesCount = g.catalog?.entries ? g.catalog.entries.length : null;

                  return (
                    <tr key={g.id} className="hover:bg-slate-50/60 transition">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm">{g.name}</span>
                          {!isClosed && (
                            <button
                              type="button"
                              onClick={() => handleStartEdit(g)}
                              className="text-slate-400 hover:text-indigo-600 transition p-1 rounded-md hover:bg-slate-100"
                              title="Cambiar nombre o descripción del grupo"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                          )}
                          {g.type === "curso" ? (
                            <span className="rounded-md bg-purple-50 border border-purple-200 px-1.5 py-0.5 text-[10px] font-bold text-purple-700">
                              🎯 Curso
                            </span>
                          ) : (
                            <span className="rounded-md bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                              🏫 Escuela
                            </span>
                          )}
                          {isActive && (
                            <span className="rounded-md bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                              Activo
                            </span>
                          )}
                        </div>
                        {g.description && (
                          <p className="text-[11px] text-slate-500 font-normal mt-0.5 line-clamp-1">
                            {g.description}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {isClosed ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-300 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                            🔒 Cerrado / Congelado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Abierto para carga
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            to={`/ejercicios?grupo=${g.id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50/60 px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 transition"
                            title="Configurar ejercicios obligatorios y entornos de este grupo"
                          >
                            <span>📋 Ejercicios</span>
                            {exerciseCount !== null && (
                              <span className="font-mono text-[10px] text-indigo-500">({exerciseCount})</span>
                            )}
                          </Link>
                          <Link
                            to={`/catalogo?grupo=${g.id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50/60 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 transition"
                            title="Configurar catálogo de errores y ponderaciones de este grupo"
                          >
                            <span>⚖️ Errores</span>
                            {errorRulesCount !== null && (
                              <span className="font-mono text-[10px] text-blue-500">({errorRulesCount})</span>
                            )}
                          </Link>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[11px]">
                        <div>{new Date(g.createdAt).toLocaleDateString("es-MX", { dateStyle: "medium" })}</div>
                        <div className="text-slate-400 font-normal">{g.createdBy}</div>
                      </td>
                      <td className="py-3 px-4 text-[11px]">
                        {isClosed && g.closedAt ? (
                          <div>
                            <div className="font-semibold text-slate-700">
                              {new Date(g.closedAt).toLocaleDateString("es-MX", { dateStyle: "medium" })}
                            </div>
                            <div className="text-slate-400 font-normal">{g.closedBy}</div>
                          </div>
                        ) : (
                          <span className="text-slate-400 font-normal italic">En progreso</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {!isClosed && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleStartEdit(g)}
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
                                title="Editar nombre o descripción"
                              >
                                Editar
                              </button>
                              {!isActive && (
                                <button
                                  type="button"
                                  onClick={() => handleSelectActive(g.id)}
                                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition shadow-xs"
                                >
                                  Fijar activo
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setClosingGroup(g)}
                                className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 transition shadow-xs"
                              >
                                🔒 Cerrar y Congelar
                              </button>
                            </>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => {
                                setDeletingGroup(g);
                                setConfirmDeleteText("");
                              }}
                              className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 transition shadow-xs"
                              title="Eliminar grupo y sus registros"
                            >
                              Eliminar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Crear Nuevo Grupo */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 mb-1">Crear Nuevo Grupo de Evaluación</h3>
            <p className="text-xs text-slate-500 mb-4">
              Ingresa el nombre descriptivo para agrupar las evaluaciones (ej. "Generación Octubre 2026", "Curso Mina Pinos").
            </p>

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nombre del Grupo *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Curso Intensivo 2026-A"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Descripción / Observaciones (Opcional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Detalles sobre el cliente, sede o instructores a cargo..."
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                    className={`flex flex-col items-start p-3 rounded-xl border text-left transition ${
                      newGroupType === "escuela"
                        ? "border-indigo-600 bg-indigo-50/70 text-indigo-900 ring-1 ring-indigo-600"
                        : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <span className="text-xs font-bold flex items-center gap-1.5">
                      🏫 Escuela
                    </span>
                    <span className="text-[10px] text-slate-500 mt-0.5">
                      Estructura de 6 Fases progresivas
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewGroupType("curso")}
                    className={`flex flex-col items-start p-3 rounded-xl border text-left transition ${
                      newGroupType === "curso"
                        ? "border-indigo-600 bg-indigo-50/70 text-indigo-900 ring-1 ring-indigo-600"
                        : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <span className="text-xs font-bold flex items-center gap-1.5">
                      🎯 Curso
                    </span>
                    <span className="text-[10px] text-slate-500 mt-0.5">
                      Sin fases: lista directa de ejercicios
                    </span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reglas Iniciales de Errores y Ejercicios
                </label>
                <select
                  value={sourceGroupId}
                  onChange={(e) => setSourceGroupId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">🌐 Copiar de Plantilla Global (Por defecto)</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      📋 Copiar reglas de «{g.name}»
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  El grupo tendrá su propia copia independiente de ejercicios y errores que podrás personalizar en cualquier momento.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating || !newGroupName.trim()}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50 transition"
                >
                  {creating ? "Creando..." : "Crear y Activar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Editar Nombre y Descripción de Grupo */}
      {editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 mb-1">Editar Información del Grupo</h3>
            <p className="text-xs text-slate-500 mb-4">
              Modifica el nombre o la descripción del grupo.
            </p>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nombre del Grupo *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Descripción / Observaciones (Opcional)
                </label>
                <textarea
                  rows={2}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={savingEdit}
                  onClick={() => setEditingGroup(null)}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingEdit || !editName.trim()}
                  className="rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50 transition"
                >
                  {savingEdit ? "Guardando..." : "Guardar Cambios"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirmar Cierre y Congelamiento */}
      {closingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-600 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">¿Cerrar y Congelar Grupo?</h3>
                <span className="text-xs font-medium text-slate-500">{closingGroup.name}</span>
              </div>
            </div>

            <div className="space-y-3 text-xs text-slate-600 mb-6 bg-amber-50/50 p-4 rounded-xl border border-amber-200/60">
              <p>
                <strong>Atención:</strong> Al congelar este grupo, todas las calificaciones, dictámenes, conteo de errores y deducciones de telemetría se calcularán con las reglas y catálogo actuales y <strong>se congelarán permanentemente</strong> en la base de datos.
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-600">
                <li>Futuros cambios en el catálogo de errores no alterarán los resultados de este grupo.</li>
                <li>Futuras modificaciones en ponderaciones o severidades respetarán este cierre.</li>
                <li>Ya no podrán cargarse nuevas evaluaciones a este grupo.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                disabled={closing}
                onClick={() => setClosingGroup(null)}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={closing}
                onClick={handleCloseGroup}
                className="rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:from-amber-700 hover:to-orange-700 disabled:opacity-50 transition"
              >
                {closing ? "Congelando evaluaciones..." : "Sí, Cerrar y Congelar Grupo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmar Eliminación */}
      {deletingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-2xl">
            <h3 className="text-base font-bold text-rose-900 mb-1">Eliminar Grupo</h3>
            <p className="text-xs text-slate-600 mb-4">
              Esta acción eliminará el grupo y todas sus evaluaciones asociadas de forma irreversible.
            </p>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Escribe exactamente <span className="font-bold text-rose-700">{deletingGroup.name}</span> para confirmar:
              </label>
              <input
                type="text"
                value={confirmDeleteText}
                onChange={(e) => setConfirmDeleteText(e.target.value)}
                className="w-full rounded-xl border border-rose-300 px-3.5 py-2 text-xs font-medium text-slate-900 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeletingGroup(null)}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleting || confirmDeleteText !== deletingGroup.name}
                onClick={handleDeleteGroup}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50 transition"
              >
                {deleting ? "Eliminando..." : "Eliminar Definitivamente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

