import { useEffect, useState } from "react";
import { subscribeNetworkStatus, type NetworkStatus } from "../lib/firebase";

export default function NetworkStatusBadge() {
  const [status, setStatus] = useState<NetworkStatus>({
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    degraded: false,
    pendingWrites: 0,
    lastSyncedAt: Date.now(),
  });

  useEffect(() => {
    return subscribeNetworkStatus(setStatus);
  }, []);

  if (!status.online) {
    return (
      <div
        title="Sin conexión a internet. Puedes seguir consultando datos y subiendo evaluaciones; todo se guarda en este equipo y se sincronizará automáticamente al recuperar la red."
        className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 shadow-xs"
      >
        <span className="relative flex h-2 w-2">
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500"></span>
        </span>
        <span>
          Modo Offline
          {status.pendingWrites > 0 ? ` · ${status.pendingWrites} en cola` : " · Caché activa"}
        </span>
      </div>
    );
  }

  if (status.pendingWrites > 0) {
    return (
      <div
        title="Tus cambios ya están guardados localmente y se están subiendo a la nube en segundo plano."
        className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/90 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 shadow-xs"
      >
        <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        <span>Sincronizando ({status.pendingWrites})…</span>
      </div>
    );
  }

  if (status.degraded) {
    return (
      <div
        title="Se detectó una conexión a internet lenta o inestable. TrackSIM ZERO está usando la caché local para responder sin demoras."
        className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50/80 px-2.5 py-1 text-[11px] font-medium text-amber-700"
      >
        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
        <span className="hidden md:inline">Red lenta · Caché activa</span>
      </div>
    );
  }

  return (
    <div
      title="Conectado y sincronizado con la nube (respaldo local activo)"
      className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-emerald-200/80 bg-emerald-50/60 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      <span className="hidden lg:inline">Sincronizado</span>
    </div>
  );
}

