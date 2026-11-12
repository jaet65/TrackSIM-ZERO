import { useEffect } from "react";
import { createPortal } from "react-dom";
import Driver from "../pages/Driver";
import { useEscapeKey } from "../lib/useEscapeKey";

export interface DriverModalProps {
  isOpen: boolean;
  onClose: () => void;
  driverId: string;
  groupId?: string;
  startDate?: string;
  endDate?: string;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  currentIndex?: number;
  totalDrivers?: number;
}

export default function DriverModal({
  isOpen,
  onClose,
  driverId,
  groupId = "",
  startDate = "",
  endDate = "",
  onNavigatePrev,
  onNavigateNext,
  hasPrev = false,
  hasNext = false,
  currentIndex,
  totalDrivers,
}: DriverModalProps) {
  useEscapeKey(isOpen, onClose);

  // Atajos de teclado: flechas izquierda / derecha para navegar entre conductores
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Evitar interceptar si el usuario está escribiendo en un input o select
      const activeTag = (document.activeElement?.tagName || "").toLowerCase();
      if (activeTag === "input" || activeTag === "textarea" || activeTag === "select") {
        return;
      }

      if (e.key === "ArrowLeft" && hasPrev && onNavigatePrev) {
        e.preventDefault();
        onNavigatePrev();
      } else if (e.key === "ArrowRight" && hasNext && onNavigateNext) {
        e.preventDefault();
        onNavigateNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, hasPrev, hasNext, onNavigatePrev, onNavigateNext]);

  // Bloquear scroll de fondo cuando el modal esté abierto
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen || !driverId) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Expediente del Conductor"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-full max-w-7xl max-h-[94vh] rounded-3xl bg-slate-50 shadow-2xl border border-slate-200/90 overflow-hidden"
      >
        <div className="flex-1 overflow-y-auto">
          <Driver
            driverId={driverId}
            groupId={groupId}
            startDate={startDate}
            endDate={endDate}
            onClose={onClose}
            onNavigatePrev={onNavigatePrev}
            onNavigateNext={onNavigateNext}
            hasPrev={hasPrev}
            hasNext={hasNext}
            currentIndex={currentIndex}
            totalDrivers={totalDrivers}
            isModal={true}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

