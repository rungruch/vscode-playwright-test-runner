import { expect, test } from '@playwright/test';

test.describe('nested suite', () => {
  test('nested test', async () => {
    expect(true).toBe(true);
  });
});
