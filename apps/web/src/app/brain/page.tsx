"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Bot, User, BrainCircuit, TerminalSquare } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function BrainPage() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/brain/agent" }),
  });
  const [input, setInput] = useState("");
  const isLoading = status === "submitted" || status === "streaming";

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    sendMessage({ text });
    setInput("");
  }

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4 bg-background">
      <header className="mb-6 pb-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2 text-primary">
          <BrainCircuit className="w-8 h-8" />
          <h1 className="text-2xl font-bold tracking-tight">Company Brain</h1>
        </div>
        <p className="text-sm text-muted-foreground font-mono bg-muted px-2 py-1 rounded">Agentic RAG Active</p>
      </header>

      <div className="flex-1 overflow-y-auto space-y-6 pb-24 pr-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
            <BrainCircuit className="w-24 h-24 text-muted-foreground" />
            <h2 className="text-xl font-semibold">Ask the Company Brain</h2>
            <p className="max-w-md text-sm">
              I can search through Slack messages, emails, and Linear tickets to find answers, or trigger workflows automatically.
            </p>
          </div>
        ) : null}

        {messages.map((message) => (
          <div key={message.id} className={`flex gap-4 ${message.role === "user" ? "justify-end" : ""}`}>
            {message.role === "assistant" && (
              <div className="w-8 h-8 shrink-0 bg-primary/10 rounded-full flex items-center justify-center">
                <Bot className="w-5 h-5 text-primary" />
              </div>
            )}

            <div className={`flex flex-col gap-2 max-w-[80%] ${message.role === "user" ? "items-end" : "items-start"}`}>
              {message.parts.map((part, index) => {
                if (part.type === "text") {
                  return (
                    <div
                      key={index}
                      className={`rounded-xl px-4 py-2 ${message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{part.text}</p>
                    </div>
                  );
                }

                if (part.type.startsWith("tool-")) {
                  const toolPart = part as {
                    type: string;
                    toolCallId?: string;
                    state: "input-streaming" | "input-available" | "output-available" | "output-error";
                    input?: unknown;
                    output?: unknown;
                    errorText?: string;
                  };
                  const toolName = part.type.replace(/^tool-/, "");
                  const finished = toolPart.state === "output-available" || toolPart.state === "output-error";

                  return (
                    <Card
                      key={toolPart.toolCallId ?? index}
                      className="bg-card text-card-foreground shadow-sm w-full border-muted-foreground/20 p-3 mt-1"
                    >
                      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground mb-2 pb-2 border-b">
                        <TerminalSquare className="w-4 h-4" />
                        <span>Agent Tool Execution: {toolName}</span>
                      </div>

                      {finished ? (
                        <div className="text-xs space-y-1">
                          <p className={`font-semibold ${toolPart.state === "output-error" ? "text-red-500" : "text-green-500"}`}>
                            {toolPart.state === "output-error" ? "✗ Error" : "✓ Completed"}
                          </p>
                          <pre className="p-2 bg-muted rounded overflow-x-auto max-h-32 text-muted-foreground">
                            {JSON.stringify(toolPart.output ?? toolPart.errorText, null, 2)}
                          </pre>
                        </div>
                      ) : (
                        <div className="text-xs space-y-1">
                          <p className="font-semibold text-blue-500 animate-pulse">Running…</p>
                          <pre className="p-2 bg-muted rounded overflow-x-auto max-h-32 text-muted-foreground">
                            {JSON.stringify(toolPart.input, null, 2)}
                          </pre>
                        </div>
                      )}
                    </Card>
                  );
                }

                return null;
              })}
            </div>

            {message.role === "user" && (
              <div className="w-8 h-8 shrink-0 bg-secondary rounded-full flex items-center justify-center">
                <User className="w-5 h-5" />
              </div>
            )}
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex gap-4">
            <div className="w-8 h-8 shrink-0 bg-primary/10 rounded-full flex items-center justify-center">
              <Bot className="w-5 h-5 text-primary animate-pulse" />
            </div>
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-md border-t p-4">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex gap-4">
          <input
            className="flex-1 bg-muted px-4 py-3 rounded-xl border-none focus:ring-2 focus:ring-primary outline-none transition-all"
            value={input}
            placeholder="Search the company brain or trigger a workflow..."
            onChange={(event) => setInput(event.target.value)}
          />
          <Button type="submit" size="lg" className="rounded-xl px-8 shadow-md hover:shadow-lg transition-all" disabled={isLoading || !input.trim()}>
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
