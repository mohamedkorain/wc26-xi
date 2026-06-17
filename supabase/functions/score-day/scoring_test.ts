import { normaliseName } from './scoring.ts';

Deno.test('normaliseName keeps Scandinavian roster names matchable', () => {
  const cases: Array<[string, string]> = [
    ['ØDEGAARD Martin', 'odegaard martin'],
    ['Martin Odegaard', 'martin odegaard'],
    ['MØLLER WOLFE David', 'moller wolfe david'],
    ['SØRLOTH Alexander', 'sorloth alexander'],
    ['BJØRKAN Fredrik Andre', 'bjorkan fredrik andre'],
  ];

  for (const [input, expected] of cases) {
    const actual = normaliseName(input);
    if (actual !== expected) {
      throw new Error(`Expected ${input} -> ${expected}, got ${actual}`);
    }
  }
});
