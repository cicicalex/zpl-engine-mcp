/**
 * When the engine refuses a job in a batch, the customer must learn why.
 *
 * AUDIT 2026-08-02. zpl_batch rendered a failure as
 * `${(err).message.slice(0, 30)}`, and no refusal the engine sends is that
 * short. Reproduced through the shipped handler against a real engine, with a
 * free-plan account seeded at 4998 of 5000 tokens:
 *
 *   | 2 | a doua  | 16 | ... | ERROR | Engine error 403: Dimension 16 | 0 |
 *   | 3 | a treia |  9 | ... | ERROR | You've hit your monthly ZPL En | 0 |
 *
 *   isError: false
 *
 * Both cut exactly where the useful part starts: the plan limit that was
 * exceeded, and the figure the customer is measured against. And the whole
 * call came back as a success while two of three jobs had been refused - one
 * of them because the customer had run out of quota. The caller here is
 * usually another agent, which has nothing to read but that flag.
 *
 * These are behavioural checks. The handler is the one the server registers,
 * captured from a stub server; only the engine underneath is a stand-in, and
 * it throws the messages the real engine was measured sending. Nothing here
 * reads the source, so no comment in it can answer for the code.
 */

import test from "node:test";
import assert from "node:assert/strict";

const { registerMetaTools } = await import("../dist/tools/meta.js");

/** The engine's own words, copied from a real 403 and a real quota refusal. */
const DIMENSION_REFUSAL = "Engine error 403: Dimension 16 exceeds plan limit of 9";
const QUOTA_REFUSAL =
  "You've hit your monthly ZPL Engine quota (5000 / 5000 tokens used this month). " +
  "Upgrade options: - Basic $10/mo 10,000 tokens - Pro $29/mo 50,000 tokens";

/**
 * The handler the server actually registers, with an engine we control.
 *
 * `outcomes` is one entry per job, in order: an Error to throw, or a result to
 * return. Registration is what the real server does, so a rename or a signature
 * change here fails loudly rather than silently testing nothing.
 */
function batchHandler(outcomes) {
  const handlers = new Map();
  const server = {
    tool: (name, _d, _s, fn) => handlers.set(name, fn),
    registerTool: (name, _c, fn) => handlers.set(name, fn),
  };
  let call = 0;
  const client = {
    async compute() {
      const outcome = outcomes[call++];
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  registerMetaTools(server, () => client);
  const fn = handlers.get("zpl_batch");
  assert.ok(fn, "zpl_batch is no longer registered under that name");
  return fn;
}

const ok = (tokens = 2) => ({
  ain: 0.98,
  ain_status: "CERTIFIED_NEUTRAL",
  tokens_used: tokens,
  p_output: 0.5,
});

const jobs = (n) =>
  Array.from({ length: n }, (_, i) => ({ label: `job${i + 1}`, d: 9, bias: 0.5, samples: 100 }));

const render = (out) => out.content.map((c) => c.text).join("\n");

test("a refusal reaches the customer whole", async () => {
  const handler = batchHandler([ok(), new Error(DIMENSION_REFUSAL)]);
  const out = await handler({ jobs: jobs(2) });
  const text = render(out);

  assert.ok(
    text.includes("exceeds plan limit of 9"),
    "the tail of the refusal is gone, so the customer is told a dimension was " +
      "rejected and not what their plan actually allows:\n" + text,
  );
});

test("a quota refusal keeps the figures", async () => {
  const handler = batchHandler([new Error(QUOTA_REFUSAL)]);
  const text = render(await handler({ jobs: jobs(1) }));

  assert.ok(
    /5000\s*\/\s*5000/.test(text),
    "the customer is told they hit a ceiling without being told which one, or " +
      "how far past it they are:\n" + text,
  );
});

test("the message is not shortened to some fixed prefix", async () => {
  // The exact defect: any cap short enough to cut a real refusal. Both real
  // messages measured above are past 40 characters before they say anything
  // useful, so a rendering that keeps fewer than that keeps nothing.
  const marker = "END-OF-MESSAGE-MARKER";
  const long = `Engine error 403: ${"the engine explains itself at length. ".repeat(3)}${marker}`;
  const text = render(await batchHandler([new Error(long)])({ jobs: jobs(1) }));

  assert.ok(
    text.includes(marker),
    `a ${long.length}-character refusal was cut before its end. Whatever the ` +
      `engine puts last - the limit, the figure, the upgrade - is what the ` +
      `customer needs:\n` + text,
  );
});

test("the table still holds together when a message contains a pipe", async () => {
  // The reason a cell needs any treatment at all. A raw pipe splits the row and
  // the customer gets a mangled table instead of an explanation.
  const text = render(
    await batchHandler([new Error("refused | for | several reasons")])({ jobs: jobs(1) }),
  );
  const row = text.split("\n").find((l) => l.includes("several reasons"));
  assert.ok(row, "the message vanished from the table entirely:\n" + text);
  assert.equal(
    row.split("|").length - 1,
    8,
    `the row has ${row.split("|").length - 1} pipes instead of 8, so the pipes in ` +
      `the message became column breaks:\n${row}`,
  );
});

test("newlines in a message do not break the row", async () => {
  const text = render(
    await batchHandler([new Error("refused\nfor a reason\r\non another line")])({ jobs: jobs(1) }),
  );
  const row = text.split("\n").find((l) => l.includes("refused"));
  assert.ok(
    row && row.includes("on another line"),
    "a multi-line message spilled out of its row, so the rest of it is not in " +
      "the table at all:\n" + text,
  );
});

test("the summary counts the jobs that failed", async () => {
  const handler = batchHandler([ok(), new Error(DIMENSION_REFUSAL), new Error(QUOTA_REFUSAL)]);
  const text = render(await handler({ jobs: jobs(3) }));

  assert.match(
    text,
    /\b2 of 3\b/,
    "the summary reports only what was spent. Two of three jobs were refused " +
      "and the result never says so outside the table:\n" + text,
  );
});

test("a batch where everything worked says nothing about failures", async () => {
  const text = render(await batchHandler([ok(), ok()])({ jobs: jobs(2) }));
  assert.ok(
    !/failed/i.test(text),
    "a clean batch is being told it failed:\n" + text,
  );
});

test("a batch where every job was refused is an error", async () => {
  const out = await batchHandler([new Error(QUOTA_REFUSAL), new Error(QUOTA_REFUSAL)])({
    jobs: jobs(2),
  });
  assert.equal(
    out.isError,
    true,
    "nothing was computed and the call still came back as a success, so a " +
      "caller that branches on isError proceeds as if it had results",
  );
});

test("a partly successful batch is not thrown away", async () => {
  // The other direction. Flagging the whole call would discard the row that
  // worked, and the customer paid for it.
  const out = await batchHandler([ok(), new Error(DIMENSION_REFUSAL)])({ jobs: jobs(2) });
  assert.notEqual(
    out.isError,
    true,
    "one job succeeded and was charged for, and the whole batch is marked an error",
  );
  assert.match(
    render(out),
    /CERTIFIED_NEUTRAL/,
    "the successful row is missing from a batch that is not marked an error",
  );
});

test("only successful jobs are counted in the total", async () => {
  const out = await batchHandler([ok(7), new Error(QUOTA_REFUSAL)])({ jobs: jobs(2) });
  assert.match(
    render(out),
    /\*\*Total tokens:\*\*\s*7\b/,
    "the total does not match the one job that ran; a refused job is not charged",
  );
});
