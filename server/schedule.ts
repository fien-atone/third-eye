/**
 * Cross-platform hourly ingest scheduler.
 *
 *   npm run schedule:install    → register hourly job (macOS launchd | Linux cron | Windows schtasks)
 *   npm run schedule:uninstall  → remove it
 *   npm run schedule:status     → show whether it's installed and when it last ran
 *
 * The job runs `npm run ingest:hour` from the repo root every hour.
 * Uses absolute paths to npm/node so it works under nvm, Homebrew, fnm, etc.
 */
import { execSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { homedir, platform } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..') // webapp/
const logFile = join(homedir(), '.third-eye-ingest.log')
const LABEL = 'org.thirdeye.ingest'   // launchd + cron tag
const WIN_TASK = 'ThirdEyeIngest'     // schtasks name

function resolveNpm(): string {
  try {
    const which = platform() === 'win32' ? 'where npm' : 'command -v npm'
    const out = execSync(which, { encoding: 'utf8' }).trim().split('\n')[0]
    if (out && existsSync(out)) return out
  } catch {}
  // Fallback: rely on PATH at runtime.
  return 'npm'
}
const NPM = resolveNpm()

type Action = 'install' | 'uninstall' | 'status'

function parseAction(argv: string[]): Action {
  const a = argv[2]
  if (a === 'uninstall' || a === 'remove') return 'uninstall'
  if (a === 'status') return 'status'
  return 'install'
}

// ─────────────────────────── macOS (launchd) ───────────────────────────

const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)

function plist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd ${shellEscape(repoRoot)} && ${shellEscape(NPM)} run ingest:hour --silent</string>
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${logFile}</string>
  <key>StandardErrorPath</key><string>${logFile}</string>
</dict>
</plist>
`
}

function shellEscape(s: string): string { return s.replace(/'/g, `'\\''`) }

function macosInstall() {
  mkdirSync(dirname(plistPath), { recursive: true })
  writeFileSync(plistPath, plist(), 'utf8')
  try { execSync(`launchctl unload ${JSON.stringify(plistPath)}`, { stdio: 'ignore' }) } catch {}
  execSync(`launchctl load ${JSON.stringify(plistPath)}`, { stdio: 'inherit' })
  console.log(`[schedule] installed macOS launchd agent: ${plistPath}`)
  console.log(`[schedule] fires every 3600s (1h). Log: ${logFile}`)
}

function macosUninstall() {
  if (!existsSync(plistPath)) { console.log('[schedule] not installed'); return }
  try { execSync(`launchctl unload ${JSON.stringify(plistPath)}`, { stdio: 'ignore' }) } catch {}
  unlinkSync(plistPath)
  console.log(`[schedule] removed launchd agent: ${plistPath}`)
}

function macosStatus() {
  const installed = existsSync(plistPath)
  console.log(`[schedule] macOS launchd agent: ${installed ? 'INSTALLED' : 'not installed'}`)
  if (installed) {
    try {
      const out = execSync(`launchctl list | grep ${LABEL} || true`, { encoding: 'utf8' }).trim()
      if (out) console.log(`[schedule] loaded: ${out}`)
    } catch {}
    showRecentLog()
  }
}

// ─────────────────────────── Linux (cron) ───────────────────────────

const CRON_TAG = `# ${LABEL}`

function cronLine(): string {
  // Minute 17 of every hour, odd timing to avoid pile-ups on :00.
  return `17 * * * * cd ${shellEscape(repoRoot)} && ${shellEscape(NPM)} run ingest:hour --silent >> ${logFile} 2>&1 ${CRON_TAG}`
}

function readCrontab(): string {
  try { return execSync('crontab -l 2>/dev/null', { encoding: 'utf8' }) } catch { return '' }
}

function writeCrontab(content: string) {
  execSync('crontab -', { input: content, stdio: ['pipe', 'inherit', 'inherit'] })
}

function linuxInstall() {
  const current = readCrontab()
  const kept = current.split('\n').filter(l => !l.includes(CRON_TAG)).join('\n').trim()
  const next = (kept ? kept + '\n' : '') + cronLine() + '\n'
  writeCrontab(next)
  console.log(`[schedule] installed cron entry (runs at :17 every hour)`)
  console.log(`[schedule] log: ${logFile}`)
}

function linuxUninstall() {
  const current = readCrontab()
  if (!current.includes(CRON_TAG)) { console.log('[schedule] not installed'); return }
  const next = current.split('\n').filter(l => !l.includes(CRON_TAG)).join('\n')
  writeCrontab(next)
  console.log('[schedule] removed cron entry')
}

function linuxStatus() {
  const current = readCrontab()
  const line = current.split('\n').find(l => l.includes(CRON_TAG))
  console.log(`[schedule] cron entry: ${line ? 'INSTALLED' : 'not installed'}`)
  if (line) {
    console.log(`[schedule] ${line}`)
    showRecentLog()
  }
}

// ─────────────────────────── Windows (schtasks) ───────────────────────────

function winInstall() {
  // Every hour, action runs npm run ingest:hour from the repo root.
  // /F forces overwrite if task exists.
  const cmd = [
    'schtasks.exe', '/Create', '/F',
    '/SC', 'HOURLY',
    '/MO', '1',
    '/TN', WIN_TASK,
    '/TR', `"cmd /c cd /d \\"${repoRoot}\\" && \\"${NPM}\\" run ingest:hour"`,
  ].join(' ')
  execSync(cmd, { stdio: 'inherit' })
  console.log(`[schedule] installed Windows scheduled task "${WIN_TASK}" (hourly)`)
}

function winUninstall() {
  try {
    execSync(`schtasks.exe /Delete /TN ${WIN_TASK} /F`, { stdio: 'inherit' })
    console.log(`[schedule] removed Windows scheduled task`)
  } catch {
    console.log('[schedule] not installed')
  }
}

function winStatus() {
  try {
    execSync(`schtasks.exe /Query /TN ${WIN_TASK}`, { stdio: 'inherit' })
  } catch {
    console.log('[schedule] Windows scheduled task: not installed')
  }
}

// ─────────────────────────── Common ───────────────────────────

function showRecentLog() {
  if (!existsSync(logFile)) { console.log('[schedule] no runs logged yet'); return }
  try {
    const raw = readFileSync(logFile, 'utf8')
    const last = raw.trim().split('\n').slice(-3).join('\n')
    console.log('[schedule] recent log tail:')
    console.log(last.split('\n').map(l => '    ' + l).join('\n'))
  } catch {}
}

// ─────────────────────────── Dispatch ───────────────────────────

const action = parseAction(process.argv)
const plat = platform()

if (plat === 'darwin') {
  if (action === 'install') macosInstall()
  else if (action === 'uninstall') macosUninstall()
  else macosStatus()
} else if (plat === 'win32') {
  if (action === 'install') winInstall()
  else if (action === 'uninstall') winUninstall()
  else winStatus()
} else {
  if (action === 'install') linuxInstall()
  else if (action === 'uninstall') linuxUninstall()
  else linuxStatus()
}
