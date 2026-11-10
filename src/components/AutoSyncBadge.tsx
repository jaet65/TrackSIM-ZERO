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
      <div className="flex items-center gap-1.5">
        {/* Interruptor sutil tipo pill */}
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
          <span className="hidden sm:inline">
            {enabled
              ? isPolling
                ? "Auto-Sync..."
                : "Auto-Sync"
              : "Auto-Sync"}
          </span>
        </button>

        {/* Badge discreto de Cola Pendiente */}
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={() => handleOpenModal(0)}
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

