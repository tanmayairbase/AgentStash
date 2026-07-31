import { basename, extname } from 'node:path'
import type {
  ClaudeUsageEvent,
  SessionExecutionMode,
  SessionMessage,
  SessionSummary
} from '../../shared/types'
import {
  aggregateTokenUsageByModel,
  appendExecutionMode,
  asNumber,
  asRecord,
  firstString,
  inferFormat,
  parseJsonLines,
  stableId,
  toIso,
  type ParseContext,
  type ParsedSession
} from './helpers'

interface ClaudeContentBlock {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
}

interface ClaudeLogLine {
  type?: string
  uuid?: string
  parentUuid?: string | null
  isSidechain?: boolean
  message?: {
    id?: string
    role?: string
    content?: unknown
    model?: string
    usage?: Record<string, unknown>
  }
  timestamp?: string
  cwd?: string
  sessionId?: string
  permissionMode?: string
  aiTitle?: string
  customTitle?: string
  agentId?: string
}

const toClaudeBlocks = (content: unknown): ClaudeContentBlock[] => {
  if (!Array.isArray(content)) {
    return []
  }
  return content
    .map(block => asRecord(block) as ClaudeContentBlock | null)
    .filter((block): block is ClaudeContentBlock => block !== null)
}

const extractClaudeBlocksOfType = (
  content: unknown,
  blockType: 'text' | 'thinking'
): string =>
  toClaudeBlocks(content)
    .filter(block => block.type === blockType)
    .map(block => firstString(block[blockType]) ?? '')
    .filter(Boolean)
    .join('\n\n')

const extractClaudeTextBlocks = (content: unknown): string => {
  if (typeof content === 'string') {
    return content
  }
  return extractClaudeBlocksOfType(content, 'text')
}

// Claude Code's permission modes are default / acceptEdits / plan /
// bypassPermissions — there is NO "autopilot" mode (that's Copilot's term, and
// only the Copilot parser should ever produce it). Plan mode is the only one
// worth surfacing as a badge; acceptEdits ("⏵⏵ accept edits on") and
// bypassPermissions (--dangerously-skip-permissions) are standing permission
// settings, and default is the baseline, so none of them get a mode.
const mapClaudePermissionMode = (
  value: unknown
): SessionExecutionMode | null =>
  firstString(value)?.trim() === 'plan' ? 'plan' : null

const extractClaudeThinkingBlocks = (content: unknown): string =>
  extractClaudeBlocksOfType(content, 'thinking')

// A tool_result's `content` is either a plain string or an array of content
// blocks (e.g. [{ type: 'text', text: '...' }]) — both shapes occur in real
// Claude Code logs, so both need to resolve to the same flattened text here.
const extractClaudeToolResultText = (content: unknown): string | null =>
  firstString(content) ?? firstString(extractClaudeTextBlocks(content))

const collectClaudeToolResults = (
  lines: ClaudeLogLine[]
): Map<string, string> => {
  const results = new Map<string, string>()
  for (const line of lines) {
    if (line.type !== 'user') {
      continue
    }
    for (const block of toClaudeBlocks(line.message?.content)) {
      if (block.type !== 'tool_result') {
        continue
      }
      const toolUseId = firstString(block.tool_use_id)
      const resultText = extractClaudeToolResultText(block.content)
      if (toolUseId && resultText) {
        results.set(toolUseId, resultText)
      }
    }
  }
  return results
}

// Reverse-engineers the answer(s) out of AskUserQuestion's tool_result prose,
// which (as of this writing) reads exactly:
//   Your questions have been answered: "<question>"="<answer>"[, "<question>"="<answer>"...]. You can now continue with these answers in mind.
// There's no structured answer payload anywhere else in the transcript, so
// this template is the only source — if Claude Code's wording changes, this
// silently stops matching and callers fall back to the raw sentence below.
const parseAskUserQuestionAnswers = (
  resultText: string
): Map<string, string> => {
  const answers = new Map<string, string>()
  const pattern = /"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(resultText)) !== null) {
    const [, question, answer] = match
    if (question && answer) {
      answers.set(question, answer)
    }
  }
  return answers
}

const extractClaudeQuestions = (
  content: unknown,
  toolResultsByToolUseId: ReadonlyMap<string, string>
): NonNullable<SessionMessage['questions']> => {
  const questions: NonNullable<SessionMessage['questions']> = []

  for (const block of toClaudeBlocks(content)) {
    if (
      block.type !== 'tool_use' ||
      firstString(block.name) !== 'AskUserQuestion'
    ) {
      continue
    }

    const input = asRecord(block.input)
    const rawQuestions = Array.isArray(input?.questions) ? input.questions : []
    const toolUseId = firstString(block.id)
    const resultText = toolUseId
      ? toolResultsByToolUseId.get(toolUseId)
      : undefined
    // A miss here means the template in parseAskUserQuestionAnswers didn't
    // match (wording changed, or the question was dismissed without a
    // structured answer) — the per-question fallback below then surfaces the
    // raw resultText as freeform context instead of a parsed answer.
    const answersByQuestion = resultText
      ? parseAskUserQuestionAnswers(resultText)
      : new Map<string, string>()

    for (const rawQuestion of rawQuestions) {
      const questionRecord = asRecord(rawQuestion)
      const questionText = firstString(questionRecord?.question)
      if (!questionRecord || !questionText) {
        continue
      }

      const options = (
        Array.isArray(questionRecord.options) ? questionRecord.options : []
      )
        .map(option => asRecord(option))
        .filter((option): option is Record<string, unknown> => option !== null)
        .map(option => ({
          label: firstString(option.label) ?? '',
          description: firstString(option.description) ?? ''
        }))

      const parsedAnswer = answersByQuestion.get(questionText)
      questions.push({
        question: questionText,
        header: firstString(questionRecord.header) ?? undefined,
        options,
        multiSelect: Boolean(questionRecord.multiSelect),
        answer: parsedAnswer ?? resultText ?? ''
      })
    }
  }

  return questions
}

const collectClaudeUsageEvents = (
  lines: ClaudeLogLine[]
): ClaudeUsageEvent[] => {
  const eventsById = new Map<string, ClaudeUsageEvent>()

  for (const line of lines) {
    if (line.type !== 'assistant') {
      continue
    }
    const usage = asRecord(line.message?.usage)
    const modelId = firstString(line.message?.model)
    const id = firstString(line.message?.id, line.uuid)
    if (!usage || !modelId || !id) {
      continue
    }

    const cacheCreation = asRecord(usage.cache_creation)
    eventsById.set(id, {
      id,
      modelId,
      inputTokens: asNumber(usage.input_tokens),
      cachedInputTokens: asNumber(usage.cache_read_input_tokens),
      cacheWriteTokens: asNumber(cacheCreation?.ephemeral_5m_input_tokens),
      cacheWrite1hTokens: asNumber(cacheCreation?.ephemeral_1h_input_tokens),
      outputTokens: asNumber(usage.output_tokens),
      reasoningTokens: 0,
      timestamp: line.timestamp
    })
  }

  return [...eventsById.values()]
}

const parentClaudeSessionIdFromPath = (filePath: string): string | null => {
  const normalizedPath = filePath.replaceAll('\\', '/')
  const subagentMarker = '/subagents/'
  const markerIndex = normalizedPath.lastIndexOf(subagentMarker)
  if (markerIndex === -1) {
    return null
  }

  const parentDirectory = normalizedPath.slice(0, markerIndex)
  const parentId = basename(parentDirectory)
  return parentId || null
}

export const parseClaudeCodeSessionLog = (
  raw: string,
  context: ParseContext
): ParsedSession[] => {
  const lines = parseJsonLines(raw) as ClaudeLogLine[]
  if (lines.length === 0) {
    return []
  }

  const loggedSessionId =
    firstString(lines.find(line => line.sessionId)?.sessionId) ??
    basename(context.filePath, extname(context.filePath))
  const parentSessionId = parentClaudeSessionIdFromPath(context.filePath)
  const isFileBackedSubagent = Boolean(parentSessionId)
  const subagentId =
    firstString(lines.find(line => line.agentId)?.agentId) ??
    basename(context.filePath, extname(context.filePath))
  const sessionId =
    isFileBackedSubagent && subagentId
      ? stableId('claude-subagent', parentSessionId!, subagentId)
      : loggedSessionId

  const repoPath =
    firstString(lines.find(line => line.cwd)?.cwd) ?? context.repoRoot

  const toolResultsByToolUseId = collectClaudeToolResults(lines)
  const claudeUsageEvents = collectClaudeUsageEvents(lines)
  const messages: SessionMessage[] = []
  const modes: SessionExecutionMode[] = []
  let lastModel: string | null = null

  for (const line of lines) {
    if (line.type !== 'user' && line.type !== 'assistant') {
      continue
    }
    const role: 'user' | 'assistant' =
      line.type === 'user' ? 'user' : 'assistant'
    const content = extractClaudeTextBlocks(line.message?.content)
    const thinking =
      role === 'assistant'
        ? extractClaudeThinkingBlocks(line.message?.content)
        : ''
    const questions =
      role === 'assistant'
        ? extractClaudeQuestions(line.message?.content, toolResultsByToolUseId)
        : []
    if (!content && !thinking && questions.length === 0) {
      continue
    }

    if (role === 'assistant') {
      const model = firstString(line.message?.model)
      if (model) {
        lastModel = model
      }
    }

    const mode = mapClaudePermissionMode(line.permissionMode)
    appendExecutionMode(modes, mode)

    messages.push({
      id: line.uuid ?? stableId(sessionId, String(messages.length)),
      sessionId,
      role,
      mode: mode ?? undefined,
      content,
      thinking: thinking || undefined,
      questions: questions.length > 0 ? questions : undefined,
      format: inferFormat(content),
      timestamp: toIso(line.timestamp)
    })
  }

  if (messages.length === 0) {
    return []
  }

  const latestCustomTitle = firstString(
    [...lines].reverse().find(line => line.type === 'custom-title')?.customTitle
  )
  const aiTitle = firstString(
    [...lines].reverse().find(line => line.type === 'ai-title')?.aiTitle
  )
  const titleSeed =
    latestCustomTitle ??
    aiTitle ??
    messages.find(message => message.role === 'user')?.content ??
    messages[0].content
  const validTimestamps = lines
    .map(line => line.timestamp)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .map(timestamp => toIso(timestamp))
    .sort()
  const createdAt = validTimestamps[0] ?? toIso(undefined)
  const updatedAt = toIso(messages[messages.length - 1]?.timestamp, createdAt)
  const lineageLines = lines.filter(
    line => line.type === 'user' || line.type === 'assistant'
  )
  const lineageMessageIds = [
    ...new Set(lineageLines.map(line => line.uuid).filter(Boolean))
  ] as string[]
  const lineageParentMessageIds = [
    ...new Set(lineageLines.map(line => line.parentUuid).filter(Boolean))
  ] as string[]
  const isSubagentSession =
    isFileBackedSubagent ||
    lines.some(line => line.isSidechain === true || Boolean(line.agentId))

  const session: SessionSummary = {
    id: sessionId,
    source: 'claude',
    repoPath,
    title: titleSeed.slice(0, 120),
    model: lastModel,
    isSubagentSession,
    parentSessionId,
    modes: modes.length > 0 ? modes : undefined,
    latestMode: modes.at(-1) ?? null,
    createdAt,
    updatedAt,
    messageCount: messages.length,
    filePath: context.filePath,
    openVscodeTarget: context.filePath,
    openCliCwd: repoPath,
    tokenUsage: aggregateTokenUsageByModel(
      claudeUsageEvents,
      'claude-messages'
    ),
    lineageMessageIds,
    lineageParentMessageIds,
    claudeUsageEvents
  }

  return [{ session, messages }]
}
