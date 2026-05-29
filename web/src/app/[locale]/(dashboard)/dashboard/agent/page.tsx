'use client';

import { useEffect, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Plus, Send, Sparkles, Trash2, Loader2, Crown, Wrench } from 'lucide-react';

interface ConversationRow {
  id: string;
  title: string;
  brand_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentMessageRow {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: UIMessage['parts'] | null;
  created_at: string;
}

export default function AgentPage() {
  const { canUse, requiredPlanFor } = useFeatureGate();
  const allowed = canUse('ai_agent');

  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [hydrating, setHydrating] = useState(true);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Plan gate — Growth+ on cloud, unrestricted on self-host (the feature
  // flag handles both via the existing useFeatureGate hook).
  if (!allowed) {
    return <PlanGate requiredPlan={requiredPlanFor('ai_agent')} />;
  }

  return (
    <AgentChat
      conversations={conversations}
      setConversations={setConversations}
      activeId={activeId}
      setActiveId={setActiveId}
      initialMessages={initialMessages}
      setInitialMessages={setInitialMessages}
      hydrating={hydrating}
      setHydrating={setHydrating}
      input={input}
      setInput={setInput}
      messagesEndRef={messagesEndRef}
    />
  );
}

function AgentChat(props: {
  conversations: ConversationRow[];
  setConversations: React.Dispatch<React.SetStateAction<ConversationRow[]>>;
  activeId: string | null;
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
  initialMessages: UIMessage[];
  setInitialMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>;
  hydrating: boolean;
  setHydrating: React.Dispatch<React.SetStateAction<boolean>>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  messagesEndRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const {
    conversations,
    setConversations,
    activeId,
    setActiveId,
    initialMessages,
    setInitialMessages,
    hydrating,
    setHydrating,
    input,
    setInput,
    messagesEndRef,
  } = props;

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/agent/chat',
      // Always forward the active conversation id alongside the messages
      // array — the server saves messages keyed off it.
      prepareSendMessagesRequest: ({ messages, body }) => ({
        body: { ...(body ?? {}), conversationId: activeId, messages },
      }),
    }),
  });

  // Sync hydrated messages into the chat hook whenever we switch conversation.
  useEffect(() => {
    setMessages(initialMessages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessages]);

  // Auto-scroll on new messages / streaming chunks.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, messagesEndRef]);

  // Initial load of the conversation list + the most-recent conversation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agent/conversations');
        if (!res.ok) {
          setHydrating(false);
          return;
        }
        const { conversations: list } = (await res.json()) as {
          conversations: ConversationRow[];
        };
        if (cancelled) return;
        setConversations(list);
        if (list.length > 0) {
          await loadConversation(list[0]!.id);
        } else {
          setHydrating(false);
        }
      } catch {
        setHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadConversation(id: string) {
    setHydrating(true);
    setActiveId(id);
    try {
      const res = await fetch(`/api/agent/conversations/${id}`);
      if (!res.ok) {
        setInitialMessages([]);
        return;
      }
      const { messages: rows } = (await res.json()) as {
        messages: AgentMessageRow[];
      };
      // Rehydrate UIMessages. We saved `tool_calls` as the full parts
      // array, so prefer it; fall back to a single text part from the
      // `content` column.
      const hydrated: UIMessage[] = rows.map((r) => ({
        id: r.id,
        role: r.role === 'tool' ? 'assistant' : r.role,
        parts:
          Array.isArray(r.tool_calls) && r.tool_calls.length > 0
            ? (r.tool_calls as UIMessage['parts'])
            : [{ type: 'text', text: r.content }],
      })) as UIMessage[];
      setInitialMessages(hydrated);
    } finally {
      setHydrating(false);
    }
  }

  async function newChat() {
    const res = await fetch('/api/agent/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) return;
    const { conversation } = (await res.json()) as { conversation: ConversationRow };
    setConversations((prev) => [conversation, ...prev]);
    setActiveId(conversation.id);
    setInitialMessages([]);
    setInput('');
  }

  async function deleteConversation(id: string) {
    if (!confirm('Delete this conversation?')) return;
    const res = await fetch(`/api/agent/conversations/${id}`, { method: 'DELETE' });
    if (!res.ok) return;
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setInitialMessages([]);
      setMessages([]);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || status !== 'ready') return;
    // No active conversation yet — spin one up before the first send.
    if (!activeId) {
      const res = await fetch('/api/agent/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) return;
      const { conversation } = (await res.json()) as { conversation: ConversationRow };
      setConversations((prev) => [conversation, ...prev]);
      setActiveId(conversation.id);
    }
    sendMessage({ text });
    setInput('');
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] -m-6">
      <aside className="w-72 border-r bg-card flex flex-col">
        <div className="p-3 border-b">
          <Button onClick={newChat} variant="outline" className="w-full justify-start gap-2">
            <Plus className="h-4 w-4" />
            New chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">No conversations yet.</p>
          )}
          {conversations.map((c) => (
            // Outer wrapper is a div with role="button" rather than a real
            // <button> because we render the delete control as a nested
            // <button> inside it — HTML doesn't allow button-in-button
            // (hydration error in Next.js). Keyboard support via tabIndex +
            // onKeyDown preserves the same affordance.
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => loadConversation(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  loadConversation(c.id);
                }
              }}
              className={cn(
                'w-full text-left text-sm rounded-md px-3 py-2 flex items-start gap-2 group hover:bg-accent transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                activeId === c.id && 'bg-accent',
              )}
            >
              <span className="flex-1 truncate">{c.title}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteConversation(c.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                aria-label="Delete conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {hydrating ? (
            <div className="flex items-center justify-center h-full text-muted-foreground gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading conversation…
            </div>
          ) : messages.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
              {(status === 'submitted' || status === 'streaming') && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Thinking…
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="border-t bg-background px-6 py-4">
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void onSubmit(e as unknown as React.FormEvent);
                }
              }}
              placeholder="Ask about visibility, competitors, citations…"
              rows={1}
              disabled={status !== 'ready'}
              className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50"
            />
            {status === 'streaming' || status === 'submitted' ? (
              <Button type="button" variant="outline" onClick={() => stop()}>
                Stop
              </Button>
            ) : (
              <Button type="submit" disabled={!input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-3 text-sm',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-card border',
        )}
      >
        {(message.parts ?? []).map((part, i) => {
          if (part.type === 'text') {
            return (
              <p key={i} className="whitespace-pre-wrap leading-relaxed">
                {part.text}
              </p>
            );
          }
          if (part.type.startsWith('tool-')) {
            const toolPart = part as unknown as {
              type: string;
              toolName?: string;
              state?: string;
            };
            const name = toolPart.toolName ?? part.type.replace('tool-', '');
            return (
              <div
                key={i}
                className="my-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted rounded-md px-2 py-1"
              >
                <Wrench className="h-3 w-3" />
                <span className="font-mono">{name}</span>
                {toolPart.state && (
                  <span className="text-muted-foreground/60">· {toolPart.state}</span>
                )}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center max-w-md">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
          <Sparkles className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-semibold">Ask the agent</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Grounded in your tracked data. Try <em>&ldquo;how is my brand doing?&rdquo;</em> or{' '}
          <em>&ldquo;who&apos;s gaining share of voice this month?&rdquo;</em>
        </p>
      </div>
    </div>
  );
}

function PlanGate({ requiredPlan }: { requiredPlan: string }) {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center -m-6 p-6">
      <div className="text-center max-w-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4">
          <Crown className="h-7 w-7 text-amber-600 dark:text-amber-400" />
        </div>
        <h2 className="text-lg font-semibold">Agent is a {requiredPlan} feature</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Upgrade your plan to chat with your dashboard about visibility, competitors, citations,
          and content gaps.
        </p>
      </div>
    </div>
  );
}
