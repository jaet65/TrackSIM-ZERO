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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col selection:bg-indigo-600 selection:text-white">
      {/* Top Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-3 group">
              <img
                src="/Logo.png"
                alt="TrackSIM Logo"
                className="h-12 w-12 object-contain rounded-full shadow-sm group-hover:scale-105 transition"
              />
              <div>
                <span className="font-bold tracking-tight text-slate-900 group-hover:text-indigo-600 transition">
                  TrackSIM
                </span>
                <span className="ml-1.5 rounded-md bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                  PRO
                </span>
              </div>
            </Link>
            <UpdateNotifier />
          </div>

          <nav className="flex items-center gap-1 sm:gap-2">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${isActive
                  ? "bg-indigo-50 text-indigo-700 shadow-sm border border-indigo-200/60"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`
              }
            >
              Resultados
            </NavLink>
            <NavLink
              to="/grupos"
              className={({ isActive }) =>
                `rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${isActive
                  ? "bg-indigo-50 text-indigo-700 shadow-sm border border-indigo-200/60"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`
              }
            >
              Grupos
            </NavLink>
            <NavLink
              to="/ejercicios"
              className={({ isActive }) =>
                `rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${isActive
                  ? "bg-indigo-50 text-indigo-700 shadow-sm border border-indigo-200/60"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`
              }
            >
              Ejercicios
            </NavLink>
            <NavLink
              to="/catalogo"
              className={({ isActive }) =>
                `rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${isActive
                  ? "bg-indigo-50 text-indigo-700 shadow-sm border border-indigo-200/60"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`
              }
            >
              Errores
            </NavLink>

            <button
              type="button"
              onClick={() => setShowBackupModal(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:border-indigo-300 hover:bg-indigo-50/70 hover:text-indigo-700 transition"
              title="Copia de Seguridad y Restauración de Base de Datos"
            >
              <span>💾</span>
              <span>Respaldo</span>
            </button>
          </nav>

          <div className="flex items-center gap-2.5 sm:gap-3">
            <NetworkStatusBadge />
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-semibold text-slate-800">{user.displayName || "Usuario"}</span>
              <span className="text-[11px] text-slate-500">{user.email}</span>
            </div>
            <button
              onClick={logout}
              title="Cerrar sesión"
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 transition"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1">
        <Outlet />
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
