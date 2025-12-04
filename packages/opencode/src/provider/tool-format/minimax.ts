import { ulid } from "ulid"
import type { Provider } from "../provider"
import type { ToolFormat, ParseResult, ParsedToolCall, ToolResultInput } from "./types"

const TOOL_NAME_MAP: Record<string, string> = {
  exa_web_search_exa: "websearch",
  web_search_exa: "websearch",
  web_search: "websearch",
  search_web: "websearch",
  read_file: "read",
  write_file: "write",
  edit_file: "edit",
  run_bash: "bash",
  execute_bash: "bash",
  shell: "bash",
  run_command: "bash",
  terminal: "bash",
  list_files: "glob",
  find_files: "glob",
  search_files: "grep",
  search_code: "grep",
}

const PARAM_NAME_MAP: Record<string, Record<string, string>> = {
  bash: {
    cmd: "command",
    script: "command",
    code: "command",
    shell_command: "command",
    bash_command: "command",
  },
  read: {
    path: "filePath",
    file_path: "filePath",
    filename: "filePath",
    file: "filePath",
  },
  write: {
    path: "filePath",
    file_path: "filePath",
    filename: "filePath",
    file: "filePath",
    text: "content",
    data: "content",
    body: "content",
  },
  edit: {
    path: "filePath",
    file_path: "filePath",
    filename: "filePath",
    file: "filePath",
    find: "oldString",
    search: "oldString",
    old: "oldString",
    old_string: "oldString",
    replace: "newString",
    new: "newString",
    replacement: "newString",
    new_string: "newString",
    replace_all: "replaceAll",
  },
  glob: {
    glob: "pattern",
    glob_pattern: "pattern",
    file_pattern: "pattern",
    directory: "path",
    dir: "path",
    folder: "path",
  },
  grep: {
    search: "pattern",
    query: "pattern",
    regex: "pattern",
    search_pattern: "pattern",
    directory: "path",
    dir: "path",
    folder: "path",
    file_pattern: "include",
    glob: "include",
  },
  websearch: {
    search_query: "query",
    q: "query",
    search: "query",
    num_results: "numResults",
  },
  webfetch: {
    link: "url",
    href: "url",
    website: "url",
  },
  ls: {
    directory: "path",
    dir: "path",
    folder: "path",
  },
}

const TOOL_CALL_BLOCK_REGEX = /<minimax:tool_call>([\s\S]*?)<\/minimax:tool_call>/g
const INCOMPLETE_TOOL_CALL_BLOCK_REGEX = /<minimax:tool_call>([\s\S]*)$/g
const INVOKE_REGEX = /<invoke\s+name=["']?([^"'>\s]+)["']?\s*>([\s\S]*?)<\/invoke>/g
const PARAMETER_REGEX = /<parameter\s+name=["']?([^"'>\s]+)["']?\s*>([\s\S]*?)<\/parameter>/g
const THINK_REGEX = /<think>([\s\S]*?)<\/think>/g

function convertValue(value: string): unknown {
  const trimmed = value.trim()

  if (trimmed === "null" || trimmed === "None") return null
  if (trimmed === "true" || trimmed === "True") return true
  if (trimmed === "false" || trimmed === "False") return false
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10)
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed)

  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === "object" || Array.isArray(parsed)) return parsed
  } catch {}

  try {
    const pythonToJson = trimmed
      .replace(/'/g, '"')
      .replace(/True/g, "true")
      .replace(/False/g, "false")
      .replace(/None/g, "null")
    const parsed = JSON.parse(pythonToJson)
    if (typeof parsed === "object" || Array.isArray(parsed)) return parsed
  } catch {}

  return trimmed
}

function parseParameters(invokeContent: string): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  let match: RegExpExecArray | null
  PARAMETER_REGEX.lastIndex = 0

  while ((match = PARAMETER_REGEX.exec(invokeContent)) !== null) {
    const [, name, value] = match
    if (name) params[name] = convertValue(value || "")
  }
  return params
}

function mapParameters(toolName: string, params: Record<string, unknown>): Record<string, unknown> {
  const paramMap = PARAM_NAME_MAP[toolName]
  if (!paramMap) return params

  const mapped: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    mapped[paramMap[key] ?? key] = value
  }
  return mapped
}

function parseToolCallBlock(blockContent: string): ParsedToolCall[] {
  const toolCalls: ParsedToolCall[] = []
  let match: RegExpExecArray | null
  INVOKE_REGEX.lastIndex = 0

  while ((match = INVOKE_REGEX.exec(blockContent)) !== null) {
    const [, name, content] = match
    if (name) {
      const rawName = name.trim()
      const mappedName = TOOL_NAME_MAP[rawName] ?? rawName
      const rawParams = parseParameters(content || "")
      toolCalls.push({
        id: `minimax_${ulid()}`,
        name: mappedName,
        parameters: mapParameters(mappedName, rawParams),
      })
    }
  }
  return toolCalls
}

function extractThinking(text: string): { thinking: string | null; textWithoutThinking: string } {
  const thinkingParts: string[] = []
  let match: RegExpExecArray | null
  THINK_REGEX.lastIndex = 0

  while ((match = THINK_REGEX.exec(text)) !== null) {
    thinkingParts.push(match[1].trim())
  }

  return {
    thinking: thinkingParts.length > 0 ? thinkingParts.join("\n\n") : null,
    textWithoutThinking: text.replace(THINK_REGEX, ""),
  }
}

export const MinimaxToolFormat: ToolFormat = {
  id: "minimax",

  detect(model: Provider.Model): boolean {
    return model.capabilities.toolCallFormat === "minimax"
  },

  hasToolCall(text: string): boolean {
    return /<minimax:tool_call>/.test(text)
  },

  hasCompleteToolCall(text: string): boolean {
    if (/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/.test(text)) return true
    // Accept incomplete block with complete invoke (for stop sequence compatibility)
    if (/<minimax:tool_call>[\s\S]*?<invoke\s+name=[\s\S]*?<\/invoke>/.test(text)) return true
    return false
  },

  hasThinking(text: string): boolean {
    return /<think>/.test(text)
  },

  hasCompleteThinking(text: string): boolean {
    return /<think>[\s\S]*?<\/think>/.test(text)
  },

  parse(text: string): ParseResult {
    const toolCalls: ParsedToolCall[] = []
    const { thinking, textWithoutThinking } = extractThinking(text)
    let cleanedText = textWithoutThinking

    TOOL_CALL_BLOCK_REGEX.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = TOOL_CALL_BLOCK_REGEX.exec(cleanedText)) !== null) {
      toolCalls.push(...parseToolCallBlock(match[1]))
    }

    let remainingText = cleanedText.replace(TOOL_CALL_BLOCK_REGEX, "")

    // Handle incomplete blocks (missing closing tag) for streaming
    INCOMPLETE_TOOL_CALL_BLOCK_REGEX.lastIndex = 0
    const incompleteMatch = INCOMPLETE_TOOL_CALL_BLOCK_REGEX.exec(remainingText)
    if (incompleteMatch && toolCalls.length === 0) {
      toolCalls.push(...parseToolCallBlock(incompleteMatch[1]))
      remainingText = remainingText.replace(/<minimax:tool_call>[\s\S]*$/, "")
    }

    return { toolCalls, cleanedText: remainingText.trim(), thinking }
  },

  formatToolResult(input: ToolResultInput): string {
    const displayText = input.output.trim() || "Success. The operation completed successfully."
    return `<tool_result name="${input.toolName}">\n${displayText}\n</tool_result>`
  },

  formatToolResultMessage(results: ToolResultInput[]): string {
    return results.map((r) => this.formatToolResult(r)).join("\n")
  },
}

export type { ParsedToolCall, ParseResult, ToolResultInput } from "./types"
