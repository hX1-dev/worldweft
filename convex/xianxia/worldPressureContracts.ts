export const WORLD_PRESSURE_CONTRACT_VERSION = 'taixu.world-pressure.v1' as const;

export const WORLD_PRESSURE_LIMITS = {
  activePerWorld: 1,
  observedPerActor: 4,
  affectedResourceNodes: 4,
  durationGameHours: 12,
  minimumDurationGameHours: 6,
  maximumDurationGameHours: 24,
  cooldownGameHours: 168,
  severity: 60,
  minimumSeverity: 40,
  maximumSeverity: 70,
} as const;

export type WorldPressureKind = 'herb_miasma';
export type WorldPressureStatus = 'active' | 'resolved' | 'cancelled';
export type WorldPressureEffectCode = 'resource_refresh_delayed';

export type ActiveWorldPressure = {
  contractVersion: typeof WORLD_PRESSURE_CONTRACT_VERSION;
  pressureId: string;
  revision: number;
  kind: WorldPressureKind;
  status: 'active';
  mapId: string;
  locationId: string;
  affectedResourceNodeIds: string[];
  severity: number;
  effectCodes: WorldPressureEffectCode[];
  startedAt: number;
  startsAtGameHour: number;
  endsAt: number;
  endsAtGameHour: number;
  sourceEventId: string;
};

export type ObservedWorldPressure = Pick<
  ActiveWorldPressure,
  | 'pressureId'
  | 'revision'
  | 'kind'
  | 'status'
  | 'mapId'
  | 'locationId'
  | 'affectedResourceNodeIds'
  | 'severity'
  | 'effectCodes'
  | 'endsAt'
  | 'endsAtGameHour'
  | 'sourceEventId'
>;

export type WorldPressureResponse =
  | 'withdraw'
  | 'investigate'
  | 'aid'
  | 'report'
  | 'profit';

export type WorldDirectorTickResult =
  | {
      outcome: 'started';
      pressureId: string;
      sourceEventId: string;
      affectedResourceNodeIds: string[];
    }
  | {
      outcome: 'resolved';
      pressureId: string;
      terminalEventId: string;
    }
  | {
      outcome:
        | 'disabled'
        | 'active_pressure'
        | 'cooldown'
        | 'no_compatible_scope';
      pressureId?: string;
      nextEligibleGameHour?: number;
    };
