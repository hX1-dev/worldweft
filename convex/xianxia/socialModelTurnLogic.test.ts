import type { AgentContext } from './agentLogic';
import {
  buildSocialModelTurnPlan,
  materializeSocialModelProposal,
  parseSocialModelTurn,
} from './socialModelTurnLogic';
import {
  SOCIAL_LLM_INPUT_TOKEN_LIMIT,
  SOCIAL_MODEL_PROMPT_VERSION,
  estimateSocialPromptTokens,
} from './socialModelPolicy';

const bilateral: AgentContext = {
  self: {
    actorId: 'seller', name: '采药人', role: 'outer_disciple', realm: 'qi_refining', realmStage: 2,
    cultivationXp: 10, mood: 1, health: 10, spirit: 5, reputation: 0,
    currentLocationId: 'market', persona: '谨慎但愿意公平交易',
    inventory: [{ itemId: 'spirit_herb', qty: 3 }],
  },
  others: [{ actorId: 'buyer', name: '商旅', realm: 'qi_refining', relationship: 5 }],
  recentEvents: ['private_database_secret_must_not_render'],
  socialSummaries: ['archived_secret_must_not_render'],
  availableActions: ['talk', 'negotiate'],
  negotiationRelationship: 5,
  activeConversation: {
    conversationId: 'conversation:c016c', topicId: '灵草交易', otherActorId: 'buyer', otherActorName: '商旅',
    currentSpeakerActorId: 'seller', turnNumber: 1, maxTurns: 12, expiresAt: Date.now() + 60_000,
    recentTurns: [{ turnNumber: 1, speakerActorId: 'buyer', speechAct: 'request', utteranceText: '我想买一株灵草。' }],
    visibleFacts: [{ eventId: 'event_market', summary: '双方正在坊市摊位交谈', source: 'present' }],
    beliefs: [{ beliefId: 'belief_price', kind: 'belief', summary: '公平价格约为十枚灵石', sourceActorId: 'seller' }],
  },
  negotiationOpportunity: {
    kind: 'herb_trade', sellerActorId: 'seller', buyerActorId: 'buyer', itemQty: 1, openingPaymentQty: 11,
  },
};

describe('C016c live social prompt contract', () => {
  test('builds a bounded opening negotiation without rendering unrelated private context', () => {
    const plan = buildSocialModelTurnPlan(bilateral)!;
    expect(plan.scenarioKind).toBe('negotiation');
    expect(plan.candidates.map((candidate) => candidate.candidateId)).toEqual(['negotiation:open']);
    expect(plan.prompt.system).toContain(`promptContract=${SOCIAL_MODEL_PROMPT_VERSION}`);
    expect(plan.prompt.user).toContain('eventId=event_market');
    expect(plan.prompt.user).not.toContain('private_database_secret');
    expect(plan.prompt.user).not.toContain('archived_secret');
    expect(estimateSocialPromptTokens([
      { content: plan.prompt.system }, { content: plan.prompt.user },
    ])).toBeLessThanOrEqual(SOCIAL_LLM_INPUT_TOKEN_LIMIT);
  });

  test('active responder genuinely chooses among bounded counter, accept and reject candidates', () => {
    const buyer: AgentContext = {
      ...bilateral,
      self: {
        ...bilateral.self, actorId: 'buyer', name: '商旅',
        inventory: [{ itemId: 'spirit_stone', qty: 20 }],
      },
      others: [{ actorId: 'seller', name: '采药人', realm: 'qi_refining', relationship: 5 }],
      activeConversation: {
        ...bilateral.activeConversation!, otherActorId: 'seller', otherActorName: '采药人',
        currentSpeakerActorId: 'buyer', turnNumber: 2,
      },
      negotiationOpportunity: undefined,
      activeNegotiation: {
        negotiationId: 'negotiation:c016c', proposalId: 'proposal:c016c:1', revision: 1,
        proposerActorId: 'seller', recipientActorId: 'buyer',
        terms: {
          kind: 'herb_trade', sellerActorId: 'seller', buyerActorId: 'buyer', itemId: 'spirit_herb',
          itemQty: 1, paymentItemId: 'spirit_stone', paymentQty: 11,
        },
        priorOffers: [{ proposerActorId: 'seller', paymentQty: 11 }],
      },
    };
    const plan = buildSocialModelTurnPlan(buyer)!;
    expect(new Set(plan.candidates.map((candidate) => candidate.candidateId))).toEqual(new Set([
      'negotiation:counter', 'negotiation:accept', 'negotiation:reject',
    ]));
    const parsed = parseSocialModelTurn(JSON.stringify({
      candidateId: 'negotiation:counter',
      utteranceText: '十一枚略高，我愿出十枚灵石换一株灵草。',
      referencedFactIds: [], referencedBeliefIds: [],
    }), plan);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(materializeSocialModelProposal(buyer, plan, parsed.value)).toMatchObject({
      type: 'negotiate',
      params: { operation: 'counter', expectedRevision: 1, terms: { paymentQty: 10 } },
    });
  });

  test('builds a floor-bound group prompt with own beliefs and no world facts', () => {
    const group: AgentContext = {
      ...bilateral,
      self: { ...bilateral.self, actorId: 'mediator', name: '执事', inventory: [] },
      others: [
        { actorId: 'donor', name: '采药人', realm: 'qi_refining', relationship: 20 },
        { actorId: 'rival', name: '外门弟子', realm: 'qi_refining', relationship: -25 },
      ],
      availableActions: ['group_talk', 'group_decide'],
      activeConversation: undefined,
      negotiationOpportunity: undefined,
      activeGroupConversation: {
        groupConversationId: 'group:c016c', role: 'participant', topicId: '一株灵草应交给谁',
        participantActorIds: ['mediator', 'donor', 'rival'], observerActorIds: ['observer'],
        currentSpeakerActorId: 'mediator', turnNumber: 2, maxTurns: 12,
        expiresAt: Date.now() + 60_000, expired: false,
        recentTurns: [{ turnNumber: 2, speakerActorId: 'rival', speechAct: 'inform', utteranceText: '我反对偏袒。' }],
        beliefs: [{ beliefId: 'belief_heard', kind: 'claim', summary: '对方声称分配不公', sourceActorId: 'rival' }],
      },
    };
    const plan = buildSocialModelTurnPlan(group)!;
    expect(plan.scenarioKind).toBe('group_conversation');
    expect(plan.projection.visibleFactIds.size).toBe(0);
    expect(plan.prompt.user).toContain('beliefId=belief_heard');
    expect(plan.prompt.user).not.toContain('private_database_secret');
    const parsed = parseSocialModelTurn(JSON.stringify({
      speechAct: 'clarify', utteranceText: '先分别说明需要，再按公开表决处理。',
      referencedFactIds: [], referencedBeliefIds: ['belief_heard'],
    }), plan);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(materializeSocialModelProposal(group, plan, parsed.value)).toMatchObject({
      type: 'group_talk',
      params: {
        groupConversationId: 'group:c016c',
        addressedActorIds: ['donor', 'rival'],
        referencedBeliefIds: ['belief_heard'],
      },
    });
  });

  test('does not build a group prompt for an observer or the wrong speaker', () => {
    const group = {
      ...bilateral,
      activeConversation: undefined,
      activeGroupConversation: {
        groupConversationId: 'group:c016c', role: 'observer' as const, topicId: '群议',
        participantActorIds: ['seller', 'buyer', 'third'], observerActorIds: ['observer'],
        currentSpeakerActorId: 'seller', turnNumber: 1, maxTurns: 12,
        expiresAt: Date.now() + 60_000, expired: false, recentTurns: [], beliefs: [],
      },
    };
    expect(buildSocialModelTurnPlan(group)).toBeNull();
  });
});
