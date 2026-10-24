import { ArticleType } from '../articles/entities/article.entity';
import { UnitOfMeasure } from '../common/enums/unit-of-measure.enum';
import { ExtractedItem, reconcileItems } from './draft-reconciliation';

const line = (
  name: string,
  values: Partial<Omit<ExtractedItem, 'newArticle'>>,
): ExtractedItem => ({
  newArticle: {
    name,
    type: ArticleType.PRODUCT,
    unit: UnitOfMeasure.UNIT,
    brand: null,
  },
  unitPrice: null,
  quantity: 1,
  lineTotal: null,
  discount: null,
  description: null,
  ...values,
});

describe('reconcileItems', () => {
  it('líneas y total que cuadran no generan avisos', () => {
    const { items, warnings } = reconcileItems(
      [
        line('PAN', { unitPrice: 3500, quantity: 2, lineTotal: 7000 }),
        line('LECHE', {
          unitPrice: 4500,
          quantity: 1,
          discount: 500,
          lineTotal: 4000,
        }),
      ],
      11000,
    );
    expect(warnings).toEqual([]);
    expect(items[1]).toMatchObject({ unitPrice: 4500, discount: 500 });
    expect(items[0].newArticle.categoryId).toBeNull();
  });

  it('absorbe el redondeo de un producto pesado', () => {
    // 0,456 kg × 8.990 = 4.099,44 impreso como 4.099
    const { warnings } = reconcileItems(
      [line('TOMATE', { unitPrice: 8990, quantity: 0.456, lineTotal: 4099 })],
      4099,
    );
    expect(warnings).toEqual([]);
  });

  it('deriva el precio unitario del total de la línea si falta, y lo avisa', () => {
    const { items, warnings } = reconcileItems(
      [line('TOMATE', { quantity: 0.5, lineTotal: 4000 })],
      4000,
    );
    expect(items[0].unitPrice).toBe(8000);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('se calculó');
  });

  it('avisa sin corregir una línea que no cuadra (total de línea leído como unitario)', () => {
    const { items, warnings } = reconcileItems(
      [line('HUEVOS', { unitPrice: 15000, quantity: 3, lineTotal: 15000 })],
      15000,
    );
    expect(items[0].unitPrice).toBe(15000);
    expect(warnings.some((w) => w.startsWith('Línea 1 ("HUEVOS")'))).toBe(true);
    expect(warnings.some((w) => w.startsWith('La suma de las líneas'))).toBe(
      true,
    );
  });

  it('avisa si la suma de las líneas no coincide con el total', () => {
    const { warnings } = reconcileItems(
      [line('PAN', { unitPrice: 3500, quantity: 1, lineTotal: 3500 })],
      10000,
    );
    expect(warnings).toEqual([
      expect.stringContaining('no coincide con el total de la factura'),
    ]);
  });

  it('avisa si una línea no trae precio ni total', () => {
    const { items, warnings } = reconcileItems([line('BOLSA', {})], null);
    expect(items[0].unitPrice).toBeNull();
    expect(warnings[0]).toContain('complétalo antes de guardar');
  });
});
