export type AiTownTravelLifecycle =
  | 'accepted'
  | 'moving'
  | 'arrived'
  | 'blocked'
  | 'cancelled';

export type AiTownTravelReceipt = {
  lifecycle: AiTownTravelLifecycle;
  replay: boolean;
  restarted: boolean;
};

export type AiTownTravelPort<Input, Result> = {
  resolve(input: Input): Promise<Result>;
  receipt(input: AiTownTravelReceipt): AiTownTravelReceipt;
};

/**
 * Delegates the existing AI Town travel authority. It owns neither route
 * state nor terminal writes; lifecycle facts remain the movement authority's.
 */
export function createAiTownTravelPort<Input, Result>(delegates: {
  resolve(input: Input): Promise<Result>;
}): AiTownTravelPort<Input, Result> {
  return {
    resolve: (input) => delegates.resolve(input),
    receipt: (input) => input,
  };
}
