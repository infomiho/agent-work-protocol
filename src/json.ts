import type { Diagnostic, JsonValue } from './contract'

export const reservedJsonKeys = ['__proto__', 'prototype', 'constructor'] as const

export const isReservedJsonKey = (key: string) => reservedJsonKeys.some((reserved) => reserved === key)

export const isJsonValue = (value: unknown): value is JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null)
    && Object.entries(value).every(([key, entry]) => !isReservedJsonKey(key) && isJsonValue(entry))
}

export const cloneJson = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const canonicalJson = <T extends JsonValue>(value: unknown):
  | { ok: true; value: T }
  | { ok: false; diagnostic: Diagnostic } => {
  if (isJsonValue(value)) return { ok: true, value: cloneJson(value) as T }
  return {
    ok: false,
    diagnostic: {
      severity: 'error',
      code: 'work.structure',
      message: 'The schema decoder must return canonical JSON without reserved prototype-related keys.',
      pointer: '',
    },
  }
}

export const jsonByteLength = (value: JsonValue) => new TextEncoder().encode(JSON.stringify(value)).byteLength
