import { app, BrowserWindow, ipcMain, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { spawn } from "child_process";
import { Client } from "pg";

const GITHUB_OWNER = "jaet65";
const GITHUB_REPO = "TrackSIM-ZERO";

// Ruta del archivo de configuración (config.json en el userData de la app o local)
function getConfigPath() {
  const userData = app.getPath("userData");
  return path.join(userData, "tracksim_db_config.json");
}

function getDbConfig() {
  const cfgPath = getConfigPath();
  const defaultConfig = {
    host: "192.168.153.2",
    port: 5496,
    database: "landerlocaldb",
    user: "administrator",
    password: "landeraccess",
  };

  if (fs.existsSync(cfgPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      return { ...defaultConfig, ...data };
    } catch {
      return defaultConfig;
    }
  }
  return defaultConfig;
}

function saveDbConfig(newConfig: Record<string, any>) {
  const cfgPath = getConfigPath();
  const current = getDbConfig();
  const merged = { ...current, ...newConfig };
  fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return "00:00:00";
  const sec = Math.floor(seconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function slugify(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

async function createPgClient() {
  const cfg = getDbConfig();
  const client = new Client({
    host: cfg.host,
    port: Number(cfg.port) || 5496,
    database: cfg.database || "landerlocaldb",
    user: cfg.user || "administrator",
    password: String(cfg.password || ""),
    connectionTimeoutMillis: 4000,
  });
  await client.connect();
  return client;
}

// Generador de CSV idéntico al de Lander
async function generateCsvForSession(client: Client, sessionRow: any): Promise<{ filename: string; csv: string }> {
  const idSesion = sessionRow.id;
  const nombreAlumno = sessionRow.sstudentname || "-";
  const fecha = sessionRow.dtcreation ? new Date(sessionRow.dtcreation) : new Date();
  const instructor = sessionRow.sinstructorname || "-";
  const duracion = Number(sessionRow.duration) || 0;
  const idAula = sessionRow.idaula;

  const lines: string[] = [];
  const add = (...cells: (string | number)[]) => lines.push(cells.join(";"));

  add("Informe de sesión", "");
  add();

  let leccion = "N/A", unidad = "N/A", ejercicio = "N/A";
  try {
    const infoRes = await client.query(`
      SELECT edunits.sname AS edunit, lessons.sname AS lesson, exercises.sname AS exercise
      FROM sessions, exercises, lessons, idxexerciseslessons, edunits, idxlessonsedunits
      WHERE sessions.id = $1
        AND sessions.idexercise = exercises.id
        AND idxexerciseslessons.idexercise = exercises.id
        AND idxexerciseslessons.idlesson = lessons.id
        AND idxlessonsedunits.idlesson = lessons.id
        AND idxlessonsedunits.idedunit = edunits.id
    `, [idSesion]);

    if (infoRes.rows.length > 0) {
      leccion = infoRes.rows[0].edunit || "N/A";
      unidad = infoRes.rows[0].lesson || "N/A";
      ejercicio = infoRes.rows[0].exercise || "N/A";
    } else {
      const snameRes = await client.query("SELECT sname FROM sessions WHERE id = $1", [idSesion]);
      if (snameRes.rows.length && snameRes.rows[0].sname) {
        const parts = snameRes.rows[0].sname.split("\n").map((p: string) => p.trim()).filter(Boolean);
        if (parts.length >= 3) {
          [leccion, unidad, ejercicio] = parts;
        } else if (parts.length === 2) {
          [leccion, unidad] = parts;
        } else if (parts.length === 1) {
          leccion = parts[0];
        }
      }
    }
  } catch {}

  add("Lección", "Unidad", "Ejercicio");
  add(leccion, unidad, ejercicio);
  add();

  const fechaStr = fecha.toISOString().split("T")[0];
  add("FECHA", "CONDUCTOR", "INSTRUCTOR", "DURACIÓN");
  add(fechaStr, instructor, nombreAlumno, formatDuration(duracion));
  add();

  add();
  add("Condiciones iniciales", "");
  add();
  try {
    const extraRes = await client.query(`
      SELECT
        substring(sessionsextradata.sdescription from '[^:]+'),
        sessionsextradata.svalue
      FROM idxsessionsextradatasessions, sessionsextradata
      WHERE idxsessionsextradatasessions.idsessionsextradata = sessionsextradata.id
        AND idxsessionsextradatasessions.idsession = $1
        AND idxsessionsextradatasessions.IdAulaSession = $2
    `, [idSesion, idAula]);

    for (const r of extraRes.rows) {
      add((r.substring || "") + ":", r.svalue || "");
    }
  } catch {}
  add();

  let comentarios = "";
  try {
    const cRes = await client.query(`
      SELECT exercises.scomments
      FROM sessions, exercises
      WHERE sessions.idexercise = exercises.id
        AND sessions.id = $1
    `, [idSesion]);
    if (cRes.rows.length && cRes.rows[0].scomments) comentarios = cRes.rows[0].scomments;
  } catch {}
  add("Comentarios", "");
  add(comentarios);
  add();

  let palabrasClave = "";
  try {
    const tRes = await client.query(`
      SELECT exercises.stags
      FROM sessions, exercises
      WHERE sessions.idexercise = exercises.id
        AND sessions.id = $1
    `, [idSesion]);
    if (tRes.rows.length && tRes.rows[0].stags) palabrasClave = tRes.rows[0].stags;
  } catch {}
  add("Palabras clave del ejercicio", "");
  add(palabrasClave);
  add();

  let notas = "";
  try {
    const nRes = await client.query("SELECT instructornotes FROM sessions WHERE id = $1", [idSesion]);
    if (nRes.rows.length && nRes.rows[0].instructornotes) notas = nRes.rows[0].instructornotes;
  } catch {}
  add("Notas del instructor", "");
  add(notas);
  add();

  add();
  add("Marcas", "");
  add();
  try {
    const marksRes = await client.query(`
      SELECT marks.ncicle*sessions.dcicleperiod/1000.0 AS tiempo,
             marks.stipo,
             marks.scomment
      FROM sessions, marks, idxmarkssessions
      WHERE sessions.id = $1
        AND sessions.IdAula = $2
        AND idxmarkssessions.idsession = sessions.id
        AND idxmarkssessions.idmark = marks.id
      ORDER BY marks.ncicle ASC
    `, [idSesion, idAula]);

    for (const m of marksRes.rows) {
      add(formatDuration(Number(m.tiempo)), m.stipo || "", m.scomment || "");
    }
  } catch {}
  add();

  add();
  add("Resumen de marcas", "");
  add();
  try {
    const sumRes = await client.query(`
      SELECT marks.stipo, marks.scomment, COUNT(marks.id) as cantidad
      FROM marks, idxmarkssessions, sessions
      WHERE idxmarkssessions.idsession = sessions.id
        AND idxmarkssessions.idmark = marks.id
        AND sessions.id = $1
        AND sessions.IdAula = $2
        AND sessions.ncicles*sessions.dcicleperiod > 0
      GROUP BY marks.stipo, marks.scomment
      ORDER BY marks.stipo, COUNT(marks.id) DESC
    `, [idSesion, idAula]);

    const byType: Record<string, Array<{ comment: string; count: number }>> = {};
    for (const r of sumRes.rows) {
      if (!byType[r.stipo]) byType[r.stipo] = [];
      byType[r.stipo].push({ comment: r.scomment, count: Number(r.cantidad) });
    }

    const tiposOrdenados = [
      ["ERROR", "Errores"],
      ["BREAKDOWN", "Averias"],
      ["START EVENT", "Incidencias"],
      ["MARK", "Marcas"],
      ["WEATHER", "Eventos de clima"],
      ["ILLUMINATION", "Eventos de iluminacion"],
      ["TRAFFIC", "Eventos de trafico"],
      ["START COMM", "Comunicaciones"],
      ["ENDING", "Desenlaces"],
      ["INFO", "Mensajes de informacion"],
      ["STUDENT MARK", "Marcas de alumno"],
      ["MESSAGE", "Mensajes"],
      ["TRAIN_LOAD", "Evento de carga de tren"],
      ["TRAFFIC_CONDS", "Evento de condiciones de trafico"],
      ["PULSADOR", "Pulsador"]
    ];

    let hasMarks = false;
    for (const [tipoDb, tipoLabel] of tiposOrdenados) {
      if (byType[tipoDb]) {
        hasMarks = true;
        add(tipoLabel, "");
        for (const item of byType[tipoDb]) {
          add(item.comment, item.count);
        }
        add();
      }
    }
    if (!hasMarks) {
      add("La sesion no contiene marcas");
      add();
    }
  } catch {}
  add();

  add();
  add("Indicadores genéricos", "");
  add();
  try {
    const indRes = await client.query(`
      SELECT
        genericindics.sdescription,
        substring(genericindics.svalue from '[0-9.:]+') AS val,
        substring(genericindics.svalue from '[^0-9.:].*') AS unit
      FROM idxgenindicssessions, genericindics
      WHERE idxgenindicssessions.idgenindics = genericindics.id
        AND idxgenindicssessions.idsession = $1
    `, [idSesion]);

    for (const r of indRes.rows) {
      add(r.sdescription || "", r.val || "", r.unit || "");
    }
  } catch {}

  const alumnoLimpio = slugify(nombreAlumno);
  const filename = `ID${idSesion}_${alumnoLimpio}_${fechaStr}.csv`;
  return { filename, csv: lines.join("\r\n") };
}

// --------------------------------------------------------
// Servidor HTTP embebido para Producción en localhost
// Permite que Firebase Auth valide el dominio autorizado "localhost"
// y que location.protocol sea http:
// --------------------------------------------------------
let localStaticServer: http.Server | null = null;

function startEmbeddedStaticServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const distDir = path.join(__dirname, "../dist");

    const srv = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url || "/", "http://localhost");
      let cleanPath = decodeURIComponent(parsedUrl.pathname);
      if (cleanPath === "/") cleanPath = "/index.html";

      let filePath = path.join(distDir, cleanPath);

      // Si el archivo no existe, devolver index.html (SPA fallback)
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(distDir, "index.html");
      }

      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".json": "application/json; charset=utf-8",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".svg": "image/svg+xml",
          ".ico": "image/x-icon",
        };
        res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    // Intentamos escuchar en un puerto libre de loopback (127.0.0.1 / localhost)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        localStaticServer = srv;
        resolve(addr.port);
      } else {
        reject(new Error("Could not bind static server"));
      }
    });

    srv.on("error", reject);
  });
}

// --------------------------------------------------------
// Ventana de Electron y Comunicación IPC
// --------------------------------------------------------
let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "TrackSIM ZERO",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  mainWindow.maximize();
  mainWindow.show();

  const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
  if (isDev) {
    // Si estamos en modo desarrollo con Vite corriendo en 5173, conectamos ahí;
    // si no responde 5173, levantamos el servidor estático embebido de dist
    try {
      await mainWindow.loadURL("http://localhost:5173");
    } catch {
      const port = await startEmbeddedStaticServer();
      await mainWindow.loadURL(`http://localhost:${port}`);
    }
  } else {
    const port = await startEmbeddedStaticServer();
    await mainWindow.loadURL(`http://localhost:${port}`);
  }

  // Interceptar la ventana de autenticación Google para permitir que el popup complete el flujo OAuth
  mainWindow.webContents.setWindowOpenHandler(() => {
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        width: 600,
        height: 700,
        autoHideMenuBar: true,
      },
    };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle("lander:checkStatus", async () => {
  const cfg = getDbConfig();
  const safeConfig = {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
  };

  try {
    const client = await createPgClient();
    await client.end();
    return { service: "running", db_connected: true, config: safeConfig };
  } catch (err: any) {
    return {
      service: "running",
      db_connected: false,
      config: safeConfig,
      error: err.message,
    };
  }
});

ipcMain.handle("lander:saveConfig", async (_, newConfig) => {
  try {
    saveDbConfig(newConfig);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("lander:countSessions", async (_, { inicio, fin, anon }) => {
  let client: Client | null = null;
  try {
    client = await createPgClient();
    let queryBase = `
      SELECT COUNT(*) as total
      FROM sessions 
      WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN $1 AND $2
    `;
    if (!anon) {
      queryBase += " AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')";
    }
    const res = await client.query(queryBase, [inicio, fin]);
    const total = Number(res.rows[0]?.total) || 0;

    let min_date = null, max_date = null;
    if (total > 0) {
      let qDates = `
        SELECT MIN(CAST(dtcreation AS DATE)) as min_d, MAX(CAST(dtcreation AS DATE)) as max_d
        FROM sessions 
        WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN $1 AND $2
      `;
      if (!anon) {
        qDates += " AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')";
      }
      const dRes = await client.query(qDates, [inicio, fin]);
      if (dRes.rows.length) {
        min_date = dRes.rows[0].min_d ? new Date(dRes.rows[0].min_d).toISOString().split("T")[0] : null;
        max_date = dRes.rows[0].max_d ? new Date(dRes.rows[0].max_d).toISOString().split("T")[0] : null;
      }
    }

    return { ok: true, total, min_date, max_date };
  } catch (err: any) {
    return { ok: false, error: err.message };
  } finally {
    if (client) await client.end().catch(() => {});
  }
});

ipcMain.handle("lander:extractSessions", async (_, { inicio, fin, anon, limit }) => {
  let client: Client | null = null;
  try {
    client = await createPgClient();
    const lim = Number(limit) || 200;

    let q = `
      SELECT id, sstudentname, dtcreation, 
             sinstructorname, (ncicles * dcicleperiod / 1000.0) as duration,
             idexercise, idaula
      FROM sessions 
      WHERE ncicles > 0 AND CAST(dtcreation AS DATE) BETWEEN $1 AND $2
    `;
    if (!anon) {
      q += " AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')";
    }
    q += ` ORDER BY dtcreation DESC LIMIT ${lim};`;

    const res = await client.query(q, [inicio, fin]);
    const sessionsOut: any[] = [];

    for (const row of res.rows) {
      try {
        const { filename, csv } = await generateCsvForSession(client, row);
        sessionsOut.push({
          id: row.id,
          driver: row.sstudentname,
          date: row.dtcreation ? new Date(row.dtcreation).toISOString().split("T")[0] : "",
          filename,
          csv,
        });
      } catch (procErr: any) {
        sessionsOut.push({
          id: row.id,
          driver: row.sstudentname,
          error: procErr.message,
        });
      }
    }

    return { ok: true, extracted: sessionsOut.length, sessions: sessionsOut };
  } catch (err: any) {
    return { ok: false, error: err.message };
  } finally {
    if (client) await client.end().catch(() => {});
  }
});

// --------------------------------------------------------
// Auto-Updater en Segundo Plano contra GitHub Releases
// --------------------------------------------------------
let isBackgroundDownloading = false;
let downloadedInstallerPath: string | null = null;
let downloadedVersion: string | null = null;
let lastDownloadProgress: { percent: number; transferredMB: number; totalMB: number } | null = null;
let installOnQuit = true;
let installingNow = false;

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

function fetchJsonFromGitHub(apiPath: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.github.com${apiPath}`,
      {
        headers: {
          "User-Agent": "TrackSIM-ZERO-Updater",
          Accept: "application/vnd.github+json",
        },
        timeout: 10000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode || 500, data: parsed });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Tiempo de espera agotado al consultar GitHub Releases"));
    });
  });
}

function downloadFileWithProgress(
  url: string,
  destPath: string,
  onProgress: (info: { percent: number; transferredMB: number; totalMB: number }) => void,
  redirectsLeft = 5
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) {
      return reject(new Error("Demasiadas redirecciones al descargar el instalador"));
    }

    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "TrackSIM-ZERO-Updater",
          Accept: "application/octet-stream",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          downloadFileWithProgress(res.headers.location, destPath, onProgress, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new Error(`Error HTTP ${status} al descargar la actualización`));
        }

        const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
        let receivedBytes = 0;

        const fileStream = fs.createWriteStream(destPath);
        res.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (totalBytes > 0) {
            const percent = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
            onProgress({
              percent,
              transferredMB: Number((receivedBytes / (1024 * 1024)).toFixed(1)),
              totalMB: Number((totalBytes / (1024 * 1024)).toFixed(1)),
            });
          }
        });

        res.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close(() => resolve());
        });

        fileStream.on("error", (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }
    );

    req.on("error", (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function getInstallerDestPath(fileName: string, version: string): string {
  const fallback = `TrackSIM-ZERO-Setup-${version || "latest"}.exe`;
  const safeName = (fileName || fallback).replace(/[^a-zA-Z0-9._ -]/g, "_");
  return path.join(app.getPath("temp"), safeName);
}

async function startBackgroundDownload(
  downloadUrl: string,
  fileName: string,
  version: string,
  expectedBytes?: number
): Promise<string> {
  const destPath = getInstallerDestPath(fileName, version);

  // Si ya se descargó previamente en esta sesión o en temp con el tamaño esperado, reutilizarlo
  if (fs.existsSync(destPath)) {
    try {
      const stat = fs.statSync(destPath);
      if (!expectedBytes || stat.size === expectedBytes || stat.size > 10 * 1024 * 1024) {
        downloadedInstallerPath = destPath;
        downloadedVersion = version;
        lastDownloadProgress = {
          percent: 100,
          transferredMB: Number((stat.size / (1024 * 1024)).toFixed(1)),
          totalMB: Number((stat.size / (1024 * 1024)).toFixed(1)),
        };
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("updater:downloaded", {
            version,
            filePath: destPath,
          });
        }
        return destPath;
      }
    } catch {}
  }

  if (isBackgroundDownloading) {
    return destPath;
  }

  isBackgroundDownloading = true;
  const partPath = `${destPath}.part`;

  try {
    await downloadFileWithProgress(downloadUrl, partPath, (progress) => {
      lastDownloadProgress = progress;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("updater:downloadProgress", {
          ...progress,
          version,
        });
      }
    });

    if (fs.existsSync(destPath)) {
      try {
        fs.unlinkSync(destPath);
      } catch {}
    }
    fs.renameSync(partPath, destPath);

    downloadedInstallerPath = destPath;
    downloadedVersion = version;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("updater:downloaded", {
        version,
        filePath: destPath,
      });
    }
    return destPath;
  } finally {
    isBackgroundDownloading = false;
  }
}

function launchSilentInstaller(installerPath: string, restartAfterInstall: boolean) {
  if (!installerPath || !fs.existsSync(installerPath) || installingNow) return;
  installingNow = true;

  const escapedInstaller = installerPath.replace(/'/g, "''");
  const exePath = app.getPath("exe").replace(/'/g, "''");

  // Ejecuta el instalador NSIS en modo silencioso (/S) tras cerrar la app; si restartAfterInstall=true, relanza TrackSIM ZERO
  const psCommand = restartAfterInstall && app.isPackaged
    ? `Start-Sleep -Milliseconds 1500; Start-Process -FilePath '${escapedInstaller}' -ArgumentList '/S' -Wait; Start-Process -FilePath '${exePath}'`
    : `Start-Sleep -Milliseconds 1500; Start-Process -FilePath '${escapedInstaller}' -ArgumentList '/S' -Wait`;

  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psCommand],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }
  );
  child.unref();
}

ipcMain.handle("updater:check", async () => {
  const currentVersion = app.getVersion();
  try {
    let { status, data } = await fetchJsonFromGitHub(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
    );

    // Si /releases/latest devuelve 404 (p. ej. solo hay pre-releases o ningún release aún), consultamos /releases
    if (status === 404) {
      const listRes = await fetchJsonFromGitHub(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`);
      if (listRes.status === 200 && Array.isArray(listRes.data) && listRes.data.length > 0) {
        status = 200;
        data = listRes.data[0];
      } else {
        return {
          ok: true,
          currentVersion,
          latestVersion: currentVersion,
          updateAvailable: false,
          noReleasesYet: true,
        };
      }
    }

    if (status !== 200 || !data || !data.tag_name) {
      return {
        ok: false,
        currentVersion,
        error: data?.message || `Respuesta inesperada de GitHub (HTTP ${status})`,
      };
    }

    const latestVersion = String(data.tag_name).replace(/^[vV]/, "");
    const updateAvailable = isNewerVersion(currentVersion, latestVersion);

    // Buscar el instalador .exe entre los assets del release
    const assets: any[] = Array.isArray(data.assets) ? data.assets : [];
    const exeAsset =
      assets.find(
        (a) =>
          typeof a.name === "string" &&
          a.name.toLowerCase().endsWith(".exe") &&
          !a.name.toLowerCase().endsWith(".blockmap")
      ) || null;

    const downloadUrl = exeAsset ? exeAsset.browser_download_url : null;
    const fileName = exeAsset ? exeAsset.name : `TrackSIM-ZERO-Setup-${latestVersion}.exe`;
    const expectedSize = exeAsset?.size ? Number(exeAsset.size) : undefined;

    // Si hay actualización disponible con instalador .exe, iniciar descarga automática en segundo plano
    if (updateAvailable && downloadUrl) {
      startBackgroundDownload(downloadUrl, fileName, latestVersion, expectedSize).catch((err) => {
        console.error("Background update download error:", err);
      });
    }

    const isReadyToInstall =
      Boolean(downloadedInstallerPath && fs.existsSync(downloadedInstallerPath)) &&
      downloadedVersion === latestVersion;

    return {
      ok: true,
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseName: data.name || `v${latestVersion}`,
      releaseNotes: data.body || "",
      releaseUrl:
        data.html_url || `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
      publishedAt: data.published_at || null,
      downloadUrl,
      fileName,
      assetSizeMB: exeAsset?.size ? Number((exeAsset.size / (1024 * 1024)).toFixed(1)) : null,
      downloadingInBackground: isBackgroundDownloading,
      readyToInstall: isReadyToInstall,
      progress: lastDownloadProgress,
    };
  } catch (err: any) {
    return {
      ok: false,
      currentVersion,
      error: err.message || "No se pudo verificar actualizaciones en GitHub",
    };
  }
});

ipcMain.handle("updater:downloadAndInstall", async (_, { downloadUrl, fileName, version }) => {
  try {
    const targetVersion = version || downloadedVersion || "latest";

    // Si ya se descargó en segundo plano, aplicarlo de inmediato en modo silencioso y reiniciar
    if (downloadedInstallerPath && fs.existsSync(downloadedInstallerPath)) {
      launchSilentInstaller(downloadedInstallerPath, true);
      setTimeout(() => {
        app.quit();
      }, 400);
      return { ok: true, filePath: downloadedInstallerPath };
    }

    if (!downloadUrl) {
      throw new Error("No se encontró el archivo instalador (.exe) en el Release de GitHub.");
    }

    const destPath = await startBackgroundDownload(downloadUrl, fileName, targetVersion);
    launchSilentInstaller(destPath, true);

    setTimeout(() => {
      app.quit();
    }, 400);

    return { ok: true, filePath: destPath };
  } catch (err: any) {
    return { ok: false, error: err.message || "Error al descargar o iniciar el instalador" };
  }
});

ipcMain.handle("updater:openExternal", async (_, url: string) => {
  if (url && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
    return { ok: true };
  }
  return { ok: false, error: "URL no válida" };
});

// Registrar protocolo personalizado tracksim:// para abrir desde el navegador web
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("tracksim", process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient("tracksim");
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("will-quit", () => {
  // Si hay una actualización ya descargada en segundo plano, aplicarla silenciosamente al cerrar la app
  if (!installingNow && installOnQuit && downloadedInstallerPath && fs.existsSync(downloadedInstallerPath)) {
    launchSilentInstaller(downloadedInstallerPath, false);
  }
});

app.on("window-all-closed", () => {
  if (localStaticServer) {
    localStaticServer.close();
  }
  if (process.platform !== "darwin") app.quit();
});
