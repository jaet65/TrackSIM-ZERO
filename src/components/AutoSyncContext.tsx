import React, { createContext, useContext, useState } from "react";
import { useAutoSync, type PendingAuditItem } from "../lib/useAutoSync";
import { useAuth } from "./AuthProvider";
import type { GroupDoc } from "../lib/groups";
import AuditQueueModal from "./AuditQueueModal";

interface AutoSyncContextValue {
  enabled: boolean;
  toggleAutoSync: () => Promise<void>;
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

  const openAuditModal = (index = 0) => {
    setSelectedIndex(index);
    setIsModalOpen(true);
  };

  const value: AutoSyncContextValue = {
    enabled: autoSync.enabled,
    toggleAutoSync: autoSync.toggleAutoSync,
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
    </AutoSyncContext.Provider>
  );
}

export function useAutoSyncContext() {
  const ctx = useContext(AutoSyncContext);
  return ctx;
}
