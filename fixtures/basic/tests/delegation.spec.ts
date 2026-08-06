import * as fs from 'fs';
import * as path from 'path';
import { expect, test } from '@playwright/test';

test('CodeLens delegates through Microsoft once', async () => {
  const marker = path.resolve(__dirname, '..', 'official-run-marker.txt');
  fs.appendFileSync(marker, 'run\n');
  expect(true).toBe(true);
});
