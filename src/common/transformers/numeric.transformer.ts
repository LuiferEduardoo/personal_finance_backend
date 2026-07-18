import { ValueTransformer } from 'typeorm';

// postgres devuelve NUMERIC como string; lo exponemos como number en la app
export class NumericTransformer implements ValueTransformer {
  to(value: number | null | undefined): number | null | undefined {
    return value;
  }

  from(value: string | null | undefined): number | null {
    return value === null || value === undefined ? null : Number(value);
  }
}
