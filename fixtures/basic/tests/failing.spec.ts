import { expect, test } from '@playwright/test';

test('always fails', async () => {
  expect(1).toBe(2);
});
