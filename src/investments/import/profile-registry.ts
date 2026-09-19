import { Injectable } from '@nestjs/common';
import { binanceTradeHistoryProfile } from './profiles/binance-trade-history.profile';
import { etoroStatementProfile } from './profiles/etoro-statement.profile';
import { genericProfile } from './profiles/generic.profile';
import { ibkrFlexCsvProfile } from './profiles/ibkr-flex-csv.profile';
import {
  CanonicalField,
  ParserProfile,
  normalizeHeader,
} from './profiles/profile.types';
import { xtbStatementProfile } from './profiles/xtb-statement.profile';

// Por debajo de esta confianza no se fía de la detección y cae al perfil
// genérico, que solo acierta con nombres de columna habituales.
const MIN_CONFIDENCE = 0.6;

export interface ProfileDetection {
  profile: ParserProfile;
  confidence: number;
  /** campo canónico -> cabecera real del archivo */
  mapping: Record<string, string>;
}

// Estrategia de mapeo: perfil por bróker primero, heurística después,
// corrección del usuario al final. Los tres, en ese orden, porque ninguno basta
// solo: el perfil acierta el 95% de los casos, la heurística evita que un
// bróker desconocido sea un callejón sin salida, y poder corregir es lo que
// hace seguro adivinar.
@Injectable()
export class ProfileRegistry {
  private readonly profiles: ParserProfile[] = [
    etoroStatementProfile,
    ibkrFlexCsvProfile,
    binanceTradeHistoryProfile,
    xtbStatementProfile,
  ];

  detect(headers: string[]): ProfileDetection {
    let best: ParserProfile = genericProfile;
    let bestScore = 0;

    for (const profile of this.profiles) {
      const score = profile.detect(headers);
      if (score > bestScore) {
        best = profile;
        bestScore = score;
      }
    }

    if (bestScore < MIN_CONFIDENCE) {
      best = genericProfile;
      bestScore = 0;
    }

    return {
      profile: best,
      confidence: bestScore,
      mapping: this.buildMapping(best, headers),
    };
  }

  byId(id: string): ParserProfile {
    return this.profiles.find((profile) => profile.id === id) ?? genericProfile;
  }

  // Resuelve cada campo canónico a la cabecera REAL del archivo, comparando de
  // forma normalizada para que acentos, mayúsculas y guiones bajos no importen.
  buildMapping(
    profile: ParserProfile,
    headers: string[],
  ): Record<string, string> {
    const byNormalized = new Map<string, string>();
    for (const header of headers) {
      byNormalized.set(normalizeHeader(header), header);
    }

    const mapping: Record<string, string> = {};
    for (const [field, aliases] of Object.entries(profile.columns)) {
      for (const alias of aliases ?? []) {
        const found = byNormalized.get(normalizeHeader(alias));
        if (found) {
          mapping[field as CanonicalField] = found;
          break;
        }
      }
    }
    return mapping;
  }
}
