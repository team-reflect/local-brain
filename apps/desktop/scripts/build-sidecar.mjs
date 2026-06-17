// Build the `brain` CLI (apps/cli) and stage it where Tauri's sidecar bundling
// expects it: src-tauri/binaries/brain-<target-triple>[.exe].
//
// Wired into the Tauri lifecycle from Plan 07 onward via the desktop
// `beforeDevCommand`/`beforeBuildCommand` (`pnpm sidecar && ...`). Requires a
// Rust toolchain (`cargo`, `rustc`).

import { execFileSync, execSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const platform = process.env.TAURI_ENV_PLATFORM ?? ''
if (platform === 'ios' || platform === 'android') {
  console.log(`build-sidecar: skipping on ${platform}`)
  process.exit(0)
}

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const binariesDir = join(here, '..', 'src-tauri', 'binaries')

// Tauri exports TAURI_ENV_TARGET_TRIPLE during a build; otherwise use the host.
const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ??
  execSync('rustc -vV', { encoding: 'utf8' }).match(/^host: (\S+)$/m)?.[1]
if (!triple) {
  throw new Error('build-sidecar: could not determine the target triple from `rustc -vV`')
}

const SIDECARS = [{ crate: 'brain-cli', binary: 'brain' }]

// Build with an explicit --target so artifacts land in target/<triple>/release/.
const packageArgs = SIDECARS.flatMap(({ crate }) => ['-p', crate])
execFileSync('cargo', ['build', '--release', ...packageArgs, '--target', triple], {
  cwd: repoRoot,
  stdio: 'inherit',
})

const extension = triple.includes('windows') ? '.exe' : ''
mkdirSync(binariesDir, { recursive: true })
for (const { binary } of SIDECARS) {
  const built = join(repoRoot, 'target', triple, 'release', `${binary}${extension}`)
  const staged = join(binariesDir, `${binary}-${triple}${extension}`)
  copyFileSync(built, staged)
  console.log(`build-sidecar: staged ${staged}`)
}
