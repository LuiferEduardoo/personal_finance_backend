import {
  isInvalidGrant,
  isNotFound,
  parseAddress,
} from './gmail-client.service';

describe('parseAddress', () => {
  it('saca la dirección de un From con nombre', () => {
    expect(parseAddress('D1 S A S <FacturacionElectronica@D1.com.co>')).toBe(
      'facturacionelectronica@d1.com.co',
    );
  });

  it('acepta la dirección sola y rechaza lo que no lo es', () => {
    expect(parseAddress(' ventas@tienda.co ')).toBe('ventas@tienda.co');
    expect(parseAddress('Sin correo')).toBeNull();
    expect(parseAddress(null)).toBeNull();
  });
});

describe('clasificación de errores de Google', () => {
  it('invalid_grant', () => {
    expect(isInvalidGrant(new Error('invalid_grant'))).toBe(true);
    expect(
      isInvalidGrant({ response: { data: { error: 'invalid_grant' } } }),
    ).toBe(true);
    expect(isInvalidGrant(new Error('timeout'))).toBe(false);
  });

  it('404 de historial caducado', () => {
    expect(isNotFound({ status: 404 })).toBe(true);
    expect(isNotFound({ code: '404' })).toBe(true);
    expect(isNotFound({ status: 500 })).toBe(false);
  });
});
