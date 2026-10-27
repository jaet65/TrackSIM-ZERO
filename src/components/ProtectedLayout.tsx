import { Link, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { ALLOWED_DOMAIN } from "../lib/config";

export default function ProtectedLayout() {
  const { user, loading, error, signIn, logout } = useAuth();

  if (loading) return <p className="p-6 text-gray-500">Cargando…</p>;

  if (!user) {
    return (
      <main className="mx-auto mt-24 max-w-sm space-y-4 rounded-lg border bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-bold">TrackSIM</h1>
        <p className="text-sm text-gray-600">Inicia sesión con tu cuenta @{ALLOWED_DOMAIN}</p>
        <button onClick={signIn} className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          Entrar con Google
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </main>
    );
  }

  return (
    <>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between p-3 text-sm">
          <Link to="/" className="font-semibold">TrackSIM</Link>
          <div className="flex items-center gap-3">
            <Link to="/ejercicios" className="text-blue-700 hover:underline">Ejercicios</Link>
            <Link to="/catalogo" className="text-blue-700 hover:underline">Catálogo de errores</Link>
            <span className="text-gray-600">{user.email}</span>
            <button onClick={logout} className="rounded border px-2 py-1 hover:bg-gray-50">Salir</button>
          </div>
        </div>
      </header>
      <Outlet />
    </>
  );
}
