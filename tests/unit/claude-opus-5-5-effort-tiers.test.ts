import assert from "node:assert/strict";
import { test } from "node:test";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.ts";
import { getRegistryModelThinkingEfforts } from "../../open-sse/config/providerRegistry.ts";
import { splitSyncedEffortSuffix } from "../../open-sse/services/model.ts";

const OPUS_55 = "claude-opus-5-5";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

test("claude registry advertises opus 5.5 reasoning tiers", () => {
  const model = getModelsByProviderId("claude").find((entry) => entry.id === OPUS_55);
  assert.ok(model, "claude-opus-5-5 must be a seeded Claude Code model");
  assert.deepEqual(model.supportedThinkingEfforts, EFFORTS);
  assert.equal(model.supportsReasoning, true);
  assert.equal(model.supportsXHighEffort, true);
});

test("claude registry advertises opus 5 reasoning tiers", () => {
  const model = getModelsByProviderId("claude").find((entry) => entry.id === "claude-opus-5");
  assert.ok(model, "claude-opus-5 must stay a seeded Claude Code model");
  assert.deepEqual(model.supportedThinkingEfforts, EFFORTS);
  assert.equal(model.supportsReasoning, true);
  assert.equal(model.supportsXHighEffort, true);
});

test("claude registry effort lookup resolves opus 5.5 -high", () => {
  const efforts = getRegistryModelThinkingEfforts("claude", OPUS_55);
  assert.deepEqual(efforts, EFFORTS);
  const split = splitSyncedEffortSuffix(`${OPUS_55}-high`, efforts);
  assert.equal(split.baseModel, OPUS_55);
  assert.equal(split.effort, "high");
});

test("opus 5.5 keeps its own spec instead of the opus 5 prefix", async () => {
  const { getCanonicalModelSpecId, getModelSpec } =
    await import("../../src/shared/constants/modelSpecs.ts");
  assert.equal(getCanonicalModelSpecId("claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(getCanonicalModelSpecId("claude-opus-5.5"), "claude-opus-5-5");
  assert.equal(getModelSpec("claude-opus-5-5")?.supportsThinking, true);
  assert.equal(getModelSpec("claude-opus-5-5")?.adaptiveThinkingOnly, true);
  assert.equal(getModelSpec("claude-opus-5-5")?.defaultReasoningEffort, "medium");
  const { applyDefaultReasoningEffort } =
    await import("../../open-sse/services/defaultReasoningEffort.ts");
  const bare: Record<string, unknown> = { model: "claude-opus-5-5", messages: [] };
  const filled = applyDefaultReasoningEffort(bare, "claude-opus-5-5");
  assert.equal(filled.reasoning_effort, "medium");
  const chosen: Record<string, unknown> = {
    model: "claude-opus-5-5",
    messages: [],
    reasoning_effort: "max",
  };
  const kept = applyDefaultReasoningEffort(chosen, "claude-opus-5-5");
  assert.equal(kept.reasoning_effort, "max");
});
