/** English — source of truth. All other locales must satisfy this Dict. */
export const en = {
  // Header
  'header.tagline': 'AI coding spend',
  'header.lastRefresh': 'Last refresh',
  'header.refresh': 'Refresh',
  'header.refreshing': 'Refreshing…',
  'header.refreshTitle': 'Re-scan all session files into the local DB',
  'header.theme.title': 'Theme',
  'header.theme.cycle': 'click to cycle',
  'header.theme.light': 'Light',
  'header.theme.dark': 'Dark',
  'header.theme.system': 'System',
  'header.locale.title': 'Language',

  // Controls / toolbar
  'controls.view': 'View',
  'controls.day': 'Day',
  'controls.week': 'Week',
  'controls.month': 'Month',
  'controls.allProviders': 'All providers',
  'preset.7d': '7d',
  'preset.30d': '30d',
  'preset.12w': '12w',
  'preset.mtd': 'MTD',
  'preset.12m': '12m',
  'controls.providerCalls': 'calls',

  // Summary
  'summary.days': 'days',
  'summary.weeks': 'weeks',
  'summary.months': 'months',
  'summary.allProviders': 'all providers',

  // Breadcrumb
  'breadcrumb.allProjects': '← All projects',

  // KPI groups
  'kpi.spend': 'Spend',
  'kpi.tokens': 'Tokens',
  'kpi.cache': 'Cache',
  'kpi.scope': 'Scope',
  'kpi.total': 'Total',
  'kpi.avg': 'Avg',
  'kpi.input': 'Input',
  'kpi.output': 'Output',
  'kpi.read': 'Read',
  'kpi.write': 'Write',
  'kpi.projects': 'Projects',
  'kpi.active': 'Active',
  'kpi.apiCalls': 'API calls',
  'kpi.calls': 'calls',

  // Panel: cost by model
  'panel.costByProject.title': 'Cost by project',
  'panel.costByProject.subDay': 'Daily totals, stacked',
  'panel.costByProject.subWeek': 'Weekly totals, stacked',
  'panel.costByProject.subMonth': 'Monthly totals, stacked',
  'panel.costByProject.help': 'Each bar is USD spent that period, stacked by project. Top 8 projects by cost get their own color; the rest are grouped as "Other". Click a legend row to drill into that project.',
  'panel.costByProject.other': 'Other',
  'panel.costByProject.otherWith': '{count} more projects',

  'panel.costByModel.title': 'Cost by model',
  'panel.costByModel.subDay': 'Daily totals, stacked',
  'panel.costByModel.subWeek': 'Weekly totals, stacked',
  'panel.costByModel.subMonth': 'Monthly totals, stacked',
  'panel.costByModel.help': 'Each bar is the total USD spent in that period, split by which model generated the answer. Cost per call = (input + output + cache tokens) × model price from LiteLLM, plus a 6× multiplier for fast-mode Opus calls.',

  // Panel: API calls over time
  'panel.calls.title': 'API calls over time',
  'panel.calls.subDay': 'Requests per day',
  'panel.calls.subWeek': 'Requests per week',
  'panel.calls.subMonth': 'Requests per month',
  'panel.calls.help': 'How many times Claude / Codex talked to the model API in each period. One round-trip = one API call. High call counts with low cost = lots of small turns; low calls with high cost = long heavy turns.',

  // Panel: tokens over time
  'panel.tokens.title': 'Tokens over time',
  'panel.tokens.sub': 'Stacked per period — cache-read typically dominates',
  'panel.tokens.help.intro': 'Token counts per period.',
  'panel.tokens.help.io': 'Input/Output = the actual question + answer.',
  'panel.tokens.help.cache': 'Cache read/write = the conversation context Claude reuses between turns (cheap to read, costly to write).',
  'panel.tokens.help.tip': 'Use the chips to compare both groups on the same axis or hide one.',
  'panel.tokens.both': 'Both',
  'panel.tokens.ioOnly': 'I/O only',
  'panel.tokens.cacheOnly': 'Cache only',

  // Panel: models
  'panel.models.title': 'Models',
  'panel.models.subFmt': '{count} models · {calls} calls · {cost}',
  'panel.models.help': 'One row per model used in this period. The bar shows that model\'s cost relative to the most expensive one. Token columns show how the spend breaks down — output tokens cost ~5× more than input, cache-read is ~10× cheaper than input.',
  'panel.models.colModel': 'Model',
  'panel.models.colShare': 'Cost share',
  'panel.models.colCalls': 'Calls',
  'panel.models.colInput': 'Input',
  'panel.models.colOutput': 'Output',
  'panel.models.colCacheR': 'Cache R',
  'panel.models.colCacheW': 'Cache W',
  'panel.models.colCost': 'Cost',

  // Panel: by activity
  'panel.activity.title': 'By activity',
  'panel.activity.help': 'Each turn is auto-classified into 13 categories (coding, debugging, exploration, planning, etc.) based on which tools you used and your message. Cost shown is the sum of API spend for turns of that kind. No LLM is called for classification — pure pattern matching.',

  // Panel: top projects
  'panel.topProjects.title': 'Top projects — click to drill in',
  'panel.topProjects.help': 'Projects are detected from session folder names (one folder per working directory). Click a row to filter the whole dashboard down to that project — the URL gets a stable UUID so you can bookmark or share the view.',
  'panel.topProjects.colProject': 'Project',
  'panel.topProjects.colCalls': 'Calls',
  'panel.topProjects.colCost': 'Cost',

  // Insights — section
  'insights.title': 'Project insights',

  'insights.subagents.title': 'Subagents',
  'insights.subagents.sub': 'Agent tool — by subagent_type',
  'insights.subagents.help': 'Counts of Agent tool calls grouped by their subagent_type (e.g. Explore, Plan, your custom agents). Cost is the parent call\'s API spend split across the tools it invoked.',

  'insights.skills.title': 'Skills',
  'insights.skills.sub': 'Slash commands invoked via Skill',
  'insights.skills.help': 'Counts of Skill tool calls — these are the slash-commands like /commit, /simplify. Empty list means no skills were triggered in this period.',

  'insights.mcp.title': 'MCP servers',
  'insights.mcp.sub': 'External MCP tool calls grouped by server',
  'insights.mcp.help': 'Tool calls to MCP servers (named mcp__<server>__<tool>). Shows which external integrations the project leans on.',

  'insights.bash.title': 'Bash commands',
  'insights.bash.sub': 'Top commands extracted from Bash tool',
  'insights.bash.help': 'Top commands extracted from Bash tool inputs.',

  'insights.files.title': 'File hotspots',
  'insights.files.subFmt': '{unique} unique files touched · top {shown} shown',
  'insights.files.help': 'Files that received the most Edit/Write/Read/MultiEdit calls in this period. Cost is the sum of API spend on calls that touched the file.',
  'insights.files.colFile': 'File',
  'insights.files.colTouches': 'Touches',
  'insights.files.colCost': 'Cost',
  'insights.files.empty': 'No file edits in this range.',

  'insights.flags.title': 'Workflow flags',
  'insights.flags.help': 'Plan Mode = number of API calls where you used EnterPlanMode (strategic turns). TodoWrite = calls where the todo list was updated. Higher percentages = more methodical workflow.',
  'insights.flags.planMode': 'Plan Mode',
  'insights.flags.todoWrite': 'TodoWrite',
  'insights.flags.subFmt': '{pct}% of {total} calls',

  'insights.versions.title': 'Claude Code versions',
  'insights.versions.subFmt': '{count} versions · total {value}',
  'insights.versions.help': 'Distribution of activity across Claude Code CLI versions that touched this project. Toggle between cost, API calls, or total tokens.',
  'insights.versions.colVersion': 'Version',
  'insights.versions.colShare': 'Share',
  'insights.versions.colFirstSeen': 'First seen',
  'insights.versions.empty': 'No version data.',
  'insights.versions.metricCost': 'Cost',
  'insights.versions.metricCalls': 'Calls',
  'insights.versions.metricTokens': 'Tokens',

  'insights.branches.title': 'Branch activity',
  'insights.branches.sub': 'git branches captured at session time',
  'insights.branches.help': 'Each session records the current git branch. Cost per branch shows where you burn most of your AI budget. Sessions outside a git repo are not counted.',
  'insights.branches.colBranch': 'Branch',
  'insights.branches.colCalls': 'Calls',
  'insights.branches.colCost': 'Cost',
  'insights.branches.empty': 'No branch data.',

  'insights.heatmap.title': 'Activity heatmap',
  'insights.heatmap.sub': 'When you work on this project — calls per hour-of-week',
  'insights.heatmap.help': '7×24 grid: rows = day of week (your local timezone), columns = hour of day. Brighter orange = more API calls in that hour-of-week.',

  // Days
  'day.sun': 'Sun',
  'day.mon': 'Mon',
  'day.tue': 'Tue',
  'day.wed': 'Wed',
  'day.thu': 'Thu',
  'day.fri': 'Fri',
  'day.sat': 'Sat',

  // Common
  'common.loading': 'Loading…',
  'common.error': 'Error',
  'common.calls': 'calls',
  'common.runs': 'runs',
  'common.empty': 'No data in this range.',
  'common.emptyChart': 'No data',
  'common.emptyChartHint': 'Nothing matches your current filters in this period.',

  'server.down.title': "Can't reach the Third Eye server",
  'server.down.msg': 'The backend at localhost:4317 is not responding. Your data is safe on disk — the UI just needs the server process running to show it.',
  'server.down.docker': 'If you installed via Docker: run',
  'server.down.node': 'If you installed via Node: run',
  'server.down.check': 'Then check',
  'server.down.retry': 'Retry',
  'common.total': 'Total',
  'common.share': 'Share',

  // Time
  'notfound.code': '404',
  'notfound.title': 'Lost in the void',
  'notfound.message': 'This page does not exist, or the project you are looking for is gone.',
  'notfound.home': 'Back to dashboard',

  'time.justNow': 'just now',
  'time.never': 'never',
  'time.minAgo': '{n}m ago',
  'time.hourAgo': '{n}h ago',
  'time.dayAgo': '{n}d ago',
} as const

export type Dict = Record<keyof typeof en, string>
