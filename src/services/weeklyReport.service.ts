import PDFDocument from 'pdfkit';
import path from 'path';
import { pool } from '../database/connection';
import { COMPANY_PROFILE } from './folio.service';

const ASSETS_DIR = path.resolve(__dirname, '..', 'assets');
const LOGO_PATH = path.join(ASSETS_DIR, 'cciod-logo.png');
const WATERMARK_PATH = path.join(ASSETS_DIR, 'cciod-watermark.png');
const SIGNATURE_PATH = path.join(ASSETS_DIR, 'cciod-signature.png');

// =============================================================================
// Tipos
// =============================================================================

export interface WeeklyReportAlertRow {
  alert_id: number;
  alert_type: string;
  protocol_label: string | null;
  zona_inclusion: string | null;
  zona_exclusion: string | null;
  correa: string | null;
  generated_message: string;
  activated_at: string;
  reported_to_authority: boolean;
  reported_at: string | null;
  report_document: string | null;
  related_folio: string | null;
}

export interface WeeklyReportAttachment {
  attachment_id: number;
  file_url: string;
  filename: string;
  mime_type: string | null;
  caption: string | null;
  section: 'mensajes' | 'recorrido' | 'evidencia';
  display_order: number;
}

export interface WeeklyReportAggregate {
  total_alerts: number;
  reported_alerts: number;
  unreported_alerts: number;
  alerts: WeeklyReportAlertRow[];
}

export interface CarrierSnapshot {
  carrier_id: number;
  client_id: number | null;
  subject_name: string; // defendant_name del cliente
  bracelet_serial: string;
  installation_date: string | null; // ISO
  installation_location: string;
  residence_area: string | null;
}

// =============================================================================
// Data layer
// =============================================================================

/**
 * Trae el "snapshot" de los datos del portador que entran al PDF.
 */
export const getCarrierSnapshot = async (
  carrier_id: number,
): Promise<CarrierSnapshot | null> => {
  const r = await pool.query({
    text: `SELECT ca.carrier_id,
                  ca.electronic_bracelet AS bracelet_serial,
                  ca.placement_date      AS installation_date,
                  ca.residence_area      AS residence_area,
                  ca.client_id,
                  c.defendant_name       AS subject_name,
                  c.court_name           AS court_name
           FROM CARRIERS ca
           LEFT JOIN CLIENTS c ON c.client_id = ca.client_id
           WHERE ca.carrier_id = $1`,
    values: [carrier_id],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    carrier_id: row.carrier_id,
    client_id: row.client_id ?? null,
    subject_name: row.subject_name || 'PORTADOR',
    bracelet_serial: row.bracelet_serial || 'N/D',
    installation_date: row.installation_date
      ? new Date(row.installation_date).toISOString().slice(0, 10)
      : null,
    installation_location: row.residence_area || row.court_name || 'domicilio del imputado',
    residence_area: row.residence_area ?? null,
  };
};

export type WeeklyReportType = 'full' | 'reported-only';

/**
 * Alertas del portador dentro del rango. Si reportType es 'reported-only',
 * solo incluye alertas con reported_to_authority = true.
 */
export const aggregateAlertsForCarrierAndRange = async (
  carrier_id: number | null,
  from: string,
  to: string,
  reportType: WeeklyReportType = 'full',
): Promise<WeeklyReportAggregate> => {
  const carrierClause = carrier_id ? ' AND a.carrier_id = $3' : '';
  const reportedClause =
    reportType === 'reported-only' ? ' AND a.reported_to_authority = TRUE' : '';
  const values: any[] = [from, to];
  if (carrier_id) values.push(carrier_id);

  const alertsRes = await pool.query<WeeklyReportAlertRow>({
    text: `SELECT a.alert_id, a.alert_type,
                  p.label                 AS protocol_label,
                  a.zona_inclusion, a.zona_exclusion, a.correa,
                  a.generated_message, a.activated_at,
                  a.reported_to_authority, a.reported_at,
                  a.report_document,
                  NULL::text AS related_folio
           FROM ALERTS a
           LEFT JOIN ALERT_PROTOCOLS p ON p.protocol_id = a.protocol_id
           WHERE a.activated_at >= $1::timestamp
             AND a.activated_at <  ($2::timestamp + INTERVAL '1 day')
             ${carrierClause}
             ${reportedClause}
           ORDER BY a.activated_at ASC`,
    values,
  });

  const reported = alertsRes.rows.filter((a) => a.reported_to_authority).length;
  return {
    total_alerts: alertsRes.rows.length,
    reported_alerts: reported,
    unreported_alerts: alertsRes.rows.length - reported,
    alerts: alertsRes.rows,
  };
};

export const listAttachmentsForReport = async (
  weekly_report_id: number,
): Promise<WeeklyReportAttachment[]> => {
  const r = await pool.query<WeeklyReportAttachment>({
    text: `SELECT attachment_id, file_url, filename, mime_type, caption, section, display_order
           FROM WEEKLY_REPORT_ATTACHMENTS
           WHERE weekly_report_id = $1
           ORDER BY display_order ASC, attachment_id ASC`,
    values: [weekly_report_id],
  });
  return r.rows;
};

// =============================================================================
// PDF builder — estilo oficial CC-IOD
// =============================================================================

const PAGE_MARGIN = 60;
const HEADER_TOP = 30;
// El footer ocupa 3 líneas a partir de FOOTER_TOP. Tiene que terminar antes
// de page.height (Letter = 792). Si FOOTER_TOP queda muy abajo, pdfkit dispara
// addPage() automático al pintar la 3ra línea y aparecen páginas en blanco.
const FOOTER_TOP = 720;

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const formatLongDate = (iso: string): string => {
  const d = new Date(iso + (iso.includes('T') ? '' : 'T00:00:00'));
  return `${d.getDate().toString().padStart(2, '0')} de ${MONTHS_ES[d.getMonth()]} de ${d.getFullYear()}`;
};

const formatWeekRange = (from: string, to: string): string => {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  // "02 al 08 de febrero de 2026" si mismo mes/año
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    const dayA = a.getDate().toString().padStart(2, '0');
    const dayB = b.getDate().toString().padStart(2, '0');
    return `${dayA} al ${dayB} de ${MONTHS_ES[b.getMonth()]} de ${b.getFullYear()}`;
  }
  return `${formatLongDate(from)} al ${formatLongDate(to)}`;
};

const formatDayWithName = (iso: string): string => {
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const d = new Date(iso);
  return `el día ${days[d.getDay()]} ${d.getDate().toString().padStart(2, '0')} de ${MONTHS_ES[d.getMonth()]}`;
};

interface BuildArgs {
  meta: {
    city: string;
    folio: string;
    issuedDate: string; // ISO date string
    period_from: string;
    period_to: string;
    summary?: string;
    signerName: string;
    signerRole: string;
    reportType?: WeeklyReportType;
  };
  carrier: CarrierSnapshot;
  data: WeeklyReportAggregate;
  attachments: WeeklyReportAttachment[];
  attachmentBuffers: Map<number, Buffer>; // cargado por el caller para no hacer fetch dentro
}

export const buildWeeklyReportPdf = ({
  meta,
  carrier,
  data,
  attachments,
  attachmentBuffers,
}: BuildArgs): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        // bottom 30 deja el área de pdfkit hasta y=762, lo suficiente para que
        // las 3 líneas del footer (en y=720, 732, 744) no disparen addPage
        // automático. Mi lógica de overflow sigue usando FOOTER_TOP como límite.
        margins: { top: PAGE_MARGIN + 50, bottom: 30, left: PAGE_MARGIN, right: PAGE_MARGIN },
        bufferPages: true,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // --- Pie / encabezado (decoración que aplica a TODAS las páginas) ---
      const decoratePage = () => {
        // Marca de agua tenue al centro
        try {
          doc.save();
          doc.opacity(0.05);
          doc.image(WATERMARK_PATH, doc.page.width / 2 - 150, 280, { width: 300 });
          doc.restore();
        } catch {
          /* sin marca si falta asset */
        }

        // Logo top-right
        try {
          doc.image(LOGO_PATH, doc.page.width - PAGE_MARGIN - 110, HEADER_TOP, {
            width: 110,
          });
        } catch {
          /* sin logo si falta asset */
        }
      };

      const drawFooter = (pageNumber: number, totalPages: number) => {
        const x = PAGE_MARGIN;
        const w = doc.page.width - PAGE_MARGIN * 2;
        const baseY = FOOTER_TOP;
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#333')
          .text(`Página ${pageNumber} de ${totalPages}`, x, baseY, {
            width: 80,
            align: 'left',
            lineBreak: false,
          });
        doc
          .fontSize(9)
          .fillColor('#222')
          .text(`Dirección: ${COMPANY_PROFILE.address}`, x + 80, baseY, {
            width: w - 80,
            align: 'right',
            lineBreak: false,
          });
        const telRfcText = `Tel: ${COMPANY_PROFILE.phones}    RFC: ${COMPANY_PROFILE.rfc}`;
        doc
          .fontSize(9)
          .fillColor('#222')
          .text(telRfcText, x, baseY + 12, {
            width: w,
            align: 'right',
            lineBreak: false,
          });
        doc
          .fontSize(9)
          .fillColor('#2D52B0')
          .text(`Correo electrónico: ${COMPANY_PROFILE.email}`, x, baseY + 24, {
            width: w,
            align: 'right',
            lineBreak: false,
          });
      };

      doc.on('pageAdded', decoratePage);
      decoratePage();

      // --- Encabezado tipo carta ---
      doc
        .fontSize(11)
        .font('Helvetica')
        .fillColor('#222')
        .text(`${meta.city} a ${formatLongDate(meta.issuedDate)}`, {
          align: 'right',
        })
        .fontSize(11)
        .text(meta.folio, { align: 'right' });

      doc.moveDown(1.5);

      // --- Destinatario ---
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#1A2340');
      COMPANY_PROFILE.recipientLines.forEach((line) => doc.text(line));
      doc.text('P R E S E N T E');
      doc.font('Helvetica').fillColor('#222');

      doc.moveDown(0.8);

      // --- Párrafo intro ---
      const installLine = carrier.installation_date
        ? `realizado el día ${formatLongDate(carrier.installation_date)}`
        : 'realizado recientemente';
      doc
        .fontSize(11)
        .text(
          `En atención a la instalación del brazalete electrónico de la C. ${carrier.subject_name}, ` +
            `${installLine} en ${carrier.installation_location}, me permito enviar el reporte ` +
            `semanal sobre el monitoreo del brazalete electrónico del imputado.`,
          { align: 'justify' },
        );

      doc.moveDown(0.8);

      // --- Bloque de datos ---
      const titleText =
        meta.reportType === 'reported-only'
          ? 'REPORTE SEMANAL DE ALERTAS REPORTADAS A LA AUTORIDAD:'
          : 'REPORTE SEMANAL DEL MONITOREO:';
      doc.font('Helvetica-Bold').text(titleText);
      doc.moveDown(0.4);
      doc.font('Helvetica');
      doc.text(`Nombre: ${carrier.subject_name}`);
      doc.text(`Brazalete actual: ${carrier.bracelet_serial}`);
      doc.text(`Semana: ${formatWeekRange(meta.period_from, meta.period_to)}`);

      doc.moveDown(0.8);

      // --- §1 RESUMEN GENERAL DE LA SEMANA ---
      doc.font('Helvetica-Bold').fontSize(11).text('1.   RESUMEN GENERAL DE LA SEMANA');
      doc.moveDown(0.3);
      doc
        .font('Helvetica')
        .fontSize(11)
        .text(
          `Durante esta semana se dio seguimiento al monitoreo electrónico del brazalete con número ` +
            `${carrier.bracelet_serial} incluyendo revisión de incidencias como batería del dispositivo, ` +
            `no comunicación, zonas de inclusión, exclusión y alertas de violación de correa.`,
          { align: 'justify' },
        );
      doc.moveDown(0.3);

      if (data.alerts.length === 0) {
        bullet(
          doc,
          `En la semana del ${formatWeekRange(meta.period_from, meta.period_to)}, no hubo alertas por parte del portador en mención.`,
        );
      } else {
        for (const a of data.alerts) {
          const when = formatDayWithName(a.activated_at);
          const hora = new Date(a.activated_at).toLocaleTimeString('es-MX', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });
          const tipo =
            (a.protocol_label || a.alert_type)
              .replace(/^ALERTA — /i, '')
              .toLowerCase();
          const reported = a.reported_to_authority
            ? ` Se notificó a las autoridades correspondientes${a.reported_at ? `.` : ''}`
            : ' Aún no se notifica a la autoridad correspondiente.';
          bullet(
            doc,
            `En la semana del ${formatWeekRange(meta.period_from, meta.period_to)}, ` +
              `${when} a las ${hora} se registró una alerta de ${tipo} del portador en mención.` +
              reported,
          );
        }
      }

      doc.moveDown(0.6);

      // --- §2 RESUMEN DE MENSAJES ENVIADOS DURANTE LA SEMANA ---
      doc.font('Helvetica-Bold').fontSize(11).text('2.   RESUMEN DE MENSAJES ENVIADOS DURANTE LA SEMANA');
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(11);
      if (data.alerts.length === 0) {
        bullet(
          doc,
          `En la semana del ${formatWeekRange(meta.period_from, meta.period_to)}, no se enviaron mensajes al portador en mención.`,
        );
      } else {
        bullet(
          doc,
          `Durante la semana se enviaron comunicaciones al portador y a las autoridades correspondientes ` +
            `derivado de las alertas registradas. A continuación se adjunta la evidencia.`,
        );
      }

      // Imágenes sección "mensajes"
      embedAttachmentsForSection(doc, attachments, attachmentBuffers, 'mensajes');

      doc.moveDown(0.6);

      // --- §3 RECORRIDO DEL IMPUTADO DURANTE LA SEMANA ---
      doc.font('Helvetica-Bold').fontSize(11).text('3.   RECORRIDO DEL IMPUTADO DURANTE LA SEMANA');
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(11);
      bullet(
        doc,
        `A continuación, se adjunta evidencia de todo el recorrido que hizo el imputado en mención ` +
          `durante los días mencionados. Los puntos marcados fuera de su zona permitida pueden deberse ` +
          `a saltos de reubicación que hace el dispositivo.`,
      );
      doc.moveDown(0.3);
      doc
        .fontSize(10)
        .fillColor('#444')
        .text(
          `***Los saltos de reubicación que realiza el dispositivo se deben a que este percibe señal ` +
            `satelital y realiza un proceso de triangulación para calcular de una forma más precisa ` +
            `la ubicación, por lo que toma señal de varios satélites para poder seleccionar el que ` +
            `tenga una mayor intensidad de señal con más estabilidad o seleccionar la que tenga una ` +
            `interferencia menor.`,
          { align: 'justify' },
        )
        .fillColor('#222')
        .fontSize(11);

      embedAttachmentsForSection(doc, attachments, attachmentBuffers, 'recorrido');

      // Sección "evidencia" genérica si hay
      embedAttachmentsForSection(doc, attachments, attachmentBuffers, 'evidencia');

      // Summary del operador (opcional)
      if (meta.summary && meta.summary.trim().length > 0) {
        doc.moveDown(0.8);
        doc.font('Helvetica-Oblique').fontSize(10).text('Observaciones del operador:', {
          continued: false,
        });
        doc.font('Helvetica').fontSize(10).text(meta.summary, { align: 'justify' });
      }

      // --- Cierre + firma con coordenadas absolutas (evita page-breaks
      //     automáticos por moveDown que se pasa del bottom margin) ---
      const CLOSING_BLOCK_HEIGHT = 180;
      doc.moveDown(1);
      if (doc.y + CLOSING_BLOCK_HEIGHT > FOOTER_TOP - 10) {
        doc.addPage();
      }
      const startClosingY = doc.y;
      const contentX = PAGE_MARGIN;
      const contentW = doc.page.width - PAGE_MARGIN * 2;

      doc
        .font('Helvetica')
        .fontSize(11)
        .fillColor('#222')
        .text(
          'Sin otro particular y agradeciendo de antemano su atención le envío un cordial saludo.',
          contentX,
          startClosingY,
          { width: contentW, align: 'justify' },
        );

      const atentamenteY = startClosingY + 40;
      doc.fontSize(10).text('ATENTAMENTE', contentX, atentamenteY, {
        width: contentW,
        align: 'center',
        lineBreak: false,
      });

      let nameY = atentamenteY + 20;
      try {
        const cx = doc.page.width / 2 - 70;
        doc.image(SIGNATURE_PATH, cx, atentamenteY + 14, { width: 140 });
        nameY = atentamenteY + 80;
      } catch {
        nameY = atentamenteY + 40;
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(meta.signerName, contentX, nameY, {
          width: contentW,
          align: 'center',
          lineBreak: false,
        });
      doc
        .font('Helvetica')
        .fontSize(10)
        .text(meta.signerRole, contentX, nameY + 16, {
          width: contentW,
          align: 'center',
          lineBreak: false,
        });
      // Fija el cursor para que doc.end() no detecte contenido pendiente y
      // dispare page-breaks fantasma.
      doc.y = nameY + 32;

      // --- Footer en todas las páginas (recorrer buffered pages) ---
      const range = doc.bufferedPageRange();
      const totalPages = range.count;
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(range.start + i);
        drawFooter(i + 1, totalPages);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

// =============================================================================
// Helpers de layout
// =============================================================================

const bullet = (doc: PDFKit.PDFDocument, text: string) => {
  const bulletX = PAGE_MARGIN + 12;
  const textX = bulletX + 14;
  const usableWidth = doc.page.width - textX - PAGE_MARGIN;
  doc.font('Helvetica').fontSize(11).fillColor('#222');
  const startY = doc.y;
  doc.text('•', bulletX, startY);
  doc.text(text, textX, startY, {
    width: usableWidth,
    align: 'justify',
    lineGap: 1,
  });
  doc.x = PAGE_MARGIN;
};

/**
 * Embebe las imágenes de una sección con coordenadas absolutas y manejo
 * predecible de page-breaks. Layout en grid: 1 imagen → centrada;
 * 2+ imágenes → 2 columnas × N filas con altura acotada.
 */
const embedAttachmentsForSection = (
  doc: PDFKit.PDFDocument,
  attachments: WeeklyReportAttachment[],
  buffers: Map<number, Buffer>,
  section: 'mensajes' | 'recorrido' | 'evidencia',
) => {
  const subset = attachments.filter((a) => a.section === section);
  const valid = subset.filter((a) => buffers.has(a.attachment_id));
  if (valid.length === 0) return;

  doc.moveDown(0.4);
  const maxW = doc.page.width - PAGE_MARGIN * 2;
  const cols = valid.length === 1 ? 1 : 2;
  const rows = Math.ceil(valid.length / cols);
  const gap = 10;
  const colW = (maxW - gap * (cols - 1)) / cols;
  const rowH = Math.min(220, Math.max(100, (FOOTER_TOP - doc.y - 60) / rows));
  const totalH = rowH * rows + gap * (rows - 1) + 20;

  if (doc.y + totalH > FOOTER_TOP - 20) {
    doc.addPage();
  }
  const startY = doc.y;

  valid.forEach((att, idx) => {
    const buf = buffers.get(att.attachment_id)!;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = PAGE_MARGIN + col * (colW + gap);
    const y = startY + row * (rowH + gap);
    try {
      doc.image(buf, x, y, {
        fit: [colW, rowH],
        align: 'center',
        valign: 'center',
      });
    } catch {
      doc
        .fontSize(9)
        .fillColor('#a00')
        .text(`[No se pudo embeber ${att.filename}]`, x, y + rowH / 2, {
          width: colW,
          align: 'center',
          lineBreak: false,
        });
      doc.fillColor('#222').fontSize(11);
    }
  });

  // Avanzar el cursor manualmente por la altura total del grid
  doc.y = startY + rows * (rowH + gap);
};
