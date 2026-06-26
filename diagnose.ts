import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const diagnose = async (): Promise<void> => {
  console.log('=== AgentStash - Windows Diagnostics ===\n')

  const home = homedir()
  const appData = process.env.APPDATA ?? null
  const localAppData = process.env.LOCALAPPDATA ?? null

  console.log('System Paths:')
  console.log('  Home:', home)
  console.log('  APPDATA:', appData ?? '(not set)')
  console.log('  LOCALAPPDATA:', localAppData ?? '(not set)')
  console.log('  Platform:', process.platform)

  console.log('\n1. Copilot CLI Sessions (~/.copilot/session-state):')
  const cliPath = join(home, '.copilot', 'session-state')
  try {
    const stat = await fs.stat(cliPath)
    if (stat.isDirectory()) {
      const entries = await fs.readdir(cliPath)
      console.log(`   ✓ Directory exists with ${entries.length} items`)
      entries.slice(0, 3).forEach(entry => console.log(`     - ${entry}`))
    }
  } catch (error) {
    console.log(`   ✗ Not found: ${getErrorMessage(error)}`)
  }

  console.log(
    '\n2. VS Code Chat Sessions (%APPDATA%\\Code\\User\\workspaceStorage):'
  )
  if (!appData) {
    console.log('   ✗ APPDATA is not set on this machine')
  } else {
    const vsCodePath = join(appData, 'Code', 'User', 'workspaceStorage')
    try {
      const stat = await fs.stat(vsCodePath)
      if (stat.isDirectory()) {
        const workspaceDirs = await fs.readdir(vsCodePath)
        console.log(
          `   ✓ Directory exists with ${workspaceDirs.length} workspace folders`
        )

        let totalSessions = 0
        for (const dir of workspaceDirs.slice(0, 5)) {
          const chatPath = join(vsCodePath, dir, 'chatSessions')
          try {
            const files = await fs.readdir(chatPath)
            if (files.length > 0) {
              totalSessions += files.length
              console.log(`     - Workspace ${dir}: ${files.length} session(s)`)
              files.slice(0, 2).forEach(file => console.log(`       • ${file}`))
            }
          } catch {
            // Ignore workspaces without chatSessions.
          }
        }
        console.log(`   Total sessions found: ${totalSessions}`)
      }
    } catch (error) {
      console.log(`   ✗ Not found: ${getErrorMessage(error)}`)
    }
  }

  console.log('\n3. App Configuration (%APPDATA%\\Copilot Sessions Hub):')
  if (!appData) {
    console.log('   ✗ APPDATA is not set on this machine')
  } else {
    const appConfigDir = join(appData, 'Copilot Sessions Hub')
    try {
      const stat = await fs.stat(appConfigDir)
      if (stat.isDirectory()) {
        console.log('   ✓ App directory exists')

        const configPath = join(appConfigDir, 'config.json')
        try {
          const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as {
            repoRoots?: string[]
            discoveryMode?: string
            explicitPatterns?: string[]
          }
          console.log('   ✓ Config found:')
          console.log(`     - Repo roots: ${config.repoRoots?.length ?? 0}`)
          config.repoRoots
            ?.slice(0, 3)
            .forEach(root => console.log(`       • ${root}`))
          console.log(`     - Discovery mode: ${config.discoveryMode ?? '(n/a)'}`)
          console.log(
            `     - Explicit patterns: ${config.explicitPatterns?.length ?? 0}`
          )
        } catch {
          console.log('   - Config not found or invalid')
        }

        const logPath = join(appConfigDir, 'logs', 'app.log')
        try {
          const stat = await fs.stat(logPath)
          console.log(`   ✓ Log file exists (${Math.round(stat.size / 1024)}KB)`)
        } catch {
          console.log('   - Log file not found')
        }
      }
    } catch (error) {
      console.log(`   ✗ App directory not found: ${getErrorMessage(error)}`)
    }
  }

  console.log('\n4. Default Repo Roots (Windows):')
  const defaultRoots = [
    join(home, 'projects'),
    join(home, 'Documents'),
    join(home, 'source')
  ]
  for (const root of defaultRoots) {
    try {
      const stat = await fs.stat(root)
      console.log(stat.isDirectory() ? `   ✓ ${root}` : `   ✗ ${root}`)
    } catch {
      console.log(`   ✗ ${root}`)
    }
  }
}

void diagnose().catch(error => {
  console.error(getErrorMessage(error))
  process.exitCode = 1
})
