import { describe, expect, it } from 'vitest'
import { applyJsonMergePatch } from '../src/merge-patch'

describe('RFC 7396 appendix A test cases', () => {
  it.each([
    ['{"a":"b"}', '{"a":"c"}', '{"a":"c"}'],
    ['{"a":"b"}', '{"b":"c"}', '{"a":"b","b":"c"}'],
    ['{"a":"b"}', '{"a":null}', '{}'],
    ['{"a":"b","b":"c"}', '{"a":null}', '{"b":"c"}'],
    ['{"a":["b"]}', '{"a":"c"}', '{"a":"c"}'],
    ['{"a":"c"}', '{"a":["b"]}', '{"a":["b"]}'],
    ['{"a":{"b":"c"}}', '{"a":{"b":"d","c":null}}', '{"a":{"b":"d"}}'],
    ['{"a":[{"b":"c"}]}', '{"a":[1]}', '{"a":[1]}'],
    ['["a","b"]', '["c","d"]', '["c","d"]'],
    ['{"a":"b"}', '["c"]', '["c"]'],
    ['{"a":"foo"}', 'null', 'null'],
    ['{"a":"foo"}', '"bar"', '"bar"'],
    ['{"e":null}', '{"a":1}', '{"e":null,"a":1}'],
    ['[1,2]', '{"a":"b","c":null}', '{"a":"b"}'],
    ['{}', '{"a":{"bb":{"ccc":null}}}', '{"a":{"bb":{}}}'],
  ])('target %s with patch %s gives %s', (target, patch, result) => {
    expect(applyJsonMergePatch(JSON.parse(target), JSON.parse(patch))).toEqual(JSON.parse(result))
  })
})

describe('prototype safety', () => {
  it('skips __proto__ keys instead of assigning them', () => {
    const patch = JSON.parse('{"__proto__": {"polluted": true}, "name": "Renamed"}')

    const merged = applyJsonMergePatch({ name: 'Original' }, patch) as Record<string, unknown>

    expect(Object.prototype).not.toHaveProperty('polluted')
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
    expect(merged.polluted).toBeUndefined()
    expect(merged.name).toBe('Renamed')
  })
})
