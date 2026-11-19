// run_javascript sandbox. Model-written code runs in a blob Worker inside a sandboxed srcdoc iframe:
// - sandbox="allow-scripts" only, so the iframe has an opaque origin: no cookies, storage or parent DOM;
// - the CSP blocks every network path (fetch, XHR, WebSocket, importScripts, import()) and blob workers inherit it;
// - the worker has no RTCPeerConnection or navigation, the two leaks left on the iframe's main thread,
//   which only runs the fixed bootstrap below and never evaluates anything it receives;
// - Chrome runs sandboxed iframes in their own process, so a busy loop never freezes this page,
//   and removing the iframe kills the worker. Verified in headless Chrome (see the report).
// There is no per-run memory cap (a memory bomb crashes only the sandbox and shows up as a timeout);
// QuickJS-in-WASM gives hard caps if that ever matters.
const TIMEOUT_MS = 5000;
const MAX_LOG_LINES = 50;
const MAX_CHARS = 2000;
const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:";

// Runs in the worker. Indirect eval returns the last expression's value like a REPL ("[3,1].sort()");
// code using top-level return or await is a SyntaxError there (raised before anything runs),
// so it runs again as an async function body instead.
const WORKER_SRC = `
const logs = [];
const fmt = (v) => { try { return typeof v === "string" ? v : JSON.stringify(v) ?? String(v); } catch { return String(v); } };
for (const k of ["log", "info", "warn", "error", "debug"]) {
  console[k] = (...a) => { if (logs.length < ${MAX_LOG_LINES}) logs.push(a.map(fmt).join(" ").slice(0, 500)); };
}
onmessage = async (e) => {
  try {
    let value;
    try {
      value = (0, eval)(e.data);
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      value = await new (async () => {}).constructor(e.data)();
    }
    value = await value;
    postMessage({ ok: true, result: value === undefined ? undefined : fmt(value), logs });
  } catch (err) {
    postMessage({ ok: false, error: String(err && err.message || err), logs });
  }
};`;

// Runs on the iframe's main thread: trusted, fixed code that only starts the worker and relays its answer.
const BOOT = `
for (const k of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"]) delete window[k];
onmessage = (e) => {
  if (e.source !== parent || typeof e.data !== "string") return;
  try {
    const url = URL.createObjectURL(new Blob([${JSON.stringify(WORKER_SRC)}], { type: "text/javascript" }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = (m) => parent.postMessage(m.data, "*");
    w.onerror = (ev) => { ev.preventDefault(); parent.postMessage({ ok: false, error: ev.message }, "*"); };
    w.postMessage(e.data);
  } catch (err) {
    parent.postMessage({ ok: false, error: "sandbox: " + err }, "*");
  }
};
parent.postMessage("ready", "*");`;

const SRCDOC = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}"><script>${BOOT.replace(/<\//g, "<\\/")}</script>`;
const clip = (s) => (typeof s === "string" && s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)} …[truncated]` : s);

/** Run untrusted JS; resolves (never rejects) with { result?, logs, error? }. A fresh sandbox per call. */
export function runJavaScript(code, { signal } = {}) {
  if (signal?.aborted) return Promise.resolve({ error: "Cancelled", logs: [] });
  return new Promise((resolve) => {
    let finished = false;
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.hidden = true;
    frame.srcdoc = SRCDOC;
    const finish = (out) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
      removeEventListener("message", onMessage);
      frame.remove(); // also terminates the worker
      resolve(out);
    };
    // The iframe's origin is "null", so messages are authenticated by their source window instead.
    const onMessage = (e) => {
      if (e.source !== frame.contentWindow) return;
      if (e.data === "ready") return frame.contentWindow.postMessage(code, "*");
      const { ok, result, error, logs } = e.data ?? {};
      const out = { logs: Array.isArray(logs) ? logs.map(clip) : [] };
      if (ok) out.result = clip(result);
      else out.error = clip(String(error ?? "Unknown error"));
      finish(out);
    };
    const abort = () => finish({ error: "Cancelled", logs: [] });
    const timer = setTimeout(() => finish({ error: `Stopped after ${TIMEOUT_MS / 1000} seconds (endless loop or too slow)`, logs: [] }), TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    addEventListener("message", onMessage);
    document.body.append(frame);
  });
}
