import {
  SOCIAL_OPPORTUNITY_CANDIDATE_VERSION,
  SOCIAL_RUNTIME_REASON_CODES,
  SOCIAL_WARRANT_VERSION,
  canonicalSocialOpportunityCandidate,
  canonicalSocialWarrant,
  revalidateSocialOpportunityCandidate,
  socialOpportunityCandidateDigest,
  socialWarrantCandidateDigest,
  socialWarrantDigest,
  validateSocialOpportunityCandidate,
  validateSocialWarrant,
  type SocialOpportunityCandidate,
  type SocialWarrant,
  type SocialWarrantKind,
  type SocialWarrantOutcome,
  type SocialOpportunityLatestFacts,
} from './socialWarrantContracts';

const KIND_OUTCOME: Array<[SocialWarrantKind, SocialWarrantOutcome]> = [
  ['care_or_aid', 'request_aid'],
  ['active_obligation', 'respond_to_request'],
  ['resource_coordination', 'trade_or_coordinate'],
  ['knowledge_gap', 'ask_or_verify'],
  ['teaching_or_advice', 'teach_or_advise'],
  ['relationship_maintenance', 'maintain_bond'],
  ['gratitude_or_repair', 'thank_apologize_or_repair'],
  ['conflict_resolution', 'mediate_or_negotiate'],
  ['shared_activity', 'join_shared_activity'],
  ['collective_event', 'reach_group_decision'],
];

function warrant(overrides: Partial<SocialWarrant> = {}): SocialWarrant {
  return {
    contractVersion: SOCIAL_WARRANT_VERSION,
    warrantId: 'warrant:actor_a:relationship:7',
    actorId: 'actor_a',
    kind: 'relationship_maintenance',
    sourceRef: 'relationship:actor_a:actor_b',
    sourceRevision: 'relationship:rev:7',
    intendedOutcome: 'maintain_bond',
    eligibleTargetActorIds: ['actor_b', 'actor_c', 'actor_d'],
    topicRefs: ['memory:shared_harvest', 'relationship:actor_a:actor_b'],
    audience: 'private',
    urgencyBand: 'routine',
    createdAt: 1_000,
    expiresAt: 2_000,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<SocialOpportunityCandidate> = {},
): SocialOpportunityCandidate {
  return {
    contractVersion: SOCIAL_OPPORTUNITY_CANDIDATE_VERSION,
    candidateId: 'candidate:warrant_7:actor_b',
    warrantId: 'warrant:actor_a:relationship:7',
    mode: 'start_direct_conversation',
    targetActorIds: ['actor_b'],
    intendedActivity: 'talk',
    summary: '询问近况并维护已有关系。',
    ...overrides,
  };
}

function latestFacts(overrides: Partial<SocialOpportunityLatestFacts> = {}): SocialOpportunityLatestFacts {
  return {
    now: 1_500,
    source: {
      sourceRef: 'relationship:actor_a:actor_b',
      sourceRevision: 'relationship:rev:7',
    },
    actorAliveAndCapable: true,
    actorBusy: false,
    targetFacts: [
      {
        actorId: 'actor_b',
        relevant: true,
        aliveAndCapable: true,
        busy: false,
        visibleOrKnownReachable: true,
        declined: false,
        moved: false,
        canFulfillOutcome: true,
      },
    ],
    disclosureAllowed: true,
    cooldownClear: true,
    sessionCapacityAvailable: true,
    meetingLocationValid: true,
    invitationState: 'not_required',
    sharedTopicRefs: ['memory:shared_harvest'],
    ...overrides,
  };
}

describe('C021b0a SocialWarrant contract', () => {
  test.each(KIND_OUTCOME)('accepts frozen kind/outcome pair %s -> %s', (kind, outcome) => {
    const result = validateSocialWarrant(
      warrant({
        kind,
        intendedOutcome: outcome,
        warrantId: `warrant:actor_a:${kind}`,
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      digest: expect.stringMatching(/^stable64:[0-9a-f]{16}$/u),
    });
  });

  test('canonicalizes key and set order without changing the digest', () => {
    const original = warrant();
    const reordered = {
      expiresAt: original.expiresAt,
      createdAt: original.createdAt,
      urgencyBand: original.urgencyBand,
      audience: original.audience,
      topicRefs: [...original.topicRefs].reverse(),
      eligibleTargetActorIds: [...original.eligibleTargetActorIds].reverse(),
      intendedOutcome: original.intendedOutcome,
      sourceRevision: original.sourceRevision,
      sourceRef: original.sourceRef,
      kind: original.kind,
      actorId: original.actorId,
      warrantId: original.warrantId,
      contractVersion: original.contractVersion,
    };
    const first = validateSocialWarrant(original);
    const second = validateSocialWarrant(reordered);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('expected valid warrants');
    expect(second.warrant.eligibleTargetActorIds).toEqual(['actor_b', 'actor_c', 'actor_d']);
    expect(second.warrant.topicRefs).toEqual([
      'memory:shared_harvest',
      'relationship:actor_a:actor_b',
    ]);
    expect(second.canonical).toBe(first.canonical);
    expect(second.digest).toBe(first.digest);
    expect(canonicalSocialWarrant(second.warrant)).toBe(canonicalSocialWarrant(first.warrant));
    expect(socialWarrantDigest(second.warrant)).toBe(socialWarrantDigest(first.warrant));
  });

  test.each([
    [null, 'social_warrant_not_object'],
    [{ ...warrant(), extra: true }, 'social_warrant_unknown_field'],
    [{ ...warrant(), contractVersion: 'taixu.social-warrant.v0' }, 'social_warrant_unsupported_version'],
    [{ ...warrant(), sourceRef: '' }, 'social_warrant_source_ref_invalid'],
    [{ ...warrant(), eligibleTargetActorIds: ['actor_b', 'actor_b'] }, 'social_warrant_target_duplicate'],
    [{ ...warrant(), eligibleTargetActorIds: ['actor_a'] }, 'social_warrant_target_invalid'],
    [{ ...warrant(), topicRefs: ['memory:x', 'memory:x'] }, 'social_warrant_topic_duplicate'],
    [{ ...warrant(), expiresAt: 1_000 }, 'social_warrant_time_invalid'],
    [{ ...warrant(), intendedOutcome: 'request_aid' }, 'social_warrant_kind_outcome_mismatch'],
  ])('rejects invalid warrant %# with an explicit reason', (input, reasonCode) => {
    expect(validateSocialWarrant(input)).toEqual({ ok: false, reasonCode });
  });

  test('accepts every frozen candidate mode with its exact shape', () => {
    const relationship = warrant();
    const collective = warrant({
      warrantId: 'warrant:actor_a:collective:4',
      kind: 'collective_event',
      intendedOutcome: 'reach_group_decision',
      sourceRef: 'world_event:market_dispute',
      sourceRevision: 'world_event:rev:4',
      audience: 'participants',
    });
    const cases: Array<[SocialOpportunityCandidate, SocialWarrant]> = [
      [candidate(), relationship],
      [
        candidate({
          candidateId: 'candidate:invite',
          mode: 'invite_then_travel',
          meetingLocationId: 'quiet_pavilion',
        }),
        relationship,
      ],
      [
        candidate({
          candidateId: 'candidate:respond',
          mode: 'respond_to_invitation',
          meetingLocationId: 'quiet_pavilion',
        }),
        relationship,
      ],
      [
        candidate({
          candidateId: 'candidate:group',
          warrantId: collective.warrantId,
          mode: 'start_group_conversation',
          targetActorIds: ['actor_d', 'actor_b', 'actor_c'],
          meetingLocationId: 'market_square',
          intendedActivity: 'group_decide',
        }),
        collective,
      ],
      [
        candidate({
          candidateId: 'candidate:wait',
          mode: 'wait',
          targetActorIds: [],
          intendedActivity: 'wait',
          summary: '当前没有值得发起的正式交流。',
        }),
        relationship,
      ],
    ];

    for (const [entry, sourceWarrant] of cases) {
      expect(validateSocialOpportunityCandidate(entry, sourceWarrant)).toMatchObject({
        ok: true,
        digest: expect.stringMatching(/^stable64:[0-9a-f]{16}$/u),
        warrantCandidateDigest: expect.stringMatching(/^stable64:[0-9a-f]{16}$/u),
      });
    }
  });

  test('canonicalizes candidate targets and binds candidate to its warrant', () => {
    const sourceWarrant = warrant();
    const firstCandidate = candidate({
      candidateId: 'candidate:group_waiting',
      mode: 'start_group_conversation',
      targetActorIds: ['actor_d', 'actor_b', 'actor_c'],
      meetingLocationId: 'market_square',
      intendedActivity: 'group_decide',
    });
    const collective = warrant({
      kind: 'collective_event',
      intendedOutcome: 'reach_group_decision',
      sourceRef: 'world_event:market_dispute',
    });
    const reordered = { ...firstCandidate, targetActorIds: ['actor_b', 'actor_c', 'actor_d'] };
    const first = validateSocialOpportunityCandidate(firstCandidate, collective);
    const second = validateSocialOpportunityCandidate(reordered, collective);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('expected valid candidates');
    expect(first.canonical).toBe(second.canonical);
    expect(first.digest).toBe(second.digest);
    expect(first.warrantCandidateDigest).toBe(second.warrantCandidateDigest);
    expect(canonicalSocialOpportunityCandidate(first.candidate)).toBe(
      canonicalSocialOpportunityCandidate(second.candidate),
    );
    expect(socialOpportunityCandidateDigest(first.candidate)).toBe(
      socialOpportunityCandidateDigest(second.candidate),
    );
    expect(sourceWarrant.warrantId).toBe(firstCandidate.warrantId);
  });

  test.each([
    [candidate({ targetActorIds: [] }), 'social_candidate_mode_mismatch'],
    [candidate({ targetActorIds: ['actor_b', 'actor_b'] }), 'social_candidate_target_duplicate'],
    [candidate({ meetingLocationId: 'somewhere' }), 'social_candidate_mode_mismatch'],
    [candidate({ mode: 'invite_then_travel' }), 'social_candidate_mode_mismatch'],
    [candidate({ mode: 'wait', targetActorIds: [], intendedActivity: 'talk' }), 'social_candidate_mode_mismatch'],
    [candidate({ mode: 'wait', targetActorIds: [], intendedActivity: 'wait', meetingLocationId: 'market' }), 'social_candidate_mode_mismatch'],
    [candidate({ targetActorIds: ['actor_outsider'] }), 'social_candidate_target_ineligible'],
    [candidate({ intendedActivity: 'negotiate' }), 'social_candidate_outcome_mismatch'],
    [candidate({ warrantId: 'warrant:other' }), 'social_candidate_warrant_mismatch'],
  ])('rejects invalid or unbound candidate %#', (input, reasonCode) => {
    expect(validateSocialOpportunityCandidate(input, warrant())).toEqual({ ok: false, reasonCode });
  });

  test('paired digest changes when source revision, audience, or expiry changes', () => {
    const entry = candidate();
    const baseline = socialWarrantCandidateDigest(warrant(), entry);
    expect(socialWarrantCandidateDigest(warrant({ sourceRevision: 'relationship:rev:8' }), entry)).not.toBe(
      baseline,
    );
    expect(socialWarrantCandidateDigest(warrant({ audience: 'participants' }), entry)).not.toBe(
      baseline,
    );
    expect(socialWarrantCandidateDigest(warrant({ expiresAt: 2_001 }), entry)).not.toBe(baseline);
  });

  test.each([
    [latestFacts(), undefined],
    [latestFacts({ source: undefined }), 'social_source_stale'],
    [latestFacts({ source: { sourceRef: 'relationship:other', sourceRevision: 'relationship:rev:7' } }), 'social_source_stale'],
    [latestFacts({ now: 2_000 }), 'social_source_stale'],
    [latestFacts({ disclosureAllowed: false }), 'social_disclosure_forbidden'],
    [latestFacts({ cooldownClear: false }), 'social_cooldown_active'],
    [latestFacts({ sessionCapacityAvailable: false }), 'social_session_capacity_full'],
    [
      latestFacts({
        targetFacts: [
          {
            ...latestFacts().targetFacts[0],
            canFulfillOutcome: false,
          },
        ],
      }),
      'social_target_irrelevant',
    ],
    [
      latestFacts({
        targetFacts: [
          {
            ...latestFacts().targetFacts[0],
            busy: true,
          },
        ],
      }),
      'social_target_busy',
    ],
    [
      latestFacts({
        targetFacts: [
          {
            ...latestFacts().targetFacts[0],
            declined: true,
          },
        ],
      }),
      'social_target_declined',
    ],
  ])('revalidates source, capability, privacy and cooldown counterfactual %#', (facts, reasonCode) => {
    expect(revalidateSocialOpportunityCandidate(warrant(), candidate(), facts)).toBe(reasonCode);
  });

  test('no source fact makes the social choice ineligible instead of silently replacing it', () => {
    const sourceWarrant = warrant();
    const entry = candidate();
    expect(validateSocialOpportunityCandidate(entry, sourceWarrant).ok).toBe(true);
    expect(
      revalidateSocialOpportunityCandidate(sourceWarrant, entry, latestFacts({ source: undefined })),
    ).toBe('social_source_stale');
  });

  test('freezes distinct runtime rejection reasons without granting runtime behavior', () => {
    expect(new Set(SOCIAL_RUNTIME_REASON_CODES).size).toBe(SOCIAL_RUNTIME_REASON_CODES.length);
    expect(SOCIAL_RUNTIME_REASON_CODES).toEqual(
      expect.arrayContaining([
        'social_source_stale',
        'social_target_declined',
        'social_disclosure_forbidden',
        'social_group_topic_not_shared',
      ]),
    );
  });
});
