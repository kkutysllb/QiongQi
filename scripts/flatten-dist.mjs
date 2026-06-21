#!/usr/bin/env node
/**
 * Post-build script: flatten nested dist output.
 *
 * When tsconfig.build.json uses `paths` mapping pointing to other packages' src/,
 * TypeScript outputs a nested structure like:
 *   dist/adapter-tools/src/index.js  (the package's own files)
 *   dist/contracts/src/index.js      (dependency files, duplicated)
 *
 * This script flattens the package's own files to dist/ root level
 * and removes the duplicated dependency directories.
 */
import { readdirSync, statSync, existsSync, rmSync, cpSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'

const packagesDir = resolve(import.meta.dirname, '..', 'packages')

for (const pkg of readdirSync(packagesDir)) {
  const pkgDir = join(packagesDir, pkg)
  if (!statSync(pkgDir).isDirectory()) continue

  const distDir = join(pkgDir, 'dist')
  if (!existsSync(distDir)) continue

  // Check if the nested structure exists: dist/<pkg>/src/
  const nestedSrc = join(distDir, pkg, 'src')
  if (!existsSync(nestedSrc)) continue

  // Copy the package's own files from nested path to dist root
  const tempDir = join(pkgDir, 'dist-flat-tmp')
  cpSync(nestedSrc, tempDir, { recursive: true })

  // Remove the old dist and replace with flattened version
  rmSync(distDir, { recursive: true })
  renameSync(tempDir, distDir)

  console.log(`  Flattened dist for @qiongqi/${pkg}`)
}

console.log('Done: all dist directories flattened.')
