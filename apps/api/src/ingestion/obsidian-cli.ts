// Deliberately no dotenv, database factory, ingestion service or network client.
import { runObsidianCommand } from './obsidian-command.js'

process.exitCode = await runObsidianCommand(process.argv.slice(2), line => console.log(line))
