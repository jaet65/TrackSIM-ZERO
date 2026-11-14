import { useAutoSyncContext } from "./AutoSyncContext";

export default function AutoSyncBadge() {
  const autoSync = useAutoSyncContext();
  if (!autoSync || !autoSync.isElectron) return null;

  const {
    enabled,
    toggleAutoSync,
    isPolling,
    dbConnected,
    queue,
    openAuditModal,
  } = autoSync;

  const pendingCount = queue.length;
  const hasCritical = queue.some((item) => item.criticalCount > 0);
  const connectionUnavailable = enabled && dbConnected === false;
  const connectionLabel = connectionUnavailable
    ? "Sin acceso a la BD de Lander"
    : enabled && dbConnected === true
      ? "Conectado al simulador Lander"
      : enabled
        ? "Buscando conexión con Lander DB..."
        : "AutoSync Off · clic para activar";
  const statusClass = connectionUnavailable
    ? "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
    : enabled
      ? dbConnected === true
        ? "border-emerald-200/80 bg-emerald-50/60 text-emerald-800 hover:bg-emerald-100/70"
        : "border-amber-200/80 bg-amber-50/60 text-amber-800 hover:bg-amber-100/70"
      : "border-slate-200 bg-white/60 text-slate-500 hover:border-slate-300 hover:text-slate-700";

  return (
    <div className="flex items-center gap-1.5">
        {/* Interruptor sutil tipo pill */}
        <button
          type="button"
          onClick={toggleAutoSync}
          title={`${connectionLabel}${enabled ? " (clic para desactivar)" : ""}`}
          aria-label={connectionLabel}
          className={`group flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-medium transition ${statusClass}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full transition-colors ${connectionUnavailable ? "bg-rose-600 ring-2 ring-rose-200" : enabled ? dbConnected === true ? "bg-emerald-500 ring-2 ring-emerald-200" : "bg-amber-500 ring-2 ring-amber-200" : "bg-slate-300 group-hover:bg-slate-400"}`}
          />
          <span className="hidden sm:inline">
            {connectionUnavailable
              ? "Sin conexión"
              : enabled
              ? isPolling
                ? "Auto-Sync..."
                : "Auto-Sync"
              : "AutoSync Off"}
          </span>
        </button>

        {/* Badge discreto de Cola Pendiente */}
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={() => openAuditModal(0)}
            className={`flex items-center gap-1 rounded-xl px-2.5 py-1 text-[11px] font-semibold text-white shadow-xs transition active:scale-95 ${
              hasCritical
                ? "bg-rose-600 hover:bg-rose-700"
                : "bg-indigo-600 hover:bg-indigo-700"
            }`}
            title="Ver evaluaciones terminadas pendientes de auditar"
          >
            <span>{hasCritical ? "🚨" : "🔔"}</span>
            <span>{pendingCount}</span>
          </button>
        )}
    </div>
  );
}

