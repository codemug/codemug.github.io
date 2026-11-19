// A new worker per load. Termination cancels download, prefill and decoding alike,
// rejects every waiter, and prevents old worker events from reaching a new chat.
export class ModelClient {
  constructor({ createWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }), progress = () => {}, failure = () => {} } = {}) {
    this.createWorker = createWorker; this.progress = progress; this.failure = failure; this.pending = new Map(); this.nextId = 0; this.ready = false; this.vision = false;
  }
  stop() {
    this.worker?.terminate(); this.worker = null; this.ready = false; this.vision = false;
    const error = new DOMException('Stopped', 'AbortError');
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
  async load(key, { vision = false } = {}) {
    this.stop();
    const worker = this.createWorker(); this.worker = worker;
    worker.onmessage = ({ data }) => {
      if (this.worker !== worker) return;
      if (data.type === 'progress') return this.progress(data);
      const id = data.type === 'ready' || (data.type === 'error' && data.id == null) ? 'load' : data.id;
      const request = this.pending.get(id);
      if (!request) return;
      if (data.type === 'token') return request.token?.(data.text);
      this.pending.delete(id);
      if (data.type === 'error') request.reject(new Error(data.message));
      else { if (data.type === 'ready') { this.ready = true; this.vision = Boolean(data.vision); } request.resolve(data); }
    };
    worker.onerror = event => {
      if (this.worker !== worker) return;
      event.preventDefault?.();
      const error = new Error(event.message || 'The model worker failed. Load the model to retry.');
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear(); this.stop(); this.failure(error);
    };
    const promise = new Promise((resolve, reject) => this.pending.set('load', { resolve, reject }));
    worker.postMessage({ type: 'load', key, vision });
    try { await promise; } catch (error) { if (this.worker === worker) this.stop(); throw error; }
  }
  request(type, payload, token) {
    if (!this.ready || !this.worker) return Promise.reject(new Error('Load a model first.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, token });
      this.worker.postMessage({ type, id, ...payload });
    });
  }
  async generate(messages, tools, token) { return (await this.request('generate', { messages, tools }, token)).text; }
  async count(messages, tools) { return (await this.request('count', { messages, tools })).tokens; }
}
