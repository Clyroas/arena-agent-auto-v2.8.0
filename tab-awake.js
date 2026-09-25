// Memory-only best-effort lease. Serialize changes per tab, including acquire/release races.
export class TabAwakeLease {
  constructor(api = chrome) { this.api = api; this.entries = new Map(); }
  acquire(tabId) { return this.change(tabId, true); }
  release(tabId) { return this.change(tabId, false); }
  change(tabId, keep) {
    let entry = this.entries.get(tabId);
    if (!entry && !keep) return Promise.resolve();
    if (!entry) { entry = { work: Promise.resolve() }; this.entries.set(tabId, entry); }
    const work = entry.work.then(async () => {
      try {
        if (entry.original === undefined) {
          const tab = await this.api.tabs.get(tabId);
          if (typeof tab.autoDiscardable !== 'boolean') return;
          entry.original = tab.autoDiscardable;
        }
        await this.api.tabs.update(tabId, { autoDiscardable: keep ? false : entry.original });
      } catch { /* tab closed / extension context invalidated */ }
    });
    entry.work = work;
    return work.finally(() => { if (!keep && entry.work === work) this.entries.delete(tabId); });
  }
}
