import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    server: 'src/server.ts',
    'adapters/express': 'src/adapters/express.ts',
  },
  dts: true,
  exports: true,
  publint: true,
})
