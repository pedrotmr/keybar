import { SerialTaskQueue } from '@/utils/serialTaskQueue';

export interface TabPreviewRecord {
  url: string;
  dataUrl: string;
  capturedAt: number;
}

interface TabPreviewCachePort {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
}

/** Serializes preview-cache read/modify/write operations across all browser windows. */
export class TabPreviewCache {
  private readonly operations = new SerialTaskQueue();
  private generation = 0;

  constructor(
    private readonly port: TabPreviewCachePort,
    private readonly idsKey: string,
    private readonly recordPrefix: string,
    private readonly maxRecords: number,
  ) {}

  captureGeneration(): number {
    return this.generation;
  }

  save(tabId: number, record: TabPreviewRecord, generation: number): Promise<boolean> {
    return this.operations.enqueue(async () => {
      if (generation !== this.generation) {
        return false;
      }

      const stored = await this.port.get(this.idsKey);

      if (generation !== this.generation) {
        return false;
      }

      const previousIds = this.readIds(stored[this.idsKey]);
      const nextIds = [tabId, ...previousIds.filter((id) => id !== tabId)].slice(0, this.maxRecords);
      const evictedIds = previousIds.filter((id) => !nextIds.includes(id));

      await this.port.set({
        [this.idsKey]: nextIds,
        [`${this.recordPrefix}${tabId}`]: record,
      });

      if (evictedIds.length > 0) {
        await this.port.remove(evictedIds.map((id) => `${this.recordPrefix}${id}`));
      }

      return true;
    });
  }

  remove(tabId: number): Promise<void> {
    this.generation++;
    return this.operations.enqueue(async () => {
      const stored = await this.port.get(this.idsKey);
      const ids = this.readIds(stored[this.idsKey]);

      await this.port.set({ [this.idsKey]: ids.filter((id) => id !== tabId) });

      // Remove the record even if the index was already inconsistent.
      await this.port.remove(`${this.recordPrefix}${tabId}`);
    });
  }

  private readIds(value: unknown): number[] {
    return Array.isArray(value)
      ? value.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id >= 0)
      : [];
  }
}
