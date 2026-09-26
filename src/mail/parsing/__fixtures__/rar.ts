import { crc32 } from 'zlib';

// Arma un RAR 4 "almacenado" (sin compresión) en memoria. No hay binario de
// rar en el entorno de pruebas y un .rar opaco en el repo sería imposible de
// revisar; este formato mínimo lo abre node-unrar-js igual que uno real.
export function buildStoredRar(
  files: { name: string; data: Buffer }[],
): Buffer {
  const parts: Buffer[] = [
    Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]),
  ];
  const main = Buffer.alloc(11);
  main.writeUInt8(0x73, 0);
  main.writeUInt16LE(13, 3);
  parts.push(block(main));

  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const header = Buffer.alloc(30 + nameBytes.length);
    let offset = header.writeUInt8(0x74, 0);
    offset = header.writeUInt16LE(0x8000, offset); // LONG_BLOCK
    offset = header.writeUInt16LE(32 + nameBytes.length, offset);
    offset = header.writeUInt32LE(data.length, offset); // tamaño empaquetado
    offset = header.writeUInt32LE(data.length, offset); // tamaño original
    offset = header.writeUInt8(3, offset); // unix
    offset = header.writeUInt32LE(crc32(data) >>> 0, offset);
    offset = header.writeUInt32LE(0x5a000000, offset); // fecha DOS
    offset = header.writeUInt8(20, offset); // versión 2.0
    offset = header.writeUInt8(0x30, offset); // método: almacenado
    offset = header.writeUInt16LE(nameBytes.length, offset);
    offset = header.writeUInt32LE(0o100644, offset);
    nameBytes.copy(header, offset);
    parts.push(block(header), data);
  }

  parts.push(Buffer.from([0xc4, 0x3d, 0x7b, 0x00, 0x40, 0x07, 0x00]));
  return Buffer.concat(parts);
}

// cada bloque empieza con los 16 bits bajos del CRC32 del resto del bloque
function block(body: Buffer): Buffer {
  const crc = Buffer.alloc(2);
  crc.writeUInt16LE((crc32(body) >>> 0) & 0xffff);
  return Buffer.concat([crc, body]);
}
