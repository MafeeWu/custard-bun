import type { GenerationStatus } from "@/server/db/chat-schema";
import type { PublishedCharacterVersion } from "@/server/characters/character-queries";
import type { RecalledMemoryContext } from "@/server/memory/memory-recall";
import {
  boundMemoryContext,
  boundedMemoryTokenBudget,
  memoryPromptLimits,
  serializeUntrustedMemoryContext,
} from "@/server/memory/memory-prompt";
import { ChatDomainError } from "./chat-errors";
import type { TokenCounter } from "./token-counter";

export type GatewayMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type PromptHistoryMessage =
  | {
      id: string;
      conversationId: string;
      userId: string;
      sequence: number;
      role: "user";
      kind: "user";
      content: string;
    }
  | {
      id: string;
      conversationId: string;
      userId: string;
      sequence: number;
      role: "assistant";
      kind: "opening";
      content: string;
    }
  | {
      id: string;
      conversationId: string;
      userId: string;
      sequence: number;
      role: "assistant";
      kind: "generated";
      content: string;
      inReplyTo: string;
      attemptId: string;
      status: GenerationStatus;
      isCurrent: boolean;
    };

type PromptTurn = {
  user: Extract<PromptHistoryMessage, { role: "user" }>;
  assistant: Extract<
    PromptHistoryMessage,
    { role: "assistant"; kind: "generated" }
  >;
};

function buildCharacterInstruction(
  character: PublishedCharacterVersion,
): string {
  return [
    `Character: ${character.displayName}`,
    "Personality principles:",
    ...character.personalityPrinciples.map((value) => `- ${value}`),
    `Speaking style: ${character.speakingStyle}`,
    `Response rhythm: ${character.responseRhythm}`,
    "Relationship boundaries:",
    ...character.relationshipBoundaries.map((value) => `- ${value}`),
    "Safety additions:",
    ...character.safetyAdditions.map((value) => `- ${value}`),
  ].join("\n");
}

function flattenTurns(turns: PromptTurn[]): GatewayMessage[] {
  return turns.flatMap((turn) => [
    {
      role: "user" as const,
      content: turn.user.content,
    },
    {
      role: "assistant" as const,
      content: turn.assistant.content,
    },
  ]);
}

function estimateInputTokens(
  tokenCounter: TokenCounter,
  messages: GatewayMessage[],
): number {
  return tokenCounter.withSafetyMargin(tokenCounter.estimateMessages(messages));
}

function fitsWithinBudget(input: {
  tokenCounter: TokenCounter;
  messages: GatewayMessage[];
  maxOutputTokens: number;
  promptTokenBudget: number;
}): boolean {
  return (
    estimateInputTokens(input.tokenCounter, input.messages) +
      input.maxOutputTokens <=
    input.promptTokenBudget
  );
}

function filterCurrentHistory(input: {
  history: PromptHistoryMessage[];
  userId: string;
  conversationId: string;
}): PromptHistoryMessage[] {
  return input.history.filter(
    (message) =>
      message.userId === input.userId &&
      message.conversationId === input.conversationId,
  );
}

function createCompleteTurns(history: PromptHistoryMessage[]): PromptTurn[] {
  const sorted = [...history].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const users = new Map<
    string,
    Extract<PromptHistoryMessage, { role: "user" }>
  >();
  const assistants = new Map<
    string,
    Extract<PromptHistoryMessage, { role: "assistant"; kind: "generated" }>
  >();

  for (const message of sorted) {
    if (message.role === "user") {
      users.set(message.id, message);
      continue;
    }

    if (
      message.kind !== "generated" ||
      message.status !== "complete" ||
      !message.isCurrent
    ) {
      continue;
    }

    assistants.set(message.inReplyTo, message);
  }

  const turns: PromptTurn[] = [];
  for (const user of users.values()) {
    const assistant = assistants.get(user.id);
    if (!assistant) {
      continue;
    }
    if (
      assistant.sequence <= user.sequence ||
      assistant.conversationId !== user.conversationId ||
      assistant.userId !== user.userId
    ) {
      continue;
    }

    turns.push({ user, assistant });
  }

  return turns;
}

function appendExampleMessages(input: {
  selected: GatewayMessage[];
  currentUserMessage: GatewayMessage;
  character: PublishedCharacterVersion;
  tokenCounter: TokenCounter;
  maxOutputTokens: number;
  promptTokenBudget: number;
}): GatewayMessage[] {
  const selected = [...input.selected];

  for (const example of input.character.exampleConversations) {
    const candidate = [
      ...selected,
      { role: "user" as const, content: example.user },
      { role: "assistant" as const, content: example.assistant },
      input.currentUserMessage,
    ];

    if (
      !fitsWithinBudget({
        tokenCounter: input.tokenCounter,
        messages: candidate,
        maxOutputTokens: input.maxOutputTokens,
        promptTokenBudget: input.promptTokenBudget,
      })
    ) {
      break;
    }

    selected.push(
      { role: "user", content: example.user },
      { role: "assistant", content: example.assistant },
    );
  }

  return selected;
}

function appendHistoryTurns(input: {
  selected: GatewayMessage[];
  currentUserMessage: GatewayMessage;
  userId: string;
  conversationId: string;
  history: PromptHistoryMessage[];
  tokenCounter: TokenCounter;
  maxOutputTokens: number;
  promptTokenBudget: number;
}): {
  messages: GatewayMessage[];
  includedHistoryMessageIds: string[];
} {
  const completeTurns = createCompleteTurns(
    filterCurrentHistory({
      history: input.history,
      userId: input.userId,
      conversationId: input.conversationId,
    }),
  );
  const selectedTurns: PromptTurn[] = [];

  for (const turn of [...completeTurns].reverse()) {
    const candidateTurns = [turn, ...selectedTurns];
    const candidateMessages = [
      ...input.selected,
      ...flattenTurns(candidateTurns),
      input.currentUserMessage,
    ];

    if (
      !fitsWithinBudget({
        tokenCounter: input.tokenCounter,
        messages: candidateMessages,
        maxOutputTokens: input.maxOutputTokens,
        promptTokenBudget: input.promptTokenBudget,
      })
    ) {
      break;
    }

    selectedTurns.unshift(turn);
  }

  return {
    messages: [...input.selected, ...flattenTurns(selectedTurns)],
    includedHistoryMessageIds: selectedTurns.flatMap((turn) => [
      turn.user.id,
      turn.assistant.id,
    ]),
  };
}

export function assembleChatPrompt(input: {
  character: PublishedCharacterVersion;
  userId: string;
  conversationId: string;
  history: PromptHistoryMessage[];
  currentUserMessage: string;
  platformRules: string;
  promptTokenBudget: number;
  maxOutputTokens: number;
  tokenCounter: TokenCounter;
  memoryContext: RecalledMemoryContext;
  memoryPromptTokenBudget: number;
  relationshipSummaryTokenBudget: number;
  memoryItemsTokenBudget: number;
}): {
  messages: GatewayMessage[];
  estimatedInputTokens: number;
  includedHistoryMessageIds: string[];
  memoryDiagnostics: {
    memoryItemIds: string[];
    summaryVersionId?: string;
  };
} {
  const currentUserMessage: GatewayMessage = {
    role: "user",
    content: input.currentUserMessage,
  };
  const mandatoryPrefix: GatewayMessage[] = [
    {
      role: "system",
      content: input.platformRules,
    },
    {
      role: "system",
      content: buildCharacterInstruction(input.character),
    },
  ];
  const mandatoryMessages = [...mandatoryPrefix, currentUserMessage];

  if (
    !fitsWithinBudget({
      tokenCounter: input.tokenCounter,
      messages: mandatoryMessages,
      maxOutputTokens: input.maxOutputTokens,
      promptTokenBudget: input.promptTokenBudget,
    })
  ) {
    throw new ChatDomainError(
      "CHAT_VALIDATION",
      "The mandatory prompt content exceeds the available token budget.",
    );
  }

  const withExamples = appendExampleMessages({
    selected: mandatoryPrefix,
    currentUserMessage,
    character: input.character,
    tokenCounter: input.tokenCounter,
    maxOutputTokens: input.maxOutputTokens,
    promptTokenBudget: input.promptTokenBudget,
  });
  const selectedMemory = boundMemoryContext(input.memoryContext, {
    summaryTokenBudget: input.relationshipSummaryTokenBudget,
    itemTokenBudget: input.memoryItemsTokenBudget,
    tokenCounter: input.tokenCounter,
  });
  const memoryBudget = boundedMemoryTokenBudget(
    input.memoryPromptTokenBudget,
    memoryPromptLimits.totalTokens,
  );
  let memoryMessages = serializeUntrustedMemoryContext(selectedMemory);
  while (memoryMessages.length > 0) {
    if (
      input.tokenCounter.estimateMessages(memoryMessages) <= memoryBudget &&
      fitsWithinBudget({
        tokenCounter: input.tokenCounter,
        messages: [...withExamples, ...memoryMessages, currentUserMessage],
        maxOutputTokens: input.maxOutputTokens,
        promptTokenBudget: input.promptTokenBudget,
      })
    )
      break;
    if (selectedMemory.items.length > 0) selectedMemory.items.pop();
    else delete selectedMemory.summary;
    memoryMessages = serializeUntrustedMemoryContext(selectedMemory);
  }
  const withHistory = appendHistoryTurns({
    selected: [...withExamples, ...memoryMessages],
    currentUserMessage,
    userId: input.userId,
    conversationId: input.conversationId,
    history: input.history,
    tokenCounter: input.tokenCounter,
    maxOutputTokens: input.maxOutputTokens,
    promptTokenBudget: input.promptTokenBudget,
  });
  const messages = [...withHistory.messages, currentUserMessage];

  return {
    messages,
    estimatedInputTokens: estimateInputTokens(input.tokenCounter, messages),
    includedHistoryMessageIds: withHistory.includedHistoryMessageIds,
    memoryDiagnostics: {
      memoryItemIds: selectedMemory.items.map((item) => item.id),
      ...(selectedMemory.summary
        ? { summaryVersionId: selectedMemory.summary.versionId }
        : {}),
    },
  };
}
