import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function disableThinking(body: Record<string, unknown>) {
  return { ...body, enable_thinking: false };
}

export function createTodoProvider(baseURL: string, apiKey: string) {
  return createOpenAICompatible({
    name: "todo-provider",
    baseURL,
    apiKey,
    supportsStructuredOutputs: true,
    transformRequestBody: disableThinking,
  });
}
