import {
  buildAgentMessages,
  assertAgentProviderCallAllowed,
  applyAgentCultivationMode,
  buildValleyMovementMessages,
  buildConversationTurnMessages,
  parseProposal,
  parseValleyMovementDecision,
  ownedHealingItemId,
  planGatherIntent,
  planShopTradeIntent,
  planCombatIntent,
  planConversationTurnIntent,
  planGroupConversationTurnIntent,
  planGroupDecisionIntent,
  planRestIntent,
  planSurvivalEnvelope,
  planValleyAutonomy,
  planSelfCareIntent,
  planStrategicIntent,
  isAgentInteractionTargetEligible,
  type AgentContext,
} from './agentLogic';

describe('Agent provider=0 boundary', () => {
  it('fails closed before any provider call when explicitly disabled', () => {
    expect(() => assertAgentProviderCallAllowed('disabled')).toThrow(
      'pi_npc_provider_forbidden',
    );
    expect(() => assertAgentProviderCallAllowed(undefined)).not.toThrow();
  });
});

describe('C012 production conversation planner', () => {
  const conversationContext = (turnNumber = 1): AgentContext => ({
    ...baseCtx,
    activeConversation: {
      conversationId: 'conversation:1',
      topicId: '问药',
      otherActorId: 'merchant',
      otherActorName: '商贩',
      currentSpeakerActorId: baseCtx.self.actorId,
      turnNumber,
      maxTurns: 12,
      expiresAt: Date.now() + 10_000,
      recentTurns: [
        { turnNumber: 1, speakerActorId: 'merchant', speechAct: 'request', utteranceText: '想谈谈药草。' },
      ],
      visibleFacts: [],
      beliefs: [],
    },
  });

  it('only speaks when the server grants this actor the turn', () => {
    expect(planConversationTurnIntent(conversationContext())).toMatchObject({
      type: 'talk',
      targetActorId: 'merchant',
      params: {
        conversationId: 'conversation:1',
        expectedTurnNumber: 2,
        speechAct: 'respond',
      },
    });
    expect(
      planConversationTurnIntent({
        ...conversationContext(),
        activeConversation: {
          ...conversationContext().activeConversation!,
          currentSpeakerActorId: 'merchant',
        },
      }),
    ).toBeNull();
  });

  it('ends after six total turns and exposes only bounded owned knowledge to the prompt', () => {
    expect(planConversationTurnIntent(conversationContext(5))).toMatchObject({
      params: { expectedTurnNumber: 6, speechAct: 'end_topic' },
    });
    const messages = buildConversationTurnMessages({
      ...conversationContext(),
      activeConversation: {
        ...conversationContext().activeConversation!,
        visibleFacts: [{ eventId: 'event:1', summary: '亲眼见到采药', source: 'witness' }],
        beliefs: [{ beliefId: 'belief:1', kind: 'rumor', summary: '据说桥边有客', sourceActorId: 'guide' }],
      },
    });
    expect(messages?.user).toContain('eventId=event:1');
    expect(messages?.user).toContain('beliefId=belief:1');
    expect(messages?.system).toContain('不能');
    expect(messages?.user).toContain('真值=unknown');
    expect(messages?.user).toContain('revision=1');
  });

  it('questions rumor, cites registered evidence, and refuses a refuted belief', () => {
    const withBelief = (belief: NonNullable<AgentContext['activeConversation']>['beliefs'][number]) => ({
      ...conversationContext(),
      activeConversation: { ...conversationContext().activeConversation!, beliefs: [belief] },
    });
    expect(planConversationTurnIntent(withBelief({
      beliefId: 'belief:rumor', kind: 'rumor', summary: '据说名册有改动', sourceActorId: 'merchant',
      truthStatus: 'unknown', revision: 1,
    }))).toMatchObject({ params: { speechAct: 'ask', knowledgeReasonCode: 'rumor_unverified' } });
    expect(planConversationTurnIntent(withBelief({
      beliefId: 'belief:rumor', kind: 'rumor', summary: '据说名册有改动', sourceActorId: 'merchant',
      truthStatus: 'unknown', revision: 1, availableEvidenceEventId: 'event:evidence',
      availableEvidenceVerdict: 'confirm',
    }))).toMatchObject({ params: {
      speechAct: 'clarify',
      referencedFactIds: ['event:evidence'],
      knowledgeReasonCode: 'registered_evidence_available',
    } });
    expect(planConversationTurnIntent(withBelief({
      beliefId: 'belief:refuted', kind: 'belief', summary: '名册有改动', sourceActorId: 'merchant',
      truthStatus: 'contradicted', revision: 2,
    }))).toMatchObject({ params: { speechAct: 'refuse', knowledgeReasonCode: 'evidence_refuted' } });
  });
});

describe('C014a production group floor planner', () => {
  const groupContext = (role: 'participant' | 'observer' = 'participant'): AgentContext => ({
    ...baseCtx,
    availableActions: ['group_talk'],
    activeGroupConversation: {
      groupConversationId: 'group_conversation:1',
      role,
      topicId: 'herb_dispute',
      participantActorIds: [baseCtx.self.actorId, 'disciple_b', 'disciple_c'],
      observerActorIds: ['guard'],
      currentSpeakerActorId: baseCtx.self.actorId,
      turnNumber: 1,
      maxTurns: 15,
      expiresAt: Date.now() + 10_000,
      expired: false,
      recentTurns: [],
      beliefs: [],
    },
  });

  it('uses the server floor and addresses every other participant', () => {
    expect(planGroupConversationTurnIntent(groupContext())).toMatchObject({
      type: 'group_talk',
      params: {
        operation: 'speak',
        expectedTurnNumber: 2,
        speechAct: 'inform',
        addressedActorIds: ['disciple_b', 'disciple_c'],
      },
    });
  });

  it('never lets an observer or non-floor participant produce a turn', () => {
    expect(planGroupConversationTurnIntent(groupContext('observer'))).toBeNull();
    expect(planGroupConversationTurnIntent({
      ...groupContext(),
      activeGroupConversation: {
        ...groupContext().activeGroupConversation!,
        currentSpeakerActorId: 'disciple_b',
      },
    })).toBeNull();
  });

  it('uses the same action protocol to settle an expired membership without a model call', () => {
    expect(planGroupConversationTurnIntent({
      ...groupContext(),
      activeGroupConversation: {
        ...groupContext().activeGroupConversation!,
        expired: true,
        currentSpeakerActorId: 'disciple_b',
      },
    })).toMatchObject({
      type: 'group_talk',
      params: { operation: 'speak', speechAct: 'end_topic' },
    });
  });
});

describe('C014b production group decision planner', () => {
  const session = {
    groupConversationId: 'group_conversation:1', role: 'participant' as const,
    topicId: 'herb_allocation', participantActorIds: ['han_li', 'b', 'c', 'd'],
    observerActorIds: ['o'], currentSpeakerActorId: 'b', turnNumber: 2, maxTurns: 15,
    expiresAt: Date.now() + 10_000, expired: false, recentTurns: [], beliefs: [],
  };

  it('votes without owning the speech floor and an observer never votes', () => {
    const context: AgentContext = {
      ...baseCtx, availableActions: ['group_decide'], activeGroupConversation: session,
      activeGroupDecision: { openProposal: {
        proposalId: 'proposal:1', proposerActorId: 'b', donorActorId: 'b', recipientActorId: 'c', hasVoted: false,
      } },
    };
    expect(planGroupDecisionIntent(context)).toMatchObject({
      type: 'group_decide', params: { operation: 'vote', proposalId: 'proposal:1', choice: 'abstain' },
    });
    expect(planGroupDecisionIntent({
      ...context, activeGroupConversation: { ...session, role: 'observer' },
    })).toBeNull();
  });

  it('only the donor executes a pending commitment', () => {
    const context: AgentContext = {
      ...baseCtx, availableActions: ['group_decide'], activeGroupConversation: session,
      activeGroupDecision: { pendingCommitment: {
        commitmentId: 'commitment:1', donorActorId: 'han_li', recipientActorId: 'c',
      } },
    };
    expect(planGroupDecisionIntent(context)).toMatchObject({
      type: 'group_decide', params: { operation: 'execute', commitmentId: 'commitment:1' },
    });
    expect(planGroupDecisionIntent({ ...context, self: { ...context.self, actorId: 'b' } })).toBeNull();
  });

  it('uses its own directional relationship and skips rejected recipients on mediation', () => {
    const voting: AgentContext = {
      ...baseCtx,
      others: [...baseCtx.others, { actorId: 'c', name: '丙', realm: 'qi_refining', relationship: -20 }],
      availableActions: ['group_decide'], activeGroupConversation: session,
      activeGroupDecision: { openProposal: {
        proposalId: 'proposal:2', proposerActorId: 'b', donorActorId: 'b', recipientActorId: 'c', hasVoted: false,
      } },
    };
    expect(planGroupDecisionIntent(voting)).toMatchObject({ params: { operation: 'vote', choice: 'oppose' } });

    const mediating: AgentContext = {
      ...voting,
      self: { ...voting.self, inventory: [{ itemId: 'spirit_herb', qty: 1 }] },
      activeGroupDecision: { attemptedRecipientActorIds: ['b'], proposalCount: 1, mediationExhausted: false },
    };
    expect(planGroupDecisionIntent(mediating)).toMatchObject({
      params: { operation: 'propose', recipientActorId: 'c' },
    });
  });

  it('supports a recipient after one sourced fulfilled-request trust and debt effect', () => {
    const context: AgentContext = {
      ...baseCtx,
      others: [
        ...baseCtx.others,
        {
          actorId: 'c', name: '丙', realm: 'qi_refining', relationship: 0,
          trust: 5, debt: 5, suspicion: 0,
        },
      ],
      availableActions: ['group_decide'],
      activeGroupConversation: session,
      activeGroupDecision: { openProposal: {
        proposalId: 'proposal:fulfilled-request',
        proposerActorId: 'b', donorActorId: 'b', recipientActorId: 'c', hasVoted: false,
      } },
    };
    expect(planGroupDecisionIntent(context)).toMatchObject({
      params: { operation: 'vote', choice: 'approve' },
    });
  });

  it('keeps the current vote invariant when unrelated episodic rows become a social summary', () => {
    const beforeCompaction: AgentContext = {
      ...baseCtx,
      recentEvents: Array.from({ length: 5 }, (_, index) => `与旁听者 o 的旧经历 ${index}`),
      socialSummaries: [],
      availableActions: ['group_decide'],
      activeGroupConversation: session,
      activeGroupDecision: { openProposal: {
        proposalId: 'proposal:memory-invariance',
        proposerActorId: 'b',
        donorActorId: 'b',
        recipientActorId: 'c',
        hasVoted: false,
      } },
    };
    const afterCompaction: AgentContext = {
      ...beforeCompaction,
      recentEvents: Array.from({ length: 5 }, (_, index) => `较新的与旁听者 o 的旧经历 ${index}`),
      socialSummaries: ['角色 o 相关的 7 段归档经历；事件=c016d3_unrelated_memory'],
    };
    expect(planGroupDecisionIntent(afterCompaction)).toEqual(
      planGroupDecisionIntent(beforeCompaction),
    );
  });
});

describe('planCombatIntent（C010 规则 Agent）', () => {
  it('低气血 active encounter 只选择高层 flee', () => {
    const proposal = planCombatIntent({
        ...baseCtx,
        self: { ...baseCtx.self, health: 2 },
        availableActions: ['attack', 'flee'],
        combat: {
          activeEncounterId: 'combat-1',
          opponentActorId: 'enemy',
          opponentName: '对手',
          opponentHealth: 8,
          lootTargets: [],
        },
      });
    expect(proposal).toMatchObject({ type: 'flee' });
    expect(proposal).not.toHaveProperty('targetActorId');
  });

  it('清醒且有优势时继续 attack 但不输出伤害', () => {
    const proposal = planCombatIntent({
        ...baseCtx,
        availableActions: ['attack', 'flee'],
        combat: {
          activeEncounterId: 'combat-1',
          opponentActorId: 'enemy',
          opponentName: '对手',
          opponentHealth: 3,
          lootTargets: [],
        },
      });
    expect(proposal).toEqual(expect.objectContaining({ type: 'attack', targetActorId: 'enemy' }));
    expect(proposal).not.toHaveProperty('params');
  });

  it('只从可追溯且有优先权的失能目标选择一件 loot', () => {
    expect(
      planCombatIntent({
        ...baseCtx,
        availableActions: ['loot'],
        combat: {
          lootTargets: [
            {
              encounterId: 'combat-1',
              actorId: 'downed',
              name: '落败者',
              priorityAllowed: true,
              items: [{ itemId: 'spirit_herb', qty: 1 }],
            },
          ],
        },
      }),
    ).toMatchObject({ type: 'loot', targetActorId: 'downed', params: { itemId: 'spirit_herb' } });
  });
});

describe('planSurvivalEnvelope（C017b 统一抢占）', () => {
  it('重伤会话参与者先自疗，健康参与者放行原会话', () => {
    const conversation = {
      conversationId: 'conversation:survival',
      topicId: '闲谈',
      otherActorId: 'peer',
      otherActorName: '同门',
      currentSpeakerActorId: baseCtx.self.actorId,
      turnNumber: 1,
      maxTurns: 6,
      expiresAt: 9_999,
      recentTurns: [],
      visibleFacts: [],
      beliefs: [],
    };
    const injured = planSurvivalEnvelope({
      ...baseCtx,
      self: {
        ...baseCtx.self,
        health: 5,
        maxHealth: 10,
        inventory: [{ itemId: 'healing_pill', qty: 1 }],
      },
      availableActions: ['talk', 'use_item'],
      activeConversation: conversation,
    });
    expect(injured).toMatchObject({
      kind: 'act',
      proposal: { type: 'use_item', params: { itemId: 'healing_pill' } },
    });
    expect(
      planSurvivalEnvelope({
        ...baseCtx,
        self: { ...baseCtx.self, health: 10, maxHealth: 10, fatigue: 0 },
        availableActions: ['talk'],
        activeConversation: conversation,
      }),
    ).toMatchObject({ kind: 'pass', envelope: { state: 'stable', urgency: 0 } });
  });

  it('溪谷疲劳角色前往篝火交互点，而不是地点内任意站位', () => {
    expect(
      planSurvivalEnvelope({
        ...baseCtx,
        self: {
          ...baseCtx.self,
          actorId: 'qinglan_valley_gate:herb_gatherer',
          currentLocationId: 'herb_meadow',
          fatigue: 80,
        },
        knownLocations: [
          {
            locationId: 'rest_clearing',
            name: '松风歇脚地',
            allowedActions: ['rest'],
          },
          {
            locationId: 'herb_meadow',
            name: '凝露药草坡',
            allowedActions: ['gather'],
          },
        ],
      }),
    ).toMatchObject({
      kind: 'act',
      proposal: {
        type: 'travel',
        targetId: 'rest_clearing',
        params: {
          movementTarget: {
            kind: 'interactable',
            interactionId: 'rest_campfire',
          },
          decisionSource: 'utility',
        },
      },
    });
  });
});

const KNOWN = [
  {
    locationId: 'mountain_gate',
    name: '山门',
    allowedActions: ['cultivate', 'talk', 'request_teaching', 'spar', 'gift'],
  },
  { locationId: 'market', name: '坊市', allowedActions: ['talk', 'trade', 'gift', 'steal'] },
  {
    locationId: 'secret_realm_gate',
    name: '秘境入口',
    allowedActions: ['explore', 'gather', 'steal'],
  },
];

const baseCtx: AgentContext = {
  self: {
    actorId: 'han_li',
    name: '韩立',
    role: 'outer_disciple',
    realm: 'qi_refining',
    realmStage: 3,
    cultivationXp: 40,
    mood: 1,
    health: 8,
    maxHealth: 10,
    spirit: 7,
    reputation: 0,
    currentLocationId: 'mountain_gate',
    inventory: [{ itemId: 'healing_pill', qty: 1 }],
  },
  currentLocationName: '山门',
  others: [
    { actorId: 'elder_li', name: '李长老', realm: 'golden_core', relationship: 10 },
    { actorId: 'merchant', name: '商贩', realm: 'qi_refining', relationship: 0 },
  ],
  recentEvents: ['韩立在山门吐纳行功，修为稳步精进。'],
  availableActions: ['cultivate', 'talk', 'request_teaching', 'spar', 'gift'],
};

const secretCtx: AgentContext = {
  ...baseCtx,
  self: { ...baseCtx.self, currentLocationId: 'secret_realm_gate' },
  currentLocationName: '秘境入口',
  availableActions: ['explore', 'steal'],
};

describe('Agent 观察生命状态门禁', () => {
  it('附近目标保留受伤者，但排除气血归零者', () => {
    expect(isAgentInteractionTargetEligible({ health: 4 })).toBe(true);
    expect(isAgentInteractionTargetEligible({ health: 0 })).toBe(false);
    expect(isAgentInteractionTargetEligible({ health: 10, lifeStatus: 'deceased' })).toBe(false);
  });
});

describe('buildAgentMessages', () => {
  it('包含角色名、可用动作、附近的人与约束', () => {
    const { system, user } = buildAgentMessages(baseCtx);
    expect(system).toContain('韩立');
    expect(system).toContain('不能直接控制世界');
    expect(system).toContain('JSON');
    expect(user).toContain('可用动作：cultivate');
    expect(user).toContain('elder_li');
    expect(user).toContain('气血 8/10');
  });

  it('把 social summary 标成非事实背景，且不需要伪造 eventId', () => {
    const { user } = buildAgentMessages({
      ...baseCtx,
      socialSummaries: ['角色 merchant 相关的 6 段归档经历；事件=trade_completed'],
    });
    expect(user).toContain('长期社会印象');
    expect(user).toContain('不等于已证实世界事实');
    expect(user).toContain('6 段归档经历');
    expect(user).not.toContain('eventId=undefined');
  });

  it('有 persona 时注入性情；无 persona 不留空行', () => {
    const withPersona = buildAgentMessages({
      ...baseCtx,
      self: { ...baseCtx.self, persona: '谨慎隐忍，偏好稳健修炼' },
    });
    expect(withPersona.system).toContain('你的性情：谨慎隐忍');
    // 无 persona 时不应出现「你的性情」前缀，也不应有连续空行
    expect(buildAgentMessages(baseCtx).system).not.toContain('你的性情');
    expect(buildAgentMessages(baseCtx).system).not.toContain('\n\n');
  });

  it('只展示服务端给出的商店报价和资金库存', () => {
    const { user } = buildAgentMessages({
      ...baseCtx,
      shopOffers: [
        {
          shopId: 'lab_shop',
          shopName: '灰盒补给铺',
          targetActorId: 'merchant',
          direction: 'sell',
          itemId: 'spirit_herb',
          qty: 1,
          unitPrice: 4,
          totalPrice: 4,
          stock: 1,
          capacity: 4,
          walletSpiritStones: 20,
        },
      ],
    });
    expect(user).toContain('灰盒补给铺');
    expect(user).toContain('总价 4 灵石');
    expect(user).toContain('库存 1/4');
  });
});

describe('shop trade planner', () => {
  const shopContext = {
    ...baseCtx,
    self: {
      ...baseCtx.self,
      currentLocationId: 'market',
      inventory: [{ itemId: 'spirit_herb', qty: 2 }],
    },
    availableActions: ['trade'] as AgentContext['availableActions'],
    shopOffers: [
      {
        shopId: 'lab_shop',
        shopName: '灰盒补给铺',
        targetActorId: 'merchant',
        direction: 'sell' as const,
        itemId: 'spirit_herb',
        qty: 1,
        unitPrice: 4,
        totalPrice: 4,
        stock: 1,
        capacity: 4,
        walletSpiritStones: 20,
      },
    ],
  } satisfies AgentContext;

  it('production Agent 保守出售一份采得灵草并采用服务器总价', () => {
    expect(planShopTradeIntent(shopContext)).toMatchObject({
      type: 'trade',
      targetActorId: 'merchant',
      params: {
        offeredItemId: 'spirit_herb',
        offeredQty: 1,
        requestedItemId: 'spirit_stone',
        requestedQty: 4,
      },
    });
  });

  it('LLM 不能虚构商店物品或价格，只会绑定观察中的报价', () => {
    expect(
      parseProposal(
        '{"type":"trade","targetActorId":"merchant","offeredItemId":"spirit_herb","requestedItemId":"spirit_stone"}',
        shopContext,
      ),
    ).toMatchObject({ params: { offeredQty: 1, requestedQty: 4 } });
    expect(
      parseProposal(
        '{"type":"trade","targetActorId":"merchant","offeredItemId":"qi_pill","requestedItemId":"spirit_stone"}',
        shopContext,
      ),
    ).toBeNull();
  });
});

describe('parseProposal', () => {
  it('失能者即使模型给出合法动作也不会生成提案或兜底动作', () => {
    const incapacitated = {
      ...baseCtx,
      self: { ...baseCtx.self, health: 0 },
    } satisfies AgentContext;
    expect(parseProposal('{"type":"cultivate","reason":"继续运功"}', incapacitated)).toBeNull();
    expect(parseProposal('invalid output', incapacitated)).toBeNull();
  });

  it('合法 cultivate（无目标）', () => {
    const p = parseProposal('{"type":"cultivate","reason":"稳固根基"}', baseCtx);
    expect(p?.type).toBe('cultivate');
    expect(p?.source).toBe('agent');
    expect(p?.intent).toBe('稳固根基');
    expect(p?.locationId).toBe('mountain_gate');
  });

  it('LLM 只能选择观察中明示且真实拥有的修炼模式', () => {
    const stocked = {
      ...baseCtx,
      cultivationModes: ['ambient', 'qi_pill'] as AgentContext['cultivationModes'],
      self: {
        ...baseCtx.self,
        inventory: [{ itemId: 'qi_pill', qty: 1 }],
      },
    } satisfies AgentContext;
    expect(
      parseProposal(
        '{"type":"cultivate","params":{"cultivationMode":"qi_pill"}}',
        stocked,
      ),
    ).toMatchObject({ type: 'cultivate', params: { cultivationMode: 'qi_pill' } });
    expect(
      parseProposal(
        '{"type":"cultivate","params":{"cultivationMode":"spirit_stone"}}',
        stocked,
      ),
    ).toMatchObject({ type: 'cultivate' });
    expect(
      parseProposal(
        '{"type":"cultivate","params":{"cultivationMode":"spirit_stone"}}',
        stocked,
      )?.params,
    ).toBeUndefined();
  });

  it('Utility 只在高灵气且至少 12 灵石时自动消耗，永不自动吃聚气丹', () => {
    const proposal = {
      type: 'cultivate' as const,
      intent: '按日程吐纳',
      source: 'agent' as const,
    };
    expect(
      applyAgentCultivationMode(proposal, {
        ...baseCtx,
        currentLocationSpiritualEnergy: 5,
        self: {
          ...baseCtx.self,
          inventory: [
            { itemId: 'spirit_stone', qty: 12 },
            { itemId: 'qi_pill', qty: 20 },
          ],
        },
      }).params,
    ).toEqual({ cultivationMode: 'spirit_stone' });
    expect(
      applyAgentCultivationMode(proposal, {
        ...baseCtx,
        currentLocationSpiritualEnergy: 4,
        self: { ...baseCtx.self, inventory: [{ itemId: 'qi_pill', qty: 20 }] },
      }).params,
    ).toEqual({ cultivationMode: 'ambient' });
  });

  it('只接受库存中真实存在的治疗丹药作为 use_item', () => {
    const injured = {
      ...baseCtx,
      self: { ...baseCtx.self, health: 5 },
      availableActions: ['cultivate', 'use_item'] as AgentContext['availableActions'],
    };
    expect(
      parseProposal('{"type":"use_item","params":{"itemId":"healing_pill"}}', injured),
    ).toEqual({
      type: 'use_item',
      intent: '依心而行',
      source: 'agent',
      params: { itemId: 'healing_pill' },
    });
    expect(parseProposal('{"type":"use_item"}', injured)?.type).toBe('cultivate');
    expect(
      parseProposal('{"type":"use_item","params":{"itemId":"qi_pill"}}', {
        ...injured,
        self: { ...injured.self, inventory: [{ itemId: 'qi_pill', qty: 1 }] },
      })?.type,
    ).toBe('cultivate');
  });

  it('修为已足且动作实时可用时，Agent 可以明确选择突破', () => {
    const readyCtx: AgentContext = {
      ...baseCtx,
      self: {
        ...baseCtx.self,
        realmStage: 9,
        cultivationXp: 999,
      },
      availableActions: ['cultivate', 'breakthrough'],
      readyToBreakthrough: true,
    };
    expect(
      parseProposal('{"type":"breakthrough","reason":"根基已固，尝试破境"}', readyCtx),
    ).toMatchObject({
      type: 'breakthrough',
      locationId: 'mountain_gate',
      intent: '根基已固，尝试破境',
    });
  });

  it('实时动作列表未放行突破时，模型输出突破会安全兜底', () => {
    expect(parseProposal('{"type":"breakthrough"}', baseCtx)?.type).toBe('cultivate');
  });

  it('突破是唯一动作时，非法模型输出不会自动触发高风险突破', () => {
    const onlyBreakthrough: AgentContext = {
      ...baseCtx,
      availableActions: ['breakthrough'],
      readyToBreakthrough: true,
    };
    expect(parseProposal('invalid output', onlyBreakthrough)).toBeNull();
  });

  it('合法 talk（目标可见）', () => {
    const p = parseProposal(
      '{"type":"talk","targetActorId":"merchant","reason":"打听消息"}',
      baseCtx,
    );
    expect(p?.type).toBe('talk');
    expect(p?.targetActorId).toBe('merchant');
  });

  it('只接受观察中 offered 委托的精确 requestId 与 issuer', () => {
    const context: AgentContext = {
      ...baseCtx,
      availableActions: ['accept_request', 'decline_request'],
      others: [{ actorId: 'elder', name: '长老', realm: 'foundation_building', relationship: 5 }],
      activeRequests: [
        {
          requestId: 'req-offered',
          status: 'offered',
          type: 'collect_item',
          issuerActorId: 'elder',
          summary: '采一株灵草',
        },
      ],
    };
    expect(
      parseProposal(
        '{"type":"accept_request","targetActorId":"elder","params":{"requestId":"req-offered"},"reason":"愿意相助"}',
        context,
      ),
    ).toMatchObject({
      type: 'accept_request',
      targetActorId: 'elder',
      params: { requestId: 'req-offered' },
    });
    expect(
      parseProposal(
        '{"type":"accept_request","targetActorId":"elder","params":{"requestId":"invented"}}',
        context,
      ),
    ).toBeNull();
  });

  it('目标不可见 → 兜底', () => {
    const p = parseProposal('{"type":"spar","targetActorId":"ghost"}', baseCtx);
    expect(p?.type).toBe('cultivate');
  });

  it('不可用/未知动作 → 兜底', () => {
    expect(parseProposal('{"type":"fly"}', baseCtx)?.type).toBe('cultivate');
    // explore 不在山门可用动作里
    expect(parseProposal('{"type":"explore"}', baseCtx)?.type).toBe('cultivate');
  });

  it('gift 自动补自己的物品', () => {
    const p = parseProposal('{"type":"gift","targetActorId":"elder_li","reason":"答谢"}', baseCtx);
    expect(p?.type).toBe('gift');
    expect(p?.params).toEqual({ itemId: 'healing_pill' });
  });

  it('gift 但无物品 → 兜底', () => {
    const noItem = { ...baseCtx, self: { ...baseCtx.self, inventory: [] } };
    expect(parseProposal('{"type":"gift","targetActorId":"elder_li"}', noItem)?.type).toBe(
      'cultivate',
    );
  });

  it('非 JSON → 兜底', () => {
    expect(parseProposal('我想修炼一会儿。', baseCtx)?.type).toBe('cultivate');
  });

  it('带 ```json 围栏也能解析', () => {
    const p = parseProposal('```json\n{"type":"talk","targetActorId":"merchant"}\n```', baseCtx);
    expect(p?.type).toBe('talk');
    expect(p?.targetActorId).toBe('merchant');
  });

  it('trade 缺物品 / steal 缺物品 → 兜底', () => {
    const tradeCtx = {
      ...baseCtx,
      availableActions: ['cultivate', 'trade'] as AgentContext['availableActions'],
    };
    expect(parseProposal('{"type":"trade","targetActorId":"merchant"}', tradeCtx)?.type).toBe(
      'cultivate',
    );
    const stealCtx = {
      ...baseCtx,
      availableActions: ['cultivate', 'steal'] as AgentContext['availableActions'],
    };
    expect(parseProposal('{"type":"steal","targetActorId":"merchant"}', stealCtx)?.type).toBe(
      'cultivate',
    );
  });

  it('兜底在无 cultivate 的地点退到 explore', () => {
    const p = parseProposal('garbage', secretCtx);
    expect(p?.type).toBe('explore');
  });

  it('合法 travel 到已知地点（M7）', () => {
    const ctx = { ...baseCtx, knownLocations: KNOWN };
    const p = parseProposal('{"type":"travel","targetId":"market","reason":"去坊市交易"}', ctx);
    expect(p).toMatchObject({ type: 'travel', targetId: 'market' });
  });

  it('travel 到当前地点 / 未知地点 → 兜底', () => {
    const ctx = { ...baseCtx, knownLocations: KNOWN };
    expect(parseProposal('{"type":"travel","targetId":"mountain_gate"}', ctx)?.type).toBe(
      'cultivate',
    );
    expect(parseProposal('{"type":"travel","targetId":"penglai"}', ctx)?.type).toBe('cultivate');
  });

  it('只接受观察中可预约的真实资源点', () => {
    const gatherCtx: AgentContext = {
      ...secretCtx,
      availableActions: ['gather', 'explore'],
      resourceNodes: [
        {
          resourceNodeId: 'dew_patch',
          name: '凝露草丛',
          itemId: 'spirit_herb',
          stock: 2,
          available: 1,
        },
      ],
    };
    expect(
      parseProposal(
        '{"type":"gather","params":{"resourceNodeId":"dew_patch"}}',
        gatherCtx,
      ),
    ).toMatchObject({ type: 'gather', params: { resourceNodeId: 'dew_patch' } });
    expect(
      parseProposal(
        '{"type":"gather","params":{"resourceNodeId":"invented_patch"}}',
        gatherCtx,
      )?.type,
    ).toBe('explore');
  });
});

describe('planSelfCareIntent', () => {
  const injured = (health: number, inventory = baseCtx.self.inventory): AgentContext => ({
    ...baseCtx,
    self: { ...baseCtx.self, health, inventory },
    availableActions: ['cultivate', 'use_item'],
  });

  it('气血不高于一半且有疗伤丹时，先做确定性自救', () => {
    expect(planSelfCareIntent(injured(5))).toEqual({
      type: 'use_item',
      params: { itemId: 'healing_pill' },
      intent: '伤势已重，先服用疗伤丹稳定气血',
      source: 'agent',
    });
  });

  it('轻伤、失能、无药或 capability 未放行时不会自动耗药', () => {
    expect(planSelfCareIntent(injured(6))).toBeNull();
    expect(planSelfCareIntent(injured(0))).toBeNull();
    expect(planSelfCareIntent(injured(5, []))).toBeNull();
    expect(
      planSelfCareIntent({ ...injured(5), availableActions: ['cultivate'] }),
    ).toBeNull();
  });

  it('只把目录认定的治疗丹药视为自救资源', () => {
    expect(ownedHealingItemId({ inventory: [{ itemId: 'qi_pill', qty: 2 }] })).toBeNull();
    expect(ownedHealingItemId(baseCtx.self)).toBe('healing_pill');
  });
});

describe('planGatherIntent', () => {
  const gatherCtx = (available: number, owned = 0): AgentContext => ({
    ...secretCtx,
    self: {
      ...secretCtx.self,
      inventory: owned > 0 ? [{ itemId: 'spirit_herb', qty: owned }] : [],
    },
    availableActions: ['gather', 'explore'],
    resourceNodes: [
      {
        resourceNodeId: 'dew_patch',
        name: '凝露草丛',
        itemId: 'spirit_herb',
        stock: 2,
        available,
      },
    ],
  });

  it('缺少该物品时选择可预约节点，不直接修改库存', () => {
    expect(planGatherIntent(gatherCtx(1))).toMatchObject({
      type: 'gather',
      params: { resourceNodeId: 'dew_patch' },
    });
  });

  it('节点已被预约、已有一份或 capability 未放行时不采集', () => {
    expect(planGatherIntent(gatherCtx(0))).toBeNull();
    expect(planGatherIntent(gatherCtx(1, 1))).toBeNull();
    expect(planGatherIntent({ ...gatherCtx(1), availableActions: ['explore'] })).toBeNull();
  });
});

describe('planRestIntent', () => {
  const restLocation = {
    locationId: 'rest_clearing',
    name: '松风歇脚地',
    allowedActions: ['rest'],
  };

  it('疲劳达 60 时先前往已知休息地', () => {
    expect(
      planRestIntent({
        ...baseCtx,
        self: { ...baseCtx.self, fatigue: 60 },
        knownLocations: [...KNOWN, restLocation],
      }),
    ).toMatchObject({ type: 'travel', targetId: 'rest_clearing' });
  });

  it('已在休息地时提交 rest，低疲劳或失能时不提交', () => {
    const here: AgentContext = {
      ...baseCtx,
      self: {
        ...baseCtx.self,
        currentLocationId: 'rest_clearing',
        fatigue: 80,
      },
      availableActions: ['rest'],
      knownLocations: [...KNOWN, restLocation],
    };
    expect(planRestIntent(here)).toMatchObject({ type: 'rest', locationId: 'rest_clearing' });
    expect(planRestIntent({ ...here, self: { ...here.self, fatigue: 59 } })).toBeNull();
    expect(planRestIntent({ ...here, self: { ...here.self, health: 0 } })).toBeNull();
  });

  it('多个休息地并存时优先原地休息，不按 ID 离开合法休息区', () => {
    const here: AgentContext = {
      ...baseCtx,
      self: {
        ...baseCtx.self,
        currentLocationId: 'rest_clearing',
        fatigue: 80,
      },
      availableActions: ['rest'],
      knownLocations: [
        { locationId: 'request_hall', name: '委托堂', allowedActions: ['talk', 'rest'] },
        restLocation,
      ],
    };
    expect(planRestIntent(here)).toMatchObject({
      type: 'rest',
      locationId: 'rest_clearing',
    });
  });
});

describe('valley movement decision', () => {
  const valleyCtx: AgentContext = {
    ...baseCtx,
    self: {
      ...baseCtx.self,
      actorId: 'qinglan_valley_gate:resting_disciple',
      currentLocationId: 'rest_clearing',
    },
    currentLocationName: '松风歇脚地',
    currentTile: { x: 11, y: 10 },
    movementPointRadius: 12,
    knownLocations: [
      { locationId: 'rest_clearing', name: '松风歇脚地', allowedActions: ['cultivate'] },
      { locationId: 'creek_bridge', name: '听泉木桥', allowedActions: ['explore'] },
      { locationId: 'herb_meadow', name: '凝露药草坡', allowedActions: ['explore'] },
    ],
    knownInteractions: [
      { interactionId: 'bridge_inscription', name: '桥栏刻字', locationId: 'creek_bridge' },
    ],
  };

  it('renders compact observations and requires the first probe to move', () => {
    const prompt = buildValleyMovementMessages(valleyCtx, { requireMove: true });
    expect(prompt.system).toContain('必须从“可选择的其他地点”中自主选择一个 location');
    expect(prompt.user).toContain('听泉木桥');
    expect(prompt.user).toContain('距离当前格不超过 12 格');
    expect(prompt.user).not.toContain('cellMask');
    expect(prompt.system.length + prompt.user.length).toBeLessThan(2_000);
  });

  it('accepts a model-selected semantic target and records llm provenance', () => {
    const decision = parseValleyMovementDecision(
      '{"decision":"move","target":{"kind":"location","locationId":"creek_bridge"},"reason":"去桥边看看"}',
      valleyCtx,
      { requireMove: true },
    );
    expect(decision).toMatchObject({
      kind: 'move',
      proposal: {
        type: 'travel',
        targetId: 'creek_bridge',
        params: {
          movementTarget: { kind: 'location', locationId: 'creek_bridge' },
          decisionSource: 'llm',
        },
      },
    });
    if (decision?.kind !== 'move') throw new Error('expected a move decision');
    expect(decision.proposal.params).toEqual({
      movementTarget: { kind: 'location', locationId: 'creek_bridge' },
      decisionSource: 'llm',
    });
    expect(decision.proposal).not.toHaveProperty('acceptedTile');
    expect(decision.proposal).not.toHaveProperty('path');
    expect(decision.proposal).not.toHaveProperty('velocity');
  });

  it('失能溪谷角色不接受模型移动，也不进入事件/Utility 移动计划', () => {
    const incapacitated = {
      ...valleyCtx,
      self: { ...valleyCtx.self, health: 0 },
      valleyRuntime: {
        hasMovementHistory: false,
        activeCommand: false,
        fatigue: 90,
        herbNeed: 90,
        recentEventTypes: ['player_entered_valley'],
      },
    } satisfies AgentContext;
    expect(
      parseValleyMovementDecision(
        '{"decision":"move","target":{"kind":"location","locationId":"creek_bridge"}}',
        incapacitated,
      ),
    ).toBeNull();
    expect(planValleyAutonomy(incapacitated, 100)).toEqual({
      kind: 'skip',
      reason: 'actor_incapacitated',
    });
  });

  it('accepts wait after the probe but rejects it during the required first move', () => {
    expect(
      parseValleyMovementDecision('{"decision":"wait","reason":"继续歇息"}', valleyCtx),
    ).toEqual({ kind: 'wait', reason: '继续歇息' });
    expect(
      parseValleyMovementDecision('{"decision":"wait","reason":"继续歇息"}', valleyCtx, {
        requireMove: true,
      }),
    ).toBeNull();
    expect(
      parseValleyMovementDecision(
        '{"decision":"move","target":{"kind":"point","tile":{"x":12,"y":9}},"reason":"走近看看"}',
        valleyCtx,
        { requireMove: true },
      ),
    ).toBeNull();
  });

  it('rejects unknown targets and point targets outside the local radius', () => {
    expect(
      parseValleyMovementDecision(
        '{"decision":"move","target":{"kind":"location","locationId":"unknown"}}',
        valleyCtx,
      ),
    ).toBeNull();
    expect(
      parseValleyMovementDecision(
        '{"decision":"move","target":{"kind":"point","tile":{"x":40,"y":30}}}',
        valleyCtx,
      ),
    ).toBeNull();
    expect(
      parseValleyMovementDecision(
        '{"decision":"move","target":{"kind":"point","tile":{"x":16,"y":12}}}',
        valleyCtx,
      ),
    ).toMatchObject({
      kind: 'move',
      proposal: { params: { movementTarget: { kind: 'point', tile: { x: 16, y: 12 } } } },
    });
  });

  it('keeps the guide event-driven and the herb gatherer need-driven', () => {
    const guide = {
      ...valleyCtx,
      self: {
        ...valleyCtx.self,
        actorId: 'qinglan_valley_gate:valley_guide',
        currentLocationId: 'valley_west_entry',
      },
      valleyRuntime: {
        hasMovementHistory: false,
        activeCommand: false,
        recentEventTypes: ['player_entered_valley'],
      },
    } satisfies AgentContext;
    expect(planValleyAutonomy(guide, 100)).toMatchObject({
      kind: 'act',
      proposal: { targetId: 'creek_bridge', params: { decisionSource: 'event' } },
    });
    expect(
      planValleyAutonomy(
        {
          ...guide,
          valleyRuntime: { ...guide.valleyRuntime, recentEventTypes: [] },
        },
        100,
      ),
    ).toEqual({ kind: 'skip', reason: 'awaiting_player_event' });

    const gatherer = {
      ...valleyCtx,
      self: {
        ...valleyCtx.self,
        actorId: 'qinglan_valley_gate:herb_gatherer',
        currentLocationId: 'herb_meadow',
      },
      valleyRuntime: {
        hasMovementHistory: false,
        activeCommand: false,
        fatigue: 80,
        herbNeed: 70,
        recentEventTypes: [],
      },
    } satisfies AgentContext;
    expect(planValleyAutonomy(gatherer, 100)).toMatchObject({
      kind: 'act',
      proposal: {
        targetId: 'rest_clearing',
        params: {
          decisionSource: 'utility',
          movementTarget: {
            kind: 'interactable',
            interactionId: 'rest_campfire',
          },
        },
      },
    });

    const restedGatherer = {
      ...gatherer,
      self: {
        ...gatherer.self,
        currentLocationId: 'rest_clearing',
      },
      valleyRuntime: {
        ...gatherer.valleyRuntime,
        hasMovementHistory: true,
        fatigue: 40,
        herbNeed: 70,
      },
    } satisfies AgentContext;
    expect(planValleyAutonomy(restedGatherer, 100)).toMatchObject({
      kind: 'act',
      proposal: {
        targetId: 'herb_meadow',
        params: {
          decisionSource: 'utility',
          movementTarget: {
            kind: 'interactable',
            interactionId: 'dew_herb_patch',
          },
        },
      },
    });
  });

  it('does not issue a new goal while moving or during post-arrival dwell', () => {
    const moving = {
      ...valleyCtx,
      valleyRuntime: {
        hasMovementHistory: true,
        activeCommand: true,
        recentEventTypes: [],
      },
    } satisfies AgentContext;
    expect(planValleyAutonomy(moving, 100)).toEqual({
      kind: 'skip',
      reason: 'movement_active',
    });
    expect(
      planValleyAutonomy(
        {
          ...moving,
          valleyRuntime: { ...moving.valleyRuntime, activeCommand: false, nextActionAt: 200 },
        },
        100,
      ),
    ).toEqual({ kind: 'skip', reason: 'action_dwell' });
    expect(
      planValleyAutonomy(
        {
          ...moving,
          valleyRuntime: { ...moving.valleyRuntime, activeCommand: false, nextActionAt: 200 },
        },
        200,
      ),
    ).toEqual({ kind: 'llm', requireMove: false });
  });
});

describe('inspect proposal parsing', () => {
  const inspectCtx: AgentContext = {
    ...baseCtx,
    self: {
      ...baseCtx.self,
      actorId: 'qinglan_valley_gate:resting_disciple',
      currentLocationId: 'creek_bridge',
    },
    availableActions: ['inspect'],
    knownInteractions: [
      {
        interactionId: 'bridge_inscription',
        name: '桥栏刻字',
        locationId: 'creek_bridge',
        actions: ['inspect'],
      },
      {
        interactionId: 'sealed_shrine_door',
        name: '古祠封印',
        locationId: 'sealed_shrine',
        actions: ['inspect'],
      },
    ],
  };

  it('only accepts an inspectable interaction at the current semantic location', () => {
    expect(
      parseProposal(
        '{"type":"inspect","params":{"interactionId":"bridge_inscription"},"reason":"查看桥栏刻字"}',
        inspectCtx,
      ),
    ).toMatchObject({
      type: 'inspect',
      locationId: 'creek_bridge',
      params: { interactionId: 'bridge_inscription' },
    });
    expect(
      parseProposal(
        '{"type":"inspect","params":{"interactionId":"sealed_shrine_door"}}',
        inspectCtx,
      ),
    ).toBeNull();
    expect(
      parseProposal(
        '{"type":"inspect","params":{"interactionId":"invented_relic"}}',
        inspectCtx,
      ),
    ).toBeNull();
  });
});

describe('planStrategicIntent（M7 点亮：为目标主动 travel/取物）', () => {
  const withQuests = (
    reqs: NonNullable<AgentContext['activeRequests']>,
    over: Partial<AgentContext> = {},
  ): AgentContext => ({ ...baseCtx, knownLocations: KNOWN, activeRequests: reqs, ...over });

  it('采集委托缺物 + 不在可采集地 → 前往真实采集地', () => {
    const p = planStrategicIntent(
      withQuests([{ type: 'collect_item', itemId: 'spirit_herb', qty: 1, summary: '采灵草' }]),
    );
    expect(p).toMatchObject({ type: 'travel', targetId: 'secret_realm_gate' });
  });

  it('失能者即使身负委托也不产生 travel 或 gather', () => {
    const p = planStrategicIntent(
      withQuests([{ type: 'collect_item', itemId: 'spirit_herb', qty: 1, summary: '采灵草' }], {
        self: { ...baseCtx.self, health: 0 },
      }),
    );
    expect(p).toBeNull();
  });

  it('采集委托缺物 + 已在可采集地 → 预约真实节点', () => {
    const p = planStrategicIntent(
      withQuests([{ type: 'collect_item', itemId: 'spirit_herb', qty: 1, summary: '采灵草' }], {
        self: { ...baseCtx.self, currentLocationId: 'secret_realm_gate' },
        availableActions: ['gather', 'explore', 'steal'],
        resourceNodes: [
          {
            resourceNodeId: 'dew_patch',
            name: '凝露草丛',
            itemId: 'spirit_herb',
            stock: 1,
            available: 1,
          },
        ],
      }),
    );
    expect(p).toMatchObject({ type: 'gather', params: { resourceNodeId: 'dew_patch' } });
  });

  it('采集委托已持有 → 无策略动作（tick 只标记 ready，不结算）', () => {
    const p = planStrategicIntent(
      withQuests([{ type: 'collect_item', itemId: 'spirit_herb', qty: 1, summary: '采灵草' }], {
        self: { ...baseCtx.self, inventory: [{ itemId: 'spirit_herb', qty: 1 }] },
      }),
    );
    expect(p).toBeNull();
  });

  it('ready 委托会先返回发起者，近身后用统一 turn_in_request 交付', () => {
    const request = {
      requestId: 'req-ready',
      status: 'ready_to_turn_in' as const,
      type: 'collect_item',
      itemId: 'spirit_herb',
      qty: 1,
      issuerActorId: 'elder',
      issuerLocationId: 'secret_realm_gate',
      summary: '交一株灵草',
    };
    expect(planStrategicIntent(withQuests([request]))).toMatchObject({
      type: 'travel',
      targetId: 'secret_realm_gate',
    });
    expect(
      planStrategicIntent(
        withQuests([request], {
          self: { ...baseCtx.self, currentLocationId: 'secret_realm_gate' },
          others: [{ actorId: 'elder', name: '长老', realm: 'foundation_building', relationship: 5 }],
          availableActions: ['turn_in_request'],
        }),
      ),
    ).toMatchObject({
      type: 'turn_in_request',
      targetActorId: 'elder',
      params: { requestId: 'req-ready' },
    });
  });

  it('offered 委托不由战略 Utility 自动接受或拒绝', () => {
    expect(
      planStrategicIntent(
        withQuests([
          {
            requestId: 'req-offer',
            status: 'offered',
            type: 'collect_item',
            issuerActorId: 'elder',
            summary: '采灵草',
          },
        ]),
      ),
    ).toBeNull();
  });

  it('探索委托 + 不在目标地 → 前往目标地', () => {
    const p = planStrategicIntent(
      withQuests([
        { type: 'explore_location', locationId: 'secret_realm_gate', summary: '去秘境查看' },
      ]),
    );
    expect(p).toMatchObject({ type: 'travel', targetId: 'secret_realm_gate' });
  });

  it('无委托 → null（交给 LLM 在本地动作里选）', () => {
    expect(
      planStrategicIntent({ ...baseCtx, knownLocations: KNOWN, activeRequests: [] }),
    ).toBeNull();
  });
});
