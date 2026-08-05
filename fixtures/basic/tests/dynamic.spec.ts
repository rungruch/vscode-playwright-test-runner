import { expect, test } from '@playwright/test';

for (const value of [1, 2, 3]) {
  test(`dynamic case ${value}`, async () => {
    expect(value).toBeGreaterThan(0);
  });
}
