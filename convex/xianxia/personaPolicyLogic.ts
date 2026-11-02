import {
  INNER_TRAITS,
  OUTER_TRAITS,
  type InnerTrait,
  type OuterTrait,
} from './personalityLogic';

export const PERSONA_POLICY_VERSION = 'taixu.persona-policy.v1' as const;
export const PERSONA_EXCEPTION_FIT_THRESHOLD = -30;

export type PersonaPolicyDimensions = {
  riskTolerance: number;
  helpingBias: number;
  commitmentBias: number;
  conflictBias: number;
  socialBias: number;
  cultivationBias: number;
  persistenceBias: number;
  evidenceBias: number;
  resourceReserveBias: number;
};

export type PersonaPolicyV1 = {
  policyVersion: typeof PERSONA_POLICY_VERSION;
  innerTrait?: string;
  outerTrait?: string;
  innerTraitKnown: boolean;
  outerTraitKnown: boolean;
  dimensions: PersonaPolicyDimensions;
  reasonCodes: string[];
  selfBinding?: PersonaSelfBindingV1;
  policyDigest: string;
};

export type PersonaSelfBindingV1 = {
  selfContractVersion: 'taixu.self-core.v1';
  actorId: string;
  revision: number;
  digest: string;
  sourceRefs: string[];
};

export type PersonaCandidateDescriptor = {
  actionType: string;
  risk?: number;
  helping?: number;
  commitment?: number;
  conflict?: number;
  social?: number;
  cultivation?: number;
  persistence?: number;
  evidence?: number;
  resourceDirection?: 'spend' | 'gain' | 'neutral';
  disposition?: 'approach' | 'avoid' | 'accept' | 'decline' | 'continue';
};

export type PersonaCandidateAssessment = {
  personaFit: number;
  reasonCodes: string[];
};

const ZERO_DIMENSIONS: PersonaPolicyDimensions = {
  riskTolerance: 50,
  helpingBias: 0,
  commitmentBias: 0,
  conflictBias: 0,
  socialBias: 0,
  cultivationBias: 0,
  persistenceBias: 0,
  evidenceBias: 0,
  resourceReserveBias: 0,
};

const INNER_POLICY: Record<InnerTrait, Partial<PersonaPolicyDimensions>> = {
  无私: {
    riskTolerance: -5,
    helpingBias: 30,
    commitmentBias: 15,
    conflictBias: -20,
    socialBias: 10,
    persistenceBias: 10,
    evidenceBias: 5,
    resourceReserveBias: -10,
  },
  正直: {
    helpingBias: 15,
    commitmentBias: 25,
    conflictBias: 5,
    socialBias: 5,
    cultivationBias: 5,
    persistenceBias: 15,
    evidenceBias: 30,
  },
  仁善: {
    riskTolerance: -15,
    helpingBias: 30,
    commitmentBias: 15,
    conflictBias: -30,
    socialBias: 15,
    persistenceBias: 5,
    evidenceBias: 10,
    resourceReserveBias: -5,
  },
  中庸: {
    riskTolerance: -5,
    evidenceBias: 5,
  },
  利己: {
    riskTolerance: 5,
    helpingBias: -25,
    commitmentBias: -10,
    conflictBias: 5,
    socialBias: -5,
    cultivationBias: 5,
    resourceReserveBias: 25,
  },
  狂邪: {
    riskTolerance: 25,
    helpingBias: -10,
    commitmentBias: -15,
    conflictBias: 30,
    socialBias: 5,
    cultivationBias: 20,
    persistenceBias: 15,
    evidenceBias: -10,
  },
  邪恶: {
    riskTolerance: 20,
    helpingBias: -35,
    commitmentBias: -25,
    conflictBias: 35,
    socialBias: -15,
    cultivationBias: 10,
    persistenceBias: 20,
    evidenceBias: -20,
    resourceReserveBias: 20,
  },
};

const OUTER_POLICY: Record<OuterTrait, Partial<PersonaPolicyDimensions>> = {
  天伦: { helpingBias: 15, commitmentBias: 20, socialBias: 5, persistenceBias: 15 },
  义气: { helpingBias: 25, commitmentBias: 20, socialBias: 15, persistenceBias: 10 },
  护短: { helpingBias: 20, commitmentBias: 15, conflictBias: 10, persistenceBias: 15 },
  孤僻: {
    riskTolerance: -10,
    helpingBias: -5,
    socialBias: -30,
    cultivationBias: 15,
    persistenceBias: 10,
    evidenceBias: 10,
  },
  爱家: { helpingBias: 15, commitmentBias: 25, socialBias: 5, persistenceBias: 15 },
  名声: {
    riskTolerance: 5,
    helpingBias: 5,
    commitmentBias: 15,
    socialBias: 15,
    cultivationBias: 10,
    evidenceBias: 10,
  },
  权力: {
    riskTolerance: 10,
    helpingBias: -5,
    commitmentBias: 5,
    conflictBias: 10,
    socialBias: 5,
    cultivationBias: 30,
    persistenceBias: 15,
    resourceReserveBias: 10,
  },
  睚眦: {
    riskTolerance: 10,
    helpingBias: -10,
    conflictBias: 30,
    persistenceBias: 25,
    evidenceBias: -5,
  },
  任我: {
    riskTolerance: 5,
    helpingBias: -15,
    commitmentBias: -20,
    socialBias: -15,
    cultivationBias: 15,
    persistenceBias: 10,
  },
  情种: { helpingBias: 10, commitmentBias: 5, socialBias: 25, cultivationBias: -15 },
  传承: {
    helpingBias: 20,
    commitmentBias: 20,
    socialBias: 10,
    cultivationBias: 20,
    persistenceBias: 15,
    evidenceBias: 10,
  },
  忠贞: { helpingBias: 5, commitmentBias: 30, socialBias: -5, persistenceBias: 25 },
};

export function buildPersonaPolicy(
  innerTrait: string | undefined,
  outerTrait: string | undefined,
): PersonaPolicyV1 {
  const innerKnown = INNER_TRAITS.includes(innerTrait as InnerTrait);
  const outerKnown = OUTER_TRAITS.includes(outerTrait as OuterTrait);
  const dimensions = {
    ...ZERO_DIMENSIONS,
  };
  if (innerKnown) addDimensions(dimensions, INNER_POLICY[innerTrait as InnerTrait]);
  if (outerKnown) addDimensions(dimensions, OUTER_POLICY[outerTrait as OuterTrait]);
  dimensions.riskTolerance = clamp(Math.round(dimensions.riskTolerance), 0, 100);
  for (const key of Object.keys(dimensions) as Array<keyof PersonaPolicyDimensions>) {
    if (key === 'riskTolerance') continue;
    dimensions[key] = clamp(Math.round(dimensions[key]), -60, 60);
  }
  const reasonCodes = [
    ...(innerKnown ? [`persona_inner_${traitCode(innerTrait!)}`] : ['persona_inner_unknown']),
    ...(outerKnown ? [`persona_outer_${traitCode(outerTrait!)}`] : ['persona_outer_unknown']),
    ...(!innerKnown || !outerKnown ? ['persona_policy_traits_unknown'] : []),
  ];
  const semantic = {
    policyVersion: PERSONA_POLICY_VERSION,
    innerTrait: innerKnown ? innerTrait : undefined,
    outerTrait: outerKnown ? outerTrait : undefined,
    innerTraitKnown: innerKnown,
    outerTraitKnown: outerKnown,
    dimensions,
    reasonCodes,
  };
  return {
    ...semantic,
    policyDigest: stableDigest(semantic),
  };
}

export function buildPersonaPolicyFromDimensions(
  dimensions: PersonaPolicyDimensions,
  selfBinding: PersonaSelfBindingV1,
): PersonaPolicyV1 {
  const semantic = {
    policyVersion: PERSONA_POLICY_VERSION,
    innerTraitKnown: false,
    outerTraitKnown: false,
    dimensions: { ...dimensions },
    reasonCodes: ['persona_policy_stable_self'],
    selfBinding: {
      ...selfBinding,
      sourceRefs: [...new Set(selfBinding.sourceRefs)].sort((left, right) =>
        left.localeCompare(right),
      ),
    },
  };
  return {
    ...semantic,
    policyDigest: stableDigest(semantic),
  };
}

export function evaluatePersonaCandidate(
  policy: PersonaPolicyV1,
  descriptor: PersonaCandidateDescriptor,
): PersonaCandidateAssessment {
  const contributions: Array<{ code: string; value: number }> = [];
  const d = policy.dimensions;
  addContribution(
    contributions,
    'persona_risk',
    ((d.riskTolerance - 50) * intensity(descriptor.risk)) / 100,
  );
  addContribution(
    contributions,
    'persona_help',
    (d.helpingBias * intensity(descriptor.helping)) / 100,
  );
  addContribution(
    contributions,
    'persona_commitment',
    (d.commitmentBias * intensity(descriptor.commitment)) / 100,
  );
  addContribution(
    contributions,
    'persona_conflict',
    (d.conflictBias * intensity(descriptor.conflict)) / 100,
  );
  addContribution(
    contributions,
    'persona_social',
    (d.socialBias * intensity(descriptor.social)) / 100,
  );
  addContribution(
    contributions,
    'persona_cultivation',
    (d.cultivationBias * intensity(descriptor.cultivation)) / 100,
  );
  addContribution(
    contributions,
    'persona_persistence',
    (d.persistenceBias * intensity(descriptor.persistence)) / 100,
  );
  addContribution(
    contributions,
    'persona_evidence',
    (d.evidenceBias * intensity(descriptor.evidence)) / 100,
  );
  if (descriptor.resourceDirection === 'spend') {
    addContribution(contributions, 'persona_resource_reserve', -d.resourceReserveBias);
  } else if (descriptor.resourceDirection === 'gain') {
    addContribution(contributions, 'persona_resource_gain', d.resourceReserveBias * 0.5);
  }
  if (descriptor.disposition === 'avoid') {
    addContribution(
      contributions,
      'persona_avoidance',
      (50 - d.riskTolerance) * 0.6 - d.conflictBias * 0.4,
    );
  } else if (descriptor.disposition === 'decline') {
    addContribution(
      contributions,
      'persona_decline',
      -d.helpingBias * 0.8 - d.commitmentBias * 0.25,
    );
  } else if (descriptor.disposition === 'accept') {
    addContribution(
      contributions,
      'persona_accept',
      d.helpingBias * 0.5 + d.commitmentBias * 0.25,
    );
  } else if (descriptor.disposition === 'continue') {
    addContribution(
      contributions,
      'persona_continue',
      d.persistenceBias * 0.5 + d.commitmentBias * 0.25,
    );
  }
  const personaFit = clamp(
    Math.round(contributions.reduce((sum, contribution) => sum + contribution.value, 0)),
    -100,
    100,
  );
  return {
    personaFit,
    reasonCodes: [
      ...policy.reasonCodes,
      ...contributions
        .filter((contribution) => Math.abs(contribution.value) >= 2)
        .map(
          (contribution) =>
            `${contribution.code}_${contribution.value > 0 ? 'supports' : 'opposes'}`,
        ),
    ],
  };
}

export function personaCandidateRank(input: {
  needScore: number;
  commitmentUrgency: number;
  personaFit: number;
}) {
  return (
    clamp(input.needScore, 0, 100) +
    clamp(input.commitmentUrgency, 0, 100) * 0.35 +
    clamp(input.personaFit, -100, 100) * 0.45
  );
}

function addDimensions(
  target: PersonaPolicyDimensions,
  patch: Partial<PersonaPolicyDimensions>,
) {
  for (const key of Object.keys(patch) as Array<keyof PersonaPolicyDimensions>) {
    const value = patch[key];
    if (value === undefined) continue;
    target[key] += value;
  }
}

function addContribution(
  contributions: Array<{ code: string; value: number }>,
  code: string,
  rawValue: number,
) {
  const value = Math.round(rawValue * 100) / 100;
  if (value !== 0) contributions.push({ code, value });
}

function intensity(value: number | undefined) {
  return clamp(Number.isFinite(value) ? Math.round(value!) : 0, 0, 100);
}

function traitCode(trait: string) {
  return encodeURIComponent(trait).toLowerCase();
}

export function stableDigest(value: unknown) {
  const text = stableStringify(value);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
    right = (right ^ (right >>> 13)) >>> 0;
  }
  return `stable64:${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
