import { expect, test } from '@playwright/test';

for (const title of ['admin', 'superadmin', 'super admin', 'foo bar', 'foobar']) {
  test(title, async () => {
    expect(title.length).toBeGreaterThan(0);
  });
}
