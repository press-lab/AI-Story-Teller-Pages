// Run with node scripts/measure-world-evolution-cost.mjs. No network/model calls.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import ts from "typescript";

const externalRequire = createRequire(import.meta.url);
function loader(ref) {
  const cache = new Map();
  function load(file) {
    file = file.replace(/\\/g, "/");
    if (!path.posix.extname(file)) file += ".ts";
    if (cache.has(file)) return cache.get(file).exports;
    const source = ref === "working" ? readFileSync(file, "utf8") : execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8" });
    const module = { exports: {} }; cache.set(file, module);
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const require = name => name.startsWith(".") ? load(path.posix.normalize(path.posix.join(path.posix.dirname(file), name))) : externalRequire(name);
    runInThisContext(`(function(require,module,exports){${compiled}\n})`, { filename: `${ref}/${file}` })(require, module, module.exports);
    return module.exports;
  }
  return load;
}
const current = loader("working");
const defaults = current("src/state/defaults.ts");
const estimate = current("src/tokenizer/approximateTokenCount.ts").approximateTokenCount;
const fixedTime = "2026-01-01T00:00:00.000Z";
function fixture(withArc) {
  const a = defaults.createDefaultAdventure("Identical cost fixture");
  a.id = "cost-fixture"; a.createdAt = fixedTime; a.updatedAt = fixedTime;
  a.storyCards = [defaults.makeStoryCard({ id: "marcus", title: "Marcus", type: "character", content: "Marcus is loyal to the king.", keys: ["Marcus"], pinned: true })];
  a.brains = [];
  a.components = [defaults.makeComponent({ id: "pe", title: "Foundations", type: "plotEssentials", content: "The kingdom is at peace." })];
  if (withArc) a.components.push(defaults.makeComponent({ id: "arc", title: "Royal conspiracy", type: "currentArc", content: "Investigate the conspiracy.", arcPremise: "Expose the conspiracy against the king.", arcSimmerInstruction: "Follow established leads.", arcBreakInstruction: "Confront the conspiracy leaders.", arcThreadKeys: ["marcus"] }));
  [...a.storyCards, ...a.components].forEach(t => { t.createdAt = fixedTime; t.updatedAt = fixedTime; });
  a.semanticEvaluationSettings.enabled = false;
  a.activeState.turn = 0;
  return a;
}
const refs = ["401b27c", "bdb7e53", "1edee2d", "3c25be0", "e3c432", "2df5e17", "working"];
const rows = [];
for (const ref of refs) {
  const load = loader(ref);
  for (const arc of [false, true]) {
    let requests = 0;
    const a = fixture(arc);
    const result = await load("src/state/turnPipeline.ts").runTurnPipeline({ adventure: structuredClone(a), text: "Marcus looks around the peaceful garden.", sendChatCompletion: async () => { requests++; return { content: 'Marcus drinks his tea.\n<memory_updates>{"updates":[]}</memory_updates>' }; } });
    const input = result.providerPayload.reduce((n, m) => n + estimate(m.content), 0);
    const memory = result.preProviderContext.sections.flatMap(s => s.items).find(i => i.id === "one-pass-memory")?.content ?? "";
    rows.push({ ref, fixture: arc ? "activeArc" : "emptySandbox", requests, inputTokensEstimate: input, memoryInstructionTokensEstimate: estimate(memory), structuredOutputTokensEstimate: estimate('{"updates":[]}') });
  }
}
const presets = current("src/memory/worldPresets.ts").worldPresets;
const presetRows = [];
for (const [preset, settings] of Object.entries({ Disabled: { ...presets["Living World"], enabled: false }, ...presets })) {
  for (const arc of [false, true]) {
    let requests = 0;
    const a = fixture(arc); a.worldEvolutionSettings = { enabled: true, ...settings };
    const result = await current("src/state/turnPipeline.ts").runTurnPipeline({ adventure: a, text: "Marcus looks around the peaceful garden.", sendChatCompletion: async () => { requests++; return { content: 'Marcus drinks his tea.\n<memory_updates>{"updates":[]}</memory_updates>' }; } });
    const input = result.providerPayload.reduce((n, m) => n + estimate(m.content), 0);
    const worldInstruction = current("src/memory/worldEvolution.ts").worldEvolutionInstruction(a, new Set([...a.storyCards, ...a.components].map(t => t.id)));
    const row = { preset, fixture: arc ? "activeArc" : "emptySandbox", requests, inputTokensEstimate: input, worldInstructionTokensEstimate: worldInstruction ? estimate(worldInstruction) : 0 };
    for (const ref of ["401b27c", "1edee2d", "2df5e17"]) row[`deltaFrom${ref}`] = input - rows.find(r => r.ref === ref && r.fixture === row.fixture).inputTokensEstimate;
    if (requests !== 1) throw new Error("Preset added routine requests.");
    if (preset === "Disabled" && worldInstruction) throw new Error("Disabled world has prompt overhead.");
    presetRows.push(row);
  }
}
console.log(JSON.stringify({ presetRows }, null, 2));
console.log(JSON.stringify(rows, null, 2));
const world = current("src/memory/worldEvolution.ts");
const worst = fixture(true);
worst.storyCards = Array.from({ length: 4 }, (_, i) => defaults.makeStoryCard({ id: `card${i}`.padEnd(160, "x"), title: `Character ${i}`, type: "character", content: "Known canon.", updatedAt: "x".repeat(80), evolutionProtection: { identity: true, betrayal: true } }));
worst.components = Array.from({ length: 4 }, (_, i) => defaults.makeComponent({ id: `arc${i}`.padEnd(160, "x"), type: "currentArc", arcPremise: "x".repeat(300) }));
const worstInstruction = world.worldEvolutionInstruction(worst, new Set([...worst.storyCards, ...worst.components].map(t => t.id)));
const story = "Marcus discovers evidence exposing the conspiracy against the king.";
const shortEvent = { kind: "progress", targetId: "arc", evidence: story, outcome: story, offscreen: false };
const fullEvent = { ...shortEvent, expectedRevision: 0, objective: "Expose the conspiracy against the king.", certainty: "confirmed", autonomous: false };
console.log(JSON.stringify({ worstWorldInstructionChars: worstInstruction.length, worstWorldInstructionTokensEstimate: estimate(worstInstruction),
  output: { empty: estimate('{"updates":[]}'), initialPlotEvent: estimate(JSON.stringify({ updates: [], plotEvents: [shortEvent] })), explicitPlotEvent: estimate(JSON.stringify({ updates: [], plotEvents: [fullEvent] })) },
  limits: { sharedRecords: world.MAX_WORLD_RECORDS, serializedCharacters: world.MAX_WORLD_OUTPUT_CHARS, structuredTokensEstimate: world.MAX_WORLD_OUTPUT_TOKENS_ESTIMATE, activePlots: world.MAX_ACTIVE_PLOTS },
  deterministicFixtureFallbacks: 0, measuredProviderCostUSD: null }, null, 2));
if (estimate(worstInstruction) > 1000) throw new Error("Worst world instruction exceeds 1000 estimated tokens.");
const working = rows.filter(r => r.ref === "working");
for (const row of working) {
  if (row.requests !== 1) throw new Error("Additional routine request introduced.");
  const base = rows.find(r => r.ref === "1edee2d" && r.fixture === row.fixture);
  if (row.inputTokensEstimate - base.inputTokensEstimate > 650) throw new Error("World prompt overhead exceeds 650 estimated tokens on identical fixtures.");
}
