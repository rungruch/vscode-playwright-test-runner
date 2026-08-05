import { expect, test } from '@playwright/test';

test.describe('Math', () => {
  test('adds numbers', async () => {
    expect(1 + 1).toBe(2);
  });
});
