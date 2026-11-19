import { wasp } from 'wasp/client/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    wasp(),
    tailwindcss()
  ],
  build: {
    chunkSizeWarningLimit: 3_000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/monaco-editor") || id.includes("node_modules/@monaco-editor")) {
            return "vendor-monaco"
          }
          if (id.includes("/src/domain/udm/generated-fields.ts")) {
            return "udm-generated-fields"
          }
          if (id.includes("/src/domain/udm/generated-field-values.ts")) {
            return "udm-generated-field-values"
          }
          if (id.includes("/src/domain/udm/")) {
            return "udm-runtime"
          }
          if (id.includes("/src/domain/yaral/fixtures/")) {
            return "yaral-fixtures"
          }
          if (id.includes("/src/domain/yaral/compiler/")) {
            return "yaral-compiler"
          }
          if (id.includes("/src/domain/yaral/")) {
            return "yaral-compiler"
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "vendor-react"
          }
          if (id.includes("node_modules/radix-ui") || id.includes("node_modules/@radix-ui")) {
            return "vendor-radix"
          }
          if (id.includes("node_modules/recharts")) {
            return "vendor-charts"
          }
        },
      },
    },
  },
  server: {
    open: true,
  },
})
