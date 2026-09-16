import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/** Het hoogste nummer in supabase/migrations. Zie __SCHEMA_VERWACHT__. */
function hoogsteMigratie(): number {
  const dir = path.resolve(import.meta.dirname, 'supabase', 'migrations')
  const nummers = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => Number(f.slice(0, 4)))
    .filter((n) => Number.isFinite(n))
  return nummers.length ? Math.max(...nummers) : 0
}

export default defineConfig({
  plugins: [react()],

  /*
   * Relatief pad is verplicht: Electron laadt via file://.
   *
   * Dit blijft './' en mag NIET '/app/' worden, ook nu de app onder /app/
   * komt te staan. Met een absolute base schrijft Vite src="/app/assets/..."
   * in index.html, en onder file:// wordt dat file:///app/assets/... -- een
   * pad op de C-schijf dat niet bestaat. Het venster komt op, blijft leeg en
   * meldt niets. Op Android via Capacitor gaat het op dezelfde manier mis.
   *
   * './' werkt op alle drie de doelen tegelijk: op het web lost het op tegen
   * /app/, in Electron tegen de map van index.html, en op een toestel tegen
   * de wortel van het Capacitor-scheme. Eén bouw, drie doelen.
   *
   * De enige voorwaarde is de schuine streep aan het eind van het adres:
   * daarom staat html_handling in wrangler.jsonc op force-trailing-slash.
   */
  base: './',

  /*
   * Het versienummer uit package.json de app in.
   *
   * Stond hier eerst als vaste tekst in updates.ts, op '1.0.0', terwijl
   * package.json al veel verder was. Op Windows viel dat niet op, want
   * daar vraagt de app het aan Electron. Op een tablet is het wel erg:
   * daar vergelijkt de updater met dit nummer, en dan denkt hij altijd
   * dat er een nieuwere versie is.
   */
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    /*
     * Het hoogste migratienummer dat bij deze app hoort.
     *
     * Sinds 0103 zegt de server zelf hoe ver zijn schema staat. Zonder dit
     * getal is dat antwoord een los nummer waar niemand iets aan afleest;
     * met dit getal ernaast kan het scherm zeggen dat het schema achterloopt.
     *
     * Uit de bestandsnamen geteld en niet met de hand bijgehouden: een
     * nummer dat je met de hand ophoogt is een nummer dat je vergeet.
     */
    __SCHEMA_VERWACHT__: hoogsteMigratie(),
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  // Zonder dit doorzoekt Vite ook android/ en ios/. Daar staat een kopie van
  // een eerdere build, en die probeert hij dan als broncode te behandelen --
  // met klachten over pakketten die alleen in die oude bundel voorkomen.
  optimizeDeps: {
    entries: ['index.html'],
  },

  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/android/**',
        '**/ios/**',
        '**/dist/**',
        '**/release/**',
      ],
    },
  },
  build: {
    /*
     * De app staat niet meer op de wortel maar in dist/app.
     *
     * dist/ is vanaf nu de uitrolmap met twee bewoners: de merksite op de
     * wortel en de app in app/. Vite maakt alleen zijn eigen outDir leeg, dus
     * dist/app -- de pagina's van de site blijven staan.
     *
     * Wie dit meeverhuist: electron/main.cjs (loadFile), electron-builder.yml
     * (files) en capacitor.config.ts (webDir).
     */
    outDir: 'dist/app',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
})
