import { defineVitestProject } from '@nuxt/test-utils/config'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Bound concurrent Nuxt application boots on Windows.
    ...(process.platform === 'win32' ? { maxWorkers: 1, fileParallelism: false } : {}),
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.{test,spec}.ts'],
          environment: 'node',
        },
      },

      await defineVitestProject({
        test: {
          name: 'nuxt',
          // Cold Nuxt setup exceeded 10s on Windows; functional test deadlines stay unchanged.
          ...(process.platform === 'win32' ? { hookTimeout: 30000 } : {}),
          include: ['test/nuxt/**/*.{test,spec}.ts'],
          environment: 'nuxt',
          environmentOptions: {
            nuxt: {
              domEnvironment: 'happy-dom',
            },
          },
        },
      }),
    ],
  },
})
