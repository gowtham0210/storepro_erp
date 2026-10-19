// Vite's `?raw` imports: the file's contents as a string, inlined at build time.
declare module '*.sql?raw' {
  const sql: string
  export default sql
}
