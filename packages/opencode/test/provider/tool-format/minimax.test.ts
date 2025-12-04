import { describe, it, expect } from "bun:test"
import { MinimaxToolFormat } from "../../../src/provider/tool-format"

describe("MinimaxToolFormat", () => {
  describe("MiniMax XML format parsing", () => {
    it("should parse exact MiniMax format with minimax:tool_call wrapper", () => {
      const text = `<minimax:tool_call>
<invoke name="search_web">
<parameter name="query">test query</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].name).toBe("websearch")
      expect(result.toolCalls[0].parameters).toEqual({ query: "test query" })
    })

    it("should parse invoke element with name attribute", () => {
      const text = `<minimax:tool_call>
<invoke name="read_file">
<parameter name="file_path">/test.txt</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].name).toBe("read")
    })

    it("should parse parameter elements with name attribute and text content", () => {
      const text = `<minimax:tool_call>
<invoke name="edit">
<parameter name="file_path">/test.txt</parameter>
<parameter name="old_string">hello</parameter>
<parameter name="new_string">world</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].parameters).toEqual({
        filePath: "/test.txt",
        oldString: "hello",
        newString: "world",
      })
    })

    it("should parse multiple invoke elements in single tool_call block", () => {
      const text = `<minimax:tool_call>
<invoke name="search_web">
<parameter name="query_tag">["technology", "events"]</parameter>
<parameter name="query_list">["OpenAI latest release"]</parameter>
</invoke>
<invoke name="search_web">
<parameter name="query_tag">["technology", "events"]</parameter>
<parameter name="query_list">["Gemini latest release"]</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls).toHaveLength(2)
    })

    it("should handle quoted and unquoted name attributes", () => {
      const text1 = `<minimax:tool_call><invoke name="read"><parameter name="path">/test.txt</parameter></invoke></minimax:tool_call>`
      const text2 = `<minimax:tool_call><invoke name='read'><parameter name='path'>/test.txt</parameter></invoke></minimax:tool_call>`

      const result1 = MinimaxToolFormat.parse(text1)
      const result2 = MinimaxToolFormat.parse(text2)

      expect(result1.toolCalls[0].name).toBe("read")
      expect(result2.toolCalls[0].name).toBe("read")
    })
  })

  describe("OpenCode parameter mapping", () => {
    describe("bash tool", () => {
      it("should map 'command' parameter correctly", () => {
        const text = `<minimax:tool_call>
<invoke name="bash">
<parameter name="command">ls -la</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          command: "ls -la",
        })
      })

      it("should map 'cmd' to 'command'", () => {
        const text = `<minimax:tool_call>
<invoke name="bash">
<parameter name="cmd">echo hello</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          command: "echo hello",
        })
      })

      it("should preserve timeout parameter", () => {
        const text = `<minimax:tool_call>
<invoke name="bash">
<parameter name="command">sleep 5</parameter>
<parameter name="timeout">10000</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          command: "sleep 5",
          timeout: 10000,
        })
      })
    })

    describe("read tool", () => {
      it("should use filePath (camelCase)", () => {
        const text = `<minimax:tool_call>
<invoke name="read">
<parameter name="filePath">/Users/test/file.txt</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters.filePath).toBe("/Users/test/file.txt")
      })

      it("should map file_path to filePath", () => {
        const text = `<minimax:tool_call>
<invoke name="read">
<parameter name="file_path">/Users/test/file.txt</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters.filePath).toBe("/Users/test/file.txt")
      })

      it("should map path to filePath", () => {
        const text = `<minimax:tool_call>
<invoke name="read">
<parameter name="path">/test.txt</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters.filePath).toBe("/test.txt")
      })

      it("should preserve offset and limit parameters", () => {
        const text = `<minimax:tool_call>
<invoke name="read">
<parameter name="file_path">/test.txt</parameter>
<parameter name="offset">100</parameter>
<parameter name="limit">50</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          filePath: "/test.txt",
          offset: 100,
          limit: 50,
        })
      })
    })

    describe("write tool", () => {
      it("should use filePath and content (camelCase)", () => {
        const text = `<minimax:tool_call>
<invoke name="write">
<parameter name="filePath">/test.txt</parameter>
<parameter name="content">Hello World</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          filePath: "/test.txt",
          content: "Hello World",
        })
      })

      it("should map file_path to filePath and text to content", () => {
        const text = `<minimax:tool_call>
<invoke name="write">
<parameter name="file_path">/test.txt</parameter>
<parameter name="text">Hello World</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          filePath: "/test.txt",
          content: "Hello World",
        })
      })
    })

    describe("edit tool", () => {
      it("should use filePath, oldString, newString, replaceAll (camelCase)", () => {
        const text = `<minimax:tool_call>
<invoke name="edit">
<parameter name="filePath">/test.txt</parameter>
<parameter name="oldString">foo</parameter>
<parameter name="newString">bar</parameter>
<parameter name="replaceAll">true</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          filePath: "/test.txt",
          oldString: "foo",
          newString: "bar",
          replaceAll: true,
        })
      })

      it("should map snake_case parameters to camelCase", () => {
        const text = `<minimax:tool_call>
<invoke name="edit">
<parameter name="file_path">/test.txt</parameter>
<parameter name="old_string">foo</parameter>
<parameter name="new_string">bar</parameter>
<parameter name="replace_all">true</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          filePath: "/test.txt",
          oldString: "foo",
          newString: "bar",
          replaceAll: true,
        })
      })
    })

    describe("glob tool", () => {
      it("should use pattern and path", () => {
        const text = `<minimax:tool_call>
<invoke name="glob">
<parameter name="pattern">**/*.ts</parameter>
<parameter name="path">/src</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          pattern: "**/*.ts",
          path: "/src",
        })
      })

      it("should map directory to path", () => {
        const text = `<minimax:tool_call>
<invoke name="glob">
<parameter name="glob_pattern">*.js</parameter>
<parameter name="directory">/lib</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          pattern: "*.js",
          path: "/lib",
        })
      })
    })

    describe("grep tool", () => {
      it("should use pattern, path, include", () => {
        const text = `<minimax:tool_call>
<invoke name="grep">
<parameter name="pattern">TODO</parameter>
<parameter name="path">/src</parameter>
<parameter name="include">*.ts</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          pattern: "TODO",
          path: "/src",
          include: "*.ts",
        })
      })

      it("should map search to pattern and file_pattern to include", () => {
        const text = `<minimax:tool_call>
<invoke name="grep">
<parameter name="search">FIXME</parameter>
<parameter name="directory">/src</parameter>
<parameter name="file_pattern">*.tsx</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          pattern: "FIXME",
          path: "/src",
          include: "*.tsx",
        })
      })
    })

    describe("websearch tool", () => {
      it("should use query and numResults (camelCase)", () => {
        const text = `<minimax:tool_call>
<invoke name="websearch">
<parameter name="query">TypeScript best practices</parameter>
<parameter name="numResults">10</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          query: "TypeScript best practices",
          numResults: 10,
        })
      })

      it("should map search_query to query and num_results to numResults", () => {
        const text = `<minimax:tool_call>
<invoke name="websearch">
<parameter name="search_query">React hooks</parameter>
<parameter name="num_results">5</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          query: "React hooks",
          numResults: 5,
        })
      })
    })

    describe("webfetch tool", () => {
      it("should use url and format", () => {
        const text = `<minimax:tool_call>
<invoke name="webfetch">
<parameter name="url">https://example.com</parameter>
<parameter name="format">markdown</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          url: "https://example.com",
          format: "markdown",
        })
      })

      it("should map link to url", () => {
        const text = `<minimax:tool_call>
<invoke name="webfetch">
<parameter name="link">https://docs.example.com</parameter>
<parameter name="format">text</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          url: "https://docs.example.com",
          format: "text",
        })
      })
    })

    describe("ls tool", () => {
      it("should use path", () => {
        const text = `<minimax:tool_call>
<invoke name="ls">
<parameter name="path">/Users/test/project</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          path: "/Users/test/project",
        })
      })

      it("should map directory to path", () => {
        const text = `<minimax:tool_call>
<invoke name="ls">
<parameter name="directory">/src</parameter>
</invoke>
</minimax:tool_call>`

        const result = MinimaxToolFormat.parse(text)

        expect(result.toolCalls[0].parameters).toEqual({
          path: "/src",
        })
      })
    })
  })

  describe("tool name mapping", () => {
    it("should map read_file to read", () => {
      const text = `<minimax:tool_call>
<invoke name="read_file">
<parameter name="file_path">/test.txt</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].name).toBe("read")
    })

    it("should map write_file to write", () => {
      const text = `<minimax:tool_call>
<invoke name="write_file">
<parameter name="file_path">/test.txt</parameter>
<parameter name="content">test</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].name).toBe("write")
    })

    it("should map edit_file to edit", () => {
      const text = `<minimax:tool_call>
<invoke name="edit_file">
<parameter name="file_path">/test.txt</parameter>
<parameter name="old_string">a</parameter>
<parameter name="new_string">b</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].name).toBe("edit")
    })

    it("should map run_bash to bash", () => {
      const text = `<minimax:tool_call>
<invoke name="run_bash">
<parameter name="command">ls</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].name).toBe("bash")
    })

    it("should map exa_web_search_exa to websearch", () => {
      const text = `<minimax:tool_call>
<invoke name="exa_web_search_exa">
<parameter name="query">test</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].name).toBe("websearch")
    })

    it("should map list_files to glob", () => {
      const text = `<minimax:tool_call>
<invoke name="list_files">
<parameter name="pattern">*.ts</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].name).toBe("glob")
    })

    it("should map search_files to grep", () => {
      const text = `<minimax:tool_call>
<invoke name="search_files">
<parameter name="pattern">TODO</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].name).toBe("grep")
    })

    it("should preserve unmapped tool names", () => {
      const text = `<minimax:tool_call>
<invoke name="custom_tool">
<parameter name="arg">value</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].name).toBe("custom_tool")
    })
  })

  describe("value type conversion", () => {
    it("should convert numeric strings to numbers", () => {
      const text = `<minimax:tool_call>
<invoke name="read">
<parameter name="file_path">/test.txt</parameter>
<parameter name="offset">100</parameter>
<parameter name="limit">50</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].parameters.offset).toBe(100)
      expect(result.toolCalls[0].parameters.limit).toBe(50)
      expect(typeof result.toolCalls[0].parameters.offset).toBe("number")
    })

    it("should convert boolean strings to booleans", () => {
      const text = `<minimax:tool_call>
<invoke name="edit">
<parameter name="file_path">/test.txt</parameter>
<parameter name="old_string">a</parameter>
<parameter name="new_string">b</parameter>
<parameter name="replace_all">true</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].parameters.replaceAll).toBe(true)
      expect(typeof result.toolCalls[0].parameters.replaceAll).toBe("boolean")
    })

    it("should convert 'false' to boolean false", () => {
      const text = `<minimax:tool_call>
<invoke name="edit">
<parameter name="file_path">/test.txt</parameter>
<parameter name="old_string">a</parameter>
<parameter name="new_string">b</parameter>
<parameter name="replace_all">false</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].parameters.replaceAll).toBe(false)
    })

    it("should convert 'null' to null", () => {
      const text = `<minimax:tool_call>
<invoke name="test">
<parameter name="value">null</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].parameters.value).toBeNull()
    })

    it("should parse JSON arrays", () => {
      const text = `<minimax:tool_call>
<invoke name="todowrite">
<parameter name="todos">[{"content": "Task 1", "status": "pending", "activeForm": "Working on task"}]</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].parameters.todos).toEqual([
        { content: "Task 1", status: "pending", activeForm: "Working on task" },
      ])
    })

    it("should parse JSON objects", () => {
      const text = `<minimax:tool_call>
<invoke name="test">
<parameter name="config">{"key": "value", "nested": {"a": 1}}</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].parameters.config).toEqual({
        key: "value",
        nested: { a: 1 },
      })
    })
  })

  describe("tool result formatting", () => {
    it("should format tool result with correct XML structure", () => {
      const result = MinimaxToolFormat.formatToolResult({
        toolName: "read",
        output: "file contents here",
      })

      expect(result).toBe(`<tool_result name="read">
file contents here
</tool_result>`)
    })

    it("should add success message for empty output", () => {
      const result = MinimaxToolFormat.formatToolResult({
        toolName: "write",
        output: "",
      })

      expect(result).toBe(`<tool_result name="write">
Success. The operation completed successfully.
</tool_result>`)
    })

    it("should add success message for whitespace-only output", () => {
      const result = MinimaxToolFormat.formatToolResult({
        toolName: "edit",
        output: "   \n\t  ",
      })

      expect(result).toBe(`<tool_result name="edit">
Success. The operation completed successfully.
</tool_result>`)
    })

    it("should format multiple tool results", () => {
      const result = MinimaxToolFormat.formatToolResultMessage([
        { toolName: "read", output: "content1" },
        { toolName: "bash", output: "output2" },
      ])

      expect(result).toBe(`<tool_result name="read">
content1
</tool_result>
<tool_result name="bash">
output2
</tool_result>`)
    })
  })

  describe("detection methods", () => {
    describe("hasToolCall", () => {
      it("should detect minimax:tool_call opening tag", () => {
        expect(MinimaxToolFormat.hasToolCall("<minimax:tool_call>")).toBe(true)
        expect(MinimaxToolFormat.hasToolCall("text before <minimax:tool_call>")).toBe(true)
      })

      it("should return false for non-matching text", () => {
        expect(MinimaxToolFormat.hasToolCall("regular text")).toBe(false)
        expect(MinimaxToolFormat.hasToolCall("<tool_call>")).toBe(false)
      })
    })

    describe("hasCompleteToolCall", () => {
      it("should detect complete tool call block", () => {
        expect(MinimaxToolFormat.hasCompleteToolCall("<minimax:tool_call></minimax:tool_call>")).toBe(true)
        expect(
          MinimaxToolFormat.hasCompleteToolCall(`<minimax:tool_call>
<invoke name="test"><parameter name="x">1</parameter></invoke>
</minimax:tool_call>`),
        ).toBe(true)
      })

      it("should detect incomplete block with complete invoke (stop sequence)", () => {
        // MiniMax may stop at </invoke> due to stop sequences
        expect(
          MinimaxToolFormat.hasCompleteToolCall(`<minimax:tool_call>
<invoke name="read">
<parameter name="file_path">/test.txt</parameter>
</invoke>`),
        ).toBe(true)
      })

      it("should return false for truly incomplete blocks", () => {
        expect(MinimaxToolFormat.hasCompleteToolCall("<minimax:tool_call>")).toBe(false)
        expect(MinimaxToolFormat.hasCompleteToolCall("<minimax:tool_call><invoke name")).toBe(false)
      })
    })

    describe("hasThinking", () => {
      it("should detect think tag", () => {
        expect(MinimaxToolFormat.hasThinking("<think>")).toBe(true)
        expect(MinimaxToolFormat.hasThinking("text <think> more")).toBe(true)
      })

      it("should return false for non-matching text", () => {
        expect(MinimaxToolFormat.hasThinking("regular text")).toBe(false)
      })
    })

    describe("hasCompleteThinking", () => {
      it("should detect complete thinking block", () => {
        expect(MinimaxToolFormat.hasCompleteThinking("<think>content</think>")).toBe(true)
      })

      it("should return false for incomplete thinking", () => {
        expect(MinimaxToolFormat.hasCompleteThinking("<think>incomplete")).toBe(false)
      })
    })
  })

  describe("edge cases", () => {
    it("should preserve text outside tool call XML", () => {
      const text = `Let me read that file for you.
<minimax:tool_call>
<invoke name="read">
<parameter name="file_path">/test.txt</parameter>
</invoke>
</minimax:tool_call>
I'll analyze the contents.`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls).toHaveLength(1)
      expect(result.cleanedText).toBe("Let me read that file for you.\n\nI'll analyze the contents.")
    })

    it("should extract thinking content from think tags", () => {
      const text = `<think>
I need to read this file first.
Let me check the path.
</think>
<minimax:tool_call>
<invoke name="read">
<parameter name="file_path">/test.txt</parameter>
</invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.thinking).toBe("I need to read this file first.\nLet me check the path.")
      expect(result.toolCalls).toHaveLength(1)
    })

    it("should parse incomplete tool call blocks (missing closing tag)", () => {
      const text = `<minimax:tool_call>
<invoke name="read">
<parameter name="file_path">/test.txt</parameter>
</invoke>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls).toHaveLength(1)
      expect(result.toolCalls[0].name).toBe("read")
      expect(result.cleanedText).toBe("")
    })

    it("should generate unique IDs for each tool call", () => {
      const text = `<minimax:tool_call>
<invoke name="read"><parameter name="file_path">/a.txt</parameter></invoke>
<invoke name="read"><parameter name="file_path">/b.txt</parameter></invoke>
</minimax:tool_call>`

      const result = MinimaxToolFormat.parse(text)

      expect(result.toolCalls[0].id).not.toBe(result.toolCalls[1].id)
      expect(result.toolCalls[0].id).toMatch(/^minimax_/)
      expect(result.toolCalls[1].id).toMatch(/^minimax_/)
    })
  })
})
