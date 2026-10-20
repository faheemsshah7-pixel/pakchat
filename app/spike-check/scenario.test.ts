// Runs the exact test the phone runs (src/spike/scenario.ts), with Signal's Node library.
import { expect, test } from 'vitest';

import { runScenario } from '../src/spike/scenario';
import { nodeSignal } from './nodeSignal';

test('phase 1: two phones and a group, one goes offline and catches up', async () => {
  const steps = await runScenario(nodeSignal());
  for (const s of steps) console.log(`${s.ok ? '✓' : '✗'} ${s.title} (${s.ms} ms): ${s.detail}`);
  expect(steps.filter((s) => !s.ok)).toEqual([]);
  expect(steps.length).toBe(10);
});
