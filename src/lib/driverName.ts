/**
 * Diccionario de nombres y apellidos hispanos frecuentes con sus tildes y diéresis correctas.
 * Al importar desde el simulador Lander (que no admite acentos en su interfaz o teclado),
 * esta utilidad normaliza automáticamente la capitalización y restaura las tildes correspondientes.
 */

// Mapa de palabras sin acento (en minúsculas y normalizadas) -> palabra canónica con tilde/diéresis y mayúscula inicial
const ACCENTED_WORDS_MAP: Record<string, string> = {
  // Nombres comunes
  "aaron": "Aarón",
  "adrian": "Adrián",
  "agustin": "Agustín",
  "alvaro": "Álvaro",
  "andres": "Andrés",
  "angel": "Ángel",
  "angeles": "Ángeles",
  "antonio": "Antonio",
  "bartolome": "Bartolomé",
  "belen": "Belén",
  "benjamin": "Benjamín",
  "cesar": "César",
  "cristobal": "Cristóbal",
  "damian": "Damián",
  "dario": "Darío",
  "efrain": "Efraín",
  "elias": "Elías",
  "esteban": "Esteban",
  "fabian": "Fabián",
  "german": "Germán",
  "gonzalo": "Gonzalo",
  "hector": "Héctor",
  "hernan": "Hernán",
  "isai": "Isaí",
  "isaias": "Isaías",
  "ivan": "Iván",
  "jesus": "Jesús",
  "joaquin": "Joaquín",
  "jonatan": "Jonatán",
  "jonathan": "Jonatán",
  "jose": "José",
  "julian": "Julián",
  "leon": "León",
  "lucia": "Lucía",
  "maria": "María",
  "matias": "Matías",
  "moises": "Moisés",
  "nicolas": "Nicolás",
  "oscar": "Óscar",
  "ramon": "Ramón",
  "raul": "Raúl",
  "ruben": "Rubén",
  "saul": "Saúl",
  "sebastian": "Sebastián",
  "tomas": "Tomás",
  "victor": "Víctor",

  // Apellidos comunes con tilde o diéresis
  "aguila": "Águila",
  "alcala": "Alcalá",
  "alvarez": "Álvarez",
  "aragon": "Aragón",
  "avila": "Ávila",
  "barcenas": "Bárcenas",
  "benitez": "Benítez",
  "bermudez": "Bermúdez",
  "cabrera": "Cabrera",
  "caceres": "Cáceres",
  "cadena": "Cadena",
  "calderon": "Calderón",
  "cardenas": "Cárdenas",
  "castaneda": "Castañeda",
  "chacon": "Chacón",
  "chavez": "Chávez",
  "cortes": "Cortés",
  "davila": "Dávila",
  "diaz": "Díaz",
  "dominguez": "Domínguez",
  "estevez": "Estévez",
  "fernandez": "Fernández",
  "galvez": "Gálvez",
  "garcia": "García",
  "godinez": "Godínez",
  "gomez": "Gómez",
  "gonzalez": "González",
  "gutierrez": "Gutiérrez",
  "guzman": "Guzmán",
  "hernandez": "Hernández",
  "ibanez": "Ibáñez",
  "iglesias": "Iglesias",
  "iniguez": "Iñíguez",
  "jimenez": "Jiménez",
  "juarez": "Juárez",
  "lopez": "López",
  "magana": "Magaña",
  "marquez": "Márquez",
  "martinez": "Martínez",
  "medina": "Medina",
  "mendez": "Méndez",
  "menendez": "Menéndez",
  "morales": "Morales",
  "munoz": "Muñoz",
  "nunez": "Núñez",
  "olguin": "Olguín",
  "ordonez": "Ordóñez",
  "orozco": "Orozco",
  "ortega": "Ortega",
  "ortiz": "Ortiz",
  "padron": "Padrón",
  "pena": "Peña",
  "perez": "Pérez",
  "ramirez": "Ramírez",
  "rincon": "Rincón",
  "rodriguez": "Rodríguez",
  "romon": "Romón",
  "rubio": "Rubio",
  "ruiz": "Ruiz",
  "saenz": "Sáenz",
  "salinas": "Salinas",
  "san martin": "San Martín",
  "sanchez": "Sánchez",
  "santander": "Santander",
  "santiago": "Santiago",
  "solis": "Solís",
  "suarez": "Suárez",
  "valdes": "Valdés",
  "valdez": "Valdéz",
  "vargas": "Vargas",
  "vasquez": "Vásquez",
  "vazquez": "Vázquez",
  "velasquez": "Velásquez",
  "velazquez": "Velázquez",
  "velez": "Vélez",
  "villanueva": "Villanueva",
  "yepez": "Yépez",
  "zamudio": "Zamudio",
  "zarate": "Zárate",
  "zuniga": "Zúñiga",
};

// Partículas en minúsculas en nombres compuestos (salvo al inicio)
const LOWERCASE_PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "di", "van", "von"]);

/**
 * Normaliza y agrega automáticamente las tildes a un nombre y apellidos
 * basándose en el diccionario de nombres y patronímicos hispanos más frecuentes.
 * 
 * Si una palabra ya incluye tilde o eñe, preserva el acento existente
 * y solo asegura una correcta capitalización.
 *
 * @example
 * autoAccentDriverName("SAUL PACHECO ROQUE") // "Saúl Pacheco Roque"
 * autoAccentDriverName("LEONARDO ISAI OLVERA RIVERA") // "Leonardo Isaí Olvera Rivera"
 * autoAccentDriverName("LUIS PENA MARTINEZ") // "Luis Peña Martínez" (si PENA está en mapa)
 * autoAccentDriverName("JUAN MANUEL DAVILA IBARRA") // "Juan Manuel Dávila Ibarra"
 * autoAccentDriverName("RAFAEL AGUILAR DE JESUS") // "Rafael Aguilar de Jesús"
 */
export function autoAccentDriverName(rawName: string): string {
  if (!rawName) return "";
  const cleaned = rawName.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";

  const words = cleaned.split(" ");

  const accentedWords = words.map((word, index) => {
    // Si la palabra contiene guión (ej: "Sánchez-Alcalá")
    if (word.includes("-")) {
      return word
        .split("-")
        .map((part) => autoAccentSingleWord(part, false))
        .join("-");
    }

    const isFirst = index === 0;
    return autoAccentSingleWord(word, !isFirst);
  });

  return accentedWords.join(" ");
}

function autoAccentSingleWord(word: string, allowLowercaseParticle: boolean): string {
  const lower = word.toLowerCase();

  // Partículas ("de", "del", "la", etc.)
  if (allowLowercaseParticle && LOWERCASE_PARTICLES.has(lower)) {
    return lower;
  }

  // Normalización sin acentos para buscar en el diccionario
  const key = lower
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Si está en el diccionario de palabras acentuadas
  if (ACCENTED_WORDS_MAP[key]) {
    const replacement = ACCENTED_WORDS_MAP[key];
    // Si la palabra original ya tenía eñe o tildes específicas que el diccionario conserva,
    // devolver la versión acentuada canónica.
    return replacement;
  }

  // Si no está en el mapa, conservar lo que ya tenga pero con formato Capitalize
  // Ejemplo: "rodriguez" -> "Rodriguez", "García" -> "García"
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
