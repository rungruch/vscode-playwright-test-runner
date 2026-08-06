import { expect, test } from '@playwright/test';

test.describe('tagged group', { tag: '@suite' }, () => {
  test('works', { tag: '@test' }, async () => {
    expect(true).toBe(true);
  });
});
