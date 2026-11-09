import { describe, expect, it, vi } from "vitest";
import { createDownloadCoordinator, installAfterDownload, isValidInstallerSize } from "../../electron/updateDownload";

describe("actualizaciones de escritorio", () => {
  it("espera la descarga en curso antes de instalar y cerrar", async () => {
    const coordinator = createDownloadCoordinator();
    let complete!: (path: string) => void;
    const download = vi.fn(() => new Promise<string>((resolve) => { complete = resolve; }));
    const launch = vi.fn(async () => {});
    const exit = vi.fn();

    const background = coordinator.run("v2", download);
    const install = installAfterDownload(() => coordinator.run("v2", download), launch, exit);
    await Promise.resolve();
    expect(download).toHaveBeenCalledTimes(1);
    expect(launch).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    complete("installer.exe");
    await expect(background).resolves.toBe("installer.exe");
    await expect(install).resolves.toBe("installer.exe");
    expect(launch).toHaveBeenCalledWith("installer.exe");
    expect(exit).toHaveBeenCalledOnce();
    expect(launch.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]);
  });

  it("no instala ni cierra si la descarga falla y permite reintentar", async () => {
    const coordinator = createDownloadCoordinator();
    const launch = vi.fn(async () => {});
    const exit = vi.fn();
    const download = vi.fn().mockRejectedValueOnce(new Error("descarga fallida")).mockResolvedValueOnce("installer.exe");
    await expect(installAfterDownload(() => coordinator.run("v2", download), launch, exit)).rejects.toThrow("descarga fallida");
    expect(launch).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    await expect(installAfterDownload(() => coordinator.run("v2", download), launch, exit)).resolves.toBe("installer.exe");
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("no cierra si el instalador no pudo iniciarse", async () => {
    const exit = vi.fn();
    await expect(installAfterDownload(
      async () => "installer.exe",
      async () => { throw new Error("inicio fallido"); },
      exit
    )).rejects.toThrow("inicio fallido");
    expect(exit).not.toHaveBeenCalled();
  });

  it("rechaza otra versión mientras hay una descarga activa", async () => {
    const coordinator = createDownloadCoordinator();
    let complete!: (path: string) => void;
    const first = coordinator.run("v2", () => new Promise((resolve) => { complete = resolve; }));
    const otherDownload = vi.fn(async () => "v3.exe");
    await expect(coordinator.run("v3", otherDownload)).rejects.toThrow("otra actualización");
    expect(otherDownload).not.toHaveBeenCalled();
    await Promise.resolve();
    complete("v2.exe");
    await first;
    await expect(coordinator.run("v3", otherDownload)).resolves.toBe("v3.exe");
  });

  it("exige un archivo no vacío y el tamaño exacto cuando se conoce", () => {
    expect(isValidInstallerSize(0)).toBe(false);
    expect(isValidInstallerSize(15_000_000, 20_000_000)).toBe(false);
    expect(isValidInstallerSize(20_000_000, 20_000_000)).toBe(true);
    expect(isValidInstallerSize(42)).toBe(true);
  });
});
