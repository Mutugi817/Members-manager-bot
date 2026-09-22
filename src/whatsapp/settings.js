import { nowIso } from '../core/utils.js';

export class SettingsService {
  constructor({ store, config }) { this.store = store; this.config = config; }
  async init() {
    const data = this.store.get();
    const defaults = { keyword: this.config.botKeyword, churchName: this.config.churchName, eventName: this.config.eventName, eventLocation: this.config.eventLocation, transportNotice: this.config.transportNotice, botFooter: this.config.botFooter, menuTitle: this.config.menuTitle, menuIntro: this.config.menuIntro };
    const merged = { ...defaults, ...(data.settings || {}) };
    await this.store.replace({ version: 1, updatedAt: nowIso(), settings: merged });
    return merged;
  }
  peek() { return { ...this.config, ...(this.store.get().settings || {}) }; }
  async update(patch) {
    const allowed = ['keyword','churchName','eventName','eventLocation','transportNotice','botFooter','menuTitle','menuIntro'];
    return this.store.mutate(db => {
      for (const key of allowed) if (patch[key] !== undefined) db.settings[key] = String(patch[key]).trim();
      db.updatedAt = nowIso();
      return db.settings;
    });
  }
}
