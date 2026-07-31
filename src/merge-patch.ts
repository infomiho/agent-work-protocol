// RFC 7396: objects merge recursively, null deletes keys, everything else
// replaces wholesale. '__proto__' is skipped: assigning it would change the
// object's prototype.
export const applyJsonMergePatch = (target: unknown, patch: unknown): unknown => {
  if (!isJsonObject(patch)) {
    return patch
  }
  const merged: Record<string, unknown> = isJsonObject(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__') {
      continue
    }
    if (value === null) {
      delete merged[key]
    } else {
      merged[key] = applyJsonMergePatch(merged[key], value)
    }
  }
  return merged
}

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
