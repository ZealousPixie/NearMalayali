/// <reference types="node" />
// Every error code the database can raise must have a message people can act on.
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { friendlyError } from '../errors';

const dir = join(__dirname, '../../../supabase/migrations');
const codes = new Set<string>();
for (const file of readdirSync(dir)) {
  for (const m of readFileSync(join(dir, file), 'utf8').matchAll(/raise exception '([A-Z_]+)'/g)) codes.add(m[1]);
}

describe('server error codes', () => {
  it('finds the codes', () => {
    expect(codes.size).toBeGreaterThan(40);
  });
  it.each([...codes])('%s has a friendly message', (code) => {
    expect(friendlyError({ message: code })).not.toBe('Something went wrong. Please try again.');
  });
});
