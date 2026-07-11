import {
  godotEventPresentation,
  godotPresentationPolishPreview,
  godotSettlementPreview,
  godotTraceChain,
} from './godotPresentation';

describe('godotPresentation', () => {
  test('keeps rule-produced durable summary locked while exposing Godot display text', () => {
    const summary = '张三就「药草」与李四叙谈，相谈尚欢。';
    const presentation = godotEventPresentation({
      actionType: 'talk',
      resultCode: 'conversation_started',
      summary,
    });

    expect(presentation).toMatchObject({
      bubbleKind: 'dialogue',
      durableSummary: summary,
      presentationSource: 'rule_template',
      presentationVersion: 1,
      presentationPolicy: {
        durableSummaryLocked: true,
        llmMayPolishDisplayText: true,
        llmMayChangeFacts: false,
        llmMayChangeDurableState: false,
      },
    });
    expect(presentation.bubbleText.length).toBeLessThanOrEqual(42);
    expect(presentation.displayText).toContain('药草');

    const rejected = godotEventPresentation({
      actionType: 'talk',
      resultCode: 'target_not_present',
      status: 'rejected',
      summary: '目标不在当前语义地点，不能对话。',
    });
    expect(rejected).toMatchObject({
      bubbleKind: 'warning',
      durableSummary: '目标不在当前语义地点，不能对话。',
      presentationSource: 'rule_template',
      presentationPolicy: {
        durableSummaryLocked: true,
        llmMayChangeFacts: false,
        llmMayChangeDurableState: false,
      },
    });
  });

  test('builds settlement preview only from resolved rule effects', () => {
    const preview = godotSettlementPreview({
      items: [
        { from: 'godot_smoke_unit', to: 'qinglan:qinglan-medicine-keeper', itemId: 'spirit_herb', qty: 2 },
        { to: 'godot_player', itemId: 'spirit_stone', qty: 3 },
        { itemId: 'spirit_herb', qty: 0 },
      ],
    });

    expect(preview).toMatchObject({
      presentationSource: 'rule_template',
      previewOnly: false,
      durableSource: 'rules.effects.items',
      policy: {
        convexAuthored: true,
        godotMayDisplayOnly: true,
        durableStateAlreadyResolved: true,
        durableSummaryLocked: true,
      },
    });
    expect(preview?.transfers).toHaveLength(2);
    expect(preview?.summary).toContain('You -> qinglan:qinglan-medicine-keeper: 灵草 x2');
    expect(preview?.summary).toContain('You +3: 灵石 x3');
    expect(godotSettlementPreview({ items: [] })).toBeUndefined();
  });

  test('LLM polish preview cannot create facts or write durable state', () => {
    const preview = godotPresentationPolishPreview({
      actionType: 'trade',
      resultCode: 'trade_completed',
      summary: '交易完成。',
      mode: 'llm_polish',
    });

    expect(preview).toMatchObject({
      adapter: 'godot_safe_polish_v1',
      requestedMode: 'llm_polish',
      status: 'llm_not_configured',
      applied: false,
      durableSummary: '交易完成。',
      inputSnapshot: {
        durableSummary: '交易完成。',
      },
      validation: {
        previewOnly: true,
        writesDurableState: false,
        factsLocked: true,
        candidateBubbleKindAllowed: true,
      },
      presentationPolicy: {
        durableSummaryLocked: true,
        llmMayChangeFacts: false,
        llmMayChangeDurableState: false,
      },
    });
    expect(preview.inputSnapshot.durableSummaryHash).toBe(preview.validation.durableSummaryHash);
    expect(preview.inputSnapshot.durableSummaryHash).toMatch(/^fnv1a32:/);
    expect([...preview.allowedOutputFields]).toEqual(['bubbleText', 'displayText', 'bubbleKind']);
    expect(preview.candidateValidation).toMatchObject({
      provided: false,
      accepted: false,
    });
    expect([...preview.lockedFields]).toEqual(
      expect.arrayContaining(['durableSummary', 'worldEventId', 'actionRecordId', 'worldState']),
    );
    expect([...preview.forbiddenEffects]).toEqual(
      expect.arrayContaining([
        'write_worldEvents',
        'write_actionRecords',
        'write_relationships',
        'write_memories',
        'change_rule_result',
        'create_facts',
      ]),
    );
    expect(preview.guardrails.every((guardrail) => guardrail.enforced)).toBe(true);

    const ruleTemplate = godotPresentationPolishPreview({
      actionType: 'talk',
      resultCode: 'conversation_started',
      summary: '闲谈几句。',
    });
    expect(ruleTemplate).toMatchObject({
      requestedMode: 'rule_template',
      status: 'rule_template_ready',
      applied: false,
    });
  });

  test('LLM polish candidates are preview-only and cannot smuggle facts', () => {
    const safePreview = godotPresentationPolishPreview({
      actionType: 'gift',
      resultCode: 'gift_accepted',
      summary: '张三将一枚灵石赠予李四，李四记下这份情谊。',
      mode: 'llm_polish',
      candidate: {
        bubbleText: '李四收下灵石。',
        displayText: '李四收下灵石，神色温和。',
        bubbleKind: 'reaction',
      },
    });

    expect(safePreview).toMatchObject({
      status: 'candidate_preview_ready',
      applied: false,
      durableSummary: '张三将一枚灵石赠予李四，李四记下这份情谊。',
      candidateBubbleText: '李四收下灵石。',
      candidateDisplayText: '李四收下灵石，神色温和。',
      candidateBubbleKind: 'reaction',
      candidateSource: 'llm_candidate_preview',
      candidateValidation: {
        provided: true,
        accepted: true,
        rejectedReasons: [],
      },
      validation: {
        previewOnly: true,
        writesDurableState: false,
        factsLocked: true,
      },
    });

    const unsafePreview = godotPresentationPolishPreview({
      actionType: 'gift',
      resultCode: 'gift_accepted',
      summary: '张三将一枚灵石赠予李四，李四记下这份情谊。',
      mode: 'llm_polish',
      candidate: {
        bubbleText: '李四得了仙器。',
        displayText: 'x'.repeat(141),
        bubbleKind: 'miracle',
        durableSummary: '李四获得上古仙器。',
        worldEventId: 'forged-event',
        effects: { items: [{ to: '李四', itemId: 'immortal_sword', qty: 1 }] },
      },
    });

    expect(unsafePreview).toMatchObject({
      status: 'candidate_rejected',
      applied: false,
      durableSummary: '张三将一枚灵石赠予李四，李四记下这份情谊。',
      candidateSource: 'rule_template',
      candidateValidation: {
        provided: true,
        accepted: false,
      },
      validation: {
        previewOnly: true,
        writesDurableState: false,
        factsLocked: true,
      },
    });
    expect(unsafePreview.candidateValidation.disallowedFields).toEqual(
      expect.arrayContaining(['durableSummary', 'worldEventId', 'effects']),
    );
    expect(unsafePreview.candidateValidation.rejectedReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining('disallowed_fields:'),
        'displayText_too_long',
        'bubbleKind_not_allowed',
      ]),
    );
    expect(unsafePreview.candidateBubbleText).not.toBe('李四得了仙器。');
    expect(unsafePreview.candidateDisplayText).not.toContain('immortal_sword');
  });

  test('trace chain labels durable action links and tickOnly observations separately', () => {
    expect(
      godotTraceChain({
        source: 'action',
        actionType: 'talk',
        worldEventId: 'we1',
        actionRecordId: 'ar1',
        resultCode: 'conversation_started',
      }),
    ).toMatchObject({
      durable: true,
      linkStatus: 'action_record_linked',
      label: 'actionRecord -> worldEvent',
      steps: [{ kind: 'semantic_action' }, { kind: 'action_record' }, { kind: 'world_event' }],
    });

    expect(godotTraceChain({ source: 'event', actionType: 'arrive', worldEventId: 'we2' })).toMatchObject({
      durable: true,
      linkStatus: 'event_only',
      label: 'worldEvent only',
      steps: [{ kind: 'region_event' }],
    });

    expect(godotTraceChain({ source: 'action_record', actionType: 'trade', actionRecordId: 'ar2' })).toMatchObject({
      durable: false,
      linkStatus: 'action_record_only',
      label: 'actionRecord only',
      steps: [{ kind: 'action_record_readback' }],
    });

    expect(
      godotTraceChain({
        source: 'tick',
        actionType: 'agent_tick',
        resultCode: 'agent_skipped',
        tickOnly: true,
      }),
    ).toMatchObject({
      durable: false,
      tickOnly: true,
      linkStatus: 'tick_only',
      label: 'tickOnly observation',
      steps: [{ kind: 'tick_observation' }, { kind: 'tick_only' }],
    });
  });
});
