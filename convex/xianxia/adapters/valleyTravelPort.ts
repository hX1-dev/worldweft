export type ValleyTravelReceipt = {
  commandId: string;
  revision: number;
  frameBodyAuthoritative: true;
  reservationRetained: true;
  terminalLayer: 'movement';
};

export type ValleyTravelPort<Input, Result> = {
  reserve(input: Input): Promise<Result>;
  receipt(input: ValleyTravelReceipt): ValleyTravelReceipt;
};

/**
 * Delegates the existing reservation writer. Godot frame reports and the
 * layered terminal remain owned by the pre-existing Valley movement authority.
 */
export function createValleyTravelPort<Input, Result>(delegates: {
  reserve(input: Input): Promise<Result>;
}): ValleyTravelPort<Input, Result> {
  return {
    reserve: (input) => delegates.reserve(input),
    receipt: (input) => input,
  };
}
