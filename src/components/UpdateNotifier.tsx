import { useEffect, useState, useCallback } from "react";
import pkg from "../../package.json";

export interface UpdateCheckResult {
  ok: boolean;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  noReleasesYet?: boolean;
  releaseName?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  publishedAt?: string | null;
  downloadUrl?: string | null;
  fileName?: string;
  assetSizeMB?: number | null;
  error?: string;
}

export interface DownloadProgress {
  percent: number;
  transferredMB: number;
  totalMB: number;
}

const GITHUB_OWNER = "jaet65";
const GITHUB_REPO = "TrackSIM-ZERO";

function parseSemver(v: string): number[] {
  const clean = (v || "").trim().replace(/^[vV]/, "").split("-")[0];
  return clean.split(".").map((n) => parseInt(n, 10) || 0);
}

function isNewerVersion(current: string, latest: string): boolean {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  const len = Math.max(c.length, l.length, 3);
  for (let i = 0; i < len; i++) {
    const lv = l[i] || 0;
    const cv = c[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

const getLanderBridge = () => {
  return typeof window !== "undefined" && (window as any).landerBridge
    ? (window as any).landerBridge
    : null;
};

export default function UpdateNotifier() {
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<UpdateCheckResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [upToDateNotice, setUpToDateNotice] = useState(false);

  const currentVersion = info?.currentVersion || pkg.version || "1.0.0";
  const isElectron = Boolean(getLanderBridge()?.checkForUpdates);

  const checkUpdates = useCallback(async (manual = false) => {
    setChecking(true);
    setActionError(null);
    if (manual) setUpToDateNotice(false);

    try {
      const bridge = getLanderBridge();
      let result: UpdateCheckResult;

      if (bridge?.checkForUpdates) {
        result = await bridge.checkForUpdates();
      } else {
        // Fallback para navegador web consultando API pública de GitHub
        const res = await fetch(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
          { headers: { Accept: "application/vnd.github+json" } }
        );
        if (res.status === 404) {
          result = {
            ok: true,
            currentVersion: pkg.version,
            latestVersion: pkg.version,
            updateAvailable: false,
            noReleasesYet: true,
          };
        } else if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        } else {
          const data = await res.json();
          const latestVersion = String(data.tag_name || "").replace(/^[vV]/, "");
          const assets: any[] = Array.isArray(data.assets) ? data.assets : [];
          const exeAsset =
            assets.find(
              (a) =>
                typeof a.name === "string" &&
                a.name.toLowerCase().endsWith(".exe") &&
                !a.name.toLowerCase().endsWith(".blockmap")
            ) || null;

          result = {
            ok: true,
            currentVersion: pkg.version,
            latestVersion,
            updateAvailable: isNewerVersion(pkg.version, latestVersion),
            releaseName: data.name || `v${latestVersion}`,
            releaseNotes: data.body || "",
            releaseUrl: data.html_url,
            publishedAt: data.published_at,
            downloadUrl: exeAsset ? exeAsset.browser_download_url : null,
            fileName: exeAsset ? exeAsset.name : undefined,
            assetSizeMB: exeAsset?.size
              ? Number((exeAsset.size / (1024 * 1024)).toFixed(1))
              : null,
          };
        }
      }

      setInfo(result);

      if (result.ok && result.updateAvailable) {
        setModalOpen(true);
      } else if (manual && result.ok && !result.updateAvailable) {
        setUpToDateNotice(true);
        setTimeout(() => setUpToDateNotice(false), 4000);
      }
    } catch (err: any) {
      setInfo({
        ok: false,
        currentVersion: pkg.version,
        error: err.message || "Error al verificar versión",
      });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    checkUpdates(false);
    const interval = setInterval(() => checkUpdates(false), 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkUpdates, isElectron]);

  useEffect(() => {
    const bridge = getLanderBridge();
    if (!bridge?.onUpdateProgress) return;
    const unsubscribe = bridge.onUpdateProgress((data: DownloadProgress) => {
      setProgress(data);
    });
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  if (!isElectron) return null;

  const handleInstall = async () => {
    if (!info) return;
    setActionError(null);
    const bridge = getLanderBridge();

    if (bridge?.downloadAndInstallUpdate && info.downloadUrl) {
      setDownloading(true);
      setProgress({ percent: 0, transferredMB: 0, totalMB: info.assetSizeMB || 0 });
      const res = await bridge.downloadAndInstallUpdate(info.downloadUrl, info.fileName);
      if (!res?.ok) {
        setDownloading(false);
        setActionError(res?.error || "No se pudo descargar el instalador automáticamente.");
      }
    } else {
      const targetUrl =
        info.downloadUrl ||
        info.releaseUrl ||
        `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
      if (bridge?.openExternalUrl) {
        await bridge.openExternalUrl(targetUrl);
      } else {
        window.open(targetUrl, "_blank", "noopener,noreferrer");
      }
    }
  };

  const handleOpenReleasePage = async () => {
    const url =
      info?.releaseUrl || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
    const bridge = getLanderBridge();
    if (bridge?.openExternalUrl) {
      await bridge.openExternalUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <>
      <div className="relative flex items-center gap-2">
        {info?.updateAvailable ? (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 px-3 py-1 text-[11px] font-bold text-white shadow-sm shadow-amber-500/30 hover:from-amber-600 hover:to-orange-700 transition animate-pulse"
            title={`Nueva versión v${info.latestVersion} disponible en GitHub`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Actualizar a v{info.latestVersion}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => checkUpdates(true)}
            disabled={checking}
            title="Haz clic para buscar actualizaciones en GitHub"
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/60 hover:text-indigo-700 transition disabled:opacity-60"
          >
            <span>v{currentVersion}</span>
            <svg
              className={`h-3 w-3 text-slate-400 ${checking ? "animate-spin text-indigo-600" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        )}

        {upToDateNotice && (
          <div className="absolute top-full right-0 mt-2 z-50 whitespace-nowrap rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 shadow-md">
            ✓ Tienes la versión más reciente (v{currentVersion})
          </div>
        )}
      </div>

      {/* Modal de Actualización Disponible */}
      {modalOpen && info?.updateAvailable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-600/25">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Nueva actualización disponible
                  </h3>
                  <p className="text-xs text-slate-500">
                    Versión actual:{" "}
                    <span className="font-semibold text-slate-700">v{info.currentVersion}</span>
                    {" → "}
                    Nueva:{" "}
                    <span className="font-bold text-indigo-600">v{info.latestVersion}</span>
                  </p>
                </div>
              </div>

              {!downloading && (
                <button
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {info.releaseNotes && (
              <div className="mt-4 max-h-44 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-line">
                <div className="mb-1 font-semibold text-slate-800">
                  {info.releaseName || `Novedades en v${info.latestVersion}`}
                </div>
                {info.releaseNotes}
              </div>
            )}

            {info.assetSizeMB && !downloading && (
              <p className="mt-3 text-[11px] text-slate-500">
                Tamaño del instalador: <span className="font-semibold text-slate-700">{info.assetSizeMB} MB</span>
              </p>
            )}

            {downloading && (
              <div className="mt-5 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>Descargando instalador...</span>
                  <span>
                    {progress?.percent ?? 0}%
                    {progress?.totalMB
                      ? ` (${progress.transferredMB} / ${progress.totalMB} MB)`
                      : ""}
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 transition-all duration-200"
                    style={{ width: `${progress?.percent ?? 0}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  Al finalizar la descarga se abrirá el instalador automáticamente y TrackSIM ZERO se reiniciará.
                </p>
              </div>
            )}

            {actionError && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                {actionError}
              </div>
            )}

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={handleOpenReleasePage}
                disabled={downloading}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                Ver en GitHub
              </button>

              {!downloading && (
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Más tarde
                </button>
              )}

              <button
                type="button"
                onClick={handleInstall}
                disabled={downloading}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-indigo-600/25 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-60"
              >
                {downloading ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Instalando...
                  </>
                ) : isElectron && info.downloadUrl ? (
                  "Descargar e instalar ahora"
                ) : (
                  "Descargar instalador"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

