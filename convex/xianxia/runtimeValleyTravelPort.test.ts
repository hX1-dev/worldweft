import { createValleyTravelPort, type ValleyTravelReceipt } from './runtimeValleyTravelPort';

test('Valley travel port delegates the existing reservation and preserves the layered receipt', async () => {
  const port = createValleyTravelPort({
    reserve: async (target: string) => ({ target, commandId: 'c1', revision: 4 }),
  });
  await expect(port.reserve('dew-herb')).resolves.toEqual({ target: 'dew-herb', commandId: 'c1', revision: 4 });
  const receipt: ValleyTravelReceipt = {
    commandId: 'c1',
    revision: 4,
    frameBodyAuthoritative: true,
    reservationRetained: true,
    terminalLayer: 'movement',
  };
  expect(port.receipt(receipt)).toBe(receipt);
});
