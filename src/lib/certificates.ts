import jsPDF from "jspdf";
import { listCertificateRecipients, type CertificateRecipient } from "./db";
import { getGroup } from "./groups";
import templateUrl from "../../Material Apoyo/RECONOCIMIENTO 6@.jpg?url";

export function filenamePart(value: string): string {
  const clean = Array.from(value.trim(), (char) =>
    char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? "_" : char
  ).join("").replace(/[. ]+$/g, "");
  if (!clean) throw new Error("No se pudo generar un nombre de archivo válido.");
  return clean;
}

function diplomaFilename(name: string): string {
  return `${filenamePart(name)}_Diploma.pdf`;
}

export function generateCertificatePdf(
  recipient: CertificateRecipient,
  groupName: string,
  courseName: string | undefined,
  template: Uint8Array
): ArrayBuffer {
  const width = 297;
  const height = width * 2534 / 3300;
  const doc = new jsPDF({ orientation: "landscape", format: [width, height], unit: "mm" });
  doc.addImage(template, "JPEG", 0, 0, width, height);
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  let nameSize = 21;
  doc.setFontSize(nameSize);
  while (nameSize > 8 && doc.getTextWidth(recipient.name) > 160) {
    nameSize -= 0.5;
    doc.setFontSize(nameSize);
  }
  if (doc.getTextWidth(recipient.name) > 160) {
    throw new Error(`El nombre de ${recipient.driverId} es demasiado largo para el documento.`);
  }
  doc.text(recipient.name, 145, 88, { align: "center" });

  doc.setFont("helvetica", "normal");
  const fields = [
    ...(courseName?.trim() ? [`Curso: ${courseName.trim()}`] : []),
    `Grupo: ${groupName}`,
    `Calificación: ${recipient.score.toFixed(1)} / 10`,
    `Última evaluación: ${recipient.lastEvaluationDate ?? "Fecha no disponible"}`,
  ];
  let fontSize = 9;
  let lines: string[] = [];
  do {
    doc.setFontSize(fontSize);
    lines = fields.flatMap((field) => doc.splitTextToSize(field, 80) as string[]);
    if (lines.length * fontSize * 0.44 <= 22) break;
    fontSize -= 0.5;
  } while (fontSize >= 5);
  if (fontSize < 5) {
    throw new Error("El nombre del curso o grupo es demasiado largo para el documento.");
  }
  doc.text(lines, 139, 199, { align: "center", lineHeightFactor: 1.25 });
  return doc.output("arraybuffer");
}

async function loadTemplate(): Promise<Uint8Array> {
  const response = await fetch(templateUrl);
  if (!response.ok) throw new Error("No se pudo cargar el formato de reconocimiento.");
  return new Uint8Array(await response.arrayBuffer());
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadGroupRecipients(groupId: string) {
  const [group, recipients] = await Promise.all([getGroup(groupId), listCertificateRecipients(groupId)]);
  if (!group) throw new Error("No se encontró el grupo seleccionado.");
  if (!recipients.length) throw new Error("El grupo no tiene conductores evaluados.");
  return { group, recipients };
}

export async function downloadCertificate(groupId: string, driverId: string) {
  const { group, recipients } = await loadGroupRecipients(groupId);
  const recipient = recipients.find((item) => item.driverId === driverId);
  if (!recipient) throw new Error("No se encontró al conductor en el grupo seleccionado.");
  const bytes = generateCertificatePdf(recipient, group.name, group.courseName, await loadTemplate());
  download(new Blob([bytes], { type: "application/pdf" }), diplomaFilename(recipient.name));
}

export async function generateGroupCertificates(groupId: string): Promise<{
  groupName: string;
  year: string;
  files: { path: string; content: ArrayBuffer }[];
}> {
  const { group, recipients } = await loadGroupRecipients(groupId);
  const dates = recipients.map((recipient) => recipient.lastEvaluationDate)
    .filter((date): date is string => date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  const latestDate = dates.at(-1);
  if (!latestDate) throw new Error("No se pudo determinar el año: el grupo no tiene fechas de evaluación disponibles.");
  const filenames = recipients.map((recipient) => diplomaFilename(recipient.name));
  const counts = new Map<string, number>();
  for (const filename of filenames) {
    const key = filename.toLocaleLowerCase("es");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const template = await loadTemplate();
  const files = recipients.map((recipient, index) => {
    const filename = filenames[index];
    const path = (counts.get(filename.toLocaleLowerCase("es")) ?? 0) > 1
      ? `${String(index + 1).padStart(3, "0")}/${filename}`
      : filename;
    return { path, content: generateCertificatePdf(recipient, group.name, group.courseName, template) };
  });
  return {
    groupName: group.name,
    year: latestDate.slice(0, 4),
    files,
  };
}
