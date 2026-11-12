import { useAutoSyncContext } from "./AutoSyncContext";

export default function AutoSyncButton() {
  const autoSync = useAutoSyncContext();

  if (!autoSync || !autoSync.isElectron) return null;

  const { enabled, toggleAutoSync, isPolling, dbConnected } = autoSync;

  return (
    <button
      type="button"
      onClick={toggleAutoSync}
      title={
        enabled
          ? dbConnected
            ? "Auto-Sync activo · Conectado al simulador Lander (clic para desactivar)"
            : "Auto-Sync activo · Buscando conexión con Lander DB..."
          : "Activar Auto-Sync en vivo de Lander"
      }
      className={`group flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-medium transition ${
        enabled
          ? dbConnected
            ? "border-emerald-200/80 bg-emerald-50/60 text-emerald-800 hover:bg-emerald-100/70"
            : "border-amber-200/80 bg-amber-50/60 text-amber-800 hover:bg-amber-100/70"
          : "border-slate-200 bg-white/60 text-slate-500 hover:border-slate-300 hover:text-slate-700"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full transition-colors ${
          enabled
            ? dbConnected
              ? "bg-emerald-500 ring-2 ring-emerald-200"
              : "bg-amber-500 ring-2 ring-amber-200"
            : "bg-slate-300 group-hover:bg-slate-400"
        }`}
      />
      <span className="inline">
        {enabled
          ? isPolling
            ? "Auto-Sync..."
            : "Auto-Sync"
          : "Auto-Sync"}
      </span>
    </button>
  );
}

