export const ALLOWED_DOMAIN = "corporativomaf.com";

// Solo estos correos pueden editar el catálogo de errores. Debe coincidir con isAdmin() en firestore.rules.
export const ADMIN_EMAILS = ["magraz@corporativomaf.com"];

export function isAdminEmail(email: string | null | undefined) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

export function isAllowedEmail(email: string | null | undefined, verified: boolean) {
  return verified && !!email && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

export const PHASES = [
  { id: 1, name: "Adaptación Sensorial" },
  { id: 2, name: "Tren Motriz y Sincronización" },
  { id: 3, name: "Dinámica en pendientes" },
  { id: 4, name: "Conciencia Dimensional" },
  { id: 5, name: "Maniobrabilidad y Enrampe" },
  { id: 6, name: "Conducción Defensiva y Crisis" },
] as const;

// Puntos de penalización por minuto que equivalen a 100 puntos perdidos. Normalizar por duración
// permite comparar ejercicios de distinta longitud; el peso de cada error viene de catalog.ts.
export const PENALTY_PER_ERROR_RATE = 4;

// Cantidad de errores críticos (acumulados en la fase) a partir de la cual el dictamen es NO APTO sin importar el promedio.
export const CRITICAL_LIMIT = 2;

export const VERDICTS = [
  { min: 80, label: "APTO", color: "bg-green-100 text-green-800" },
  { min: 60, label: "APTO CON OBSERVACIONES", color: "bg-yellow-100 text-yellow-800" },
  { min: 0, label: "NO APTO", color: "bg-red-100 text-red-800" },
] as const;

export function verdictFor(score: number) {
  return VERDICTS.find((v) => score >= v.min) ?? VERDICTS[VERDICTS.length - 1];
}

export function phaseName(id: number) {
  return PHASES.find((p) => p.id === id)?.name ?? `Fase ${id}`;
}
