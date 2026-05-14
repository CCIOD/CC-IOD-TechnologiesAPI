import PDFDocument from 'pdfkit';
import path from 'path';
import axios from 'axios';
import { BlobServiceClient } from '@azure/storage-blob';
import { COMPANY_PROFILE } from './folio.service';

const AZURE_KEY = process.env.AZURE_STORAGE_CONNECTION_STRING;

const ASSETS_DIR = path.resolve(__dirname, '..', 'assets');
const LOGO_PATH = path.join(ASSETS_DIR, 'cciod-logo.png');
const WATERMARK_PATH = path.join(ASSETS_DIR, 'cciod-watermark.png');

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

const dayName = (iso: string): string => {
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return days[new Date(iso).getDay()];
};

export interface AlertReportMeta {
  city: string;
  folio: string;
  issuedDate: string; // YYYY-MM-DD
  // Datos del portador
  subjectName: string;
  installationDate: string | null;
  installationLocation: string;
  // Datos del incidente
  alertActivatedAt: string; // ISO
  alertType: string;
  protocolLabel: string;
  authorityWhatsapp: string | null;
  authorityEmail: string | null;
  // Firmante (monitorista que reporta)
  signerName: string;
  signerRole: string;
  signatureUrl: string | null;
}

export interface AlertReportAttachment {
  file_url: string;
  caption?: string | null;
}

/**
 * Intenta extraer (container, blobName) de una URL del blob storage.
 * Acepta formatos típicos como https://<acct>.blob.core.windows.net/<container>/<path>
 */
const parseBlobUrl = (
  url: string,
): { container: string; blob: string } | null => {
  try {
    const u = new URL(url);
    // pathname tipo /alert-reports/alert-9/anexos/foo.png
    const parts = u.pathname.replace(/^\//, '').split('/');
    if (parts.length < 2) return null;
    const [container, ...rest] = parts;
    return { container, blob: decodeURIComponent(rest.join('/')) };
  } catch {
    return null;
  }
};

/**
 * Descarga un blob usando el SDK de Azure si la URL es de nuestro storage.
 * Si no, cae al fetch HTTP con axios.
 */
const downloadOne = async (url: string): Promise<Buffer | null> => {
  // 1) SDK directo (más confiable que HTTP cuando el blob es nuestro)
  if (AZURE_KEY) {
    const parsed = parseBlobUrl(url);
    if (parsed) {
      try {
        const svc = BlobServiceClient.fromConnectionString(AZURE_KEY);
        const c = svc.getContainerClient(parsed.container);
        const b = c.getBlockBlobClient(parsed.blob);
        const buf = await b.downloadToBuffer();
        if (buf.length > 0) {
          console.log(
            `[alertReport] Anexo descargado via SDK (${buf.length}B): ${parsed.container}/${parsed.blob}`,
          );
          return buf;
        }
      } catch (err) {
        console.warn(
          `[alertReport] SDK falló para ${url}:`,
          (err as Error).message,
        );
      }
    }
  }
  // 2) Fallback HTTP
  try {
    const r = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      validateStatus: () => true,
    });
    if (r.status !== 200) {
      console.warn(`[alertReport] HTTP ${r.status} al descargar ${url}`);
      return null;
    }
    const buf = Buffer.from(r.data);
    if (buf.length === 0) {
      console.warn(`[alertReport] Descarga vacía: ${url}`);
      return null;
    }
    console.log(`[alertReport] Anexo descargado via HTTP (${buf.length}B): ${url}`);
    return buf;
  } catch (err) {
    console.warn(
      `[alertReport] axios falló para ${url}:`,
      (err as Error).message,
    );
    return null;
  }
};

/**
 * Descarga las imágenes en paralelo.
 */
const downloadAttachments = async (
  attachments: AlertReportAttachment[],
): Promise<Map<string, Buffer>> => {
  const map = new Map<string, Buffer>();
  console.log(
    `[alertReport] Descargando ${attachments.length} anexo(s)…`,
    attachments.map((a) => a.file_url),
  );
  await Promise.all(
    attachments.map(async (a) => {
      const buf = await downloadOne(a.file_url);
      if (buf) map.set(a.file_url, buf);
    }),
  );
  console.log(
    `[alertReport] Embebidos efectivos: ${map.size}/${attachments.length}`,
  );
  return map;
};

/**
 * Descarga la firma del monitorista. Si falla, devuelve null y el PDF se
 * genera sin imagen de firma.
 */
const downloadSignature = async (url: string | null): Promise<Buffer | null> => {
  if (!url) return null;
  try {
    const r = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
    return Buffer.from(r.data);
  } catch (err) {
    console.warn('[alertReport] No se pudo descargar la firma:', (err as Error).message);
    return null;
  }
};

export const buildAlertReportPdf = async (
  meta: AlertReportMeta,
  attachments: AlertReportAttachment[],
): Promise<Buffer> => {
  const buffers = await downloadAttachments(attachments);
  const signatureBuf = await downloadSignature(meta.signatureUrl);

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

      const decoratePage = () => {
        try {
          doc.save();
          doc.opacity(0.05);
          doc.image(WATERMARK_PATH, doc.page.width / 2 - 150, 280, { width: 300 });
          doc.restore();
        } catch {
          /* sin marca si falta asset */
        }
        try {
          doc.image(LOGO_PATH, doc.page.width - PAGE_MARGIN - 110, HEADER_TOP, {
            width: 110,
          });
        } catch {
          /* sin logo */
        }
      };

      const drawFooter = (pageNumber: number, totalPages: number) => {
        const x = PAGE_MARGIN;
        const w = doc.page.width - PAGE_MARGIN * 2;
        const baseY = FOOTER_TOP;
        // Cada línea con coordenadas absolutas, sin continued ni moveDown,
        // para que pdfkit no dispare page-breaks al pintar el footer.
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
        // Línea Tel | RFC dividida en dos textos absolutos para colores distintos.
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

      // Encabezado tipo carta
      doc
        .fontSize(11)
        .font('Helvetica')
        .fillColor('#222')
        .text(`${meta.city} a ${formatLongDate(meta.issuedDate)}`, { align: 'right' })
        .text(meta.folio, { align: 'right' });

      doc.moveDown(1.5);

      // Destinatario
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#1A2340');
      COMPANY_PROFILE.recipientLines.forEach((line) => doc.text(line));
      doc.text('P R E S E N T E');
      doc.font('Helvetica').fillColor('#222');

      doc.moveDown(0.8);

      // Intro
      const install = meta.installationDate
        ? `realizado el día ${dayName(meta.installationDate)} ${formatLongDate(meta.installationDate)}`
        : 'realizado recientemente';
      doc
        .fontSize(11)
        .text(
          `En atención a la instalación del brazalete de la C. ${meta.subjectName}, ` +
            `${install} en ${meta.installationLocation}, me permito comentar lo siguiente:`,
          { align: 'justify' },
        );

      doc.moveDown(0.8);

      // Cuerpo del incidente
      const when = `el día ${dayName(meta.alertActivatedAt)} ${formatLongDate(
        meta.alertActivatedAt.slice(0, 10),
      )}`;
      const lowerLabel = (meta.protocolLabel || meta.alertType).toLowerCase();

      const lines = [
        `Que ${when}, se emitió una alerta de ${lowerLabel} de la portadora en ` +
          `mención. Por lo que se activó el protocolo correspondiente por parte del ` +
          `centro de monitoreo.`,
      ];
      const contactos: string[] = [];
      if (meta.authorityWhatsapp) contactos.push(meta.authorityWhatsapp);
      if (meta.authorityEmail) contactos.push(meta.authorityEmail);
      if (contactos.length > 0) {
        lines.push(
          `Se mandó mensaje notificando la alerta a ${contactos.join(' y ')} ` +
            `de la autoridad a cargo de la supervisión de la medida cautelar de la ` +
            `portadora en mención para dar seguimiento a la alerta. (Anexo 1).`,
        );
      } else {
        lines.push(
          `Aún no se cuenta con datos de contacto de la autoridad para notificar ` +
            `la alerta. (Anexo 1).`,
        );
      }

      for (const text of lines) {
        const bulletX = PAGE_MARGIN + 12;
        const textX = bulletX + 14;
        const usableWidth = doc.page.width - textX - PAGE_MARGIN;
        doc.font('Helvetica').fontSize(11).fillColor('#222');
        const startY = doc.y;
        doc.text('•', bulletX, startY);
        doc.text(text, textX, startY, {
          width: usableWidth,
          align: 'justify',
        });
        doc.x = PAGE_MARGIN;
        doc.moveDown(0.3);
      }

      // Anexos / imágenes con layout predecible que no genera páginas extra.
      const validAttachments = attachments.filter((a) => buffers.has(a.file_url));
      if (validAttachments.length > 0) {
        doc.moveDown(0.5);
        const maxW = doc.page.width - PAGE_MARGIN * 2;

        // Calcula cuántas filas y columnas según el número de imágenes.
        const cols = validAttachments.length === 1 ? 1 : 2;
        const rows = Math.ceil(validAttachments.length / cols);
        const gap = 10;
        const colW = (maxW - gap * (cols - 1)) / cols;
        // Altura conservadora por imagen para que entren en una sola página.
        const rowH = Math.min(220, (FOOTER_TOP - doc.y - 220) / rows);
        const safeRowH = rowH < 100 ? 100 : rowH;

        // Si no cabe el bloque completo en esta página, salta a la siguiente
        // ANTES de empezar a dibujar (evita imágenes huérfanas).
        const totalH = safeRowH * rows + 30;
        if (doc.y + totalH > FOOTER_TOP - 20) {
          doc.addPage();
        }
        const startY = doc.y;

        validAttachments.forEach((a, idx) => {
          const buf = buffers.get(a.file_url)!;
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const x = PAGE_MARGIN + col * (colW + gap);
          const y = startY + row * (safeRowH + gap);
          try {
            doc.image(buf, x, y, { fit: [colW, safeRowH], align: 'center', valign: 'center' });
          } catch (err) {
            console.warn('[alertReport] doc.image falló:', (err as Error).message);
          }
        });

        doc.y = startY + rows * (safeRowH + gap);

        // Etiqueta del anexo
        doc.moveDown(0.2);
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#666').text('Anexo 1', {
          align: 'center',
        });
        doc.font('Helvetica').fillColor('#222').fontSize(11);
      } else if (attachments.length > 0) {
        // Había attachments pero ninguno se pudo descargar → aviso explícito
        doc.moveDown(0.5);
        doc
          .font('Helvetica-Oblique')
          .fontSize(9)
          .fillColor('#a00')
          .text(
            `[No se pudieron embeber ${attachments.length} imagen(es) adjunta(s) — verifique conectividad o permisos del blob.]`,
            { align: 'center' },
          );
        doc.font('Helvetica').fillColor('#222').fontSize(11);
      }

      // Bloque de cierre con coordenadas absolutas: garantiza posición y
      // evita page-breaks automáticos. Si no cabe, hace UN solo addPage.
      const CLOSING_BLOCK_HEIGHT = signatureBuf ? 170 : 110;
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
          'Sin otro particular le envío un cordial saludo.',
          contentX,
          startClosingY,
          { width: contentW, align: 'justify', lineBreak: true },
        );
      const atentamenteY = startClosingY + 36;
      doc.fontSize(10).text('ATENTAMENTE', contentX, atentamenteY, {
        width: contentW,
        align: 'center',
        lineBreak: false,
      });

      let nameY = atentamenteY + 18;
      if (signatureBuf) {
        try {
          const cx = doc.page.width / 2 - 70;
          doc.image(signatureBuf, cx, atentamenteY + 14, { width: 140 });
          nameY = atentamenteY + 80;
        } catch {
          nameY = atentamenteY + 40;
        }
      } else {
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
      // Fija el cursor para que el `doc.end()` no detecte contenido pendiente
      // y dispare page-breaks fantasma.
      doc.y = nameY + 32;

      // Footer en todas las páginas
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        drawFooter(i + 1, range.count);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
