import { retryWithBackoff } from './llm';

describe('bounded LLM transport retries', () => {
  test('maxRetries=0 performs exactly one provider attempt', async () => {
    let attempts = 0;
    await expect(
      retryWithBackoff(async () => {
        attempts += 1;
        throw { retry: true, error: new Error('fixture failure') };
      }, 0),
    ).rejects.toThrow('fixture failure');
    expect(attempts).toBe(1);
  });

  test('non-retryable failures never enter backoff', async () => {
    let attempts = 0;
    await expect(
      retryWithBackoff(async () => {
        attempts += 1;
        throw { retry: false, error: new Error('do not retry') };
      }),
    ).rejects.toThrow('do not retry');
    expect(attempts).toBe(1);
  });
});
