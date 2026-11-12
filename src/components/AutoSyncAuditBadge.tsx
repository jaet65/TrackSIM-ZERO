import { useAutoSyncContext } from "./AutoSyncContext";

export default function AutoSyncAuditBadge() {
  const autoSync = useAutoSyncContext();

  if (!autoSync || !autoSync.isElectron) return null;

  const { queue, openAuditModal } = autoSync;
  const pendingCount = queue.length;
  if (pendingCount === 0) return null;

  const hasCritical = queue.some((item) => item.criticalCount > 0);

  return (
    <button
      type="button"
      onClick={() => openAuditModal(0)}
      className={`flex items-center gap-1 rounded-xl px-2.5 py-1 text-[11px] font-semibold text-white shadow-xs transition active:scale-95 ${
        hasCritical
          ? "bg-rose-600 hover:bg-rose-700 animate-pulse"
          : "bg-indigo-600 hover:bg-indigo-700"
      }`}
      title="Ver evaluaciones terminadas pendientes de auditar"
    >
      <span>{hasCritical ? "🚨" : "🔔"}</span>
      <span>{pendingCount}</span>
      <span className="hidden sm:inline font-normal">por auditar</span>
    </button>
  );
}

