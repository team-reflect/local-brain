import { z } from 'zod'
import { call } from './invoke'

const cliInstallStateSchema = z.enum(['unsupported', 'missing', 'current', 'stale', 'conflict'])

const cliStatusSchema = z.object({
  supported: z.boolean(),
  bundledPath: z.string(),
  bundledVersion: z.string().nullable(),
  installTargetPath: z.string(),
  installTargetDir: z.string(),
  targetDirOnPath: z.boolean(),
  installedPath: z.string().nullable(),
  installedVersion: z.string().nullable(),
  installState: cliInstallStateSchema,
})

export type CliInstallState = z.infer<typeof cliInstallStateSchema>
export type CliStatus = z.infer<typeof cliStatusSchema>

export function cliStatus(): Promise<CliStatus> {
  return call('cli_status', {}, cliStatusSchema)
}

export function cliInstall(): Promise<CliStatus> {
  return call('cli_install', {}, cliStatusSchema)
}

export function cliUninstall(): Promise<CliStatus> {
  return call('cli_uninstall', {}, cliStatusSchema)
}
