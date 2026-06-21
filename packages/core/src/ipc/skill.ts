import { z } from 'zod'
import { call } from './invoke'

const skillInstallStateSchema = z.enum(['unsupported', 'missing', 'current', 'stale', 'conflict'])

const managedSkillStatusSchema = z.object({
  id: z.string(),
  installTargetDir: z.string(),
  bundledHash: z.string(),
  installedHash: z.string().nullable(),
  installState: skillInstallStateSchema,
})

const skillStatusSchema = z.object({
  supported: z.boolean(),
  installTargetDir: z.string(),
  installState: skillInstallStateSchema,
  skills: z.array(managedSkillStatusSchema),
})

export type SkillInstallState = z.infer<typeof skillInstallStateSchema>
export type ManagedSkillStatus = z.infer<typeof managedSkillStatusSchema>
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
