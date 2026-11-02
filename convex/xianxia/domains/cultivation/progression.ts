import type { MutationCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';
import {
  breakthroughThreshold,
  clamp,
  realmDisplayName,
  realmMaxStage,
} from '../../rules';
import { appendWorldEvent } from '../../events';
import { versionDurableEventFacts } from '../../durableContracts';
import { isActorDeceased, isActorIncapacitated } from '../../lifeStateLogic';
import { loadProfile } from '../life/profile';

// 境内自动升层不跨境界；达到大关后仍由显式突破动作裁决。
export async function autoAdvanceLayers(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  now: number,
) {
  const profile = await loadProfile(ctx, worldId, actorId);
  if (!profile || isActorDeceased(profile) || isActorIncapacitated(profile.health)) return;
  const realm = profile.realm;
  let realmStage = profile.realmStage;
  let cultivationXp = profile.cultivationXp;
  let mood = profile.mood;
  let guard = 0;
  while (guard++ < 20) {
    if (realmStage >= realmMaxStage(realm)) break;
    const threshold = breakthroughThreshold(realm, realmStage);
    if (cultivationXp < threshold) break;
    realmStage += 1;
    cultivationXp -= threshold;
    mood = clamp(mood + 1, -5, 5);
    await ctx.db.patch(profile._id, { realmStage, cultivationXp, mood });
    await appendWorldEvent(ctx, {
      worldId,
      type: 'breakthrough_resolved',
      createdAt: now,
      actorIds: [actorId],
      visibility: 'local',
      summary: `${profile.name}水到渠成，晋入${realmDisplayName(realm)} ${realmStage} 层。`,
      facts: versionDurableEventFacts({ resultCode: 'breakthrough_success' }),
    });
  }
}
