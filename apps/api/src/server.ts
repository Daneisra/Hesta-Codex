import { config } from 'dotenv'
import { resolve } from 'node:path'
import { app } from './app.js'

config({ path: resolve(process.cwd(), '../../.env'), quiet: true })

const port = Number(process.env.PORT ?? 3000)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

app.listen(port, () => {
  console.log(`Hesta Codex API listening on http://localhost:${port}`)
})

