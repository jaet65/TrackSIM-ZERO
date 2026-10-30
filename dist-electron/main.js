"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const pg_1 = require("pg");
// Ruta del archivo de configuración (config.json en el userData de la app o local)
function getConfigPath() {
    const userData = electron_1.app.getPath("userData");
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
        }
        catch {
            return defaultConfig;
        }
    }
    return defaultConfig;
}
function saveDbConfig(newConfig) {
    const cfgPath = getConfigPath();
    const current = getDbConfig();
    const merged = { ...current, ...newConfig };
    fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2), "utf-8");
    return merged;
}
function formatDuration(seconds) {
    if (seconds == null || isNaN(seconds))
        return "00:00:00";
    const sec = Math.floor(seconds);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function slugify(value) {
    return (value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9 _]/g, "")
        .trim()
        .replace(/\s+/g, "_");
}
async function createPgClient() {
    const cfg = getDbConfig();
    const client = new pg_1.Client({
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
async function generateCsvForSession(client, sessionRow) {
    const idSesion = sessionRow.id;
    const nombreAlumno = sessionRow.sstudentname || "-";
    const fecha = sessionRow.dtcreation ? new Date(sessionRow.dtcreation) : new Date();
    const instructor = sessionRow.sinstructorname || "-";
    const duracion = Number(sessionRow.duration) || 0;
    const idAula = sessionRow.idaula;
    const lines = [];
    const add = (...cells) => lines.push(cells.join(";"));
    add("Informe de sesión", "");
    add();
    // Lección, unidad y ejercicio
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
        }
        else {
            const snameRes = await client.query("SELECT sname FROM sessions WHERE id = $1", [idSesion]);
            if (snameRes.rows.length && snameRes.rows[0].sname) {
                const parts = snameRes.rows[0].sname.split("\n").map((p) => p.trim()).filter(Boolean);
                if (parts.length >= 3) {
                    [leccion, unidad, ejercicio] = parts;
                }
                else if (parts.length === 2) {
                    [leccion, unidad] = parts;
                }
                else if (parts.length === 1) {
                    leccion = parts[0];
                }
            }
        }
    }
    catch { }
    add("Lección", "Unidad", "Ejercicio");
    add(leccion, unidad, ejercicio);
    add();
    const fechaStr = fecha.toISOString().split("T")[0];
    add("FECHA", "CONDUCTOR", "INSTRUCTOR", "DURACIÓN");
    add(fechaStr, instructor, nombreAlumno, formatDuration(duracion));
    add();
    // Condiciones iniciales
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
    }
    catch { }
    add();
    // Comentarios
    let comentarios = "";
    try {
        const cRes = await client.query(`
      SELECT exercises.scomments
      FROM sessions, exercises
      WHERE sessions.idexercise = exercises.id
        AND sessions.id = $1
    `, [idSesion]);
        if (cRes.rows.length && cRes.rows[0].scomments)
            comentarios = cRes.rows[0].scomments;
    }
    catch { }
    add("Comentarios", "");
    add(comentarios);
    add();
    // Palabras clave
    let palabrasClave = "";
    try {
        const tRes = await client.query(`
      SELECT exercises.stags
      FROM sessions, exercises
      WHERE sessions.idexercise = exercises.id
        AND sessions.id = $1
    `, [idSesion]);
        if (tRes.rows.length && tRes.rows[0].stags)
            palabrasClave = tRes.rows[0].stags;
    }
    catch { }
    add("Palabras clave del ejercicio", "");
    add(palabrasClave);
    add();
    // Notas del instructor
    let notas = "";
    try {
        const nRes = await client.query("SELECT instructornotes FROM sessions WHERE id = $1", [idSesion]);
        if (nRes.rows.length && nRes.rows[0].instructornotes)
            notas = nRes.rows[0].instructornotes;
    }
    catch { }
    add("Notas del instructor", "");
    add(notas);
    add();
    // Marcas
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
    }
    catch { }
    add();
    // Resumen de marcas
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
        const byType = {};
        for (const r of sumRes.rows) {
            if (!byType[r.stipo])
                byType[r.stipo] = [];
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
    }
    catch { }
    add();
    // Indicadores genéricos
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
    }
    catch { }
    const alumnoLimpio = slugify(nombreAlumno);
    const filename = `ID${idSesion}_${alumnoLimpio}_${fechaStr}.csv`;
    return { filename, csv: lines.join("\r\n") };
}
// --------------------------------------------------------
// Ventana de Electron y Comunicación IPC
// --------------------------------------------------------
let mainWindow = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1280,
        height: 840,
        minWidth: 1024,
        minHeight: 700,
        title: "TrackSIM ZERO",
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });
    const isDev = process.env.NODE_ENV === "development" || !electron_1.app.isPackaged;
    if (isDev) {
        mainWindow.loadURL("http://localhost:5173");
    }
    else {
        mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    }
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}
// IPC Handlers: Reemplazan por completo a local_server.py
electron_1.ipcMain.handle("lander:checkStatus", async () => {
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
    }
    catch (err) {
        return {
            service: "running",
            db_connected: false,
            config: safeConfig,
            error: err.message,
        };
    }
});
electron_1.ipcMain.handle("lander:saveConfig", async (_, newConfig) => {
    try {
        saveDbConfig(newConfig);
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
});
electron_1.ipcMain.handle("lander:countSessions", async (_, { inicio, fin, anon }) => {
    let client = null;
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
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
    finally {
        if (client)
            await client.end().catch(() => { });
    }
});
electron_1.ipcMain.handle("lander:extractSessions", async (_, { inicio, fin, anon, limit }) => {
    let client = null;
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
        const sessionsOut = [];
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
            }
            catch (procErr) {
                sessionsOut.push({
                    id: row.id,
                    driver: row.sstudentname,
                    error: procErr.message,
                });
            }
        }
        return { ok: true, extracted: sessionsOut.length, sessions: sessionsOut };
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
    finally {
        if (client)
            await client.end().catch(() => { });
    }
});
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        electron_1.app.quit();
});
