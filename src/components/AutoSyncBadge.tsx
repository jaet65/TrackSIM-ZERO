import React, { useState } from "react";
import { useAutoSync } from "../lib/useAutoSync";
import AuditQueueModal from "./AuditQueueModal";
import { useAuth } from "./AuthProvider";

export default function AutoSyncBadge() {
  const { user } = useAuth();
  const {
    enabled,
    toggleAutoSync,
    isPolling,
    dbConnected,
    queue,
    activeGroup,
    removeQueueItem,
    clearQueue,
    isElectron,
  } = useAutoSync({
    userEmail: user?.email || "",
    userName: user?.displayName || user?.email || "",
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Si no está corriendo en Electron, no mostramos el widget de Lander
  if (!isElectron) return null;

  const pendingCount = queue.length;
  const hasCritical = queue.some((item) => item.criticalCount > 0);

  const handleOpenModal = (index = 0) => {
    setSelectedIndex(index);
    setIsModalOpen(true);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Interruptor / Botón de Auto-Sync */}
        <button
          type="button"
          onClick={toggleAutoSync}
          title={
            enabled
              ? dbConnected
                ? "Auto-Sync Activo · Conectado al simulador Lander"
                : "Auto-Sync Activo · Intentando reconectar a la BD..."
              : "Activar Auto-Sync en Vivo de Lander"
          }
          className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold shadow-sm transition ${
            enabled
              ? dbConnected
                ? "border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                : "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
          }`}
        >
          <span className="relative flex h-2 w-2">
            {enabled && (
              <span
                className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                  dbConnected ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                enabled
                  ? dbConnected
                    ? "bg-emerald-500"
                    : "bg-amber-500"
                  : "bg-slate-400"
              }`}
            />
          </span>
          <span className="hidden sm:inline">
            {enabled ? (isPolling ? "Sincronizando..." : "Auto-Sync Lander") : "Auto-Sync OFF"}
          </span>
        </button>

        {/* Badge de Cola Pendiente */}
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={() => handleOpenModal(0)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white shadow-md transition active:scale-95 animate-bounce ${
              hasCritical
                ? "bg-rose-600 hover:bg-rose-700 shadow-rose-600/30"
                : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/30"
            }`}
            title="Ver cola de sesiones terminadas pendientes de auditar"
          >
            <span>{hasCritical ? "🚨" : "🔔"}</span>
            <span>{pendingCount} por auditar</span>
          </button>
        )}
      </div>

      {/* Modal de Auditoría */}
      <AuditQueueModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        queue={queue}
        selectedIndex={selectedIndex}
        onSelectIndex={setSelectedIndex}
        onRemoveItem={removeQueueItem}
        onClearQueue={clearQueue}
        activeGroupId={activeGroup?.id}
      />
    </>
  );
}

