import { strToU8, zipSync } from 'fflate';
import { extractXmlDocuments } from './attachment-extractor';
import { buildStoredRar } from './__fixtures__/rar';

const XML = '<?xml version="1.0"?><Invoice>ñandú</Invoice>';

function attachment(filename: string, data: Buffer | Uint8Array) {
  return {
    filename,
    mimeType: 'application/octet-stream',
    data: Buffer.from(data),
  };
}

describe('extractXmlDocuments', () => {
  it('XML suelto', async () => {
    expect(
      await extractXmlDocuments([attachment('f.xml', Buffer.from(XML))]),
    ).toEqual([XML]);
  });

  it('ignora PDF y adjuntos ajenos', async () => {
    expect(
      await extractXmlDocuments([
        attachment('f.pdf', Buffer.from('%PDF-1.4')),
        attachment('foto.png', Buffer.from([0x89, 0x50])),
      ]),
    ).toEqual([]);
  });

  it('ZIP con PDF y XML', async () => {
    const zip = zipSync({
      'factura.pdf': strToU8('%PDF-1.4'),
      'factura.xml': strToU8(XML),
    });
    expect(await extractXmlDocuments([attachment('f.zip', zip)])).toEqual([
      XML,
    ]);
  });

  it('RAR con PDF y XML', async () => {
    const rar = buildStoredRar([
      { name: 'factura.pdf', data: Buffer.from('%PDF-1.4') },
      { name: 'factura.xml', data: Buffer.from(XML) },
    ]);
    expect(await extractXmlDocuments([attachment('f.rar', rar)])).toEqual([
      XML,
    ]);
  });

  it('decide por la firma, no por la extensión', async () => {
    const zip = zipSync({ 'factura.xml': strToU8(XML) });
    expect(await extractXmlDocuments([attachment('f.rar', zip)])).toEqual([
      XML,
    ]);
  });

  it('un ZIP dentro de un RAR', async () => {
    const zip = Buffer.from(zipSync({ 'factura.xml': strToU8(XML) }));
    const rar = buildStoredRar([{ name: 'interno.zip', data: zip }]);
    expect(await extractXmlDocuments([attachment('f.rar', rar)])).toEqual([
      XML,
    ]);
  });

  it('un comprimido corrupto se salta sin tumbar los demás', async () => {
    const broken = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0, 1, 2]);
    expect(
      await extractXmlDocuments([
        attachment('roto.rar', broken),
        attachment('f.xml', Buffer.from(XML)),
      ]),
    ).toEqual([XML]);
  });

  it('respeta la codificación ISO-8859-1 declarada', async () => {
    const latin = '<?xml version="1.0" encoding="ISO-8859-1"?><a>café</a>';
    expect(
      await extractXmlDocuments([
        attachment('f.xml', Buffer.from(latin, 'latin1')),
      ]),
    ).toEqual([latin]);
  });
});
