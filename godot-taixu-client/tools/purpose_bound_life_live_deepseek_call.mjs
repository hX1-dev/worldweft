#!/usr/bin/env node

import { runPiNpcTurn } from '../../convex/vendor/piNpcCoreLite/loop.ts';
import {
  PI_NPC_DEEPSEEK_MAX_OUTPUT_TOKENS,
  PI_NPC_DEEPSEEK_MODEL,
  callPiNpcDeepSeek,
  readPiNpcDeepSeekTransportConfig,
} from '../../convex/xianxia/piNpcDeepSeekTransport.ts';

const input = JSON.parse(await readStdin());
assertInput(input);
const eventTypes = [];
let inputTokens = 0;
let outputTokens = 0;
let latencyMs = 0;
let externalProviderCalls = 0;
const config = readPiNpcDeepSeekTransportConfig(process.env, input.actorId);
if (config.fixture) throw new Error('c021q7_official_provider_required');

const result = await runPiNpcTurn(
  {
    turnId: input.turnId,
    observationRevision: input.observationRevision,
    candidateSetDigest: input.candidateSetDigest,
    messages: input.messages,
    eligibleCandidateIds: input.eligibleCandidateIds,
  },
  {
    transformContext: (messages) => messages.map((message) => ({ ...message })),
    provider: async (request) => {
      externalProviderCalls += 1;
      const response = await callPiNpcDeepSeek(
        {
          messages: request.messages,
          maxOutputTokens: request.maxOutputTokens,
          signal: request.signal,
        },
        config,
      );
      inputTokens += response.inputTokens ?? 0;
      outputTokens += response.outputTokens ?? 0;
      latencyMs += response.latencyMs;
      return {
        text: response.text,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
      };
    },
    emit: (event) => eventTypes.push(event.type),
  },
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  provider: 'deepseek',
  model: PI_NPC_DEEPSEEK_MODEL,
  externalProviderCalls,
  inputTokens,
  outputTokens,
  latencyMs,
  eventTypes,
  result,
})}\n`);

function assertInput(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.actorId !== 'string' ||
    typeof value.turnId !== 'string' ||
    typeof value.observationRevision !== 'string' ||
    typeof value.candidateSetDigest !== 'string' ||
    !Array.isArray(value.messages) ||
    value.messages.length !== 2 ||
    !Array.isArray(value.eligibleCandidateIds) ||
    value.eligibleCandidateIds.length < 2 ||
    value.eligibleCandidateIds.length > 12 ||
    value.messages.some(
      (message) =>
        !message ||
        !['system', 'user'].includes(message.role) ||
        typeof message.content !== 'string' ||
        message.content.length < 1,
    )
  ) {
    throw new Error('c021q7_provider_input_invalid');
  }
  const promptSize = value.messages.reduce(
    (total, message) => total + Array.from(message.content).length,
    0,
  );
  if (promptSize > 9_000) throw new Error('c021q7_prompt_budget_exceeded');
  if (PI_NPC_DEEPSEEK_MAX_OUTPUT_TOKENS !== 180) {
    throw new Error('c021q7_output_budget_drift');
  }
}
function readStdin() {
  return new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      text += chunk;
      if (Buffer.byteLength(text) > 64 * 1024) {
        reject(new Error('c021q7_provider_input_too_large'));
      }
    });
    process.stdin.once('end', () => resolve(text));
    process.stdin.once('error', reject);
  });
}
