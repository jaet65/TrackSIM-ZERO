import NetworkStatusBadge from "./NetworkStatusBadge";
import AutoSyncButton from "./AutoSyncButton";
import SimulatorLiveBadge from "./SimulatorLiveBadge";

export default function StatusBar() {
  return (
    <footer className="sticky bottom-0 z-30 flex h-8 shrink-0 items-center justify-between border-t border-slate-200/80 bg-white/95 px-4 text-xs backdrop-blur-xs select-none">
      <div className="flex items-center gap-3">
        <NetworkStatusBadge />
        <SimulatorLiveBadge />
      </div>

      <div className="flex items-center gap-3">
        <AutoSyncButton />
      </div>
    </footer>
  );
}

