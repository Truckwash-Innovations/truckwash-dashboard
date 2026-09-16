/**
 * Stempelt de versie in de edge functions, vlak voor het uitrollen
 *
 * Schrijft supabase/functions/_gedeeld/versie.ts met de versie uit
 * package.json en het moment van uitrollen. Die twee waarden melden de
 * functies bij hun eerste start in public.functie_stand (0103), zodat op het
 * ontwikkelaarsscherm te zien is wat er daadwerkelijk draait.
 *
 * Draait vanzelf mee met "npm run functions". Los draaien mag ook:
 *
 *   node scripts/functie-versie.cjs
 *
 * Het bestand staat wél in git. Dat is met opzet: zonder dat bestand
 * compileert stand.ts niet, en dan zou een verse kopie van de repo niet
 * uit te rollen zijn. Wat erin staat klopt pas na het stempelen -- en dat
 * gebeurt bij elke uitrol.
 */

const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const doel = join(root, 'supabase', 'functions', '_gedeeld', 'versie.ts')

const inhoud = `/*
 * Gemaakt door scripts/functie-versie.cjs bij "npm run functions".
 * Niet met de hand wijzigen: de volgende uitrol overschrijft het.
 */

/** De versie uit package.json op het moment van uitrollen. */
export const VERSIE = '${pkg.version}'

/** Wanneer die uitrol is gemaakt. */
export const GEBOUWD = '${new Date().toISOString()}'
`

writeFileSync(doel, inhoud, 'utf8')
console.log(`functies gestempeld op ${pkg.version}`)
