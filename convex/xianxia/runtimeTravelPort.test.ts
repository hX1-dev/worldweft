import { createAiTownTravelPort, type AiTownTravelReceipt } from './runtimeTravelPort';

test('AI Town travel port delegates resolution and preserves lifecycle receipts', async () => {
  const resolved = { ok: true as const, destination: { x: 4, y: 7 } };
  const port = createAiTownTravelPort({ resolve: async (input: string) => ({ ...resolved, input }) });
  await expect(port.resolve('market')).resolves.toEqual({ ...resolved, input: 'market' });

  const receipts: AiTownTravelReceipt[] = [
    { lifecycle: 'accepted', replay: false, restarted: false },
    { lifecycle: 'moving', replay: false, restarted: false },
    { lifecycle: 'arrived', replay: false, restarted: false },
    { lifecycle: 'blocked', replay: false, restarted: true },
    { lifecycle: 'cancelled', replay: true, restarted: false },
  ];
  for (const receipt of receipts) expect(port.receipt(receipt)).toBe(receipt);
});
