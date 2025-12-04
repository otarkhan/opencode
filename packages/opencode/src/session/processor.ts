import { MessageV2 } from "./message-v2"
import { streamText } from "ai"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import type { Provider } from "@/provider/provider"
import { ToolFormats } from "@/provider/tool-format"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export type StreamInput = Parameters<typeof streamText>[0]

  export type TBD = {
    model: {
      modelID: string
      providerID: string
    }
  }

  /** Tool call parsed from non-native format (e.g., XML in text) awaiting execution */
  export interface PendingToolCall {
    id: string
    name: string
    parameters: Record<string, unknown>
    part: MessageV2.ToolPart
  }

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    const pendingToolCalls: PendingToolCall[] = []
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      getPendingToolCalls() {
        return pendingToolCalls
      },
      clearPendingToolCalls() {
        pendingToolCalls.length = 0
      },
      async process(streamInput: StreamInput) {
        log.info("process")
        while (true) {
          try {
            let currentText: MessageV2.TextPart | undefined
            let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}
            const stream = streamText(streamInput)

            for await (const value of stream.fullStream) {
              input.abort.throwIfAborted()
              switch (value.type) {
                case "start":
                  SessionStatus.set(input.sessionID, { type: "busy" })
                  break

                case "reasoning-start":
                  if (value.id in reasoningMap) {
                    continue
                  }
                  reasoningMap[value.id] = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "reasoning",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  break

                case "reasoning-delta":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text += value.text
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    if (part.text) await Session.updatePart({ part, delta: value.text })
                  }
                  break

                case "reasoning-end":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text = part.text.trimEnd()

                    part.time = {
                      ...part.time,
                      end: Date.now(),
                    }
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    await Session.updatePart(part)
                    delete reasoningMap[value.id]
                  }
                  break

                case "tool-input-start":
                  const part = await Session.updatePart({
                    id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "tool",
                    tool: value.toolName,
                    callID: value.id,
                    state: {
                      status: "pending",
                      input: {},
                      raw: "",
                    },
                  })
                  toolcalls[value.id] = part as MessageV2.ToolPart
                  break

                case "tool-input-delta":
                  break

                case "tool-input-end":
                  break

                case "tool-call": {
                  const match = toolcalls[value.toolCallId]
                  if (match) {
                    const part = await Session.updatePart({
                      ...match,
                      tool: value.toolName,
                      state: {
                        status: "running",
                        input: value.input,
                        time: {
                          start: Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    })
                    toolcalls[value.toolCallId] = part as MessageV2.ToolPart

                    const parts = await MessageV2.parts(input.assistantMessage.id)
                    const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)

                    if (
                      lastThree.length === DOOM_LOOP_THRESHOLD &&
                      lastThree.every(
                        (p) =>
                          p.type === "tool" &&
                          p.tool === value.toolName &&
                          p.state.status !== "pending" &&
                          JSON.stringify(p.state.input) === JSON.stringify(value.input),
                      )
                    ) {
                      const permission = await Agent.get(input.assistantMessage.mode).then((x) => x.permission)
                      if (permission.doom_loop === "ask") {
                        await Permission.ask({
                          type: "doom_loop",
                          pattern: value.toolName,
                          sessionID: input.assistantMessage.sessionID,
                          messageID: input.assistantMessage.id,
                          callID: value.toolCallId,
                          title: `Possible doom loop: "${value.toolName}" called ${DOOM_LOOP_THRESHOLD} times with identical arguments`,
                          metadata: {
                            tool: value.toolName,
                            input: value.input,
                          },
                        })
                      } else if (permission.doom_loop === "deny") {
                        throw new Permission.RejectedError(
                          input.assistantMessage.sessionID,
                          "doom_loop",
                          value.toolCallId,
                          {
                            tool: value.toolName,
                            input: value.input,
                          },
                          `You seem to be stuck in a doom loop, please stop repeating the same action`,
                        )
                      }
                    }
                  }
                  break
                }
                case "tool-result": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "completed",
                        input: value.input,
                        output: value.output.output,
                        metadata: value.output.metadata,
                        title: value.output.title,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                        attachments: value.output.attachments,
                      },
                    })

                    delete toolcalls[value.toolCallId]
                  }
                  break
                }

                case "tool-error": {
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    await Session.updatePart({
                      ...match,
                      state: {
                        status: "error",
                        input: value.input,
                        error: (value.error as any).toString(),
                        metadata: value.error instanceof Permission.RejectedError ? value.error.metadata : undefined,
                        time: {
                          start: match.state.time.start,
                          end: Date.now(),
                        },
                      },
                    })

                    if (value.error instanceof Permission.RejectedError) {
                      blocked = true
                    }
                    delete toolcalls[value.toolCallId]
                  }
                  break
                }
                case "error":
                  throw value.error

                case "start-step":
                  snapshot = await Snapshot.track()
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.sessionID,
                    snapshot,
                    type: "step-start",
                  })
                  break

                case "finish-step":
                  const usage = Session.getUsage({
                    model: input.model,
                    usage: value.usage,
                    metadata: value.providerMetadata,
                  })
                  // Don't overwrite finish reason if we detected pending tool calls
                  // (we set it to "tool-calls" in text-end to prevent the loop from exiting)
                  if (pendingToolCalls.length === 0) {
                    input.assistantMessage.finish = value.finishReason
                  }
                  input.assistantMessage.cost += usage.cost
                  input.assistantMessage.tokens = usage.tokens
                  await Session.updatePart({
                    id: Identifier.ascending("part"),
                    reason: pendingToolCalls.length > 0 ? "tool-calls" : value.finishReason,
                    snapshot: await Snapshot.track(),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "step-finish",
                    tokens: usage.tokens,
                    cost: usage.cost,
                  })
                  await Session.updateMessage(input.assistantMessage)
                  if (snapshot) {
                    const patch = await Snapshot.patch(snapshot)
                    if (patch.files.length) {
                      await Session.updatePart({
                        id: Identifier.ascending("part"),
                        messageID: input.assistantMessage.id,
                        sessionID: input.sessionID,
                        type: "patch",
                        hash: patch.hash,
                        files: patch.files,
                      })
                    }
                    snapshot = undefined
                  }
                  SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  })
                  break

                case "text-start":
                  currentText = {
                    id: Identifier.ascending("part"),
                    messageID: input.assistantMessage.id,
                    sessionID: input.assistantMessage.sessionID,
                    type: "text",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  break

                case "text-delta":
                  if (currentText) {
                    currentText.text += value.text
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    if (currentText.text)
                      await Session.updatePart({
                        part: currentText,
                        delta: value.text,
                      })
                  }
                  break

                case "text-end":
                  if (currentText) {
                    // Check for non-native tool call formats (e.g., MiniMax XML)
                    const toolFormat = ToolFormats.get(input.model)
                    const hasToolCall = toolFormat?.hasToolCall(currentText.text) ?? false
                    const hasCompleteToolCall = toolFormat?.hasCompleteToolCall(currentText.text) ?? false

                    log.info("text-end", {
                      toolFormat: toolFormat?.id ?? "native",
                      hasToolCall,
                      hasCompleteToolCall,
                      textLength: currentText.text.length,
                      textPreview: currentText.text.substring(0, 500),
                    })

                    if (toolFormat && hasCompleteToolCall) {
                      const parsed = toolFormat.parse(currentText.text)

                      // Create ToolPart entries for each parsed tool call
                      for (const toolCall of parsed.toolCalls) {
                        const toolPart = await Session.updatePart({
                          id: Identifier.ascending("part"),
                          messageID: input.assistantMessage.id,
                          sessionID: input.assistantMessage.sessionID,
                          type: "tool",
                          tool: toolCall.name,
                          callID: toolCall.id,
                          state: {
                            status: "pending",
                            input: toolCall.parameters,
                            raw: "",
                          },
                        }) as MessageV2.ToolPart

                        pendingToolCalls.push({
                          id: toolCall.id,
                          name: toolCall.name,
                          parameters: toolCall.parameters,
                          part: toolPart,
                        })

                        toolcalls[toolCall.id] = toolPart
                      }

                      // Override finish reason to "tool-calls" so the loop knows to continue
                      // (otherwise it exits because the AI SDK doesn't know about non-native tool calls)
                      input.assistantMessage.finish = "tool-calls"
                      // IMPORTANT: Also persist this to storage so the loop sees it when re-fetching messages
                      await Session.updateMessage(input.assistantMessage)

                      // Update text to remove tool call XML (keep thinking if present)
                      currentText.text = parsed.cleanedText.trimEnd()

                      // If there's thinking content, create a reasoning part
                      if (parsed.thinking) {
                        await Session.updatePart({
                          id: Identifier.ascending("part"),
                          messageID: input.assistantMessage.id,
                          sessionID: input.assistantMessage.sessionID,
                          type: "reasoning",
                          text: parsed.thinking,
                          time: {
                            start: currentText.time?.start ?? Date.now(),
                            end: Date.now(),
                          },
                        })
                      }
                    } else {
                      currentText.text = currentText.text.trimEnd()
                    }

                    currentText.time = {
                      start: currentText.time?.start ?? Date.now(),
                      end: Date.now(),
                    }
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    // Only update if there's actual text content after removing XML
                    if (currentText.text) {
                      await Session.updatePart(currentText)
                    }
                  }
                  currentText = undefined
                  break

                case "finish":
                  break

                default:
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
            }
          } catch (e: any) {
            log.error("process", {
              error: e,
              stack: JSON.stringify(e.stack),
            })
            const error = MessageV2.fromError(e, { providerID: input.model.providerID })
            const retry = SessionRetry.retryable(error)
            if (retry !== undefined) {
              attempt++
              const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)
              SessionStatus.set(input.sessionID, {
                type: "retry",
                attempt,
                message: retry,
                next: Date.now() + delay,
              })
              await SessionRetry.sleep(delay, input.abort).catch(() => {})
              continue
            }
            input.assistantMessage.error = error
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            })
          }
          const p = await MessageV2.parts(input.assistantMessage.id)
          for (const part of p) {
            if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: "error",
                  error: "Tool execution aborted",
                  time: {
                    start: Date.now(),
                    end: Date.now(),
                  },
                },
              })
            }
          }
          input.assistantMessage.time.completed = Date.now()
          await Session.updateMessage(input.assistantMessage)

          if (blocked) {
            return "stop"
          }
          if (input.assistantMessage.error) {
            return "stop"
          }
          // Check if there are pending tool calls (from non-native formats) that need execution
          if (pendingToolCalls.length > 0) {
            return "pending_tools"
          }
          return "continue"
        }
      },
    }
    return result
  }
}
