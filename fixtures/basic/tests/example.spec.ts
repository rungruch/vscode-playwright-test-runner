import { expect, test } from '@playwright/test';

test.describe('Math', () => {
  test('adds numbers', async () => {
    expect(1 + 1).toBe(2);
  });

  test.describe('nested', () => {
    test('multiplies numbers', async () => {
      expect(2 * 3).toBe(6);
    });
  });
});

test('duplicate title', async () => {
  expect(true).toBe(true);
});

test.describe('dup', () => {
  test('duplicate title', async () => {
    expect(true).toBe(true);
  });
});

test.skip('skipped test', async () => {
  expect(true).toBe(false);
});
