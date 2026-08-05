import { expect, test } from '@playwright/test';

test('slow test for cancellation', async () => {
  await new Promise((resolve) => setTimeout(resolve, 60000));
  expect(true).toBe(true);
});
