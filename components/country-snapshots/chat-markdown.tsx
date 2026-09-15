"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";

/**
 * Markdown body for snapshot chat messages. The agent is prompted to
 * suggest canonical pages as paths like /countrysnapshots/TO/health —
 * internal links render as next/link so they're clickable and client-
 * navigated; external links open in a new tab.
 */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown space-y-2 text-sm [&_li]:ml-4 [&_li]:list-disc [&_ol_li]:list-decimal [&_code]:rounded [&_code]:bg-surface-low [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium [&_table]:w-full [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_td]:px-2 [&_td]:py-1 [&_thead]:bg-surface">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            const url = href ?? "";
            if (url.startsWith("/")) {
              return (
                <Link href={url} className="text-on-secondary-container underline">
                  {children}
                </Link>
              );
            }
            return (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-on-secondary-container underline"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
