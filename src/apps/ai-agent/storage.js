// Lazy default adapter keeps storage rules independently testable without a browser.
import { stripImages } from './agent.js';
const get = (...args) => import('./vendor/idb-keyval.js').then(module => module.get(...args));
const setMany = (...args) => import('./vendor/idb-keyval.js').then(module => module.setMany(...args));
export const STORE_KEY = 'pc:ai-agent:conversation:v1';
export const BACKUP_KEY = 'pc:ai-agent:previous:v1';
export const LEGACY_KEY = 'voice-agent:conversation';
export const MODEL_KEY = 'pc:ai-agent:model:v1';
export const LEGACY_MODEL_KEY = 'voice-agent:model';

export function validateConversation(value) {
  if (!value || !Array.isArray(value.history) || value.history.length > 2000 || (value.summary != null && typeof value.summary !== 'string')) throw new Error('This is not a valid AI Agent conversation.');
  for (const message of value.history) {
    if (!message || !['user', 'assistant', 'tool'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 100000) throw new Error('The conversation contains an invalid message.');
    if (message.at != null && (typeof message.at !== 'number' || !Number.isFinite(message.at))) throw new Error('Invalid message time.');
    if (message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.some(call => !call?.function || typeof call.id !== 'string' || typeof call.function.name !== 'string' || !call.function.arguments || typeof call.function.arguments !== 'object'))) throw new Error('Invalid tool-call record.');
  }
  if ((value.summary?.length ?? 0) > 20000) throw new Error('The conversation summary is too large.');
  // Image payloads (pixels) are stripped here, the save boundary: stored and imported records keep only the marker text in content.
  return structuredClone({ version: 1, history: stripImages(value.history), summary: value.summary ?? '', savedAt: value.savedAt ?? Date.now() });
}

export class ConversationStore {
  constructor(io = { get, setMany }) { this.io = io; this.queue = Promise.resolve(); this.blocked = false; this.pending = 0; }
  async restore() {
    try {
      const current = await this.io.get(STORE_KEY);
      if (current !== undefined) return { value: validateConversation(current), migrated: false };
      const legacy = await this.io.get(LEGACY_KEY);
      if (legacy === undefined) return { value: { history: [], summary: '' }, migrated: false };
      const value = validateConversation(legacy);
      // Copy, never move/delete: the old app's data stays untouched, including on write failure.
      await this.io.setMany([[STORE_KEY, value]]);
      return { value, migrated: true };
    } catch (error) {
      // Read failures are not evidence of an empty database. Prevent a later write
      // from replacing an unreadable chat until the user explicitly backs it up.
      this.blocked = true; throw error;
    }
  }
  save(value, { replace = false } = {}) {
    const snapshot = validateConversation({ ...value, savedAt: Date.now() });
    this.pending++;
    const operation = this.queue.catch(() => {}).then(async () => {
      if (this.blocked && !replace) throw new Error('Stored data needs recovery. Export stored data or start a new chat before saving.');
      const writes = [[STORE_KEY, snapshot]];
      if (replace) {
        const previous = await this.io.get(STORE_KEY) ?? await this.io.get(LEGACY_KEY);
        if (previous !== undefined) writes.unshift([BACKUP_KEY, previous]);
      }
      // Backup and replacement share one atomic transaction. A quota failure preserves both old records.
      await this.io.setMany(writes); this.blocked = false;
    }).finally(() => { this.pending--; });
    this.queue = operation; return operation;
  }
  async raw() { await this.queue.catch(() => {}); return { current: await this.io.get(STORE_KEY), previous: await this.io.get(BACKUP_KEY), legacy: await this.io.get(LEGACY_KEY) }; }
}
