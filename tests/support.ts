import type { WorkModel } from '../src/contract'

export type TestDocument = { name: string; tags: string[] }

export const model: WorkModel<TestDocument> = {
  id: 'theme',
  version: '1',
  schema: {
    decoder: {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string'
          && Array.isArray((value as { tags?: unknown }).tags)
          ? { value: value as TestDocument }
          : { issues: [{ message: 'Invalid theme.' }] },
      },
    },
    jsonSchema: { type: 'object', required: ['name', 'tags'] },
  },
  assess: (document) => ({
    diagnostics: document.name === ''
      ? [{ severity: 'error', code: 'theme.name', message: 'Name is required.', pointer: '/name' }]
      : [],
  }),
  authoring: {
    title: 'Theme',
    description: 'A screenshot theme.',
    examples: [{ name: 'Signal', tags: ['bold'] }],
    diagnostics: [{ code: 'theme.name', title: 'Name', description: 'A name is required.' }],
  },
}
