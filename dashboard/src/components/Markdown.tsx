import type { ReactNode } from "react";
import { PageLink } from "./PageLink";

/**
 * Minimal Markdown renderer for the dashboard's static pages (terms, policies, docs).
 * Supports #, ## and ### headings, paragraphs, "- " and "1. " lists, "> " banners, tables,
 * ``` code blocks, **bold**, `code`, [links](https://...), links to dashboard pages like
 * [Privacy Policy](/privacy) and links to headings on the same page like [Cases](#cases).
 * Builds React elements directly, so text is always escaped and never injected as HTML.
 *
 * With `anchors`, every heading gets an id and a "#" link beside it (like GitHub), so any
 * section can be linked to directly.
 */
export function Markdown({ source, anchors = false }: { source: string; anchors?: boolean }) {
  const slugs = slugger();
  return (
    <>
      {parse(source).map((block, i) => {
        switch (block.type) {
          case "heading": {
            const Tag = (["h1", "h2", "h3"] as const)[block.level - 1];
            if (!anchors) return <Tag key={i}>{inline(block.text)}</Tag>;
            const id = slugs(block.text);
            return (
              <Tag key={i} id={id} className="anchored">
                {inline(block.text)}
                <a className="anchor" href={`#${id}`} aria-label={`Link to ${plain(block.text)}`}>
                  #
                </a>
              </Tag>
            );
          }
          case "ul":
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ol>
            );
          case "banner":
            return <p key={i} className="banner">{inline(block.text)}</p>;
          case "code":
            return (
              <pre key={i} className="code-block">
                <code>{block.text}</code>
              </pre>
            );
          case "table":
            return (
              <div key={i} className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {block.head.map((cell, j) => (
                        <th key={j}>{inline(cell)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td key={k}>{inline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={i}>{inline(block.text)}</p>;
        }
      })}
    </>
  );
}

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "p" | "banner" | "code"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] };

const HEADING = /^(#{1,3}) (.+)$/;
const BULLET = /^- (.*)$/;
const NUMBER = /^\d+\. (.*)$/;

/** Splits Markdown into blocks, one line at a time. */
function parse(source: string): Block[] {
  const lines = source.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const startsBlock = (line: string) =>
    !line || HEADING.test(line) || BULLET.test(line) || NUMBER.test(line) || line.startsWith("> ") || line.startsWith("```") || line.startsWith("|");

  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++; // the closing ```
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++].trim()));
      const isDivider = (row: string[]) => row.every((c) => /^:?-{3,}:?$/.test(c));
      const head = rows[0] ?? [];
      const body = rows.slice(1).filter((row) => !isDivider(row));
      blocks.push({ type: "table", head, rows: body });
      continue;
    }
    for (const [type, re] of [["ul", BULLET], ["ol", NUMBER]] as const) {
      if (!re.test(line)) continue;
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i].trim();
        const match = current.match(re);
        if (match) items.push(match[1]);
        else if (current && !startsBlock(current)) items[items.length - 1] += " " + current; // wrapped item
        else break;
        i++;
      }
      blocks.push({ type, items });
      break;
    }
    if (BULLET.test(line) || NUMBER.test(line)) continue;
    const text: string[] = [];
    while (i < lines.length && lines[i].trim() && (text.length === 0 || !startsBlock(lines[i].trim()))) {
      text.push(lines[i++].trim());
    }
    const joined = text.join(" ");
    if (joined.startsWith("> ")) blocks.push({ type: "banner", text: joined.slice(2) });
    else blocks.push({ type: "p", text: joined });
  }
  return blocks;
}

/** The cells of a "| a | b |" table row. A "\|" inside a cell is a literal bar. */
function cells(row: string): string[] {
  return row
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** Heading text without Markdown marks, e.g. for the "On this page" list. */
export function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.+?)\]\([^)]*\)/g, "$1");
}

/** GitHub-style heading ids: "Join & leave messages" → "join--leave-messages". Repeats get -1, -2… */
export function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base =
      plain(text)
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s/g, "-") || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

/** The ## and ### headings of a page, with the same ids the renderer gives them. */
export function headings(source: string): { level: 2 | 3; text: string; id: string }[] {
  const slugs = slugger();
  const out: { level: 2 | 3; text: string; id: string }[] = [];
  for (const block of parse(source)) {
    if (block.type !== "heading") continue;
    const id = slugs(block.text);
    if (block.level > 1) out.push({ level: block.level as 2 | 3, text: plain(block.text), id });
  }
  return out;
}

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\[(.+?)\]\((https?:\/\/[^\s)]+|\/[^\s)]*|#[^\s)]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    if (match[1] !== undefined) {
      parts.push(<strong key={at}>{inline(match[1])}</strong>);
    } else if (match[2] !== undefined) {
      parts.push(<code key={at}>{match[2]}</code>);
    } else if (match[4].startsWith("#")) {
      parts.push(
        <a key={at} href={match[4]}>
          {inline(match[3])}
        </a>,
      );
    } else if (match[4].startsWith("/")) {
      parts.push(
        <PageLink key={at} to={match[4]}>
          {inline(match[3])}
        </PageLink>,
      );
    } else {
      parts.push(
        <a key={at} href={match[4]} target="_blank" rel="noopener noreferrer">
          {inline(match[3])}
        </a>,
      );
    }
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
