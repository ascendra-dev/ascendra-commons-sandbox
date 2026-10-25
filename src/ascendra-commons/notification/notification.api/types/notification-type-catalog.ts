import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import {
  NOTIFICATION_TYPES,
  sampleVariables,
  templateVariables,
  type NotificationTypeDefinition,
} from '../../notification.core';

/**
 * The app's declared notification types (`NotificationModule.forRoot({ types })`), as `notification.api` checks
 * against them. Declared none — or `NOTIFICATION_TYPES` not visible here — and every check passes: today's behaviour.
 */
@Injectable()
export class NotificationTypeCatalog {
  private readonly byName: ReadonlyMap<string, NotificationTypeDefinition>;

  constructor(@Optional() @Inject(NOTIFICATION_TYPES) types: readonly NotificationTypeDefinition[] = []) {
    this.byName = new Map(types.map((t) => [t.name, t]));
  }

  /** Whether the app declared any — the checks below apply only then. */
  get declared(): boolean {
    return this.byName.size > 0;
  }

  list(): NotificationTypeDefinition[] {
    return [...this.byName.values()];
  }

  get(name: string): NotificationTypeDefinition | undefined {
    return this.byName.get(name);
  }

  /** A route or template for a type the app doesn't send would never fire — a typo. */
  assertKnown(name: string): void {
    if (this.declared && !this.byName.has(name)) {
      throw new BadRequestException(`"${name}" is not a notification type this app declares`);
    }
  }

  /** `{{invoiceNo}}` where the type has `invoiceNumber` renders as a visible placeholder to a customer — caught here. */
  assertVariables(name: string, ...texts: Array<string | null | undefined>): void {
    const type = this.byName.get(name);
    if (!type) return;
    const allowed = new Set((type.variables ?? []).map((v) => v.name));
    const unknown = templateVariables(...texts).filter((v) => !allowed.has(v));
    if (unknown.length > 0) {
      const has = allowed.size > 0 ? `it has ${[...allowed].map((v) => `{{${v}}}`).join(', ')}` : 'it has none';
      throw new BadRequestException(`${unknown.map((v) => `{{${v}}}`).join(', ')} is not a variable of "${name}" — ${has}`);
    }
  }

  /** The type's sample values, overlaid with what the caller gave. */
  withSamples(name: string | undefined, given: Record<string, string | number>): Record<string, string | number> {
    return { ...sampleVariables(name ? this.byName.get(name) : undefined), ...given };
  }
}
