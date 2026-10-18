"use client";

import * as React from "react";

/**
 * Minimal, dependency-free markdown renderer for AI replies.
 * Supports blank lines, "• " bullets and **bold** — everything the copilot and
 * agent prompts emit. Deliberately does not render raw HTML.
 */
export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        const bullet = line.trimStart().startsWith("• ");
        const content = bullet ? line.trimStart().slice(2) : line;
        const parts = content.split(/(\*\*[^*]+\*\*)/g);
        const rendered = parts.map((part, j) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={j} className="font-extrabold">{part.slice(2, -2)}</strong>
          ) : (
            <span key={j}>{part}</span>
          ),
        );
        return bullet ? (
          <div key={i} className="flex gap-1.5">
            <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
            <span>{rendered}</span>
          </div>
        ) : (
          <p key={i}>{rendered}</p>
        );
      })}
    </div>
  );
}