// Schema/codegen drift check.
//
// Regenerates the Kysely types from the Rust migrations (in memory) and
// compares them to the committed packages/db/src/schema.gen.ts. Exits non-zero
// if they differ, so a migration change that isn't reflected in the generated
// types fails the build. Wired into the db package's `test` script, so it runs
// as part of `pnpm check`.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSchemaSource } from './generate-schema.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const generatedFile = join(here, '..', 'src', 'schema.gen.ts')

const expected = generateSchemaSource()
const actual = readFileSync(generatedFile, 'utf8')

if (actual !== expected) {
  console.error(
    'schema drift: packages/db/src/schema.gen.ts is out of date with the\n' +
      'crates/brain-schema migrations. Run `pnpm --filter @local-brain/db db:codegen`\n' +
      'and commit the result.',
  )
  process.exit(1)
}

console.log('check-drift: schema.gen.ts matches the migrations')
