import type { Provider } from "../provider"
import type { ToolFormat } from "./types"
import { MinimaxToolFormat } from "./minimax"

const formats: ToolFormat[] = [MinimaxToolFormat]

export const ToolFormats = {
  get(model: Provider.Model): ToolFormat | null {
    for (const format of formats) {
      if (format.detect(model)) {
        return format
      }
    }
    return null
  },

  getById(id: string): ToolFormat | null {
    return formats.find((f) => f.id === id) ?? null
  },

  isNonNative(model: Provider.Model): boolean {
    return this.get(model) !== null
  },
}

export type { ToolFormat, ParsedToolCall, ParseResult, ToolResultInput } from "./types"
export { MinimaxToolFormat } from "./minimax"
