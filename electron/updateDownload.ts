export function createDownloadCoordinator() {
  let active: { key: string; promise: Promise<string> } | null = null;

  return {
    run(key: string, download: () => Promise<string>): Promise<string> {
      if (active) {
        if (active.key !== key) {
          return Promise.reject(new Error("Ya hay otra actualización descargándose. Inténtalo cuando termine."));
        }
        return active.promise;
      }
      const promise = Promise.resolve().then(download).finally(() => {
        if (active?.promise === promise) active = null;
      });
      active = { key, promise };
      return promise;
    },
    isDownloading(): boolean {
      return active !== null;
    },
  };
}

export function isValidInstallerSize(actualBytes: number, expectedBytes?: number): boolean {
  return actualBytes > 0 && (expectedBytes === undefined || actualBytes === expectedBytes);
}

export async function installAfterDownload(
  download: () => Promise<string>,
  launch: (installerPath: string) => Promise<void>,
  exit: () => void
): Promise<string> {
  const installerPath = await download();
  await launch(installerPath);
  exit();
  return installerPath;
}
