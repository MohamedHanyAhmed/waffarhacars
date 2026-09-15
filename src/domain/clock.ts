export interface Clock {
  now(): string; // ISO 8601 string
}

export class StaticClock implements Clock {
  private currentIso: string;

  constructor(initialIso: string = "2026-09-13T12:00:00.000Z") {
    this.currentIso = initialIso;
  }

  now(): string {
    return this.currentIso;
  }

  setTime(iso: string): void {
    this.currentIso = iso;
  }

  advanceMinutes(minutes: number): void {
    const d = new Date(this.currentIso);
    d.setMinutes(d.getMinutes() + minutes);
    this.currentIso = d.toISOString();
  }
}

export const DEFAULT_CLOCK = new StaticClock("2026-09-13T12:00:00.000Z");
