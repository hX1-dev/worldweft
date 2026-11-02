import { MS_PER_GAME_HOUR } from './timeLogic';

export const MAX_HEALTH = 10;
export const NATURAL_RECOVERY_GAME_HOURS = 4;
export const INCAPACITATED_RECOVERY_DELAY_MS = NATURAL_RECOVERY_GAME_HOURS * MS_PER_GAME_HOUR;

export type LifeState = 'healthy' | 'injured' | 'incapacitated';
export type PersistedLifeStatus = 'alive' | 'deceased';

/**
 * Legacy profiles may predate the durable `maxHealth` field.  Their missing
 * value means "use the world life-rule default", not "the current (possibly
 * injured) health is the maximum".  Keeping this normalization in one place
 * prevents read-side observations and write-side admission checks from
 * disagreeing about an injured legacy actor.
 */
export function resolveActorMaxHealth(profile: {
  health: number;
  maxHealth?: number;
}): number {
  return Math.max(1, profile.health, profile.maxHealth ?? MAX_HEALTH);
}

export function isActorDeceased(profile: { lifeStatus?: PersistedLifeStatus }): boolean {
  return profile.lifeStatus === 'deceased';
}

export function isActorAlive(profile: { lifeStatus?: PersistedLifeStatus }): boolean {
  return !isActorDeceased(profile);
}

export function lifeStateForHealth(health: number, maxHealth = MAX_HEALTH): LifeState {
  if (health <= 0) return 'incapacitated';
  if (health < maxHealth) return 'injured';
  return 'healthy';
}

export function isActorIncapacitated(health: number): boolean {
  return lifeStateForHealth(health) === 'incapacitated';
}

export function needsIncapacitationRecoveryEnrollment(profile: {
  health: number;
  lifeStatus?: PersistedLifeStatus;
  incapacitatedAt?: number;
  recoveryEligibleAt?: number;
  recoveryToken?: string;
}): boolean {
  return (
    profile.lifeStatus !== 'deceased' &&
    isActorIncapacitated(profile.health) &&
    (profile.incapacitatedAt === undefined ||
      profile.recoveryEligibleAt === undefined ||
      !profile.recoveryToken)
  );
}

type LifeActionGateInput = {
  health: number;
  lifeStatus?: PersistedLifeStatus;
  actionType: string;
  source: string;
  now: number;
  recoveryEligibleAt?: number;
  recoveryToken?: string;
  requestedRecoveryToken?: string;
};

export type LifeActionGate = { ok: true } | { ok: false; resultCode: string; reason: string };

const TARGET_PARTICIPATION_ACTIONS = new Set([
  'talk',
  'negotiate',
  'trade',
  'gift',
  'request_teaching',
  'accept_request',
  'decline_request',
  'turn_in_request',
  'spar',
  'steal',
  'attack',
]);

/**
 * The server-side life-state gate. `recover` is deliberately system-only:
 * an incapacitated actor cannot keep acting by choosing a self-heal command.
 */
export function evaluateLifeActionGate(input: LifeActionGateInput): LifeActionGate {
  if (input.lifeStatus === 'deceased') {
    return {
      ok: false,
      resultCode: 'actor_deceased',
      reason: '行动者已经寿终，不能再产生新的行动后果。',
    };
  }
  if (input.actionType !== 'recover') {
    return isActorIncapacitated(input.health)
      ? {
          ok: false,
          resultCode: 'actor_incapacitated',
          reason: '行动者气血已尽，正处于失能状态，无法继续普通行动。',
        }
      : { ok: true };
  }

  if (input.source !== 'system') {
    return {
      ok: false,
      resultCode: 'recovery_source_forbidden',
      reason: '失能恢复只能由经过计时校验的系统流程触发。',
    };
  }
  if (!isActorIncapacitated(input.health)) {
    return {
      ok: false,
      resultCode: 'actor_not_incapacitated',
      reason: '行动者当前并未失能，无需执行自然恢复。',
    };
  }
  if (input.recoveryEligibleAt === undefined || !input.recoveryToken) {
    return {
      ok: false,
      resultCode: 'recovery_not_scheduled',
      reason: '这次失能尚无可验证的恢复计划。',
    };
  }
  if (input.requestedRecoveryToken !== input.recoveryToken) {
    return {
      ok: false,
      resultCode: 'stale_recovery',
      reason: '恢复凭证已过期，不能作用于当前生命状态。',
    };
  }
  if (input.now < input.recoveryEligibleAt) {
    return {
      ok: false,
      resultCode: 'recovery_not_ready',
      reason: '伤势尚未稳定，还不到恢复最低行动能力的时刻。',
    };
  }
  return { ok: true };
}

export function evaluateTargetLifeGate(input: {
  health: number;
  lifeStatus?: PersistedLifeStatus;
  actionType: string;
  targetName?: string;
}): LifeActionGate {
  if (TARGET_PARTICIPATION_ACTIONS.has(input.actionType) && input.lifeStatus === 'deceased') {
    return {
      ok: false,
      resultCode: 'target_deceased',
      reason: `${input.targetName ?? '目标'}已经寿终，无法参与这项互动。`,
    };
  }
  if (TARGET_PARTICIPATION_ACTIONS.has(input.actionType) && isActorIncapacitated(input.health)) {
    return {
      ok: false,
      resultCode: 'target_incapacitated',
      reason: `${input.targetName ?? '目标'}正处于失能状态，无法参与这项互动。`,
    };
  }
  return { ok: true };
}

export type HealthTransition = {
  previousHealth: number;
  nextHealth: number;
  enteredIncapacitation: boolean;
  recoveredFromIncapacitation: boolean;
  incapacitatedAt?: number;
  recoveryEligibleAt?: number;
  recoveryToken?: string;
};

export function resolveHealthTransition(input: {
  currentHealth: number;
  maxHealth?: number;
  delta: number;
  now: number;
  recoveryToken: string;
}): HealthTransition {
  const maxHealth = Math.max(1, input.maxHealth ?? MAX_HEALTH);
  const previousHealth = clampHealth(input.currentHealth, maxHealth);
  const nextHealth = clampHealth(previousHealth + input.delta, maxHealth);
  const enteredIncapacitation = previousHealth > 0 && nextHealth === 0;
  const recoveredFromIncapacitation = previousHealth === 0 && nextHealth > 0;
  return {
    previousHealth,
    nextHealth,
    enteredIncapacitation,
    recoveredFromIncapacitation,
    incapacitatedAt: enteredIncapacitation ? input.now : undefined,
    recoveryEligibleAt: enteredIncapacitation
      ? input.now + INCAPACITATED_RECOVERY_DELAY_MS
      : undefined,
    recoveryToken: enteredIncapacitation ? input.recoveryToken : undefined,
  };
}

function clampHealth(health: number, maxHealth: number) {
  return Math.max(0, Math.min(maxHealth, health));
}
