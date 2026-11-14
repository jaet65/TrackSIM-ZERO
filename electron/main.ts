import { app, BrowserWindow, ipcMain, shell, Notification } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { spawn } from "child_process";
import { pipeline } from "stream";
import { Client } from "pg";
import { autoUpdater } from "electron-updater";
import { createDownloadCoordinator, installAfterDownload, isValidInstallerSize } from "./updateDownload";

const GITHUB_OWNER = "jaet65";
const GITHUB_REPO = "TrackSIM-ZERO";

app.setName("TrackSIM PRO");

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
          ".webmanifest": "application/manifest+json; charset=utf-8",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".svg": "image/svg+xml",
          ".ico": "image/x-icon",
          ".woff": "font/woff",
          ".woff2": "font/woff2",
          ".ttf": "font/ttf",
        };
        res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    // Usamos un puerto fijo preferido (51799) para que el origen http://localhost:51799 sea siempre el mismo
    // entre reinicios de la app Electron y se conserven intactos IndexedDB (caché offline de Firestore + sesión Auth)
    // y localStorage incluso cuando el usuario abre la app sin internet.
    const candidatePorts = [51799, 51800, 51801, 0];
    let portIdx = 0;

    const tryListen = () => {
      const targetPort = candidatePorts[portIdx] ?? 0;
      const onError = (err: NodeJS.ErrnoException) => {
        if ((err.code === "EADDRINUSE" || err.code === "EACCES") && portIdx < candidatePorts.length - 1) {
          portIdx++;
          tryListen();
        } else {
          reject(err);
        }
      };
      srv.once("error", onError);
      srv.listen(targetPort, "127.0.0.1", () => {
        srv.removeListener("error", onError);
        const addr = srv.address();
        if (addr && typeof addr === "object") {
          localStaticServer = srv;
          resolve(addr.port);
        } else {
          reject(new Error("Could not bind static server"));
        }
      });
    };

    tryListen();
  });
}

// --------------------------------------------------------
// Ventana de Electron y Comunicación IPC
// --------------------------------------------------------
let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  const distIcon = path.join(__dirname, "../dist/favicon.png");
  const pubIcon = path.join(__dirname, "../public/favicon.png");
  const iconPath = fs.existsSync(distIcon) ? distIcon : fs.existsSync(pubIcon) ? pubIcon : undefined;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: "TrackSIM PRO",
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
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
        icon: iconPath,
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

ipcMain.handle("lander:getLatestSessionId", async () => {
  let client: Client | null = null;
  try {
    client = await createPgClient();
    const res = await client.query(`
      SELECT MAX(id) as max_id 
      FROM sessions 
      WHERE ncicles > 0
    `);
    const maxId = res.rows[0]?.max_id ? Number(res.rows[0].max_id) : 0;
    return { ok: true, maxId };
  } catch (err: any) {
    return { ok: false, error: err.message };
  } finally {
    if (client) await client.end().catch(() => {});
  }
});

ipcMain.handle("lander:extractNewSessions", async (_, { afterId, anon, limit }) => {
  let client: Client | null = null;
  try {
    client = await createPgClient();
    const minId = Number(afterId) || 0;
    const lim = Math.min(Number(limit) || 10, 50);

    let q = `
      SELECT id, sstudentname, dtcreation, 
             sinstructorname, (ncicles * dcicleperiod / 1000.0) as duration,
             idexercise, idaula
      FROM sessions 
      WHERE ncicles > 0 AND id > $1
    `;
    if (!anon) {
      q += " AND LOWER(sstudentname) NOT IN ('anonymous', 'anónimo')";
    }
    q += ` ORDER BY id ASC LIMIT ${lim};`;

    const res = await client.query(q, [minId]);
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

// Monitoreo en vivo del simulador (100% SOLO LECTURA)
ipcMain.handle("lander:getActiveSession", async () => {
  let client: Client | null = null;
  try {
    client = await createPgClient();
    // Forzamos la sesión como READ ONLY a nivel de protocolo PostgreSQL
    await client.query("SET TRANSACTION READ ONLY").catch(() => {});

    // Obtenemos la última sesión registrada en el simulador y la telemetría en curso
    const q = `
      SELECT 
        s.id, 
        s.sstudentname, 
        s.sinstructorname, 
        s.sname, 
        s.ncicles, 
        s.dcicleperiod, 
        s.dttimecreation, 
        EXTRACT(EPOCH FROM NOW())::bigint - s.dttimecreation AS wall_seconds,
        (SELECT COUNT(*)::int FROM idxmarkssessions m WHERE m.idsession = s.id) AS mark_count,
        (SELECT MAX(m.ncicle * 8.333 / 1000.0) FROM idxmarkssessions im JOIN marks m ON m.id = im.idmark WHERE im.idsession = s.id) AS latest_mark_sec
      FROM sessions s
      ORDER BY s.id DESC 
      LIMIT 1;
    `;
    const res = await client.query(q);
    const row = res.rows[0];

    if (!row) {
      return { ok: true, active: false };
    }

    const ncicles = Number(row.ncicles) || 0;
    const wallSeconds = Math.max(0, Number(row.wall_seconds) || 0);

    // Si ncicles == 0 y el inicio fue hace menos de 3600 segundos (1 hora), está en curso
    const isActive = ncicles === 0 && wallSeconds >= 0 && wallSeconds < 3600;

    // Sincronización precisa con el reloj del simulador Lander:
    // Lander tarda típicamente ~15 segundos entre que graba la sesión y el camión arranca (carga de escenario 3D).
    // Si ya hay marcas de telemetría de faltas/conducción, re-calibramos con el ciclo del simulador.
    const latestMarkSec = row.latest_mark_sec != null ? Number(row.latest_mark_sec) : null;
    let adjustedSeconds = Math.max(0, wallSeconds - 14);

    if (latestMarkSec != null && latestMarkSec > 0) {
      // Si la última marca está por delante del tiempo ajustado, sincronizamos directamente con ella
      if (latestMarkSec > adjustedSeconds) {
        adjustedSeconds = Math.round(latestMarkSec);
      }
    }

    return {
      ok: true,
      active: isActive,
      session: {
        id: row.id,
        driver: row.sstudentname || "Desconocido",
        instructor: row.sinstructorname || "",
        exercise: row.sname || "",
        startTime: Number(row.dttimecreation), // Epoch Unix en segundos
        elapsedSeconds: adjustedSeconds,
        ncicles,
        markCount: Number(row.mark_count) || 0,
      },
    };
  } catch (err: any) {
    return { ok: false, active: false, error: err.message };
  } finally {
    if (client) await client.end().catch(() => {});
  }
});

// Enviar notificación nativa de escritorio de Windows
ipcMain.handle("notify:showDesktop", async (_, { title, body }) => {
  try {
    if (Notification.isSupported()) {
      const pubIcon = path.join(__dirname, "../public/favicon.png");
      const distIcon = path.join(__dirname, "../dist/favicon.png");
      const iconPath = fs.existsSync(pubIcon) ? pubIcon : fs.existsSync(distIcon) ? distIcon : undefined;

      const notif = new Notification({
        title: title || "TrackSIM PRO",
        body: body || "",
        icon: iconPath,
        silent: false,
      });

      notif.on("click", () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });

      notif.show();
      return { ok: true };
    }
    return { ok: false, error: "Notificaciones no soportadas" };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

// --------------------------------------------------------
// Auto-Updater en Segundo Plano contra GitHub Releases
// --------------------------------------------------------
const downloadCoordinator = createDownloadCoordinator();
let downloadedInstallerPath: string | null = null;
let downloadedVersion: string | null = null;
let lastDownloadProgress: { percent: number; transferredMB: number; totalMB: number } | null = null;
let installingNow = false;
let differentialDownloadPromise: Promise<void> | null = null;
let differentialUpdateReady = false;
let differentialUpdateVersion: string | null = null;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false;

function sendUpdateEvent(channel: string, data: Record<string, unknown>) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function startDifferentialDownload(): Promise<void> {
  if (differentialUpdateReady) return Promise.resolve();
  if (differentialDownloadPromise) return differentialDownloadPromise;

  differentialDownloadPromise = autoUpdater.downloadUpdate().then(() => undefined).catch((err) => {
    differentialDownloadPromise = null;
    sendUpdateEvent("updater:downloadError", {
      version: differentialUpdateVersion,
      error: err instanceof Error ? err.message : "No se pudo descargar la actualización.",
    });
    throw err;
  });
  return differentialDownloadPromise;
}

autoUpdater.on("update-available", (updateInfo) => {
  differentialUpdateVersion = updateInfo.version;
  differentialUpdateReady = false;
  lastDownloadProgress = null;
  startDifferentialDownload().catch((err) => {
    console.error("Differential update download error:", err);
  });
});

autoUpdater.on("update-not-available", () => {
  differentialUpdateVersion = null;
  differentialUpdateReady = false;
  differentialDownloadPromise = null;
  lastDownloadProgress = null;
});

autoUpdater.on("download-progress", (progress) => {
  lastDownloadProgress = {
    percent: Math.round(progress.percent),
    transferredMB: Number((progress.transferred / (1024 * 1024)).toFixed(1)),
    totalMB: Number((progress.total / (1024 * 1024)).toFixed(1)),
  };
  sendUpdateEvent("updater:downloadProgress", {
    ...lastDownloadProgress,
    version: differentialUpdateVersion,
  });
});

autoUpdater.on("update-downloaded", (updateInfo) => {
  differentialUpdateReady = true;
  differentialDownloadPromise = null;
  differentialUpdateVersion = updateInfo.version;
  lastDownloadProgress = {
    percent: 100,
    transferredMB: lastDownloadProgress?.totalMB || 0,
    totalMB: lastDownloadProgress?.totalMB || 0,
  };
  sendUpdateEvent("updater:downloaded", {
    version: updateInfo.version,
    filePath: null,
  });
});

autoUpdater.on("error", (err) => {
  console.error("Auto-updater error:", err);
  sendUpdateEvent("updater:downloadError", {
    version: differentialUpdateVersion,
    error: err.message || "No se pudo verificar o descargar la actualización.",
  });
});

function getPendingUpdateFile(): string {
  return path.join(app.getPath("userData"), "pending-update.json");
}

function savePendingUpdate(installerPath: string, version: string) {
  fs.writeFileSync(getPendingUpdateFile(), JSON.stringify({ installerPath, version }), "utf-8");
}

// Si quedó una actualización descargada, se instala al abrir la app (no al cerrarla)
async function applyPendingUpdateOnStartup(): Promise<boolean> {
  if (!app.isPackaged) return false;
  const file = getPendingUpdateFile();
  try {
    if (!fs.existsSync(file)) return false;
    const { installerPath, version } = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!installerPath || !fs.existsSync(installerPath) || !isNewerVersion(app.getVersion(), version)) {
      fs.unlinkSync(file);
      return false;
    }
    downloadedVersion = version;
    await launchSilentInstaller(installerPath, true);
    try {
      fs.unlinkSync(file);
    } catch (err) {
      console.error("No se pudo borrar la actualización pendiente:", err);
    }
    setTimeout(() => app.exit(0), 300);
    return true;
  } catch (err) {
    console.error("No se pudo iniciar la actualización pendiente:", err);
    return false;
  }
}

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

    let responseStarted = false;
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "TrackSIM-ZERO-Updater",
          Accept: "application/octet-stream",
        },
      },
      (res) => {
        responseStarted = true;
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
        res.setTimeout(20000, () => {
          req.destroy(new Error("Tiempo de espera agotado por conexión inestable durante la descarga"));
        });
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

        pipeline(res, fileStream, (err) => {
          if (err) reject(err);
          else resolve();
        });
      }
    );

    req.setTimeout(20000, () => {
      req.destroy(new Error("Tiempo de espera agotado al conectar para descargar la actualización"));
    });

    req.on("error", (err) => {
      if (!responseStarted) reject(err);
    });
  });
}

function getInstallerDestPath(fileName: string, version: string): string {
  const fallback = `TrackSIM-PRO-Setup-${version || "latest"}.exe`;
  const safeName = (fileName || fallback).replace(/[^a-zA-Z0-9._ -]/g, "_");
  const safeVersion = (version || "latest").replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(app.getPath("temp"), `tracksim-update-${safeVersion}-${safeName}`);
}

function startBackgroundDownload(
  downloadUrl: string,
  fileName: string,
  version: string,
  expectedBytes?: number
): Promise<string> {
  const destPath = getInstallerDestPath(fileName, version);
  const key = JSON.stringify([downloadUrl, destPath, version, expectedBytes]);
  return downloadCoordinator.run(key, async () => {

    // Solo reutilizar archivos cuyo tamaño coincida o que ya se validaron en esta sesión.
    if (fs.existsSync(destPath)) {
      const stat = fs.statSync(destPath);
      if (isValidInstallerSize(stat.size, expectedBytes) &&
          (expectedBytes !== undefined || (downloadedInstallerPath === destPath && downloadedVersion === version))) {
        savePendingUpdate(destPath, version);
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
    }

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

      const actualSize = fs.statSync(partPath).size;
      if (!isValidInstallerSize(actualSize, expectedBytes)) {
        throw new Error("La descarga del instalador está incompleta. Inténtalo nuevamente.");
      }

      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      fs.renameSync(partPath, destPath);

      savePendingUpdate(destPath, version);
      downloadedInstallerPath = destPath;
      downloadedVersion = version;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("updater:downloaded", {
          version,
          filePath: destPath,
        });
      }
      return destPath;
    } catch (err) {
      if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
      throw err;
    }
  });
}

async function launchSilentInstaller(installerPath: string, restartAfterInstall: boolean): Promise<void> {
  if (!installerPath || !fs.existsSync(installerPath)) throw new Error("El instalador descargado no está disponible.");
  if (installingNow) throw new Error("Ya se está iniciando una actualización.");
  installingNow = true;

  const escapedInstaller = installerPath.replace(/'/g, "''");
  const exePath = app.getPath("exe").replace(/'/g, "''");
  const versionLabel = (downloadedVersion || "").replace(/[^0-9.a-zA-Z-]/g, "");
  const shouldRestart = restartAfterInstall && app.isPackaged ? "$true" : "$false";
  const tempDir = app.getPath("temp");
  const psScriptPath = path.join(tempDir, "tracksim-apply-update.ps1");
  const vbsLauncherPath = path.join(tempDir, "tracksim-update-launcher.vbs");

  const psScript = `\uFEFF$ErrorActionPreference = 'SilentlyContinue'
$installer = '${escapedInstaller}'
$appExe = '${exePath}'
$verText = if ('${versionLabel}') { 'v${versionLabel}' } else { 'Nueva versión' }
$restart = ${shouldRestart}

# 1. Esperar a que todos los procesos de TrackSIM PRO terminen y liberen archivos
for ($i = 0; $i -lt 30; $i++) {
  $procs = Get-Process -Name 'TrackSIM PRO','TrackSIM ZERO' -ErrorAction SilentlyContinue
  if (-not $procs) { break }
  if ($i -ge 10) {
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 300
}

# 2. Mostrar tarjeta moderna WPF sin bordes redondeada mientras NSIS actualiza
$win = $null
$barTranslate = $null
if ($restart) {
  Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
  $xamlStr = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Actualizando TrackSIM PRO"
        Width="440" Height="185"
        WindowStartupLocation="CenterScreen"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        ResizeMode="NoResize"
        Topmost="True"
        ShowInTaskbar="True">
  <Border Margin="16" Background="#FFFFFF" CornerRadius="16" BorderBrush="#E2E8F0" BorderThickness="1">
    <Border.Effect>
      <DropShadowEffect BlurRadius="24" ShadowDepth="6" Opacity="0.18" Color="#0F172A"/>
    </Border.Effect>
    <Grid Margin="22,20,22,20">
      <Grid.RowDefinitions>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="*"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>

      <!-- Encabezado con icono degradado y badge de versión -->
      <Grid Grid.Row="0">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="Auto"/>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>

        <Border Grid.Column="0" Width="44" Height="44" CornerRadius="12" Margin="0,0,14,0">
          <Border.Background>
            <LinearGradientBrush StartPoint="0,1" EndPoint="1,0">
              <GradientStop Color="#4F46E5" Offset="0"/>
              <GradientStop Color="#2563EB" Offset="1"/>
            </LinearGradientBrush>
          </Border.Background>
          <Canvas Width="24" Height="24" HorizontalAlignment="Center" VerticalAlignment="Center">
            <Path Data="M12,3 L12,15 M12,15 L8,11 M12,15 L16,11 M4,17 L4,19 C4,20.1 4.9,21 6,21 L18,21 C19.1,21 20,20.1 20,19 L20,17"
                  Stroke="#FFFFFF" StrokeThickness="2.2" StrokeStartLineCap="Round" StrokeEndLineCap="Round" StrokeLineJoin="Round"/>
          </Canvas>
        </Border>

        <StackPanel Grid.Column="1" VerticalAlignment="Center">
          <TextBlock Text="Actualizando TrackSIM PRO" FontFamily="Segoe UI" FontSize="15" FontWeight="Bold" Foreground="#0F172A"/>
          <TextBlock Text="Aplicando actualización en segundo plano..." FontFamily="Segoe UI" FontSize="12" Foreground="#64748B" Margin="0,2,0,0"/>
        </StackPanel>

        <Border Grid.Column="2" Background="#EEF2FF" BorderBrush="#C7D2FE" BorderThickness="1" CornerRadius="10" Padding="9,3" VerticalAlignment="Top">
          <TextBlock x:Name="VerBadge" Text="v1.0" FontFamily="Segoe UI" FontSize="11" FontWeight="Bold" Foreground="#4F46E5"/>
        </Border>
      </Grid>

      <!-- Texto informativo -->
      <TextBlock Grid.Row="1"
                 Text="Por favor espera unos segundos. La aplicación se abrirá automáticamente al finalizar."
                 FontFamily="Segoe UI" FontSize="11.5" Foreground="#475569"
                 VerticalAlignment="Center" TextWrapping="Wrap" Margin="0,8,0,6"/>

      <!-- Barra de progreso moderna -->
      <Border Grid.Row="2" Height="8" Background="#F1F5F9" CornerRadius="4" ClipToBounds="True">
        <Canvas HorizontalAlignment="Left" VerticalAlignment="Center" Height="8" Width="362">
          <Border x:Name="IndigoBar" Width="130" Height="8" CornerRadius="4">
            <Border.Background>
              <LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
                <GradientStop Color="#4F46E5" Offset="0"/>
                <GradientStop Color="#3B82F6" Offset="0.5"/>
                <GradientStop Color="#4F46E5" Offset="1"/>
              </LinearGradientBrush>
            </Border.Background>
            <Border.RenderTransform>
              <TranslateTransform x:Name="BarTranslate" X="-130" Y="0"/>
            </Border.RenderTransform>
          </Border>
        </Canvas>
      </Border>
    </Grid>
  </Border>
</Window>
'@
  $win = [Windows.Markup.XamlReader]::Parse($xamlStr)
  $verNode = $win.FindName('VerBadge')
  if ($verNode) { $verNode.Text = $verText }
  $barTranslate = $win.FindName('BarTranslate')
  $win.Show()
}

# 3. Ejecutar el instalador NSIS en modo silencioso (/S) animando la barra suavemente
if (Test-Path -LiteralPath $installer) {
  $proc = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru
  $pos = -130.0
  while ($proc -and -not $proc.HasExited) {
    if ($win) {
      $pos += 9.5
      if ($pos -gt 365) { $pos = -130.0 }
      if ($barTranslate) { $barTranslate.X = $pos }
      $win.Dispatcher.Invoke([Action]{}, [System.Windows.Threading.DispatcherPriority]::Background)
    }
    Start-Sleep -Milliseconds 25
  }
  Start-Sleep -Milliseconds 100
  Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
}

if ($win) {
  $win.Close()
}

# 4. Relanzar TrackSIM PRO de inmediato
if ($restart) {
  $logFile = Join-Path $env:TEMP 'tracksim-update.log'
  $candidates = @($appExe, (Join-Path $env:LOCALAPPDATA 'Programs\\TrackSIM PRO\\TrackSIM PRO.exe'), (Join-Path $env:ProgramFiles 'TrackSIM PRO\\TrackSIM PRO.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\\TrackSIM ZERO\\TrackSIM ZERO.exe'), (Join-Path $env:ProgramFiles 'TrackSIM ZERO\\TrackSIM ZERO.exe')) | Where-Object { $_ }
  $launched = $false
  Start-Sleep -Milliseconds 200
  for ($attempt = 0; $attempt -lt 10 -and -not $launched; $attempt++) {
    foreach ($c in $candidates) {
      if (Test-Path -LiteralPath $c) {
        try {
          Start-Process -FilePath $c -WorkingDirectory (Split-Path -Parent $c) -ErrorAction Stop
          Start-Sleep -Milliseconds 500
          if (Get-Process -Name 'TrackSIM PRO','TrackSIM ZERO' -ErrorAction SilentlyContinue) { $launched = $true; break }
        } catch {
          Add-Content -LiteralPath $logFile -Value ("$(Get-Date -Format o) fallo al relanzar $c : $($_.Exception.Message)")
        }
      }
    }
    if (-not $launched) { Start-Sleep -Milliseconds 300 }
  }
  if (-not $launched) { Add-Content -LiteralPath $logFile -Value ("$(Get-Date -Format o) no se pudo relanzar la app") }
}
`;

  // wscript.exe es un proceso GUI nativo de Windows (no requiere consola al usar DETACHED_PROCESS)
  // y lanza powershell.exe con una consola oculta válida (0 = SW_HIDE) independiente del proceso padre.
  const vbsScript = `CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & WScript.Arguments(0) & """", 0, False\r\n`;

  try {
    fs.writeFileSync(psScriptPath, psScript, "utf-8");
    fs.writeFileSync(vbsLauncherPath, vbsScript, "utf-8");
    const child = spawn(
      "wscript.exe",
      ["//B", "//NoLogo", vbsLauncherPath, psScriptPath],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }
    );
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
  } catch (err) {
    installingNow = false;
    console.error("Failed to launch silent installer script:", err);
    throw err;
  }
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

    if (!app.isPackaged) {
      return {
        ok: false,
        currentVersion,
        error: "El actualizador solo está disponible en la versión instalada de TrackSIM PRO.",
      };
    }

    const releaseVersion = String(data.tag_name).replace(/^[vV]/, "");
    const checkResult = await autoUpdater.checkForUpdates();
    if (!checkResult) throw new Error("electron-updater no pudo comprobar la versión publicada.");
    const latestVersion = checkResult.updateInfo.version || releaseVersion;
    const updateAvailable = checkResult.isUpdateAvailable &&
      isNewerVersion(currentVersion, latestVersion);
    const assets: any[] = Array.isArray(data.assets) ? data.assets : [];
    const exeAsset = assets.find(
      (asset) => typeof asset.name === "string" &&
        asset.name.toLowerCase().endsWith(".exe") &&
        !asset.name.toLowerCase().endsWith(".blockmap")
    );

    if (updateAvailable && !differentialUpdateReady && !differentialDownloadPromise) {
      differentialUpdateVersion = latestVersion;
      startDifferentialDownload().catch((err) => {
        console.error("Differential update download error:", err);
      });
    }

    const isReadyToInstall = differentialUpdateReady &&
      differentialUpdateVersion === latestVersion;

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
      downloadUrl: exeAsset?.browser_download_url || null,
      fileName: exeAsset?.name || null,
      assetSizeMB: exeAsset?.size ? Number((exeAsset.size / (1024 * 1024)).toFixed(1)) : null,
      assetSizeBytes: exeAsset?.size ? Number(exeAsset.size) : undefined,
      downloadingInBackground: Boolean(differentialDownloadPromise),
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

ipcMain.handle("updater:downloadAndInstall", async (_, { downloadUrl, fileName, version, expectedBytes }) => {
  try {
    if (!app.isPackaged) throw new Error("El actualizador solo está disponible en la versión instalada.");

    try {
      if (!differentialUpdateReady) await startDifferentialDownload();
      if (!differentialUpdateReady) throw new Error("La actualización todavía no está lista para instalarse.");
    } catch (differentialError) {
      if (!downloadUrl) throw differentialError;
      console.error("Differential update failed; trying the full installer:", differentialError);
      await installAfterDownload(
        () => startBackgroundDownload(downloadUrl, fileName, version || "latest", expectedBytes),
        (installerPath) => launchSilentInstaller(installerPath, true),
        () => setTimeout(() => {
          if (localStaticServer) localStaticServer.close();
          app.exit(0);
        }, 300)
      );
      return { ok: true };
    }

    setTimeout(() => {
      if (localStaticServer) localStaticServer.close();
      autoUpdater.quitAndInstall(true, true);
    }, 100);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Error al descargar o iniciar la actualización" };
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

  app.whenReady().then(async () => {
    if (await applyPendingUpdateOnStartup()) return;
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (localStaticServer) {
    localStaticServer.close();
  }
  if (process.platform !== "darwin") app.quit();
});
