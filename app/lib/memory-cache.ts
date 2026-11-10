/** Byte- and entry-bounded LRU. No TTL: freshness comes from durable version identities. */
export class MemoryCache<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;
  constructor(private maxBytes = 32 * 1024 * 1024, private maxEntries = 32) {}
  get(key: string): T | undefined {
    const item = this.entries.get(key);
    if (!item) return undefined;
    this.entries.delete(key); this.entries.set(key, item);
    return item.value;
  }
  set(key: string, value: T, bytes = JSON.stringify(value).length * 2) {
    this.delete(key);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes }); this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) this.delete(this.entries.keys().next().value!);
  }
  delete(key: string) { const item = this.entries.get(key); if (item) this.bytes -= item.bytes; this.entries.delete(key); }
  clear() { this.entries.clear(); this.bytes = 0; }
  values() { return [...this.entries.values()].map(item => item.value); }
}
