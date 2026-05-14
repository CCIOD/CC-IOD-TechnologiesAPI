import { pool } from '../database/connection';

/**
 * Datos fijos de la empresa para el oficio.
 * TODO: si se necesita configurabilidad, mover a tabla SETTINGS o variables de entorno.
 */
export const COMPANY_PROFILE = {
  city: 'Oaxaca de Juárez, Oaxaca',
  signerName: 'ING. MARÍA FERNANDA CANCINO MARTÍNEZ',
  signerRole: 'DIRECTORA DE OPERACIONES DE LA EMPRESA CC-IOD TECHNOLOGIES',
  rfc: 'CTE2105031M0',
  address:
    '2A Privada de Sabinos número 209 local 3 Planta Alta, Colonia Olímpica, Oaxaca de Juárez, Oaxaca.',
  phones: '951-626-77-44 ; 951-672-32-53',
  email: 'cciodtechnologies@gmail.com',
  recipientLines: [
    'AUTORIDAD DE SUPERVISIÓN DE MEDIDAS CAUTELARES',
    'Y DE LA SUSPENSIÓN CONDICIONAL DEL PROCESO',
  ],
} as const;

/**
 * Extrae las iniciales del nombre del imputado para usar en el folio.
 * "Brenda Quevedo Cruz" -> "BQC". Ignora preposiciones cortas.
 */
export const extractInitials = (fullName: string): string => {
  return fullName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // sin acentos
    .toUpperCase()
    .split(/\s+/)
    .filter((p) => p.length > 2 || /^[A-Z]$/.test(p)) // saca "DE", "DEL", "LA"
    .filter((p) => !['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'EL'].includes(p))
    .map((p) => p[0])
    .join('');
};

/**
 * Mapeo de estados / zonas a su código corto. Se buscan substrings; el primero
 * que coincida se usa. Si nada coincide, usa CDMX como default.
 */
const STATE_CODES: Array<[RegExp, string]> = [
  [/edo(?:mex)?|estado de mex(?:ico)?/i, 'EDOMEX'],
  [/cdmx|ciudad de m[eé]xico|d\.?f\.?/i, 'CDMX'],
  [/oaxaca/i, 'OAX'],
  [/puebla/i, 'PUE'],
  [/morelos/i, 'MOR'],
  [/guerrero/i, 'GRO'],
  [/jalisco/i, 'JAL'],
  [/quer[eé]taro/i, 'QRO'],
  [/nuevo le[oó]n/i, 'NL'],
  [/veracruz/i, 'VER'],
];

export const inferStateCode = (...sources: (string | null | undefined)[]): string => {
  for (const source of sources) {
    if (!source) continue;
    for (const [pattern, code] of STATE_CODES) {
      if (pattern.test(source)) return code;
    }
  }
  return 'CDMX';
};

/**
 * Reserva un folio único OFICIO/DO/[EDO]/[INICIALES]/[NUM]/[AÑO].
 * El número secuencial es por año (global, simple). Se busca el máximo
 * existente cuyo patrón coincida y se incrementa.
 *
 * En caso de carrera (poco probable en la realidad operativa), el UNIQUE
 * index `uq_weekly_reports_folio` rechazará el INSERT y el caller debe
 * reintentar — pero esa lógica vive en el controller.
 */
export const generateFolio = async (params: {
  stateCode: string;
  initials: string;
  year: number;
}): Promise<string> => {
  const { stateCode, initials, year } = params;
  // Tomamos el último secuencial global del año (no por estado/iniciales),
  // alineado con el formato observado en los oficios (010, 011, 012, 013...).
  const result = await pool.query<{ max_num: number | null }>({
    text: `SELECT COALESCE(MAX(CAST(SPLIT_PART(folio, '/', 5) AS INTEGER)), 0) AS max_num
           FROM WEEKLY_REPORTS
           WHERE folio IS NOT NULL
             AND folio LIKE $1`,
    values: [`OFICIO/DO/%/%/%/${year}`],
  });
  const next = (result.rows[0]?.max_num ?? 0) + 1;
  const padded = String(next).padStart(3, '0');
  return `OFICIO/DO/${stateCode}/${initials}/${padded}/${year}`;
};
