"use client";

// ============================================================
// Copilot chat panel — mounted at the COPILOT_MOUNT seam.
//
// Explain-only assistant for the CURRENT reconciliation:
//   - context is rebuilt from live state on every send, so the
//     copilot always sees the user's latest accept/reject state
//   - conversation is per-reconciliation and in-memory only
//     (parent remounts via key; nothing is persisted)
//   - transparency notice on first open (ack in localStorage),
//     re-openable any time from the header info button
//   - persistent one-line disclaimer under the input
//
// This component never mutates reconciliation state. It talks;
// the user acts through the existing UI.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import type { ReconContext } from "@/lib/copilot/schema";
import { QUESTION_MAX } from "@/lib/copilot/schema";

const NOTICE_ACK_KEY = "reconly-copilot-notice-ack";

const STARTER_QUESTIONS = [
  "Why doesn't my account balance?",
  "Why wasn't this matched?",
  "What's making up the difference?",
];

const NOTICE_TEXT =
  "When you ask the assistant a question, the transaction dates, descriptions, " +
  "and amounts from this reconciliation are sent securely to an AI service " +
  "(Anthropic) to generate the answer. Reconly never stores this data on a " +
  "server, and it is not used to train AI models. Don't use the assistant if " +
  "you'd prefer this data stays only on your device.";

const DISCLAIMER_TEXT =
  "Explains your reconciliation results. Not accounting, tax, or financial advice.";

type ChatMessage = { role: "user" | "assistant"; text: string };

type CopilotPanelProps = {
  /** Build the grounding payload from CURRENT state; null = not ready. */
  getContext: () => ReconContext | null;
};

export function CopilotPanel({ getContext }: CopilotPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [showNotice, setShowNotice] = useState(false);
  const [sessionId] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // First open: show the transparency notice until acknowledged once.
  const handleOpen = () => {
    setOpen(true);
    // Show the notice only when never acknowledged; a help-toggled notice
    // from a previous open doesn't carry over.
    try {
      setShowNotice(!localStorage.getItem(NOTICE_ACK_KEY));
    } catch {
      setShowNotice(true); // storage unavailable → always show
    }
  };

  const acknowledgeNotice = () => {
    setShowNotice(false);
    try {
      localStorage.setItem(NOTICE_ACK_KEY, "1");
    } catch {
      // storage unavailable — notice will reappear next open, which is fine
    }
  };

  // Keep the latest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending, open]);

  const send = async (rawQuestion: string) => {
    const question = rawQuestion.trim().slice(0, QUESTION_MAX);
    if (!question || sending) return;
    const context = getContext();
    if (!context) return;

    setErrorText(null);
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setSending(true);
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context, sessionId }),
      });
      const body = (await res.json().catch(() => null)) as
        | { reply?: string; error?: string }
        | null;
      if (!res.ok || !body?.reply) {
        setErrorText(
          body?.error ?? "I couldn't process that just now — please try again."
        );
      } else {
        setMessages((m) => [...m, { role: "assistant", text: body.reply! }]);
      }
    } catch {
      setErrorText("I couldn't process that just now — please try again.");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // ---- Launcher (closed state) ----
  if (!open) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        data-testid="copilot-launcher"
        title="Ask about this reconciliation"
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          zIndex: 40,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 18px",
          borderRadius: 999,
          border: "1px solid var(--line)",
          background: "var(--surface)",
          color: "var(--ink)",
          fontSize: 13.5,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 6px 24px oklch(0 0 0 / 0.12)",
        }}
      >
        <Icon name="sparkle" size={16} style={{ color: "var(--accent-ink)" }} />
        Ask about these results
      </button>
    );
  }

  // ---- Panel (open state) ----
  return (
    <div
      data-testid="copilot-panel"
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 40,
        width: 380,
        maxWidth: "calc(100vw - 48px)",
        height: 520,
        maxHeight: "calc(100vh - 96px)",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg, 14px)",
        boxShadow: "0 12px 40px oklch(0 0 0 / 0.16)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "13px 16px",
          borderBottom: "1px solid var(--line)",
          background: "var(--surface-2)",
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "var(--accent-soft)",
            color: "var(--accent-ink)",
            display: "grid",
            placeItems: "center",
            flex: "none",
          }}
        >
          <Icon name="sparkle" size={15} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 650 }}>Assistant</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
            Questions about this reconciliation
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowNotice((v) => !v)}
          title="How your data is used"
          data-testid="copilot-notice-toggle"
          style={iconButtonStyle}
        >
          <Icon name="help" size={16} />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="Close"
          data-testid="copilot-close"
          style={iconButtonStyle}
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      {/* Transparency notice (first open + on demand) */}
      {showNotice && (
        <div
          data-testid="copilot-notice"
          style={{
            padding: "12px 16px",
            background: "var(--accent-soft)",
            borderBottom: "1px solid var(--line)",
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--ink-2)",
          }}
        >
          {NOTICE_TEXT}
          <div style={{ marginTop: 8 }}>
            <Button size="sm" variant="secondary" onClick={acknowledgeNotice}>
              Got it
            </Button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.length === 0 && !sending && (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
              I can explain what this reconciliation found — why something
              matched, what didn&apos;t, and what makes up any difference.
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginTop: 14,
              }}
            >
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  data-testid="copilot-chip"
                  style={{
                    textAlign: "left",
                    padding: "9px 12px",
                    borderRadius: "var(--r-md)",
                    border: "1px solid var(--line)",
                    background: "var(--surface-2)",
                    color: "var(--ink-2)",
                    fontSize: 12.5,
                    fontWeight: 550,
                    cursor: "pointer",
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              padding: "9px 12px",
              borderRadius: 12,
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              ...(msg.role === "user"
                ? {
                    background: "var(--accent-soft)",
                    color: "var(--ink)",
                    borderBottomRightRadius: 4,
                  }
                : {
                    background: "var(--surface-2)",
                    color: "var(--ink)",
                    border: "1px solid var(--line)",
                    borderBottomLeftRadius: 4,
                  }),
            }}
          >
            {msg.text}
          </div>
        ))}

        {sending && (
          <div
            data-testid="copilot-loading"
            style={{
              alignSelf: "flex-start",
              padding: "9px 12px",
              borderRadius: 12,
              borderBottomLeftRadius: 4,
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              fontSize: 13,
              color: "var(--ink-3)",
            }}
          >
            Thinking…
          </div>
        )}

        {errorText && (
          <div
            data-testid="copilot-error"
            style={{
              alignSelf: "flex-start",
              maxWidth: "85%",
              padding: "9px 12px",
              borderRadius: 12,
              background: "var(--warn-soft)",
              color: "var(--warn-ink)",
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            {errorText}
          </div>
        )}
      </div>

      {/* Input + persistent disclaimer */}
      <div style={{ borderTop: "1px solid var(--line)", padding: "10px 12px 8px" }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={QUESTION_MAX}
            placeholder="Ask about this reconciliation…"
            data-testid="copilot-input"
            style={{
              flex: 1,
              padding: "9px 12px",
              borderRadius: "var(--r-md)",
              border: "1px solid var(--line)",
              background: "var(--surface-2)",
              fontSize: 13,
              color: "var(--ink)",
              outline: "none",
            }}
          />
          <Button
            variant="primary"
            size="sm"
            disabled={sending || input.trim().length === 0}
            data-testid="copilot-send"
            onClick={() => send(input)}
          >
            Send
          </Button>
        </form>
        <div
          data-testid="copilot-disclaimer"
          style={{
            marginTop: 7,
            fontSize: 11,
            color: "var(--ink-3)",
            textAlign: "center",
          }}
        >
          {DISCLAIMER_TEXT}
        </div>
      </div>
    </div>
  );
}

const iconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--ink-3)",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  flex: "none",
};
