import { itemName } from './xianxia/items';

export type GodotBubbleKind = 'dialogue' | 'reaction' | 'narration' | 'warning';

export type GodotPresentationInput = {
  actionType?: string;
  eventType?: string;
  resultCode?: string;
  status?: string;
  summary: string;
  effects?: unknown;
};

export type GodotPresentationPolishMode = 'rule_template' | 'llm_polish';

export type GodotPresentationPolishPreviewInput = GodotPresentationInput & {
  mode?: string;
  candidate?: unknown;
};

export type GodotTraceChainInput = {
  source: 'action' | 'action_record' | 'event' | 'replay_action' | 'replay_event' | 'tick';
  actionType?: string;
  worldEventId?: string;
  actionRecordId?: string;
  resultCode?: string;
  tickOnly?: boolean;
};

export function godotEventPresentation(input: GodotPresentationInput) {
  const resultCode = input.resultCode ?? '';
  const actionType = input.actionType ?? actionTypeFromEvent(input.eventType ?? '');
  const warning = input.status === 'rejected' || isRejectedCode(resultCode);
  const normalized = { ...input, actionType, resultCode, warning };
  const bubbleKind: GodotBubbleKind = warning
    ? 'warning'
    : actionType === 'talk' || actionType === 'request_teaching'
      ? 'dialogue'
      : actionType === 'arrive' || actionType === 'explore'
        ? 'narration'
        : 'reaction';

  return {
    bubbleKind,
    bubbleText: bubbleTextFor(normalized),
    displayText: displayTextFor(normalized),
    durableSummary: input.summary,
    presentationSource: 'rule_template',
    presentationVersion: 1,
    presentationPolicy: {
      durableSummaryLocked: true,
      llmMayPolishDisplayText: true,
      llmMayChangeFacts: false,
      llmMayChangeDurableState: false,
    },
    settlementPreview: godotSettlementPreview(input.effects),
  };
}

export function godotSettlementPreview(effects: unknown) {
  const source = objectOrEmpty(effects);
  const items = Array.isArray(source.items) ? source.items : [];
  const transfers = items
    .map((item) => itemTransferPreview(item))
    .filter((item): item is NonNullable<ReturnType<typeof itemTransferPreview>> => item !== null);
  if (transfers.length === 0) return undefined;

  return {
    presentationSource: 'rule_template',
    previewOnly: false,
    durableSource: 'rules.effects.items',
    summary: transfers.map((transfer) => transfer.line).join(' | '),
    transfers,
    policy: {
      convexAuthored: true,
      godotMayDisplayOnly: true,
      durableStateAlreadyResolved: true,
      durableSummaryLocked: true,
    },
  };
}

function itemTransferPreview(value: unknown) {
  const transfer = objectOrEmpty(value);
  const itemId = typeof transfer.itemId === 'string' ? transfer.itemId : '';
  const qty = typeof transfer.qty === 'number' ? transfer.qty : 0;
  if (itemId === '' || qty <= 0) return null;
  const from = typeof transfer.from === 'string' ? transfer.from : undefined;
  const to = typeof transfer.to === 'string' ? transfer.to : undefined;
  const itemLabel = itemName(itemId);
  const direction =
    from && to
      ? `${actorLabel(from)} -> ${actorLabel(to)}`
      : from
        ? `${actorLabel(from)} -${qty}`
        : to
          ? `${actorLabel(to)} +${qty}`
          : 'inventory';
  return {
    from,
    to,
    itemId,
    itemName: itemLabel,
    qty,
    line: `${direction}: ${itemLabel} x${qty}`,
  };
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function actorLabel(actorId: string) {
  return actorId === 'godot_player' || actorId.startsWith('godot_smoke_') ? 'You' : actorId;
}

export function godotPresentationPolishPreview(input: GodotPresentationPolishPreviewInput) {
  const requestedMode: GodotPresentationPolishMode =
    input.mode === 'llm_polish' ? 'llm_polish' : 'rule_template';
  const basePresentation = godotEventPresentation(input);
  const llmRequested = requestedMode === 'llm_polish';
  const durableSummaryHash = stablePresentationHash(basePresentation.durableSummary);
  const allowedBubbleKinds: GodotBubbleKind[] = ['dialogue', 'reaction', 'narration', 'warning'];
  const candidateValidation = validatePolishCandidate(
    input.candidate,
    allowedBubbleKinds,
    42,
    140,
  );
  const candidateOutput = candidateValidation.accepted ? candidateValidation.output : {};
  const useCandidate = llmRequested && candidateValidation.accepted;
  return {
    adapter: 'godot_safe_polish_v1',
    requestedMode,
    status: llmRequested
      ? candidateValidation.provided
        ? candidateValidation.accepted
          ? 'candidate_preview_ready'
          : 'candidate_rejected'
        : 'llm_not_configured'
      : 'rule_template_ready',
    applied: false,
    durableSummary: basePresentation.durableSummary,
    candidateBubbleText: useCandidate && candidateOutput.bubbleText
      ? candidateOutput.bubbleText
      : basePresentation.bubbleText,
    candidateDisplayText: useCandidate && candidateOutput.displayText
      ? candidateOutput.displayText
      : basePresentation.displayText,
    candidateBubbleKind: useCandidate && candidateOutput.bubbleKind
      ? candidateOutput.bubbleKind
      : basePresentation.bubbleKind,
    candidateSource: useCandidate ? 'llm_candidate_preview' : basePresentation.presentationSource,
    presentationVersion: basePresentation.presentationVersion,
    presentationPolicy: basePresentation.presentationPolicy,
    inputSnapshot: {
      actionType: input.actionType,
      eventType: input.eventType,
      resultCode: input.resultCode,
      status: input.status,
      durableSummary: basePresentation.durableSummary,
      durableSummaryHash,
    },
    allowedOutputFields: ['bubbleText', 'displayText', 'bubbleKind'] as const,
    lockedFields: [
      'durableSummary',
      'durableSummaryHash',
      'actionType',
      'eventType',
      'resultCode',
      'worldEventId',
      'actionRecordId',
      'worldState',
    ] as const,
    forbiddenEffects: [
      'write_worldEvents',
      'write_actionRecords',
      'write_relationships',
      'write_memories',
      'change_rule_result',
      'create_facts',
    ] as const,
    guardrails: [
      {
        id: 'durable_summary_locked',
        enforced: true,
        description: 'LLM polish must preserve the rule-produced durable summary exactly.',
      },
      {
        id: 'presentation_only',
        enforced: true,
        description: 'Only bubbleText, displayText, and bubbleKind may be proposed.',
      },
      {
        id: 'no_durable_writes',
        enforced: true,
        description: 'The preview path never writes worldEvents, actionRecords, relationships, or memories.',
      },
      {
        id: 'no_new_facts',
        enforced: true,
        description: 'Polish may not add actors, items, locations, outcomes, or state changes.',
      },
    ],
    validation: {
      previewOnly: true,
      writesDurableState: false,
      factsLocked: true,
      durableSummaryHash,
      allowedBubbleKinds,
      maxBubbleTextChars: 42,
      maxDisplayTextChars: 140,
      candidateBubbleTextWithinLimit: (
        useCandidate && candidateOutput.bubbleText
          ? candidateOutput.bubbleText
          : basePresentation.bubbleText
      ).length <= 42,
      candidateDisplayTextWithinLimit: (
        useCandidate && candidateOutput.displayText
          ? candidateOutput.displayText
          : basePresentation.displayText
      ).length <= 140,
      candidateBubbleKindAllowed: allowedBubbleKinds.includes(
        useCandidate && candidateOutput.bubbleKind
          ? candidateOutput.bubbleKind
          : basePresentation.bubbleKind,
      ),
    },
    candidateValidation,
    factsLocked: true,
    notes: llmRequested
      ? 'LLM polish is preview-only; candidate text may only alter display fields after validation.'
      : 'Rule-template presentation is available without changing durable facts.',
  };
}

function validatePolishCandidate(
  candidate: unknown,
  allowedBubbleKinds: GodotBubbleKind[],
  maxBubbleTextChars: number,
  maxDisplayTextChars: number,
) {
  const allowedFields = ['bubbleText', 'displayText', 'bubbleKind'] as const;
  const output: {
    bubbleText?: string;
    displayText?: string;
    bubbleKind?: GodotBubbleKind;
  } = {};
  if (candidate === undefined || candidate === null) {
    return {
      provided: false,
      accepted: false,
      allowedFields,
      disallowedFields: [] as string[],
      rejectedReasons: [] as string[],
      output,
    };
  }
  const source = objectOrEmpty(candidate);
  const keys = Object.keys(source);
  const disallowedFields = keys.filter((key) => !allowedFields.includes(key as (typeof allowedFields)[number]));
  const rejectedReasons: string[] = [];
  if (disallowedFields.length > 0) {
    rejectedReasons.push(`disallowed_fields:${disallowedFields.join(',')}`);
  }

  if ('bubbleText' in source) {
    if (typeof source.bubbleText !== 'string' || source.bubbleText.length === 0) {
      rejectedReasons.push('bubbleText_must_be_nonempty_string');
    } else if (source.bubbleText.length > maxBubbleTextChars) {
      rejectedReasons.push('bubbleText_too_long');
    } else {
      output.bubbleText = source.bubbleText;
    }
  }
  if ('displayText' in source) {
    if (typeof source.displayText !== 'string' || source.displayText.length === 0) {
      rejectedReasons.push('displayText_must_be_nonempty_string');
    } else if (source.displayText.length > maxDisplayTextChars) {
      rejectedReasons.push('displayText_too_long');
    } else {
      output.displayText = source.displayText;
    }
  }
  if ('bubbleKind' in source) {
    if (typeof source.bubbleKind !== 'string' || !allowedBubbleKinds.includes(source.bubbleKind as GodotBubbleKind)) {
      rejectedReasons.push('bubbleKind_not_allowed');
    } else {
      output.bubbleKind = source.bubbleKind as GodotBubbleKind;
    }
  }
  if (Object.keys(output).length === 0) {
    rejectedReasons.push('no_allowed_output_fields');
  }

  return {
    provided: true,
    accepted: rejectedReasons.length === 0,
    allowedFields,
    disallowedFields,
    rejectedReasons,
    output,
  };
}

function stablePresentationHash(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function godotTraceChain(input: GodotTraceChainInput) {
  const tickOnly = input.tickOnly === true;
  const hasWorldEvent = !!input.worldEventId;
  const hasActionRecord = !!input.actionRecordId;
  const linkStatus = tickOnly
    ? 'tick_only'
    : hasWorldEvent && hasActionRecord
      ? 'action_record_linked'
      : hasWorldEvent
        ? 'event_only'
        : hasActionRecord
          ? 'action_record_only'
          : 'unlinked';
  return {
    source: input.source,
    actionType: input.actionType,
    worldEventId: input.worldEventId,
    actionRecordId: input.actionRecordId,
    resultCode: input.resultCode,
    tickOnly,
    durable: hasWorldEvent && !tickOnly,
    linkStatus,
    label: traceChainLabel(linkStatus),
    steps: traceChainSteps(input, linkStatus),
  };
}

function traceChainSteps(input: GodotTraceChainInput, linkStatus: string) {
  const steps: Array<Record<string, string | boolean | undefined>> = [];
  switch (input.source) {
    case 'action':
      steps.push({
        kind: 'semantic_action',
        label: 'semantic action',
        actionType: input.actionType,
      });
      break;
    case 'tick':
      steps.push({
        kind: input.tickOnly ? 'tick_observation' : 'agent_tick',
        label: input.tickOnly ? 'tick observation' : 'agent tick',
        actionType: input.actionType,
      });
      break;
    case 'replay_action':
    case 'replay_event':
      steps.push({
        kind: 'replay',
        label: 'replay',
        actionType: input.actionType,
      });
      break;
    case 'action_record':
      steps.push({
        kind: 'action_record_readback',
        label: 'actionRecord readback',
        actionRecordId: input.actionRecordId,
      });
      break;
    case 'event':
      steps.push({
        kind: 'region_event',
        label: 'region event',
        worldEventId: input.worldEventId,
      });
      break;
  }

  if (input.actionRecordId && input.source !== 'action_record') {
    steps.push({
      kind: 'action_record',
      label: 'actionRecord',
      actionRecordId: input.actionRecordId,
      durable: true,
    });
  }
  if (input.worldEventId && !input.tickOnly && input.source !== 'event') {
    steps.push({
      kind: 'world_event',
      label: 'worldEvent',
      worldEventId: input.worldEventId,
      durable: true,
    });
  }
  if (input.tickOnly) {
    steps.push({
      kind: 'tick_only',
      label: 'tickOnly',
      worldEventId: input.worldEventId,
      durable: false,
    });
  }
  if (steps.length === 0) {
    steps.push({
      kind: 'unlinked',
      label: traceChainLabel(linkStatus),
      durable: false,
    });
  }
  return steps;
}

function traceChainLabel(linkStatus: string) {
  switch (linkStatus) {
    case 'action_record_linked':
      return 'actionRecord -> worldEvent';
    case 'event_only':
      return 'worldEvent only';
    case 'action_record_only':
      return 'actionRecord only';
    case 'tick_only':
      return 'tickOnly observation';
    default:
      return 'unlinked observation';
  }
}

function bubbleTextFor(input: GodotPresentationInput & { warning: boolean }) {
  if (input.warning) return shortText(input.summary, 30);
  switch (input.resultCode) {
    case 'conversation_started':
      return input.summary.includes('气氛淡淡') ? '气氛淡淡。' : '聊了几句。';
    case 'talk_warm':
      return '相谈尚欢。';
    case 'talk_cold':
      return '气氛淡淡。';
    case 'teaching_granted':
      return '受教了。';
    case 'teaching_refused':
      return '被婉拒指点。';
    case 'gift_accepted':
      return '收下了这份情谊。';
    case 'gift_rejected':
      return '没有收礼。';
    case 'trade_completed':
      return '交易成交。';
    case 'trade_refused':
      return '出价未成。';
    case 'spar_draw':
      return '点到为止。';
    case 'spar_actor_win':
      return '胜了一招。';
    case 'spar_actor_lose':
      return '落了下风。';
    case 'cultivation_success':
      return '吐纳行功。';
    case 'cultivation_breakthrough_insight':
      return '忽有顿悟。';
    case 'cultivation_deviation':
      return '气息紊乱。';
    case 'breakthrough_success':
      return '突破成功！';
    case 'breakthrough_failed':
      return '冲关未成。';
    case 'breakthrough_deviation':
      return '走火入魔！';
    case 'exploration_nothing':
      return '无甚收获。';
    case 'exploration_rumor':
      return '探得传闻。';
    case 'exploration_resource':
      return '寻得机缘。';
    case 'exploration_danger':
      return '遭遇凶险。';
    case 'arrived_location':
      return '抵达此地。';
    case 'travel_started':
      return '动身前往。';
    case 'agent_skipped':
      return '静候时机。';
    default:
      return shortText(input.summary, 30);
  }
}

function displayTextFor(
  input: GodotPresentationInput & { actionType: string; resultCode: string; warning: boolean },
) {
  if (input.warning) return shortText(input.summary, 88);
  const topic = topicFromSummary(input.summary);
  switch (input.resultCode) {
    case 'conversation_started':
      return input.summary.includes('气氛淡淡')
        ? '“此事暂且记下，今日先到这里。”'
        : topic
          ? `“${shortText(topic, 24)}，倒值得细说。”`
          : '“今日坊市风声不小，坐下慢慢说。”';
    case 'talk_warm':
      return '“你这话投缘，我们接着聊。”';
    case 'talk_cold':
      return '“寒暄几句便好。”';
    case 'teaching_granted':
      return '“这一关，先稳住气息，再谈进境。”';
    case 'teaching_refused':
      return '“今日无暇，改日再问。”';
    case 'gift_accepted':
      return '“这份心意，我收下了。”';
    case 'gift_rejected':
      return '“礼便免了。”';
    case 'trade_completed':
      return '“银货两讫，慢走。”';
    case 'trade_refused':
      return '“这个价，做不成。”';
    case 'spar_draw':
      return '“点到为止，正好。”';
    case 'spar_actor_win':
      return '“承让了。”';
    case 'spar_actor_lose':
      return '“这一招我记下了。”';
    case 'cultivation_success':
      return '灵息入脉，周天渐稳。';
    case 'cultivation_breakthrough_insight':
      return '心头一线明光，似有进境。';
    case 'cultivation_deviation':
      return '气息一乱，须立刻收功。';
    case 'breakthrough_success':
      return '灵光迸现，境界轰然洞开。';
    case 'breakthrough_failed':
      return '关隘未破，只得暂且收势。';
    case 'breakthrough_deviation':
      return '灵力逆冲，险些走火入魔。';
    case 'exploration_nothing':
      return '四下探过，并无异样。';
    case 'exploration_rumor':
      return '坊间传闻，暗暗记下。';
    case 'exploration_resource':
      return '草木灵机一闪，竟有收获。';
    case 'exploration_danger':
      return '暗处生变，险象乍起。';
    case 'arrived_location':
      return '脚步落定，已到此处。';
    case 'travel_started':
      return '衣袂一振，动身前往。';
    case 'agent_skipped':
      return '按本分行事，暂不另起波澜。';
    default:
      return shortText(input.summary, 88);
  }
}

function actionTypeFromEvent(eventType: string) {
  if (eventType.includes('conversation')) return 'talk';
  if (eventType.includes('talk')) return 'talk';
  if (eventType.includes('teaching')) return 'request_teaching';
  if (eventType.includes('gift')) return 'gift';
  if (eventType.includes('trade')) return 'trade';
  if (eventType.includes('spar')) return 'spar';
  if (eventType.includes('cultivation')) return 'cultivate';
  if (eventType.includes('breakthrough')) return 'breakthrough';
  if (eventType.includes('exploration')) return 'explore';
  if (eventType.includes('arriv')) return 'arrive';
  return '';
}

function isRejectedCode(resultCode: string) {
  return [
    'actor_not_found',
    'role_not_allowed',
    'unknown_location',
    'target_required',
    'target_not_found',
    'target_not_present',
    'missing_param',
    'missing_target',
    'no_body',
    'not_implemented',
    'location_forbids_cultivate',
    'mood_too_low',
    'insufficient_cultivation',
    'relationship_too_hostile',
    'realm_gap_too_large',
    'location_forbids_explore',
    'master_not_qualified',
    'relationship_insufficient',
    'reputation_too_low',
    'item_not_owned',
    'actor_lacks_item',
    'merchant_lacks_item',
    'insufficient_funds',
    'target_lacks_item',
  ].includes(resultCode);
}

function topicFromSummary(summary: string) {
  const match = summary.match(/就「([^」]+)」/);
  return match?.[1];
}

function shortText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}...`;
}
