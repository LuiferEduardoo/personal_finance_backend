import { unzipSync } from 'fflate';
import { createExtractorFromData } from 'node-unrar-js';

// Saca los XML de los adjuntos de un correo. Las facturas electrónicas llegan
// como .xml suelto, como .zip (lo que pide la DIAN) o como .rar (lo que usan
// algunos comercios), normalmente con el PDF al lado. El PDF se ignora: el XML
// es el documento legal y es el que se interpreta.

export interface MailAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

// Tope por archivo, comprimido o descomprimido. Una factura pesa unos KB; esto
// corta bombas de compresión y adjuntos que no tienen nada que ver.
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

// un comprimido dentro de otro (zip dentro de rar) sí; más niveles, no
const MAX_DEPTH = 2;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const RAR_MAGIC = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07];

type Kind = 'xml' | 'zip' | 'rar' | 'other';

/**
 * Devuelve el texto de cada XML encontrado, en el orden en que aparece. Un
 * comprimido corrupto o con contraseña se salta sin tumbar el resto.
 */
export async function extractXmlDocuments(
  attachments: MailAttachment[],
): Promise<string[]> {
  const found: string[] = [];
  for (const attachment of attachments) {
    await collect(attachment.filename, attachment.data, 0, found);
  }
  return found;
}

async function collect(
  filename: string,
  data: Uint8Array,
  depth: number,
  found: string[],
): Promise<void> {
  if (data.byteLength > MAX_ATTACHMENT_BYTES) {
    return;
  }
  const kind = detect(filename, data);
  if (kind === 'xml') {
    found.push(decodeXml(data));
    return;
  }
  if (depth >= MAX_DEPTH || kind === 'other') {
    return;
  }

  const entries =
    kind === 'zip' ? unzipEntries(data) : await unrarEntries(data);
  for (const entry of entries) {
    await collect(entry.name, entry.data, depth + 1, found);
  }
}

// Se decide por la firma del archivo antes que por el nombre: hay remitentes
// que mandan un .zip llamado .rar y viceversa.
function detect(filename: string, data: Uint8Array): Kind {
  if (startsWith(data, ZIP_MAGIC)) {
    return 'zip';
  }
  if (startsWith(data, RAR_MAGIC)) {
    return 'rar';
  }
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xml')) {
    return 'xml';
  }
  return 'other';
}

// solo lo que puede contener la factura; el PDF ni se descomprime
function wanted(name: string): boolean {
  return /\.(xml|zip|rar)$/i.test(name);
}

interface Entry {
  name: string;
  data: Uint8Array;
}

function unzipEntries(data: Uint8Array): Entry[] {
  try {
    const files = unzipSync(data, {
      filter: (file) =>
        wanted(file.name) && file.originalSize <= MAX_ATTACHMENT_BYTES,
    });
    return Object.entries(files).map(([name, content]) => ({
      name,
      data: content,
    }));
  } catch {
    return [];
  }
}

async function unrarEntries(data: Uint8Array): Promise<Entry[]> {
  try {
    const extractor = await createExtractorFromData({
      data: data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer,
    });
    const extracted = extractor.extract({
      files: (header) =>
        !header.flags.directory &&
        !header.flags.encrypted &&
        wanted(header.name) &&
        header.unpSize <= MAX_ATTACHMENT_BYTES,
    });
    // OJO: el iterador hay que recorrerlo ENTERO o el objeto de C++ no se
    // libera (lo advierte la documentación de node-unrar-js)
    const entries: Entry[] = [];
    for (const file of extracted.files) {
      if (file.extraction) {
        entries.push({ name: file.fileHeader.name, data: file.extraction });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

// Casi todas vienen en UTF-8, pero algunos proveedores declaran ISO-8859-1 y
// leerlas como UTF-8 destrozaría las tildes de las descripciones.
function decodeXml(data: Uint8Array): string {
  const head = Buffer.from(data.subarray(0, 200)).toString('latin1');
  const encoding = /encoding=["']([^"']+)["']/i.exec(head)?.[1]?.toLowerCase();
  if (encoding === 'iso-8859-1' || encoding === 'latin1') {
    return Buffer.from(data).toString('latin1');
  }
  return Buffer.from(data).toString('utf8');
}

function startsWith(data: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, index) => data[index] === byte);
}
