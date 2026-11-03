import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { ALLOWED_DOMAIN } from "../lib/config";
import UpdateNotifier from "./UpdateNotifier";
import NetworkStatusBadge from "./NetworkStatusBadge";
import BackupRestoreModal from "./BackupRestoreModal";

export default function ProtectedLayout() {
  const { user, loading, error, signIn, logout } = useAuth();
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"></div>
          <span className="text-sm font-medium tracking-wide">Iniciando sesión segura…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-slate-50 p-6 overflow-hidden">
        {/* Decorative soft gradient blobs */}
        <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-indigo-200/50 blur-3xl"></div>
        <div className="pointer-events-none absolute bottom-0 right-10 h-80 w-80 rounded-full bg-blue-100/60 blur-3xl"></div>

        <main className="relative z-10 w-full max-w-md space-y-6 rounded-2xl border border-slate-200/80 bg-white p-8 text-center shadow-xl shadow-slate-200/50 backdrop-blur-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-600/30">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">TrackSIM ZERO</h1>
            <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-indigo-600">
              Evaluación y Telemetría de Conductores
            </p>
          </div>

          <p className="text-sm text-slate-600 leading-relaxed">
            Ingreso restringido a instructores y personal con correo corporativo verificado{" "}
            <span className="font-semibold text-slate-800">@{ALLOWED_DOMAIN}</span>.
          </p>

          <button
            onClick={signIn}
            className="group relative flex w-full items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition duration-200 hover:from-indigo-700 hover:to-blue-700 hover:shadow-indigo-600/35 active:scale-[0.98]"
          >
            <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
              <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z" />
            </svg>
            Entrar con Google
          </button>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {error}
            </div>
          )}

          <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
            <NetworkStatusBadge />
            <UpdateNotifier />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 selection:bg-indigo-600 selection:text-white">
      <aside className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ${isSidebarExpanded ? "w-64" : "w-16"}`}>
          <Link to="/" className={`flex h-[73px] items-center gap-3 border-b border-slate-100 px-3 ${isSidebarExpanded ? "justify-start px-5" : "justify-center"}`}>
            <img src="/Logo.png" alt="TrackSIM Logo" className="h-10 w-10 shrink-0 rounded-full object-contain shadow-sm" />
            {isSidebarExpanded && <span className="whitespace-nowrap font-bold tracking-tight text-slate-900">
              TrackSIM <span className="ml-1 rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">PRO</span>
            </span>}
          </Link>

          <nav aria-label="Navegación principal" className={`flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-4 ${isSidebarExpanded ? "px-3" : "px-2"}`}>
            <NavLink
              to="/"
              end
              title="Resultados"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isSidebarExpanded ? "" : "justify-center"} ${isActive
                  ? "border border-indigo-200/60 bg-indigo-50 text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`
              }
            >
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5h5.25V21H3zM9.375 3h5.25v18h-5.25zM15.75 8.25H21V21h-5.25z" />
              </svg>
              {isSidebarExpanded && <span>Resultados</span>}
            </NavLink>
            <NavLink
              to="/grupos"
              title="Grupos"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isSidebarExpanded ? "" : "justify-center"} ${isActive
                  ? "border border-indigo-200/60 bg-indigo-50 text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`
              }
            >
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-7.87a4 4 0 0 1 0 7.75" />
              </svg>
              {isSidebarExpanded && <span>Grupos</span>}
            </NavLink>
            <NavLink
              to="/ejercicios"
              title="Ejercicios"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isSidebarExpanded ? "" : "justify-center"} ${isActive
                  ? "border border-indigo-200/60 bg-indigo-50 text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`
              }
            >
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m5-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              {isSidebarExpanded && <span>Ejercicios</span>}
            </NavLink>
            <NavLink
              to="/catalogo"
              title="Errores"
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isSidebarExpanded ? "" : "justify-center"} ${isActive
                  ? "border border-indigo-200/60 bg-indigo-50 text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`
              }
            >
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
              {isSidebarExpanded && <span>Errores</span>}
            </NavLink>

            <div className="my-3 border-t border-slate-100" />

            <button
              type="button"
              onClick={() => setShowBackupModal(true)}
              title="Copia de Seguridad y Restauración de Base de Datos"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-indigo-50/70 hover:text-indigo-700 ${isSidebarExpanded ? "" : "justify-center"}`}
            >
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4 4 4M4 16.5v2A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-2" />
              </svg>
              {isSidebarExpanded && <span>Respaldo</span>}
            </button>
            <a
              href="https://tracksim-cloud.web.app/"
              target="_blank"
              rel="noopener noreferrer"
              title="Abrir TrackSIM Cloud"
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-sky-50 hover:text-sky-700 ${isSidebarExpanded ? "" : "justify-center"}`}
            >
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 19h11a4 4 0 0 0 .58-7.958A6 6 0 0 0 6.35 9.16 4.5 4.5 0 0 0 6.5 19Z" />
              </svg>
              {isSidebarExpanded && <span>TrackSIM Cloud</span>}
            </a>
          </nav>

          <div className={`shrink-0 border-t border-slate-100 bg-white p-2 ${isSidebarExpanded ? "px-3" : ""}`}>
            <button
              type="button"
              onClick={() => setIsSidebarExpanded((expanded) => !expanded)}
              aria-label={isSidebarExpanded ? "Contraer navegación" : "Expandir navegación"}
              aria-expanded={isSidebarExpanded}
              title={isSidebarExpanded ? "Contraer navegación" : "Expandir navegación"}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 ${isSidebarExpanded ? "" : "justify-center"}`}
            >
              <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              {isSidebarExpanded && <span>Contraer</span>}
            </button>
          </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-md">
          <div className="flex min-h-[73px] items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              {!isSidebarExpanded && (
                <div className="truncate text-sm font-bold tracking-tight text-slate-900 sm:text-base">TrackSIM <span className="text-indigo-700">PRO</span></div>
              )}
              <UpdateNotifier />
            </div>

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <NetworkStatusBadge />
              <div className="hidden flex-col text-right sm:flex">
                <span className="text-xs font-semibold text-slate-800">{user.displayName || "Usuario"}</span>
                <span className="text-[11px] text-slate-500">{user.email}</span>
              </div>
              <button
                onClick={logout}
                title="Cerrar sesión"
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
              >
                Salir
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>

      {/* Modal Global de Respaldo y Restauración de Base de Datos */}
      <BackupRestoreModal
        isOpen={showBackupModal}
        onClose={() => setShowBackupModal(false)}
        onRestored={() => {
          window.location.reload();
        }}
      />
    </div>
  );
}
