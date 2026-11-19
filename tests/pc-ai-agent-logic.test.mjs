// Run: node agent.test.mjs   (pure logic checks; the browser parts are verified in Chrome)
import assert from "node:assert/strict";
import { createTools, parseToolCalls, runToolCall, visibleText, toolSchemas,
  checkUrl, hostsIn, cleanUntrusted, clearOldToolResults, splitForCompaction, transcriptText, chunkText, stampUserMessages, dropStampEcho } from "../src/apps/ai-agent/agent.js";

const hostCalls = [];
const tools = createTools({
  webSearch: async (q) => (hostCalls.push(["search", q]), { results: [] }),
  httpGet: async (u) => (hostCalls.push(["get", u]), { content: "page" }),
  runJavaScript: async (c) => (hostCalls.push(["js", c]), { result: 6 }),
  allowedHosts: () => new Set(["bbc.com", "en.wikipedia.org"]),
});
const run = (name, args) => runToolCall(tools, { name, arguments: args });

// Tool-call parsing: the exact shape Qwen3.5 / LFM3 emit, two calls, typed values.
const reply = `Sure, checking.\n<tool_call>\n<function=calculate>\n<parameter=expression>\n300\n</parameter>\n<parameter=note>\ntea\n</parameter>\n</function>\n</tool_call>\n<tool_call>\n<function=web_search>\n</function>\n</tool_call>`;
assert.deepEqual(parseToolCalls(reply), [
  { name: "calculate", arguments: { expression: 300, note: "tea" } },
  { name: "web_search", arguments: {} },
]);
assert.deepEqual(parseToolCalls("Just a normal answer."), []);

// Tools.
assert.deepEqual((await run("calculate", { expression: "(12.5*4)/3" })), { result: 16.6666666667 });
assert.deepEqual((await run("calculate", { expression: "2^10 + 1,000" })), { result: 2024 });
assert.ok((await run("calculate", { expression: "alert(1)" })).error);
assert.ok((await run("calculate", { expression: "1/0" })).error);
assert.ok((await run("nope", {})).error);
assert.equal(toolSchemas(tools).length, 4);

// Visible text: internal markup is hidden; useful Markdown and code are retained.
assert.equal(visibleText(reply), "Sure, checking.\n");
assert.equal(visibleText("<think>hmm</think>It is **3pm**."), "It is **3pm**.");
assert.equal(visibleText("Partial <tool_ca"), "Partial ");
assert.deepEqual(await runToolCall({ calculate: {} }, { name: "web_get", arguments: {} }), { error: "Unknown tool web_get. Available tools: calculate" });
assert.equal(visibleText("Partial <"), "Partial ");
assert.equal(visibleText("It is 2.</thinkIt is 2."), "It is 2.");
assert.equal(visibleText("It is 2. </th"), "It is 2. ");
assert.equal(visibleText("if (n < 2) return false; i<n"), "if (n < 2) return false; i<n"); // code in plain text survives
assert.equal(visibleText("Ok. <|tool_call_start|>[x()]"), "Ok. ");

// Host-backed tools validate before calling out; rejections become {error}.
assert.deepEqual(await run("web_search", { query: " eiffel tower " }), { results: [] });
assert.ok((await run("web_search", { query: "" })).error);
assert.deepEqual(await run("http_get", { url: "https://www.bbc.com/news" }), { content: "page" });
assert.ok((await run("http_get", { url: "https://evil.example/?q=secret" })).error);
assert.deepEqual(await run("run_javascript", { code: "return 1+2+3" }), { result: 6 });
assert.ok((await run("run_javascript", { code: " " })).error);
assert.deepEqual(hostCalls, [["search", "eiffel tower"], ["get", "https://www.bbc.com/news"], ["js", "return 1+2+3"]]);
const boom = createTools({ ...tools, allowedHosts: () => new Set(["x.com"]), httpGet: async () => { throw new Error("offline"); } });
assert.deepEqual(await runToolCall(boom, { name: "http_get", arguments: { url: "https://x.com" } }), { error: "offline" });

// URL allowlist: subdomains of an allowed host pass, lookalikes and other schemes do not.
const allow = new Set(["bbc.com"]);
assert.ok(checkUrl("https://news.bbc.com/a", allow).url);
assert.ok(checkUrl("https://notbbc.com", allow).error);
assert.ok(checkUrl("https://bbc.com.evil.io", allow).error);
assert.ok(checkUrl("file:///etc/passwd", new Set(["etc"])).error);
assert.ok(checkUrl("not a url", allow).error);
assert.equal(checkUrl("bbc.com/news", allow).url, "https://bbc.com/news");
assert.deepEqual([...hostsIn("read www.BBC.com and news dot ycombinator dot com, version 3.5")], ["bbc.com", "news.ycombinator.com"]);

// Untrusted text: hidden characters, links and images stripped, length bounded.
assert.equal(cleanUntrusted("Hi\u200B there [docs](https://x.y) ![i](a.png)\n\n\n\nend", 100), "Hi there docs\n\nend");
assert.equal(cleanUntrusted("abcdef", 3), "abc …[truncated]");

// Compaction keeps the last turns verbatim and tool calls paired with their results.
const h = [
  { role: "user", content: "a" }, { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "calculate", arguments: { expression: "1+1" } } }] },
  { role: "tool", tool_call_id: "c1", content: "{\"result\":2}" }, { role: "assistant", content: "two" },
  { role: "user", content: "c" }, { role: "assistant", content: "d" },
];
assert.deepEqual(splitForCompaction(h, 1), { older: h.slice(0, 4), recent: h.slice(4) });
assert.deepEqual(splitForCompaction(h, 5), { older: [], recent: h });
const cleared = clearOldToolResults(h, 1);
assert.equal(cleared[2].content, "[old tool result removed]");
assert.equal(h[2].content, "{\"result\":2}"); // input not mutated
assert.deepEqual(clearOldToolResults(h, 2), h);
assert.equal(transcriptText(h.slice(0, 4)), 'User: a\nAssistant called calculate({"expression":"1+1"})\nTool result: {"result":2}\nAssistant: two');

assert.deepEqual(chunkText("aa\nbb\ncc", 5), ["aa\nbb", "cc"]);
assert.deepEqual(chunkText("abcdefgh", 3), ["abc", "def", "gh"]);
assert.ok(chunkText("x\n".repeat(5000), 800).every((c) => c.length <= 800));

// Time stamps: user messages only, from their own send time, input untouched.
const timed = [{ role: "user", content: "hi", at: 0 }, { role: "assistant", content: "hello" }, { role: "user", content: "old" }];
assert.deepEqual(stampUserMessages(timed, () => "Mon 9:00"), [
  { role: "user", content: "[Mon 9:00] hi" }, { role: "assistant", content: "hello" }, { role: "user", content: "old" },
]);
assert.equal(timed[0].content, "hi");

// Stamp echo: removed only when the reply starts with the exact stamp; held back while it might.
const T = "Tuesday, November 17, 2026 at 11:31 PM, Asia/Dubai";
assert.equal(dropStampEcho(`${T}\n\nI'll read it.`, T), "I'll read it.");
assert.equal(dropStampEcho(`[${T}] Sure.`, T), "Sure.");
assert.equal(dropStampEcho("Tuesday, Nov", T), "");
assert.equal(dropStampEcho("The capital is Paris.", T), "The capital is Paris.");
assert.equal(dropStampEcho("It is Tuesday.", T), "It is Tuesday.");

console.log("agent.js: all checks passed");
