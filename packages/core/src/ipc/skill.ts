import { z } from 'zod'
import { call } from './invoke'

const skillInstallStateSchema = z.enum(['unsupported', 'missing', 'current', 'stale', 'conflict'])

const skillStatusSchema = z.object({
  supported: z.boolean(),
  installTargetPath: z.string(),
  installTargetDir: z.string(),
  bundledHash: z.string(),
  installedHash: z.string().nullable(),
  installState: skillInstallStateSchema,
})

export type SkillInstallState = z.infer<typeof skillInstallStateSchema>
export type SkillStatus = z.infer<typeof skillStatusSchema>

export function skillStatus(): Promise<SkillStatus> {
  return call('skill_status', {}, skillStatusSchema)
}

export function skillInstall(): Promise<SkillStatus> {
  return call('skill_install', {}, skillStatusSchema)
}

export function skillUninstall(): Promise<SkillStatus> {
  return call('skill_uninstall', {}, skillStatusSchema)
}
