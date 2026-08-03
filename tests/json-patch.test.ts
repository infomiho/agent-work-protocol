import { describe, expect, it } from 'vitest'
import { applyJsonPatch } from '../src/server'

describe('constrained RFC 6902 JSON Patch profile', () => {
  it('supports representative object, array, copy, move, and test operations', () => {
    const result = applyJsonPatch(
      { name: 'Signal', tags: ['bold'], settings: { foreground: 'white', background: 'black' } },
      [
        { op: 'test', path: '/settings', value: { background: 'black', foreground: 'white' } },
        { op: 'add', path: '/tags/0', value: 'first' },
        { op: 'add', path: '/tags/-', value: 'last' },
        { op: 'copy', from: '/name', path: '/copy' },
        { op: 'move', from: '/copy', path: '/moved' },
        { op: 'replace', path: '/name', value: 'Patched' },
        { op: 'remove', path: '/moved' },
      ],
    )
    expect(result).toEqual({ ok: true, document: { name: 'Patched', tags: ['first', 'bold', 'last'], settings: { foreground: 'white', background: 'black' } } })
  })

  it.each([
    ['missing path', [{ op: 'remove', path: '/missing' }], 'patch.path-not-found', 0],
    ['failed test', [{ op: 'test', path: '/name', value: 'Other' }], 'patch.test-failed', 0],
    ['bad array index', [{ op: 'replace', path: '/tags/01', value: 'x' }], 'patch.array-index', 0],
    ['array beyond end', [{ op: 'add', path: '/tags/2', value: 'x' }], 'patch.array-index', 0],
    ['move into child', [{ op: 'move', from: '/settings', path: '/settings/nested' }], 'patch.invalid-move', 0],
    ['invalid pointer escape', [{ op: 'remove', path: '/bad~2key' }], 'patch.invalid-pointer', 0],
    ['reserved key', [{ op: 'add', path: '/constructor', value: {} }], 'patch.unsafe-pointer', 0],
  ] as const)('reports %s with a stable code and operation index', (_label, operations, code, operation) => {
    expect(applyJsonPatch({ name: 'Signal', tags: ['bold'], settings: {} }, operations)).toMatchObject({ ok: false, code, operation })
  })

  it('bounds operations, pointers, and resulting JSON size', () => {
    expect(applyJsonPatch({}, [{ op: 'add', path: '/a', value: 1 }], { maxOperations: 0 })).toMatchObject({ code: 'patch.operation-limit' })
    expect(applyJsonPatch({}, [{ op: 'add', path: '/long', value: true }], { maxPointerLength: 4 })).toMatchObject({ code: 'patch.pointer-limit' })
    expect(applyJsonPatch({}, [{ op: 'add', path: '/one/two', value: true }], { maxPointerDepth: 1 })).toMatchObject({ code: 'patch.pointer-depth' })
    expect(applyJsonPatch({}, [{ op: 'add', path: '/large', value: '0123456789' }], { maxResultBytes: 5 })).toMatchObject({ code: 'patch.result-limit' })
  })
})
