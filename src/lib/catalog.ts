export type Severity = "CRITICO" | "GRAVE" | "MODERADO" | "LEVE";

// Metadatos visuales fijos para tema claro.
export const SEVERITIES: Record<Severity, { label: string; badge: string; dot: string; eliminatory: boolean }> = {
  CRITICO: {
    label: "Crítico",
    badge: "bg-rose-50 text-rose-700 border border-rose-200",
    dot: "bg-rose-500",
    eliminatory: true,
  },
  GRAVE: {
    label: "Grave",
    badge: "bg-orange-50 text-orange-700 border border-orange-200",
    dot: "bg-orange-500",
    eliminatory: false,
  },
  MODERADO: {
    label: "Moderado",
    badge: "bg-amber-50 text-amber-800 border border-amber-200",
    dot: "bg-amber-500",
    eliminatory: false,
  },
  LEVE: {
    label: "Leve",
    badge: "bg-slate-100 text-slate-700 border border-slate-200",
    dot: "bg-slate-400",
    eliminatory: false,
  },
};

export const SEVERITY_ORDER: Severity[] = ["CRITICO", "GRAVE", "MODERADO", "LEVE"];

export const DEFAULT_WEIGHTS: Record<Severity, number> = { CRITICO: 32, GRAVE: 3, MODERADO: 1, LEVE: 0.5 };

// Severidad asignada a los errores no catalogados hasta que se clasifiquen.
export const UNCATALOGED_SEVERITY: Severity = "MODERADO";

// `points` es opcional: si existe reemplaza los puntos del nivel de gravedad solo para ese error.
export type Entry = { name: string; severity: Severity; points?: number; aliases?: string[] };

export type CatalogConfig = { weights: Record<Severity, number>; entries: Entry[] };

const DEFAULT_ENTRIES: Entry[] = [
  // Críticos: daño a personas, vuelco, colisión con otros vehículos o semáforo en rojo
  { name: "Atropello de un peatón", severity: "CRITICO" },
  { name: "Atropello de un perro", severity: "CRITICO" },
  { name: "Vuelco", severity: "CRITICO" },
  { name: "Vuelco del remolque", severity: "CRITICO" },
  { name: "Colisión con un vehículo del tráfico", severity: "CRITICO" },
  { name: "Colisión con un vehículo de incidencia", severity: "CRITICO" },
  { name: "Saltarse un semáforo en rojo", severity: "CRITICO" },

  // Graves: pérdida de control o infracción que expone a terceros
  { name: "Colisión con un objeto", severity: "GRAVE" },
  { name: "Colisión con unas piedras", severity: "GRAVE" },
  { name: "Derrape del remolque", severity: "GRAVE" },
  { name: "Derrape delantero", severity: "GRAVE" },
  { name: "Derrape trasero", severity: "GRAVE" },
  { name: "Salirse de la vía", severity: "GRAVE" },
  { name: "Invadir un carril de sentido contrario rebasando una línea continua", severity: "GRAVE" },
  { name: "No parar en un stop", severity: "GRAVE" },
  { name: "No respetar un ceda el paso", severity: "GRAVE" },
  { name: "Saltarse un semáforo en Ámbar", severity: "GRAVE" },
  { name: "Acelerar para saltarse un semáforo en Ámbar", severity: "GRAVE" },
  { name: "Exceso de velocidad", severity: "GRAVE" },
  { name: "Efectuar un frenado brusco", severity: "GRAVE" },
  { name: "Iniciar el movimiento sin suficiente presión en los depósitos de freno", severity: "GRAVE" },
  { name: "No comprobar que la transmisión está en neutro antes de arrancar el motor", severity: "GRAVE" },
  { name: "Circular con el freno de mano puesto", severity: "GRAVE" },
  { name: "Superar la zona roja de las rpm", severity: "GRAVE" },
  { name: "Acelerar a fondo por encima de la zona verde", severity: "GRAVE" },

  // Moderados: mala técnica con riesgo mecánico o falta de señalización
  { name: "Invadir el acotamiento", severity: "MODERADO" },
  { name: "Pisar una línea continua", severity: "MODERADO" },
  { name: "Parar en un ceda sin necesidad", severity: "MODERADO" },
  { name: "No conectar el alumbrado de cruce en situaciones de baja visibilidad", severity: "MODERADO" },
  { name: "Circular con niebla sin luces antiniebla", severity: "MODERADO" },
  { name: "No poner la luz direccional al salir de la rotonda", severity: "MODERADO" },
  { name: "No poner la luz direccional derecha para el cambio de carril", severity: "MODERADO",
    aliases: ["No poner la luz direccional derecha con suficiente antelación para el cambio de carril"] },
  { name: "No poner la luz direccional izquierdo para el cambio de carril", severity: "MODERADO" },
  { name: "No poner la luz direccional en la incorporación", severity: "MODERADO" },
  { name: "No poner la luz direccional en la salida", severity: "MODERADO" },
  { name: "No emplear el freno de embrague para engranar la marcha de arranque", severity: "MODERADO" },
  { name: "No iniciar la marcha en primera en llano", severity: "MODERADO" },
  { name: "No iniciar la marcha en primera en pendiente ascendente", severity: "MODERADO" },
  { name: "Parar el vehículo con una marcha demasiado alta engranada", severity: "MODERADO" },
  { name: "En movimiento de avance no parar el vehículo para meter marcha atrás", severity: "MODERADO" },
  { name: "En movimiento de retroceso no parar el vehículo para meter marcha adelante", severity: "MODERADO" },
  { name: "Presionar el embrague antes que el freno de servicio en una frenada", severity: "MODERADO" },
  { name: "Bajar más de una marcha con el motor frío", severity: "MODERADO" },
  { name: "Subir más de una marcha con el motor frío", severity: "MODERADO" },
  { name: "Cambiar de rango de marchas en neutra", severity: "MODERADO" },
  { name: "Encender el motor usando el acelerador", severity: "MODERADO" },
  { name: "Utilizar el freno de servicio antes que los ralentizadores", severity: "MODERADO",
    aliases: ["Utilizar el freno de servicio antes que los frenos auxiliares"] },
  { name: "Abusar del acelerador en la aproximación a un cruce", severity: "MODERADO" },
  { name: "Abusar del acelerador en la aproximación a un vehículo parado", severity: "MODERADO" },
  { name: "Estacionar sin dejar el freno de estacionamiento puesto", severity: "MODERADO" },

  // Leves: técnica de conducción eficiente y manejo de pedales
  { name: "Pisar el acotamiento derecho", severity: "LEVE" },
  { name: "Circular en punto muerto o con embrague presionado", severity: "LEVE" },
  { name: "Acelerar por encima de la zona verde", severity: "LEVE" },
  { name: "Acelerar al 75% del recorrido del pedal por debajo de la zona verde", severity: "LEVE" },
  { name: "Acelerar con el retarder o freno motor activo", severity: "LEVE" },
  { name: "Acelerar en vacío con el motor arrancado", severity: "LEVE" },
  { name: "Acelerar tras un cambio de marcha que nos haya dejado por debajo de la zona verde", severity: "LEVE" },
  { name: "Estar parado con una marcha metida y el embrague presionado", severity: "LEVE" },
  // Marcas que el simulador emite pero no figuran en el archivo Errores
  { name: "Acelerar en neutral o con embrague presionado", severity: "LEVE" },
  { name: "Cambiar de marcha sin haber presionado el embrague lo suficiente", severity: "LEVE" },
  { name: "Desembragar muy lentamente después de un cambio de marcha", severity: "LEVE" },
];

// Compara sin acentos, mayúsculas ni caracteres basura (el simulador a veces entrega texto con mala codificación).
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9% ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const DEFAULT_CONFIG: CatalogConfig = { weights: DEFAULT_WEIGHTS, entries: DEFAULT_ENTRIES };

let active: CatalogConfig = DEFAULT_CONFIG;
let index = new Map<string, Entry>();
const groupCatalogs = new Map<string, { cfg: CatalogConfig; index: Map<string, Entry> }>();

function buildIndex(cfg: CatalogConfig) {
  const m = new Map<string, Entry>();
  for (const e of cfg.entries) for (const n of [e.name, ...(e.aliases ?? [])]) m.set(normalize(n), e);
  return m;
}

export function sanitizeCatalog(raw: unknown): CatalogConfig {
  const r = raw as Partial<CatalogConfig> | undefined;
  const weights = { ...DEFAULT_WEIGHTS };
  for (const s of SEVERITY_ORDER) {
    const w = r?.weights?.[s];
    if (typeof w === "number" && w >= 0) weights[s] = w;
  }
  const entries = Array.isArray(r?.entries)
    ? (r.entries as Entry[]).filter((e) => e && typeof e.name === "string" && SEVERITY_ORDER.includes(e.severity))
    : DEFAULT_CONFIG.entries;
  return { weights, entries };
}

// Catálogo global vigente en memoria; lo carga catalogStore desde Firestore antes de calcular calificaciones.
export function setCatalog(cfg: CatalogConfig) {
  active = cfg;
  index = buildIndex(cfg);
}

// Registra o actualiza el catálogo específico de un grupo en memoria.
export function setGroupCatalog(groupId: string, cfg: CatalogConfig) {
  groupCatalogs.set(groupId, { cfg, index: buildIndex(cfg) });
}

export function removeGroupCatalog(groupId: string) {
  groupCatalogs.delete(groupId);
}

export function hasGroupCatalog(groupId: string): boolean {
  return groupCatalogs.has(groupId);
}

export function getCatalog(groupId?: string | null): CatalogConfig {
  if (groupId && groupCatalogs.has(groupId)) {
    return groupCatalogs.get(groupId)!.cfg;
  }
  return active;
}

setCatalog(DEFAULT_CONFIG);

export function isOffRoadError(description: string): boolean {
  const norm = normalize(description);
  return norm.includes("salirse de la via") || norm.includes("salida de la via") || norm.includes("salirse de la calzada");
}

export function classify(
  description: string,
  environment?: string,
  groupId?: string | null
): { severity: Severity; weight: number; cataloged: boolean } {
  const target = (groupId && groupCatalogs.get(groupId)) || { cfg: active, index };
  const entry = target.index.get(normalize(description));
  let severity = entry?.severity ?? UNCATALOGED_SEVERITY;

  // Regla especial de seguridad: en montaña o pendientes pronunciadas,
  // salirse de la vía representa riesgo inminente de precipicio o despeñamiento,
  // por lo que se eleva su severidad a CRÍTICO.
  if (environment === "MONTANA" && isOffRoadError(description)) {
    severity = "CRITICO";
  }

  return { severity, weight: entry?.points ?? target.cfg.weights[severity], cataloged: !!entry };
}
