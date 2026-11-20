// Chrome's built-in, on-device AI: the Prompt API (LanguageModel) and the Translator, Summarizer and
// Language Detector APIs. Everything runs on the device; the only network traffic is Chrome downloading
// its own models (docs: developer.chrome.com/docs/ai/built-in-apis — Translator/LanguageDetector/Summarizer
// stable on the web from Chrome 138, Prompt API from Chrome 148; Writer/Rewriter are developer-trial only and skipped).
import { estimateTokens } from './cloud.js';

/** Documented availability of each built-in API. `scope` is the global scope (self on the page, a mock in tests). */
export async function chromeAvailability(scope) {
  const read = async (Ctor) => { try { return (await Ctor?.availability?.()) ?? 'unavailable'; } catch { return 'unavailable'; } };
  return {
    languageModel: await read(scope.LanguageModel),
    translator: await read(scope.Translator),
    summarizer: await read(scope.Summarizer),
    detector: await read(scope.LanguageDetector),
  };
}

/** The three tool APIs, with the create() options that start Chrome's own model download. */
export const CHROME_TOOL_APIS = {
  translate: { ctor: 'Translator', label: 'Translator', availabilityKey: 'translator' },
  summarize: { ctor: 'Summarizer', label: 'Summarizer', availabilityKey: 'summarizer' },
  detectLanguage: { ctor: 'LanguageDetector', label: 'Language detector', availabilityKey: 'detector' },
};

/** A tool is offered only when its API reports 'available': a model-initiated create() has no user
 *  gesture to start Chrome's own download, which the Settings "Download … model" buttons provide. */
export function chromeToolGates(availability) {
  return { translate: availability.translator === 'available', summarize: availability.summarizer === 'available', detectLanguage: availability.detector === 'available' };
}

/** Called from a user gesture (a Settings "Download … model" button): starts the API's own model download. */
export async function chromeDownload(scope, toolKey, status) {
  const { ctor, label } = CHROME_TOOL_APIS[toolKey];
  const Ctor = scope[ctor];
  if (!Ctor?.create) throw new Error(`${label} is not supported in this browser.`);
  status(`Starting Chrome ${label} model download…`);
  const monitor = (m) => m?.addEventListener?.('downloadprogress', (e) => status(`Downloading Chrome ${label} model… ${Math.round((e.loaded ?? 0) * 100)}%`));
  if (toolKey === 'translate') await Ctor.create({ sourceLanguage: 'en', targetLanguage: 'fr', monitor });
  else if (toolKey === 'summarize') await Ctor.create({ type: 'key-points', monitor });
  else await Ctor.create({ monitor });
}

/** Clear tool_result error when a tool call fails although its API reported available (e.g. a download race). */
export function chromeToolError(toolKey, err) {
  const { label } = CHROME_TOOL_APIS[toolKey] ?? { label: String(toolKey) };
  return { error: `The Chrome ${label} call failed (${err?.message ?? err}). If the model is not downloaded yet, suggest the user open Settings → Chrome built-in AI and press "Download ${label} model", then try again.` };
}

/**
 * On-device tool executors (one per API; the app passes only the ones whose API reports 'available').
 * A create() that still fails (for example a download race) returns a clear error tool_result
 * instead of throwing, so the model can suggest the Settings download button.
 */
export function chromeExecutors(scope, status) {
  const translators = new Map(); const summarizers = new Map(); let detector = null;
  const monitor = (label) => (m) => m?.addEventListener?.('downloadprogress', (e) => status(`Downloading Chrome ${label} model… ${Math.round((e.loaded ?? 0) * 100)}%`));
  const translate = async (text, target, source) => {
    try {
      const key = `${source}|${target}`;
      let translator = translators.get(key);
      if (!translator) {
        status(`Downloading Chrome translate model (${source} → ${target})…`);
        translator = await scope.Translator.create({ sourceLanguage: source, targetLanguage: target, monitor: monitor('translate') });
        translators.set(key, translator);
      }
      return { result: await translator.translate(text) };
    } catch (err) { return chromeToolError('translate', err); }
  };
  const summarize = async (text, type) => {
    try {
      let summarizer = summarizers.get(type);
      if (!summarizer) {
        status('Downloading Chrome summarizer model…');
        summarizer = await scope.Summarizer.create({ type, monitor: monitor('summarizer') });
        summarizers.set(type, summarizer);
      }
      return { result: await summarizer.summarize(text) };
    } catch (err) { return chromeToolError('summarize', err); }
  };
  const detectLanguage = async (text) => {
    try {
      if (!detector) { status('Downloading Chrome language detector model…'); detector = await scope.LanguageDetector.create({ monitor: monitor('detector') }); }
      const [top] = await detector.detect(text);
      return top ? { language: top.detectedLanguage, confidence: Number(top.confidence.toFixed(3)) } : { error: 'No language detected' };
    } catch (err) { return chromeToolError('detectLanguage', err); }
  };
  return { translate, summarize, detectLanguage };
}

/**
 * Chat backend on the Prompt API. One fresh session per turn (initialPrompts = the full history) so the
 * agent's own compaction and stored chat stay the source of truth; streaming text only — the Prompt API
 * has no tool calling, so tool schemas are never sent (supportsTools = false).
 */
export class ChromeModelClient {
  constructor(scope = globalThis) { this.scope = scope; this.ready = false; this.supportsTools = false; this.active = null; }
  stop() { this.active?.abort(); this.active = null; }
  count(messages) { return Promise.resolve(estimateTokens(messages)); }
  /** Called from a user gesture (the Load model button): starts Chrome's own model download. */
  async load(status) {
    const controller = new AbortController(); this.active = controller;
    try {
      await this.scope.LanguageModel.create({ signal: controller.signal, monitor: (m) => m?.addEventListener?.('downloadprogress', (e) => status(`Downloading Chrome model… ${Math.round((e.loaded ?? 0) * 100)}%`)) });
      this.ready = true;
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      throw new Error(`Chrome could not load its on-device model: ${err?.message ?? err}`);
    } finally { this.active = null; }
  }
  async generate(messages, schemas, onToken = () => {}) {
    if (!this.ready || !this.scope.LanguageModel) throw new Error('Load the Chrome model first.');
    const toText = (content) => (typeof content === 'string' ? content : content.filter((p) => p.type === 'text').map((p) => p.text).join(' '));
    const controller = new AbortController(); this.active = controller;
    try {
      // tool messages belong to other backends; the on-device session takes system/user/assistant text only.
      const history = messages.slice(0, -1).filter((m) => m.role !== 'tool').map((m) => ({ role: m.role, content: toText(m.content) }));
      const text = toText(messages.at(-1).content);
      let onDeviceSession = null;
      try {
        onDeviceSession = await this.scope.LanguageModel.create({ initialPrompts: history, signal: controller.signal });
        let out = '';
        for await (const chunk of onDeviceSession.promptStreaming(text, { signal: controller.signal })) { out += chunk; onToken(chunk); }
        return out;
      } finally {
        // The on-device session is one-shot: destroy it (success, error and abort alike), or every
        // round leaks a LanguageModel session.
        onDeviceSession?.destroy?.();
      }
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      if (err?.name === 'QuotaExceededError') throw new Error('The conversation is too long for the on-device model. Start a new chat or shorten the request.');
      throw new Error(`Chrome on-device model error: ${err?.message ?? err}`);
    } finally { this.active = null; }
  }
}
