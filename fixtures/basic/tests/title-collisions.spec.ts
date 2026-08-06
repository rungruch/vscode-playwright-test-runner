import { expect, test } from '@playwright/test';

test.describe('foo', () => {
  test('bar', async () => {
    expect(true).toBe(true);
  });
});

test('foo bar', async () => {
  expect(true).toBe(true);
});

test.describe('foo bar', () => {
  test('child', async () => {
    expect(true).toBe(true);
  });
});
