import {
  TEACHING_EXECUTION_TOPIC,
  evaluateTeachingActionCooldown,
  parseTeachingTopic,
} from './teachingLogic';

describe('teaching action contract', () => {
  it('maps absent legacy topics to the single server-known lesson', () => {
    expect(parseTeachingTopic(undefined)).toBe(TEACHING_EXECUTION_TOPIC);
    expect(parseTeachingTopic('')).toBe(TEACHING_EXECUTION_TOPIC);
    expect(parseTeachingTopic('筑基秘诀')).toBeNull();
  });

  it('allows the first completed lesson', () => {
    expect(evaluateTeachingActionCooldown(20, 'elder', [])).toEqual({ ok: true });
  });

  it('allows only one completed lesson per student and game day', () => {
    expect(
      evaluateTeachingActionCooldown(20, 'other_elder', [
        { targetActorId: 'elder', sourceGameDay: 20 },
      ]),
    ).toMatchObject({ ok: false, resultCode: 'teaching_daily_cooldown' });
  });

  it('keeps a seven-day directed student-to-teacher cooldown', () => {
    const usages = [{ targetActorId: 'elder', sourceGameDay: 20 }];
    expect(evaluateTeachingActionCooldown(21, 'elder', usages)).toMatchObject({
      ok: false,
      resultCode: 'teaching_pair_cooldown',
    });
    expect(evaluateTeachingActionCooldown(27, 'elder', usages)).toEqual({ ok: true });
  });

  it('does not let future or another teacher usage trigger the pair gate', () => {
    expect(
      evaluateTeachingActionCooldown(27, 'elder', [
        { targetActorId: 'other_elder', sourceGameDay: 20 },
        { targetActorId: 'elder', sourceGameDay: 30 },
      ]),
    ).toEqual({ ok: true });
  });
});
