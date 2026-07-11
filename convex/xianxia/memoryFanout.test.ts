import { memoryFanoutDeliveriesForPage, shouldRunMemoryFanoutJob } from './memory';
import type { RumorActor, RumorEvent } from './rumorLogic';

const principals: RumorActor[] = [
  { actorId: 'actor', currentLocationId: 'market', reputation: 20 },
  { actorId: 'target', currentLocationId: 'market', reputation: 0 },
];

function event(visibility: RumorEvent['visibility']): RumorEvent {
  return {
    eventId: 'event-1',
    type: 'spar_resolved',
    visibility,
    actorIds: ['actor'],
    targetActorIds: ['target'],
    locationId: 'market',
    summary: 'A bounded fanout event.',
  };
}

describe('memory fanout pages', () => {
  test('only a pending durable job may write a fanout page', () => {
    expect(shouldRunMemoryFanoutJob(null)).toBe(false);
    expect(shouldRunMemoryFanoutJob({ status: 'completed' })).toBe(false);
    expect(shouldRunMemoryFanoutJob({ status: 'pending' })).toBe(true);
  });

  test('delivers a public event to every non-principal exactly once across pages', () => {
    const actors = Array.from({ length: 120 }, (_, index) => ({
      actorId: `resident-${String(index).padStart(3, '0')}`,
      currentLocationId: index % 2 === 0 ? 'market' : 'mountain',
      reputation: 0,
    }));
    const deliveries = [actors.slice(0, 50), actors.slice(50, 100), actors.slice(100)].flatMap(
      (page) => memoryFanoutDeliveriesForPage(event('public'), page, principals),
    );

    expect(deliveries).toHaveLength(120);
    expect(new Set(deliveries.map((delivery) => delivery.actorId)).size).toBe(120);
    expect(deliveries.every((delivery) => delivery.source === 'present')).toBe(true);
  });

  test('keeps local visibility and principal exclusion stable at page boundaries', () => {
    const page = [
      principals[0],
      { actorId: 'present', currentLocationId: 'market', reputation: 0 },
      { actorId: 'away', currentLocationId: 'mountain', reputation: 0 },
    ];
    const deliveries = memoryFanoutDeliveriesForPage(event('local'), page, principals);

    expect(deliveries.map((delivery) => delivery.actorId)).toEqual(['present']);
  });

  test('rumor delivery remains deterministic when principals are supplied to each page', () => {
    const page = Array.from({ length: 50 }, (_, index) => ({
      actorId: `listener-${index}`,
      currentLocationId: 'elsewhere',
      reputation: 0,
    }));
    const first = memoryFanoutDeliveriesForPage(event('rumor'), page, principals);
    const second = memoryFanoutDeliveriesForPage(event('rumor'), page, principals);

    expect(second).toEqual(first);
  });
});
