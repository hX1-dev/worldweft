import {
  authoritativeFactAccess,
  initialBeliefState,
  planBeliefFollowup,
  reviseBelief,
  validateEvidenceUse,
} from './beliefRevisionLogic';

describe('C016e2 authoritative knowledge boundaries', () => {
  test('rumor, distorted memory, and conversation claim events cannot authorize fact refs', () => {
    expect(authoritativeFactAccess({
      eventVisibility: 'private', eventType: 'resource_changed', eventContainsClaim: false,
      principal: false, memories: [{ source: 'rumor', distorted: false }],
    })).toEqual({ ok: false, reasonCode: 'conversation_fact_not_authoritative' });
    expect(authoritativeFactAccess({
      eventVisibility: 'private', eventType: 'resource_changed', eventContainsClaim: false,
      principal: false, memories: [{ source: 'witness', distorted: true }],
    })).toEqual({ ok: false, reasonCode: 'conversation_fact_not_authoritative' });
    expect(authoritativeFactAccess({
      eventVisibility: 'private', eventType: 'conversation_utterance', eventContainsClaim: true,
      principal: true, memories: [],
    })).toEqual({ ok: false, reasonCode: 'conversation_fact_not_authoritative' });
  });

  test('public, principal, and undistorted direct/witness memories preserve fact access', () => {
    expect(authoritativeFactAccess({
      eventVisibility: 'public', eventType: 'shop_restocked', eventContainsClaim: false,
      principal: false, memories: [],
    })).toEqual({ ok: true });
    expect(authoritativeFactAccess({
      eventVisibility: 'private', eventType: 'request_resolved', eventContainsClaim: false,
      principal: true, memories: [],
    })).toEqual({ ok: true });
    expect(authoritativeFactAccess({
      eventVisibility: 'witnessed', eventType: 'combatant_defeated', eventContainsClaim: false,
      principal: false, memories: [{ source: 'witness', distorted: false }],
    })).toEqual({ ok: true });
  });
});

describe('C016e2 belief revision', () => {
  test('rumor starts unknown and never becomes supported merely by repetition', () => {
    expect(initialBeliefState({ kind: 'rumor', supported: true })).toEqual({
      kind: 'rumor', confidence: 0.35, truthStatus: 'unknown',
    });
  });

  test('confirm, refute, and uncertain create bounded next revisions', () => {
    expect(reviseBelief({ kind: 'rumor', confidence: 0.35, revision: 1 }, 'confirm')).toEqual({
      revision: 2, kind: 'belief', confidence: 0.85, truthStatus: 'supported',
    });
    expect(reviseBelief({ kind: 'rumor', confidence: 0.35, revision: 1 }, 'refute')).toEqual({
      revision: 2, kind: 'belief', confidence: 0.15, truthStatus: 'contradicted',
    });
    expect(reviseBelief({ kind: 'rumor', confidence: 0.35, revision: 1 }, 'uncertain')).toEqual({
      revision: 2, kind: 'rumor', confidence: 0.2, truthStatus: 'unknown',
    });
  });

  test.each([
    [{ speechAct: 'inform', factCount: 1, beliefCount: 1 }, 'conversation_evidence_requires_clarify'],
    [{ speechAct: 'clarify', factCount: 2, beliefCount: 1 }, 'conversation_evidence_arity_invalid'],
    [{ speechAct: 'clarify', factCount: 1, beliefCount: 1, evidenceFound: false }, 'conversation_evidence_not_registered'],
    [{ speechAct: 'clarify', factCount: 1, beliefCount: 1, beliefTopicId: 'a', evidenceTopicId: 'a', currentTopicId: 'b' }, 'conversation_evidence_topic_mismatch'],
    [{ speechAct: 'clarify', factCount: 1, beliefCount: 1, beliefSubjectClaimId: 'a', evidenceSubjectClaimId: 'b' }, 'conversation_evidence_subject_mismatch'],
  ] as const)('fails closed for invalid evidence use %#', (patch, reasonCode) => {
    const input = Object.assign({
      speechAct: 'clarify', factCount: 1, beliefCount: 1, currentTopicId: 'topic',
      beliefTopicId: 'topic', beliefSubjectClaimId: 'claim', evidenceTopicId: 'topic',
      evidenceSubjectClaimId: 'claim', evidenceFound: true,
    } as const, patch);
    expect(validateEvidenceUse(input)).toEqual({ ok: false, reasonCode });
  });

  test('firsthand, rumor, confirmed, and refuted states produce explainable follow-ups', () => {
    expect(planBeliefFollowup({ kind: 'claim' })).toEqual({ speechAct: 'ask', reasonCode: 'claim_unverified' });
    expect(planBeliefFollowup({ kind: 'rumor' })).toEqual({ speechAct: 'ask', reasonCode: 'rumor_unverified' });
    expect(planBeliefFollowup({ kind: 'belief', truthStatus: 'supported' })).toEqual({ speechAct: 'respond', reasonCode: 'evidence_confirmed' });
    expect(planBeliefFollowup({ kind: 'belief', truthStatus: 'contradicted' })).toEqual({ speechAct: 'refuse', reasonCode: 'evidence_refuted' });
  });
});
