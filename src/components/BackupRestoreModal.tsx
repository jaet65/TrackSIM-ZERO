import { useState, useRef } from "react";
import {
  downloadDatabaseBackup,
  restoreDatabaseBackup,
  type DatabaseBackupPackage,
} from "../lib/backupRestore";
import { isAdminEmail } from "../lib/config";
import { useAuth } from "./AuthProvider";

export default function BackupRestoreModal({
  isOpen,
  onClose,
  onRestored,
}: {
  isOpen: boolean;
  onClose: () => void;
  onRestored?: () => void;
}) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [progressMsg, setProgressMsg] = useState("");
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  if (!isOpen) return null;

  const canManage = isAdminEmail(user?.email);

  const handleDownload = async () => {
    setStatusMessage(null);
    setDownloading(true);
    try {
      await downloadDatabaseBackup();
      setStatusMessage({ type: "success", text: "Respaldo JSON generado y descargado correctamente." });
    } catch (err: unknown) {
      setStatusMessage({ type: "error", text: (err as Error).message || "Error al descargar respaldo." });
    } finally {
      setDownloading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusMessage(null);
    setRestoring(true);
    setProgressMsg("Leyendo archivo de respaldo…");

    try {
      const text = await file.text();
      const backupJson = JSON.parse(text) as DatabaseBackupPackage;

      if (!backupJson.metadata || !Array.isArray(backupJson.evaluations)) {
        throw new Error("El archivo no tiene el formato de respaldo válido de TrackSIM ZERO.");
      }

      const confirmed = window.confirm(
        `¿Deseas restaurar el respaldo del ${new Date(backupJson.metadata.timestamp).toLocaleString("es-MX")}?\n\n` +
        `• Evaluaciones: ${backupJson.evaluations.length}\n` +
        `• Grupos: ${backupJson.groups?.length || 0}\n\n` +
        `Las evaluaciones y grupos existentes se combinarán y actualizarán.`
      );

      if (!confirmed) {
        setRestoring(false);
        setProgressMsg("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      const result = await restoreDatabaseBackup(backupJson, (_cur, _tot, msg) => {
        setProgressMsg(msg);
      });

      setStatusMessage({
        type: "success",
        text: `Restauración exitosa: ${result.evaluationsRestored} evaluaciones y ${result.groupsRestored} grupos sincronizados.`,
      });

      onRestored?.();
    } catch (err: unknown) {
      setStatusMessage({
        type: "error",
        text: `Error al restaurar: ${(err as Error).message || "Formato inválido"}`,
      });
    } finally {
      setRestoring(false);
      setProgressMsg("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-600/25 text-xl">
              💾
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Respaldo y Restauración de Base de Datos
              </h3>
              <p className="text-xs text-slate-500">
                Ideal para simuladores offline o migración segura entre computadoras
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={restoring || downloading}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
          >
            ✕
          </button>
        </div>

        {statusMessage && (
          <div
            className={`rounded-xl border p-3 text-xs font-medium ${
              statusMessage.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {statusMessage.text}
          </div>
        )}

        <div className="space-y-4">
          {/* Tarjeta 1: Descargar Copia de Seguridad */}
          <div className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">
                1. Exportar Respaldo Completo (JSON)
              </span>
              <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                Instantáneo
              </span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Descarga un archivo con todas las evaluaciones, telemetrías, grupos de trabajo, catálogo de infracciones y configuración de ejercicios.
            </p>
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading || restoring}
              className="mt-2 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {downloading ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Generando copia de seguridad…</span>
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Descargar Respaldo JSON</span>
                </>
              )}
            </button>
          </div>

          {/* Tarjeta 2: Restaurar Respaldo */}
          <div className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">
                2. Restaurar o Importar Datos
              </span>
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                Lotes protegidos
              </span>
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Selecciona un archivo JSON generado previamente para sincronizarlo en esta instalación sin perder datos existentes.
            </p>

            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={restoring || downloading}
              className="mt-2 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50 transition"
            >
              {restoring ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                  <span>{progressMsg || "Restaurando base de datos…"}</span>
                </>
              ) : (
                <>
                  <svg className="h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span>Cargar y Restaurar JSON</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={restoring || downloading}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

