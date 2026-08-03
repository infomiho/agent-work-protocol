import type { JsonPatchOperation } from './revision'
import type { JsonValue } from './contract'
import { cloneJson, isReservedJsonKey, jsonByteLength } from './json'

export type JsonPatchLimits = {
  maxOperations: number
  maxPointerLength: number
  maxPointerDepth: number
  maxResultBytes: number
}

export const defaultJsonPatchLimits: JsonPatchLimits = {
  maxOperations: 100,
  maxPointerLength: 1_024,
  maxPointerDepth: 64,
  maxResultBytes: 1_048_576,
}

export type JsonPatchResult =
  | { ok: true; document: JsonValue }
  | { ok: false; code: string; message: string; operation?: number }

export const applyJsonPatch = (
  input: JsonValue,
  operations: readonly JsonPatchOperation[],
  configuredLimits: Partial<JsonPatchLimits> = {},
): JsonPatchResult => {
  const limits = { ...defaultJsonPatchLimits, ...configuredLimits }
  if (operations.length > limits.maxOperations) {
    return { ok: false, code: 'patch.operation-limit', message: `Patch exceeds ${limits.maxOperations} operations.` }
  }
  let document = cloneJson(input)
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]!
    const path = parsePointer(operation.path, limits)
    if (!path.ok) return { ...path, operation: index }
    const from = 'from' in operation ? parsePointer(operation.from, limits) : undefined
    if (from && !from.ok) return { ...from, operation: index }
    try {
      if (operation.op === 'add') document = add(document, path.segments, cloneJson(operation.value))
      if (operation.op === 'remove') document = remove(document, path.segments).document
      if (operation.op === 'replace') {
        get(document, path.segments)
        document = path.segments.length === 0
          ? cloneJson(operation.value)
          : add(document, path.segments, cloneJson(operation.value), true)
      }
      if (operation.op === 'test' && !deepEqual(get(document, path.segments), operation.value)) {
        throw new PatchError('patch.test-failed', 'The test operation failed.')
      }
      if (operation.op === 'copy' && from?.ok) {
        document = add(document, path.segments, cloneJson(get(document, from.segments)))
      }
      if (operation.op === 'move' && from?.ok) {
        if (isProperPrefix(from.segments, path.segments)) {
          throw new PatchError('patch.invalid-move', 'A value cannot be moved into one of its children.')
        }
        const removed = remove(document, from.segments)
        document = add(removed.document, path.segments, removed.value)
      }
    } catch (error) {
      const patchError = error instanceof PatchError
        ? error
        : new PatchError('patch.invalid-operation', 'The operation cannot be applied.')
      return { ok: false, code: patchError.code, message: patchError.message, operation: index }
    }
  }
  if (jsonByteLength(document) > limits.maxResultBytes) {
    return { ok: false, code: 'patch.result-limit', message: `Patched work exceeds ${limits.maxResultBytes} bytes.` }
  }
  return { ok: true, document }
}

const parsePointer = (pointer: string, limits: JsonPatchLimits):
  | { ok: true; segments: string[] }
  | { ok: false; code: string; message: string } => {
  if (pointer.length > limits.maxPointerLength) {
    return { ok: false, code: 'patch.pointer-limit', message: 'A JSON Pointer is too long.' }
  }
  if (pointer === '') return { ok: true, segments: [] }
  if (!pointer.startsWith('/')) return { ok: false, code: 'patch.invalid-pointer', message: 'JSON Pointers must be empty or start with /.' }
  const encoded = pointer.slice(1).split('/')
  if (encoded.length > limits.maxPointerDepth) {
    return { ok: false, code: 'patch.pointer-depth', message: 'A JSON Pointer is too deep.' }
  }
  const segments: string[] = []
  for (const segment of encoded) {
    if (/~(?:[^01]|$)/.test(segment)) {
      return { ok: false, code: 'patch.invalid-pointer', message: 'A JSON Pointer contains an invalid escape.' }
    }
    const decoded = segment.replaceAll('~1', '/').replaceAll('~0', '~')
    if (isReservedJsonKey(decoded)) {
      return { ok: false, code: 'patch.unsafe-pointer', message: 'Prototype-related JSON Pointer segments are forbidden.' }
    }
    segments.push(decoded)
  }
  return { ok: true, segments }
}

const get = (document: JsonValue, segments: readonly string[]): JsonValue => {
  let value = document
  for (const segment of segments) {
    if (Array.isArray(value)) {
      const index = existingArrayIndex(segment, value.length)
      value = value[index]!
    } else if (isObject(value) && Object.hasOwn(value, segment)) {
      value = value[segment]!
    } else {
      throw new PatchError('patch.path-not-found', 'A JSON Pointer does not exist.')
    }
  }
  return value
}

const parent = (document: JsonValue, segments: readonly string[]) => {
  if (segments.length === 0) throw new PatchError('patch.root-operation', 'This operation cannot remove the document root.')
  return { container: get(document, segments.slice(0, -1)), key: segments.at(-1)! }
}

const add = (document: JsonValue, segments: readonly string[], value: JsonValue, replacing = false): JsonValue => {
  if (segments.length === 0) return value
  const { container, key } = parent(document, segments)
  if (Array.isArray(container)) {
    if (replacing) container[existingArrayIndex(key, container.length)] = value
    else container.splice(addArrayIndex(key, container.length), 0, value)
    return document
  }
  if (!isObject(container)) throw new PatchError('patch.path-not-found', 'The target parent is not a container.')
  if (replacing && !Object.hasOwn(container, key)) throw new PatchError('patch.path-not-found', 'The target does not exist.')
  container[key] = value
  return document
}

const remove = (document: JsonValue, segments: readonly string[]) => {
  const { container, key } = parent(document, segments)
  if (Array.isArray(container)) {
    const [value] = container.splice(existingArrayIndex(key, container.length), 1)
    return { document, value: value! }
  }
  if (!isObject(container) || !Object.hasOwn(container, key)) {
    throw new PatchError('patch.path-not-found', 'The target does not exist.')
  }
  const value = container[key]!
  delete container[key]
  return { document, value }
}

const existingArrayIndex = (segment: string, length: number) => {
  const index = arrayIndex(segment)
  if (index >= length) throw new PatchError('patch.array-index', 'The array index does not exist.')
  return index
}

const addArrayIndex = (segment: string, length: number) => {
  if (segment === '-') return length
  const index = arrayIndex(segment)
  if (index > length) throw new PatchError('patch.array-index', 'The array index is beyond the end of the array.')
  return index
}

const arrayIndex = (segment: string) => {
  if (!/^(0|[1-9]\d*)$/.test(segment)) throw new PatchError('patch.array-index', 'The array index is invalid.')
  const index = Number(segment)
  if (!Number.isSafeInteger(index)) throw new PatchError('patch.array-index', 'The array index is invalid.')
  return index
}

const isObject = (value: JsonValue): value is { [key: string]: JsonValue } => typeof value === 'object' && value !== null && !Array.isArray(value)
const isProperPrefix = (prefix: readonly string[], value: readonly string[]) => prefix.length < value.length && prefix.every((part, index) => value[index] === part)
const deepEqual = (left: JsonValue, right: JsonValue): boolean => {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]!))
  }
  if (isObject(left) && isObject(right)) {
    const keys = Object.keys(left)
    return keys.length === Object.keys(right).length
      && keys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key]!, right[key]!))
  }
  return false
}

class PatchError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}
