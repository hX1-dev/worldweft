import type { AgentContext } from './agentLogic';
import { buildAutonomyDecisionTrace } from './autonomyDecisionTraceLogic';
import { buildPurposeBoundLifeCandidateBundle } from './purposeBoundLifeCandidateLogic';
import {
  projectGratitudeDueConsequences,
  projectGrievanceCreatedConsequences,
  type GratitudeConsequenceProjectionInput,
  type GrievanceConsequenceProjectionInput,
  type SocialConsequenceProjectionFact,
} from './socialConsequenceProjectionLogic';

describe('LWSE-2a gratitude consequence future projection', () => {
  test('appears only from due until expiry and carries exact source identity', () => {
    expect(project(input({ nowGameHour: 47 })).sources).toEqual([]);
    const due = project(input({ nowGameHour: 48 }));
    expect(due.sources).toHaveLength(1);
    expect(due.sources[0]).toMatchObject({
      actorId: 'recipient',
      targetActorId: 'donor',
      kind: 'gratitude_or_repair',
      sourceRef: 'consequence:social_consequence:gratitude',
      preferredActivity: 'talk',
      socialConsequenceProjection: {
        consequenceId: 'social_consequence:gratitude',
        sourceOutcomeId: 'social_outcome:aid',
        sourceEventId: 'event:gift',
        kind: 'gratitude_due',
      },
    });
    expect(project(input({ nowGameHour: 768 })).sources).toEqual([]);
    expect(project(input({ nowGameHour: 768 })).rejections).toEqual([{
      consequenceId: 'social_consequence:gratitude',
      reasonCode: 'social_consequence_projection_expired',
    }]);
  });

  test.each([
    ['budget', { consequences: [consequence({ remainingProjectionBudget: 0 })] }, 'social_consequence_projection_budget_exhausted'],
    ['persisted expiry', { consequences: [consequence({ status: 'expired', remainingProjectionBudget: 0 })] }, 'social_consequence_projection_expired'],
    ['status', { consequences: [consequence({ status: 'cancelled' })] }, 'social_consequence_projection_source_stale'],
    ['subject', { consequences: [consequence({ subjectActorId: 'other' })] }, 'social_consequence_projection_subject_mismatch'],
    ['counterpart', { consequences: [consequence({ counterpartActorIds: ['donor', 'other'] })] }, 'social_consequence_projection_subject_mismatch'],
    ['actor busy', { actor: { ...input().actor, busy: true } }, 'social_consequence_projection_busy'],
    ['target busy', { targets: [{ ...input().targets[0], busy: true }] }, 'social_consequence_projection_busy'],
    ['target moved', { targets: [{ ...input().targets[0], locationId: 'market' }] }, 'social_consequence_projection_target_ineligible'],
    ['target incapable', { targets: [{ ...input().targets[0], aliveAndCapable: false }] }, 'social_consequence_projection_target_ineligible'],
    ['privacy', { targets: [{ ...input().targets[0], disclosureAllowed: false }] }, 'social_consequence_projection_disclosure_forbidden'],
    ['private audience', { consequences: [consequence({ audience: 'private' })] }, 'social_consequence_projection_disclosure_forbidden'],
    ['cooldown', { targets: [{ ...input().targets[0], cooldownClear: false }] }, 'social_consequence_projection_cooldown_active'],
    ['capacity', { targets: [{ ...input().targets[0], sessionCapacityAvailable: false }] }, 'social_consequence_projection_busy'],
  ] as const)('rejects %s without creating a source', (_label, patch, reasonCode) => {
    const result = project(input(patch as Partial<GratitudeConsequenceProjectionInput>));
    expect(result.sources).toEqual([]);
    expect(result.rejections[0]?.reasonCode).toBe(reasonCode);
  });

  test('only gratitude_due projects and input order cannot change the digest', () => {
    const aid = consequence({ consequenceId: 'aid', kind: 'aid_received' });
    const reliability = consequence({ consequenceId: 'reliability', kind: 'reliability_evidence' });
    const grievance = consequence({ consequenceId: 'grievance', kind: 'grievance_created' });
    const boundary = consequence({ consequenceId: 'boundary', kind: 'boundary_or_refusal' });
    const gratitude = consequence();
    const left = project(input({ consequences: [aid, reliability, grievance, boundary, gratitude] }));
    const right = project(input({ consequences: [gratitude, boundary, grievance, reliability, aid] }));
    expect(left.sources).toHaveLength(1);
    expect(right.projectionSetDigest).toBe(left.projectionSetDigest);
  });

  test('revision and budget participate in the exact source revision', () => {
    const original = project(input()).sources[0];
    const revised = project(input({ consequences: [consequence({ revision: 2 })] })).sources[0];
    expect(revised.sourceRevision).not.toBe(original.sourceRevision);
    expect(revised.socialConsequenceProjection?.projectionDigest)
      .not.toBe(original.socialConsequenceProjection?.projectionDigest);
  });

  test('purpose candidate, proposal and durable autonomy trace expose consequence lineage', () => {
    const source = project(input()).sources[0];
    const context = agentContext(source);
    const bundle = buildPurposeBoundLifeCandidateBundle(context);
    const candidate = bundle.candidates.find((entry) =>
      entry.intent.sourceRef === source.sourceRef);
    expect(candidate).toMatchObject({
      planner: 'social_warrant',
      socialConsequenceProjection: {
        consequenceId: 'social_consequence:gratitude',
        sourceOutcomeId: 'social_outcome:aid',
      },
      proposal: {
        type: 'talk',
        params: {
          socialConsequenceId: 'social_consequence:gratitude',
          socialConsequenceSourceOutcomeId: 'social_outcome:aid',
          socialConsequenceProjectionDigest:
            source.socialConsequenceProjection?.projectionDigest,
        },
      },
    });
    if (!candidate) throw new Error('gratitude_candidate_missing');
    const trace = buildAutonomyDecisionTrace({
      context,
      now: 48,
      selectedProposal: candidate.proposal,
      decisionSource: 'rule',
    });
    expect(trace.candidates.find((entry) => entry.candidateId === trace.chosenCandidateId))
      .toMatchObject({
        consequenceId: 'social_consequence:gratitude',
        sourceOutcomeId: 'social_outcome:aid',
        consequenceProjectionDigest: source.socialConsequenceProjection?.projectionDigest,
      });
  });

  test('removing or revising the source makes the old candidate stale', () => {
    const source = project(input()).sources[0];
    const originalContext = agentContext(source);
    const original = buildPurposeBoundLifeCandidateBundle(originalContext).candidates.find(
      (entry) => entry.intent.sourceRef === source.sourceRef,
    );
    if (!original) throw new Error('gratitude_candidate_missing');
    const missing = buildPurposeBoundLifeCandidateBundle(agentContext());
    expect(missing.candidates.some((entry) => entry.candidateId === original.candidateId)).toBe(false);
    const revisedSource = project(input({ consequences: [consequence({ revision: 2 })] })).sources[0];
    const revised = buildPurposeBoundLifeCandidateBundle(agentContext(revisedSource));
    expect(revised.candidates.some((entry) => entry.candidateId === original.candidateId)).toBe(false);
  });
});

describe('LWSE-2b grievance consequence future reaction', () => {
  test('projects one private optional compensation or mediation request from exact assault evidence', () => {
    const projected = projectGrievanceCreatedConsequences(grievanceInput());
    expect(projected.sources).toHaveLength(1);
    expect(projected.sources[0]).toMatchObject({
      actorId: 'victim', targetActorId: 'attacker',
      kind: 'conflict_resolution', audience: 'private', urgencyBand: 'important',
      preferredActivity: 'talk',
      topicRefs: ['action:action:attack', 'consequence:social_consequence:grievance', 'event:event:attack'],
      socialConsequenceProjection: {
        consequenceId: 'social_consequence:grievance',
        sourceOutcomeId: 'action_terminal:action:attack:event:attack',
        sourceEventId: 'event:attack', kind: 'grievance_created',
      },
    });
  });

  test.each([
    ['budget', { consequences: [grievance({ remainingProjectionBudget: 0 })] }, 'social_consequence_projection_budget_exhausted'],
    ['expired', { nowGameHour: 768 }, 'social_consequence_projection_expired'],
    ['persisted expiry', { consequences: [grievance({ status: 'expired', remainingProjectionBudget: 0 })] }, 'social_consequence_projection_expired'],
    ['wrong subject', { consequences: [grievance({ subjectActorId: 'other' })] }, 'social_consequence_projection_subject_mismatch'],
    ['wrong source kind', { consequences: [grievance({ sourceKind: 'social_outcome' })] }, 'social_consequence_projection_source_kind_mismatch'],
    ['warranted source', { consequences: [grievance({ sourceWarrantId: 'warrant:fake' })] }, 'social_consequence_projection_source_kind_mismatch'],
    ['missing action proof', { consequences: [grievance({ actionTerminalEvidenceVerified: false })] }, 'social_consequence_projection_evidence_missing'],
    ['duplicate assault evidence', { consequences: [grievance({ sourceEventAssaultEvidenceCount: 2 })] }, 'social_consequence_projection_evidence_missing'],
    ['incapacitated victim', { actor: { ...grievanceInput().actor, aliveAndCapable: false } }, 'social_consequence_projection_busy'],
    ['busy attacker', { targets: [{ ...grievanceInput().targets[0], busy: true }] }, 'social_consequence_projection_busy'],
    ['attacker moved', { targets: [{ ...grievanceInput().targets[0], locationId: 'elsewhere' }] }, 'social_consequence_projection_target_ineligible'],
    ['private disclosure denied', { targets: [{ ...grievanceInput().targets[0], disclosureAllowed: false }] }, 'social_consequence_projection_disclosure_forbidden'],
    ['wrong audience', { consequences: [grievance({ audience: 'participants' })] }, 'social_consequence_projection_disclosure_forbidden'],
    ['cooldown', { targets: [{ ...grievanceInput().targets[0], cooldownClear: false }] }, 'social_consequence_projection_cooldown_active'],
  ] as const)('rejects %s without forcing a reaction', (_label, patch, reasonCode) => {
    const result = projectGrievanceCreatedConsequences(grievanceInput(
      patch as Partial<GrievanceConsequenceProjectionInput>,
    ));
    expect(result.sources).toEqual([]);
    expect(result.rejections[0]?.reasonCode).toBe(reasonCode);
  });

  test('ignores every other consequence kind and canonicalizes source order', () => {
    const actual = grievance();
    const other = grievance({ consequenceId: 'gratitude', kind: 'gratitude_due' });
    const left = projectGrievanceCreatedConsequences(grievanceInput({
      consequences: [actual, other],
    }));
    const right = projectGrievanceCreatedConsequences(grievanceInput({
      consequences: [other, actual],
    }));
    expect(left.sources).toHaveLength(1);
    expect(right.projectionSetDigest).toBe(left.projectionSetDigest);
  });

  test('candidate, proposal and autonomy trace retain exact grievance lineage', () => {
    const source = projectGrievanceCreatedConsequences(grievanceInput()).sources[0];
    const context = agentContext(source);
    context.lifeObservation = {
      observationRevision: 'observation:grievance',
    } as AgentContext['lifeObservation'];
    context.self.actorId = 'victim';
    context.self.name = '受害者';
    context.others = [{
      actorId: 'attacker', name: '施害者', realm: 'qi_refining', relationship: -10,
    }];
    const candidate = buildPurposeBoundLifeCandidateBundle(context).candidates.find((entry) =>
      entry.intent.sourceRef === source.sourceRef);
    expect(candidate).toMatchObject({
      planner: 'social_warrant',
      intent: { purposeKind: 'relationship', intendedActivity: 'talk' },
      socialOpportunity: {
        warrant: { intendedOutcome: 'mediate_or_negotiate', audience: 'private' },
      },
      proposal: {
        type: 'talk', targetActorId: 'attacker',
        params: {
          socialConsequenceId: 'social_consequence:grievance',
          socialConsequenceSourceOutcomeId: 'action_terminal:action:attack:event:attack',
          socialConsequenceProjectionDigest:
            source.socialConsequenceProjection?.projectionDigest,
        },
      },
    });
    if (!candidate) throw new Error('grievance_candidate_missing');
    const trace = buildAutonomyDecisionTrace({
      context, now: 48, selectedProposal: candidate.proposal, decisionSource: 'rule',
    });
    expect(trace.candidates.find((entry) => entry.candidateId === trace.chosenCandidateId))
      .toMatchObject({
        consequenceId: 'social_consequence:grievance',
        sourceOutcomeId: 'action_terminal:action:attack:event:attack',
        consequenceProjectionDigest: source.socialConsequenceProjection?.projectionDigest,
      });
  });

  test('removing or revising grievance makes the old candidate disappear', () => {
    const source = projectGrievanceCreatedConsequences(grievanceInput()).sources[0];
    const original = buildPurposeBoundLifeCandidateBundle(agentContext(source)).candidates.find(
      (entry) => entry.intent.sourceRef === source.sourceRef,
    );
    if (!original) throw new Error('grievance_candidate_missing');
    expect(buildPurposeBoundLifeCandidateBundle(agentContext()).candidates.some(
      (entry) => entry.candidateId === original.candidateId,
    )).toBe(false);
    const revisedSource = projectGrievanceCreatedConsequences(grievanceInput({
      consequences: [grievance({ revision: 2 })],
    })).sources[0];
    expect(buildPurposeBoundLifeCandidateBundle(agentContext(revisedSource)).candidates.some(
      (entry) => entry.candidateId === original.candidateId,
    )).toBe(false);
  });
});

function project(input: GratitudeConsequenceProjectionInput) {
  return projectGratitudeDueConsequences(input);
}

function grievance(
  patch: Partial<SocialConsequenceProjectionFact> = {},
): SocialConsequenceProjectionFact {
  return consequence({
    consequenceId: 'social_consequence:grievance',
    sourceOutcomeId: 'action_terminal:action:attack:event:attack',
    sourceOutcomeRevision: 1,
    sourceEventId: 'event:attack',
    sourceRevision: 'event_facts:attack',
    sourceKind: 'action_terminal',
    sourceActionId: 'action:attack',
    sourceWarrantId: undefined,
    actionTerminalEvidenceVerified: true,
    sourceEventAssaultEvidenceCount: 1,
    kind: 'grievance_created',
    subjectActorId: 'victim',
    counterpartActorIds: ['attacker'],
    audience: 'private',
    dueGameHour: undefined,
    createdGameHour: 48,
    ...patch,
  });
}

function grievanceInput(
  patch: Partial<GrievanceConsequenceProjectionInput> = {},
): GrievanceConsequenceProjectionInput {
  const base: GrievanceConsequenceProjectionInput = {
    nowGameHour: 48,
    actor: {
      actorId: 'victim', locationId: 'conflict_yard', aliveAndCapable: true, busy: false,
    },
    consequences: [grievance()],
    targets: [{
      actorId: 'attacker', locationId: 'conflict_yard', aliveAndCapable: true,
      busy: false, disclosureAllowed: true, cooldownClear: true,
      giftCooldownClear: true, sessionCapacityAvailable: true,
    }],
  };
  return { ...base, ...patch, actor: { ...base.actor, ...(patch.actor ?? {}) } };
}

function consequence(
  patch: Partial<SocialConsequenceProjectionFact> = {},
): SocialConsequenceProjectionFact {
  return {
    consequenceId: 'social_consequence:gratitude',
    revision: 1,
    sourceOutcomeId: 'social_outcome:aid',
    sourceOutcomeRevision: 2,
    sourceEventId: 'event:gift',
    sourceRevision: 'outcome:revision:2',
    kind: 'gratitude_due',
    subjectActorId: 'recipient',
    counterpartActorIds: ['donor'],
    audience: 'participants',
    status: 'active',
    remainingProjectionBudget: 1,
    dueGameHour: 48,
    expiresGameHour: 768,
    createdGameHour: 24,
    ...patch,
  };
}

function input(
  patch: Partial<GratitudeConsequenceProjectionInput> = {},
): GratitudeConsequenceProjectionInput {
  const base: GratitudeConsequenceProjectionInput = {
    nowGameHour: 48,
    actor: {
      actorId: 'recipient',
      locationId: 'rest_area',
      aliveAndCapable: true,
      busy: false,
      hasGiftableItem: false,
    },
    consequences: [consequence()],
    targets: [{
      actorId: 'donor',
      locationId: 'rest_area',
      aliveAndCapable: true,
      busy: false,
      disclosureAllowed: true,
      cooldownClear: true,
      giftCooldownClear: true,
      sessionCapacityAvailable: true,
    }],
  };
  return {
    ...base,
    ...patch,
    actor: { ...base.actor, ...(patch.actor ?? {}) },
  };
}

function agentContext(
  source?: ReturnType<typeof projectGratitudeDueConsequences>['sources'][number],
): AgentContext {
  const actorId = source?.actorId ?? 'recipient';
  const targetActorId = source?.targetActorId ?? 'donor';
  const locationId = source?.locationId ?? 'rest_area';
  return {
    lifeObservation: { observationRevision: 'observation:gratitude' } as AgentContext['lifeObservation'],
    currentGameHour: 48,
    self: {
      actorId, name: '受助者', role: 'outer_disciple', realm: 'qi_refining',
      realmStage: 1, cultivationXp: 0, mood: 0, health: 10, maxHealth: 10,
      fatigue: 0, spirit: 1, reputation: 0, currentLocationId: locationId, inventory: [],
    },
    others: [{ actorId: targetActorId, name: '帮助者', realm: 'qi_refining', relationship: 0 }],
    recentEvents: [],
    availableActions: ['talk'],
    knownLocations: [{
      locationId, name: '歇脚地', allowedActions: ['talk', 'rest'], dangerLevel: 0,
    }],
    purposeBoundLifeIntentV2: true,
    decisionPriorityProjectionV1: true,
    purposeResourceNodes: [],
    purposeShopOffers: [],
    sameLocationSocialSources: source ? [source] : [],
  };
}
