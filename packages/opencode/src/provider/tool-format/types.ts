import type { Provider } from "../provider"

export interface ParsedToolCall {
  id: string
  name: string
  parameters: Record<string, unknown>
}

export interface ParseResult {
  toolCalls: ParsedToolCall[]
  cleanedText: string
  thinking: string | null
}

export interface ToolResultInput {
  toolName: string
  output: string
}

export interface ToolFormat {
  readonly id: string
  detect(model: Provider.Model): boolean
  hasToolCall(text: string): boolean
  hasCompleteToolCall(text: string): boolean
  hasThinking(text: string): boolean
  hasCompleteThinking(text: string): boolean
  parse(text: string): ParseResult
  formatToolResult(input: ToolResultInput): string
  formatToolResultMessage(results: ToolResultInput[]): string
}
