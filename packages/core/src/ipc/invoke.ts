import type { ZodType } from 'zod'
import { type AppError, toAppError } from '../errors'
import { getBridge } from './bridge'

/**
 * The single boundary where an untyped native IPC response becomes a typed,
 * validated domain value.
 *
 * Components and hooks must never reach for the bridge (or `@tauri-apps/api`)
 * directly — they call a typed binding (see the per-domain command modules) that
 * funnels through here. Every response is validated with a zod schema; Rust emits
 * camelCase keys so the parsed value needs no further normalization.
 *
 * On failure this always throws an {@link AppError}: a rejected command is coerced
 * via {@link toAppError}; a response that doesn't match `schema` becomes a `parse`
 * error. Callers can branch on `error.kind`.
 */
export async function call<TOutput>(
  command: string,
  args: Record<string, unknown>,
  schema: ZodType<TOutput, unknown>,
): Promise<TOutput> {
  const bridge = getBridge()

  let raw: unknown
  try {
    raw = await bridge.invoke(command, args)
  } catch (error) {
    throw toAppError(error)
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    const appError: AppError = {
      kind: 'parse',
      message: `unexpected response shape from "${command}": ${result.error.message}`,
    }
    throw appError
  }
  return result.data
}
