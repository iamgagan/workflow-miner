"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, Send, X, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface Message {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
}

const SUGGESTED_QUERIES = [
  "How do I handle bug reports?",
  "What's my most common workflow?",
  "Show me patterns from last week",
  "Who reviews the most PRs?",
  "What slows down my deployments?",
] as const;

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <MessageCircle className="h-4 w-4 text-primary" />
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-3">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="h-2 w-2 rounded-full bg-muted-foreground/50"
              animate={{ y: [0, -6, 0] }}
              transition={{
                duration: 0.6,
                repeat: Infinity,
                delay: i * 0.15,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ message }: { readonly message: Message }) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn("flex items-start gap-3", isUser && "flex-row-reverse")}
    >
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <MessageCircle className="h-4 w-4 text-primary" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "rounded-tr-sm bg-primary text-primary-foreground"
            : "rounded-tl-sm bg-muted",
        )}
      >
        <MessageContent content={message.content} />
      </div>
    </motion.div>
  );
}

function MessageContent({ content }: { readonly content: string }) {
  // Simple markdown-like rendering for bold text and newlines
  const parts = content.split(/(\*\*[^*]+\*\*|\n)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part === "\n") return <br key={i} />;
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <span key={i} className="font-semibold">
              {part.slice(2, -2)}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function EmptyState({
  onSelectQuery,
}: {
  readonly onSelectQuery: (query: string) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-full bg-primary/10 p-4">
        <MessageCircle className="h-8 w-8 text-primary" />
      </div>
      <div>
        <h3 className="font-semibold">Ask your workflow</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Query your patterns in natural language
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTED_QUERIES.map((query) => (
          <button
            key={query}
            onClick={() => onSelectQuery(query)}
            className="rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            {query}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WorkflowChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: content.trim(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setIsLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: content.trim() }),
        });

        const data = (await res.json()) as { response?: string; error?: string };

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            data.response ?? "Sorry, I couldn't process that. Try again.",
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch {
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "Something went wrong. Please try again.",
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <>
      {/* Desktop: Side panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 380, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="hidden shrink-0 overflow-hidden border-l bg-background lg:block"
          >
            <div className="flex h-full w-[380px] flex-col">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">Ask your workflow</h2>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setIsOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <ChatBody
                messages={messages}
                isLoading={isLoading}
                scrollRef={scrollRef}
                onSelectQuery={sendMessage}
              />

              <ChatInput
                input={input}
                isLoading={isLoading}
                inputRef={inputRef}
                onChange={setInput}
                onKeyDown={handleKeyDown}
                onSend={() => sendMessage(input)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile: Bottom sheet */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="fixed inset-x-0 bottom-0 z-50 flex h-[70vh] flex-col rounded-t-2xl border-t bg-background shadow-2xl lg:hidden"
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Ask your workflow</h2>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ChatBody
              messages={messages}
              isLoading={isLoading}
              scrollRef={scrollRef}
              onSelectQuery={sendMessage}
            />

            <ChatInput
              input={input}
              isLoading={isLoading}
              inputRef={inputRef}
              onChange={setInput}
              onKeyDown={handleKeyDown}
              onSend={() => sendMessage(input)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toggle buttons */}
      {!isOpen && (
        <>
          {/* Desktop FAB */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="fixed bottom-6 right-6 z-50 hidden lg:block"
          >
            <Button
              onClick={() => setIsOpen(true)}
              size="lg"
              className="h-14 w-14 rounded-full shadow-lg"
            >
              <MessageCircle className="h-6 w-6" />
            </Button>
          </motion.div>

          {/* Mobile bottom bar */}
          <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background p-2 lg:hidden">
            <Button
              onClick={() => setIsOpen(true)}
              variant="ghost"
              className="w-full gap-2"
            >
              <ChevronUp className="h-4 w-4" />
              <span className="text-sm">Ask your workflow</span>
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function ChatBody({
  messages,
  isLoading,
  scrollRef,
  onSelectQuery,
}: {
  readonly messages: readonly Message[];
  readonly isLoading: boolean;
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
  readonly onSelectQuery: (query: string) => void;
}) {
  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 overflow-hidden">
        <EmptyState onSelectQuery={onSelectQuery} />
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div ref={scrollRef} className="flex flex-col gap-4 p-4">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {isLoading && <TypingIndicator />}
      </div>
    </ScrollArea>
  );
}

function ChatInput({
  input,
  isLoading,
  inputRef,
  onChange,
  onKeyDown,
  onSend,
}: {
  readonly input: string;
  readonly isLoading: boolean;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly onChange: (value: string) => void;
  readonly onKeyDown: (e: React.KeyboardEvent) => void;
  readonly onSend: () => void;
}) {
  return (
    <div className="border-t p-4">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about your workflows..."
          disabled={isLoading}
          className="flex h-10 w-full rounded-full border border-input bg-background px-4 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Button
          onClick={onSend}
          disabled={!input.trim() || isLoading}
          size="icon"
          className="h-10 w-10 shrink-0 rounded-full"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
