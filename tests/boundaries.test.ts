import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageDir = resolve(__dirname, '../src')

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })

const importSpecifiers = (file: string): string[] => {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '')
}

const packageFiles = listFiles(packageDir)
const coreFiles = packageFiles.filter((file) => !file.includes('/adapters/'))
const adapterFiles = packageFiles.filter((file) => file.includes('/adapters/'))

describe('import boundaries', () => {
  it('core files import only package-internal modules, the schema spec types, and node:crypto in session.ts', () => {
    for (const file of coreFiles) {
      const name = relative(packageDir, file)
      for (const specifier of importSpecifiers(file)) {
        const allowed = specifier.startsWith('./')
          || specifier === '@standard-schema/spec'
          || (name === 'session.ts' && specifier === 'node:crypto')
        expect(allowed, `${name} imports ${specifier}`).toBe(true)
      }
    }
  })

  it('adapters import only express and package-internal modules', () => {
    expect(adapterFiles.length).toBeGreaterThan(0)
    for (const file of adapterFiles) {
      const name = relative(packageDir, file)
      for (const specifier of importSpecifiers(file)) {
        const allowed = specifier === 'express'
          || (specifier.startsWith('../') && !specifier.startsWith('../../'))
        expect(allowed, `${name} imports ${specifier}`).toBe(true)
      }
    }
  })

  it('keeps the root entry browser-safe', () => {
    const browserSafe = new Set(['index.ts', 'contract.ts', 'handoff.ts'])
    const visited = new Set<string>()
    const queue = [join(packageDir, 'index.ts')]
    while (queue.length > 0) {
      const file = queue.pop()!
      if (visited.has(file)) continue
      visited.add(file)
      const name = relative(packageDir, file)
      expect(browserSafe.has(name), `root entry reaches ${name}`).toBe(true)
      for (const specifier of importSpecifiers(file)) {
        expect(specifier.startsWith('node:'), `${name} imports ${specifier}`).toBe(false)
        expect(specifier === 'express', `${name} imports express`).toBe(false)
        if (specifier.startsWith('./')) {
          queue.push(join(packageDir, `${specifier.slice(2)}.ts`))
        }
      }
    }
  })
})
