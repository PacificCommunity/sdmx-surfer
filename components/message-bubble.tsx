"use client";

import { Fragment } from "react";
import type { UIMessage } from "ai";
import Markdown from "react-markdown";

const TOOL_LABELS: Record<string, string> = {
  list_dataflows: "Searching dataflows",
  get_dataflow_structure: "Exploring structure",
  get_dimension_codes: "Looking up codes",
  check_time_availability: "Checking time range",
  get_data_availability: "Checking data availability",
  build_data_url: "Building data query",
  get_codelist: "Reading codelist",
  validate_query: "Validating query",
  compare_structures: "Comparing structures",
  find_code_usage_across_dataflows: "Searching code usage",
  update_dashboard: "Updating dashboard",
};

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

function splitTableCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function normalizeInlineTableBlock(block: string): string {
  const trimmed = block.trim();

  if (trimmed.includes("\n")) {
    return trimmed;
  }

  const match = trimmed.match(
    /^(\|[\s\S]*?\|)\s+(\|(?:\s*:?-{3,}:?\s*\|)+)\s*([\s\S]*)$/,
  );

  if (!match) {
    return trimmed;
  }

  const [, headerRow, separatorRow, remainingRows] = match;
  const columnCount = splitTableCells(separatorRow).length;

  if (columnCount < 2) {
    return trimmed;
  }

  const rowPattern = new RegExp(`^\\s*\\|((?:[^|]*\\|){${columnCount}})`);
  const rows: string[] = [];
  let rest = remainingRows;

  while (rest.trim()) {
    const rowMatch = rest.match(rowPattern);

    if (!rowMatch) {
      return trimmed;
    }

    rows.push(`|${rowMatch[1]}`.trim());
    rest = rest.slice(rowMatch[0].length);
  }

  return [headerRow.trim(), separatorRow.trim(), ...rows].join("\n");
}

function parseTableBlock(block: string): ParsedTable | null {
  const normalized = normalizeInlineTableBlock(block).replace(/\r\n?/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3 || !lines.every((line) => line.startsWith("|"))) {
    return null;
  }

  const headers = splitTableCells(lines[0]);
  const separator = splitTableCells(lines[1]);

  if (
    headers.length < 2 ||
    headers.length !== separator.length ||
    !separator.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")))
  ) {
    return null;
  }

  const rows = lines.slice(2).map(splitTableCells);

  if (rows.some((row) => row.length !== headers.length)) {
    return null;
  }

  return { headers, rows };
}

function MarkdownTable({ table }: { table: ParsedTable }) {
  return (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-separate border-spacing-0 text-xs text-on-surface">
        <thead>
          <tr>
            {table.headers.map((header) => (
              <th
                key={header}
                className="border-b border-outline-variant/40 bg-surface-high/40 px-2 py-1.5 text-left font-semibold"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td
                  key={`cell-${rowIndex}-${cellIndex}`}
                  className="border-b border-outline-variant/20 px-2 py-1.5 align-top"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarkdownContent({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const blocks = children
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const table = parseTableBlock(block);

        if (table) {
          return <MarkdownTable key={`table-${index}`} table={table} />;
        }

        return (
          <Fragment key={`markdown-${index}`}>
            <Markdown
              components={{
                p: ({ children: c }) => (
                  <p className="mb-2 last:mb-0">{c}</p>
                ),
                strong: ({ children: c }) => (
                  <strong className="font-semibold">{c}</strong>
                ),
                em: ({ children: c }) => <em className="italic">{c}</em>,
                ul: ({ children: c }) => (
                  <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{c}</ul>
                ),
                ol: ({ children: c }) => (
                  <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{c}</ol>
                ),
                li: ({ children: c }) => <li>{c}</li>,
                code: ({ children: c, className: cn }) => {
                  const isBlock = cn?.includes("language-");
                  if (isBlock) {
                    return (
                      <code className="block overflow-x-auto rounded-[var(--radius-md)] bg-surface-high/60 p-3 font-mono text-xs">
                        {c}
                      </code>
                    );
                  }
                  return (
                    <code className="rounded-[var(--radius-sm)] bg-surface-high/60 px-1 py-0.5 font-mono text-xs">
                      {c}
                    </code>
                  );
                },
                pre: ({ children: c }) => (
                  <pre className="mb-2 last:mb-0">{c}</pre>
                ),
                h1: ({ children: c }) => (
                  <h1 className="mb-1 text-base font-bold">{c}</h1>
                ),
                h2: ({ children: c }) => (
                  <h2 className="mb-1 text-sm font-bold">{c}</h2>
                ),
                h3: ({ children: c }) => (
                  <h3 className="mb-1 text-sm font-semibold">{c}</h3>
                ),
                a: ({ href, children: c }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline decoration-primary/30 hover:decoration-primary"
                  >
                    {c}
                  </a>
                ),
                blockquote: ({ children: c }) => (
                  <blockquote className="mb-2 border-l-2 border-secondary/30 pl-3 italic last:mb-0">
                    {c}
                  </blockquote>
                ),
                hr: () => <hr className="my-2 border-outline-variant/20" />,
              }}
            >
              {block}
            </Markdown>
          </Fragment>
        );
      })}
    </div>
  );
}

export function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="ml-12 max-w-[85%]">
          <div className="brand-gradient rounded-[var(--radius-xl)] rounded-tr-none px-4 py-3 text-on-primary shadow-md">
            {message.parts.map((part, i) =>
              part.type === "text" ? (
                <p key={i} className="text-sm leading-relaxed">
                  {part.text}
                </p>
              ) : null,
            )}
          </div>
        </div>
      </div>
    );
  }

  // AI message
  return (
    <div className="flex justify-start">
      <div className="mr-8 max-w-[90%]">
        {/* AI avatar + label */}
        <div className="mb-1.5 flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary">
            <svg
              className="h-3.5 w-3.5 text-on-secondary"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5z" />
            </svg>
          </div>
          <span className="type-label-md text-secondary">SDMX Surfer</span>
        </div>

        {/* Bubble */}
        <div className="rounded-[var(--radius-xl)] rounded-tl-none bg-secondary-container px-4 py-3 text-on-secondary-container shadow-ambient">
          {message.parts.map((part, i) => {
            if (part.type === "text") {
              return (
                <MarkdownContent
                  key={i}
                  className="text-sm leading-relaxed text-on-surface"
                >
                  {part.text}
                </MarkdownContent>
              );
            }
            if (
              part.type.startsWith("tool-") ||
              part.type === "dynamic-tool"
            ) {
              const toolPart = part as {
                type: string;
                toolName?: string;
                state: string;
              };
              const toolName =
                toolPart.toolName ||
                (toolPart.type.startsWith("tool-")
                  ? toolPart.type.slice(5)
                  : "unknown");
              const label = TOOL_LABELS[toolName] || toolName;
              const isDone = toolPart.state === "output-available";

              return (
                <div
                  key={i}
                  className="my-1.5 flex items-center gap-2 rounded-[var(--radius-md)] bg-white/40 px-3 py-2"
                >
                  <span
                    className={
                      "inline-block h-2 w-2 rounded-full " +
                      (isDone
                        ? "bg-secondary"
                        : "bg-secondary-fixed-dim animate-pulse")
                    }
                  />
                  <span className="text-xs font-medium text-on-surface-variant">
                    {label}
                    {isDone ? "" : "..."}
                  </span>
                  {isDone && (
                    <svg
                      className="ml-auto h-3.5 w-3.5 text-secondary"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                  )}
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}
