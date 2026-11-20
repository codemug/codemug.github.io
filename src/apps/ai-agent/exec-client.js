// AI-4 exec-bridge client: the run_code tool talks to the terminal app's exec service over a
// same-origin BroadcastChannel. Owns the pending map (delete-once settle: first settle wins, so
// a late wall timer cannot double-resolve a settled run), the per-run wall timer, the 20 KB output
// cap and the grace on not-running/busy: a closed or busy terminal page has graceMs to acknowledge
// with exec-pending before the run is reported as failed.
export const MAX_EXEC_OUTPUT_CHARS = 20_000;

/**
 * @param {{ postMessage: (msg: object) => void, addEventListener: (type: string, cb: (e: { data: object }) => void) => void }} channel
 * @param {{ graceMs?: number, wallExtraMs?: number }} opts graceMs: the not-running/busy grace
 *   (default 1500). wallExtraMs: added to the run's timeoutMs for the wall timer (default 60000:
 *   time for the user to approve before the run limit counts).
 */
export function createExecClient(channel, { graceMs = 1500, wallExtraMs = 60_000 } = {}) {
  // id -> { settle, grace, wall, gotPending }
  const pending = new Map();
  let seq = 0;
  const settle = (id, reply) => {
    const entry = pending.get(id);
    if (!entry || !pending.delete(id)) return false; // delete-once: first settle wins
    clearTimeout(entry.grace); clearTimeout(entry.wall);
    entry.settle(reply);
    return true;
  };
  const handle = (reply) => {
    if (!reply?.id || !pending.has(reply.id)) return; // already settled (late reply)
    const entry = pending.get(reply.id);
    if (reply.type === 'exec-pending') {
      // The terminal page is alive: cancel the grace (if any) and wait for the real reply.
      entry.gotPending = true; clearTimeout(entry.grace); entry.grace = null;
      return;
    }
    if (reply.type === 'exec-result') {
      const output = String(reply.output ?? '');
      const truncated = output.length > MAX_EXEC_OUTPUT_CHARS;
      settle(reply.id, { type: 'exec-result', exitCode: reply.exitCode, output: truncated ? output.slice(0, MAX_EXEC_OUTPUT_CHARS) : output, truncated });
      return;
    }
    if (reply.type === 'exec-started') { entry.started = true; return; } // the user clicked Run
    if (reply.type === 'exec-error' && !entry.started && (reply.reason === 'not-running' || reply.reason === 'busy')) {
      // Another Terminal tab may be the one prompting: after an exec-pending ack, its
      // not-running/busy replies are ignored; before one, they settle after the grace.
      if (entry.gotPending || entry.grace) return;
      entry.grace = setTimeout(() => settle(reply.id, reply), graceMs);
      return;
    }
    settle(reply.id, reply); // other errors (denied, timeout, guest crash) settle immediately
  };
  channel.addEventListener('message', (event) => handle(event.data));
  /** @returns {Promise<{type: string, id?: string, reason?: string, exitCode?: number, output?: string, truncated?: boolean}>} */
  const run = (lang, code, timeoutMs) => {
    const id = `agent-${Date.now()}-${seq++}`;
    return new Promise((resolve) => {
      const entry = { settle: resolve, grace: null, wall: null, gotPending: false, started: false };
      pending.set(id, entry);
      entry.wall = setTimeout(() => {
        channel.postMessage({ type: 'exec-cancel', id, from: 'AI Agent' });
        settle(id, { type: 'exec-error', id, reason: 'no-terminal' });
      }, timeoutMs + wallExtraMs);
      channel.postMessage({ type: 'exec-request', id, from: 'AI Agent', lang, code, timeoutMs });
    });
  };
  /** Stop, New chat and a model change: tell the terminal app to cancel and settle every open run. */
  const cancelAll = () => {
    for (const id of [...pending.keys()]) {
      channel.postMessage({ type: 'exec-cancel', id, from: 'AI Agent' });
      settle(id, { type: 'exec-error', id, reason: 'cancelled' });
    }
  };
  return { run, cancelAll };
}
