import { expect, test } from '@playwright/test';

test('snapshot test', async () => {
  expect('hello playwright').toMatchSnapshot('greeting.txt');
});
