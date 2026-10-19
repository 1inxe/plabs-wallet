import { SponsoredTransferEngine, type Ports } from '../sponsored/engine';
import { publicRequest, type Profile, type Intent } from '../sponsored/protocol';
import { legacyRequest } from './protocol';
export type { Ports } from '../sponsored/engine';
/** Compatibility entry point; no distinct proving, funding or recovery path. */
export class JubjubEngine {
  private engine: SponsoredTransferEngine;
  constructor(ports: Ports) { this.engine = new SponsoredTransferEngine(ports); }
  fund(origin: string, intent: Intent, profile: Profile, seed: string, privacy: string) {
    return this.engine.fund(origin, intent, profile, seed, privacy, publicRequest(legacyRequest(profile, intent)));
  }
}
