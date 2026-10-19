import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // The bench reads Danalieth's files straight from test-references/ at the repository root.
  server: { fs: { allow: ['../..'] } },
})
