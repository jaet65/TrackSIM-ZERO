import React, { createContext, useContext, useState } from "react";
import { useAutoSync, type PendingAuditItem } from "../lib/useAutoSync";
import { useAuth } from "./AuthProvider";
import type { GroupDoc } from "../lib/groups";
import AuditQueueModal from "./AuditQueueModal";
import { useEscapeKey } from "../lib/useEscapeKey";

interface AutoSyncContextValue {
  enabled: boolean;
  toggleAutoSync: () => void;
  isPolling: boolean;
  dbConnected: boolean | null;
  queue: PendingAuditItem[];
  activeGroup: GroupDoc | null;
  removeQueueItem: (id: number) => void;
  updateQueueItem: (id: number, updater: (prev: PendingAuditItem) => PendingAuditItem) => void;
  clearQueue: () => void;
  isElectron: boolean;
  openAuditModal: (index?: number) => void;
}

const AutoSyncContext = createContext<AutoSyncContextValue | null>(null);

export function AutoSyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const autoSync = useAutoSync({
    userEmail: user?.email || "",
    userName: user?.displayName || user?.email || "",
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingAutoSync, setPendingAutoSync] = useState<boolean | null>(null);
  const [isApplyingAutoSync, setIsApplyingAutoSync] = useState(false);

  const requestAutoSyncToggle = () => setPendingAutoSync(!autoSync.enabled);
  const closeAutoSyncConfirmation = () => {
    if (!isApplyingAutoSync) setPendingAutoSync(null);
  };

  useEscapeKey(pendingAutoSync !== null && !isApplyingAutoSync, closeAutoSyncConfirmation);

  const confirmAutoSyncToggle = async () => {
    if (pendingAutoSync === null || isApplyingAutoSync) return;
    setIsApplyingAutoSync(true);
    try {
      await autoSync.toggleAutoSync();
      setPendingAutoSync(null);
    } finally {
      setIsApplyingAutoSync(false);
    }
  };

  const openAuditModal = (index = 0) => {
    setSelectedIndex(index);
    setIsModalOpen(true);
  };

  const value: AutoSyncContextValue = {
    enabled: autoSync.enabled,
    toggleAutoSync: requestAutoSyncToggle,
    isPolling: autoSync.isPolling,
    dbConnected: autoSync.dbConnected,
    queue: autoSync.queue,
    activeGroup: autoSync.activeGroup,
    removeQueueItem: autoSync.removeQueueItem,
    updateQueueItem: autoSync.updateQueueItem,
    clearQueue: autoSync.clearQueue,
    isElectron: autoSync.isElectron,
    openAuditModal,
  };

  return (
    <AutoSyncContext.Provider value={value}>
      {children}
      {autoSync.isElectron && (
        <AuditQueueModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          queue={autoSync.queue}
          selectedIndex={selectedIndex}
          onSelectIndex={setSelectedIndex}
          onRemoveItem={autoSync.removeQueueItem}
          onUpdateItem={autoSync.updateQueueItem}
          onClearQueue={autoSync.clearQueue}
          activeGroupId={autoSync.activeGroup?.id}
          onEvaluationUpdated={() => {
            window.dispatchEvent(new CustomEvent("tracksim:evaluations-updated"));
          }}
        />
      )}
      {pendingAutoSync !== null && autoSync.isElectron && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={closeAutoSyncConfirmation}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="autosync-confirm-title"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 duration-150"
          >
            <div className={`h-1 ${pendingAutoSync ? "bg-emerald-500" : "bg-rose-500"}`} />
            <div className="p-6">
              <div className="flex items-start gap-4">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${pendingAutoSync ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    {pendingAutoSync ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 5v14m-7-7h14" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M8 5v14m8-14v14" />
                    )}
                  </svg>
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sincronización con Lander</p>
                  <h2 id="autosync-confirm-title" className="mt-1 text-lg font-semibold text-slate-900">
                    {pendingAutoSync ? "Activar Auto-Sync" : "Desactivar Auto-Sync"}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={closeAutoSyncConfirmation}
                  disabled={isApplyingAutoSync}
                  aria-label="Cerrar confirmación"
                  className="-mr-2 -mt-2 rounded-md p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>

              <div className="mt-5 space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                {pendingAutoSync ? (
                  <>
                    <p className="text-sm leading-5 text-slate-700">
                      TrackSIM revisará Lander automáticamente mientras la aplicación esté abierta y haya un grupo activo.
                    </p>
                    <p className="border-t border-slate-200 pt-3 text-sm leading-5 text-slate-600">
                      Las sesiones nuevas se guardarán y aparecerán en la cola de auditoría. No se volverán a importar sesiones ya procesadas.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm leading-5 text-slate-700">
                      Se detendrán las revisiones e importaciones automáticas desde Lander.
                    </p>
                    <p className="border-t border-slate-200 pt-3 text-sm leading-5 text-slate-600">
                      Las evaluaciones guardadas y los elementos pendientes de auditoría se conservarán.
                    </p>
                  </>
                )}
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeAutoSyncConfirmation}
                  disabled={isApplyingAutoSync}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmAutoSyncToggle}
                  disabled={isApplyingAutoSync}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-wait disabled:opacity-60 ${pendingAutoSync ? "bg-emerald-700 hover:bg-emerald-800" : "bg-rose-700 hover:bg-rose-800"}`}
                >
                  {isApplyingAutoSync ? "Aplicando..." : pendingAutoSync ? "Activar Auto-Sync" : "Desactivar Auto-Sync"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </AutoSyncContext.Provider>
  );
}

export function useAutoSyncContext() {
  const ctx = useContext(AutoSyncContext);
  return ctx;
}
