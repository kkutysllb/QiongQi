import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const pkgNames = [
  'contracts', 'domain', 'ports', 'cache', 'loop', 'services',
  'adapter-model', 'adapter-storage', 'adapter-tools', 'skills',
  'memory', 'attachments', 'delegation', 'http', 'cli',
]

const alias = {}
for (const name of pkgNames) {
  alias[`@qiongqi/${name}`] = resolve(__dirname, 'packages', name, 'src')
}

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
})
