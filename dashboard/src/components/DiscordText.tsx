import type { ReactNode } from "react";
import type { GuildDetails } from "../api";

/**
 * Shows text the way Discord formats it, for the message previews on the dashboard.
 * Supports what Discord renders in messages and embeds: **bold**, *italic* / _italic_, __underline__,
 * ~~strikethrough~~, ||spoilers||, `code`, ``` code blocks ```, > quotes, # / ## / ### headings,
 * -# small text, "- " and "1. " lists, [masked links](https://...), plain links, and
 * <@user> <@&role> <#channel> mentions and custom emojis.
 * Builds React elements directly, so text is always escaped and never injected as HTML.
 */
export function DiscordText({ text, guild }: { text: string; guild?: GuildDetails["guild"] }) {
  return <div className="dtext">{blocks(text, guild)}</div>;
}

type Guild = GuildDetails["guild"] | undefined;

/* ------------------------------------------------------------ blocks (line by line) */

function blocks(text: string, guild: Guild): ReactNode[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];

    // ``` code block ```
    if (line.trimStart().startsWith("```")) {
      const after = line.trimStart().slice(3);
      // A one-line block: ```code```
      if (after.includes("```")) {
        out.push(<pre key={key++} className="dtext-codeblock">{after.slice(0, after.indexOf("```"))}</pre>);
        i++;
        continue;
      }
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].includes("```")) code.push(lines[i++]);
      if (i < lines.length) {
        const last = lines[i].slice(0, lines[i].indexOf("```"));
        if (last) code.push(last);
      }
      i++;
      out.push(<pre key={key++} className="dtext-codeblock">{code.join("\n")}</pre>);
      continue;
    }

    // >>> quotes everything after it
    if (line.startsWith(">>> ")) {
      const rest = [line.slice(4), ...lines.slice(i + 1)].join("\n");
      out.push(<blockquote key={key++} className="dtext-quote">{blocks(rest, guild)}</blockquote>);
      break;
    }

    // > quote lines
    if (line.startsWith("> ") || line === ">") {
      const quoted: string[] = [];
      while (i < lines.length && (lines[i].startsWith("> ") || lines[i] === ">")) quoted.push(lines[i++].slice(2));
      out.push(<blockquote key={key++} className="dtext-quote">{blocks(quoted.join("\n"), guild)}</blockquote>);
      continue;
    }

    const heading = line.match(/^(#{1,3}) (.+)$/);
    if (heading) {
      out.push(<div key={key++} className={`dtext-h${heading[1].length}`}>{inline(heading[2], guild)}</div>);
      i++;
      continue;
    }

    const sub = line.match(/^-# (.+)$/);
    if (sub) {
      out.push(<div key={key++} className="dtext-sub">{inline(sub[1], guild)}</div>);
      i++;
      continue;
    }

    // - bullet / 1. numbered lists (two spaces in front nests one level)
    if (/^ *([-*]|\d+\.) /.test(line)) {
      const items: { depth: number; ordered: boolean; num: string; text: string }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^( *)([-*]|\d+\.) (.*)$/);
        if (!m) break;
        items.push({ depth: Math.min(2, Math.floor(m[1].length / 2)), ordered: m[2] !== "-" && m[2] !== "*", num: m[2], text: m[3] });
        i++;
      }
      out.push(
        <div key={key++} className="dtext-list">
          {items.map((it, j) => (
            <div key={j} className="dtext-li" style={{ paddingLeft: `${it.depth * 18 + 18}px` }}>
              <span className="dtext-bullet">{it.ordered ? it.num : "•"}</span>
              {inline(it.text, guild)}
            </div>
          ))}
        </div>,
      );
      continue;
    }

    // A plain line. Empty lines keep their height, like in Discord.
    out.push(<div key={key++} className="dtext-line">{line ? inline(line, guild) : " "}</div>);
    i++;
  }
  return out;
}

/* ------------------------------------------------------------ inline formatting */

interface Rule {
  re: RegExp;
  render: (m: RegExpExecArray, guild: Guild, key: number) => ReactNode;
}

// Order matters: earlier rules win when two could match at the same place.
const rules: Rule[] = [
  { re: /^`([^`]+)`/, render: (m, _g, k) => <code key={k} className="dtext-code">{m[1]}</code> },
  { re: /^\|\|([\s\S]+?)\|\|/, render: (m, g, k) => <span key={k} className="dtext-spoiler" title="Spoiler">{inline(m[1], g)}</span> },
  { re: /^\*\*\*([\s\S]+?)\*\*\*/, render: (m, g, k) => <strong key={k}><em>{inline(m[1], g)}</em></strong> },
  { re: /^\*\*([\s\S]+?)\*\*/, render: (m, g, k) => <strong key={k}>{inline(m[1], g)}</strong> },
  { re: /^__([\s\S]+?)__/, render: (m, g, k) => <u key={k}>{inline(m[1], g)}</u> },
  { re: /^\*(?!\s)([\s\S]+?)\*/, render: (m, g, k) => <em key={k}>{inline(m[1], g)}</em> },
  { re: /^_(?!\s)([\s\S]+?)_(?![A-Za-z0-9])/, render: (m, g, k) => <em key={k}>{inline(m[1], g)}</em> },
  { re: /^~~([\s\S]+?)~~/, render: (m, g, k) => <s key={k}>{inline(m[1], g)}</s> },
  {
    re: /^\[([^\]]+)\]\(<?(https?:\/\/[^\s)>]+)>?\)/,
    render: (m, g, k) => (
      <a key={k} className="dtext-link" href={m[2]} target="_blank" rel="noopener noreferrer">
        {inline(m[1], g)}
      </a>
    ),
  },
  {
    re: /^<?(https?:\/\/[^\s<>]+[^\s<>.,:;"')\]])>?/,
    render: (m, _g, k) => (
      <a key={k} className="dtext-link" href={m[1]} target="_blank" rel="noopener noreferrer">
        {m[1]}
      </a>
    ),
  },
  { re: /^<a?:(\w+):(\d{17,20})>/, render: (m, _g, k) => <img key={k} className="dtext-emoji" src={`https://cdn.discordapp.com/emojis/${m[2]}.webp?size=48`} alt={`:${m[1]}:`} title={`:${m[1]}:`} /> },
  {
    re: /^<@&(\d{17,20})>/,
    render: (m, g, k) => {
      const role = g?.roles.find((r) => r.id === m[1]);
      const color = role && role.color !== "#000000" ? role.color : undefined;
      return (
        <span key={k} className="dtext-mention" style={color ? { color, background: `${color}26` } : undefined}>
          @{role?.name ?? "role"}
        </span>
      );
    },
  },
  { re: /^<@!?(\d{17,20})>/, render: (_m, _g, k) => <span key={k} className="dtext-mention">@user</span> },
  { re: /^<#(\d{17,20})>/, render: (m, g, k) => <span key={k} className="dtext-mention">#{g?.channels.find((c) => c.id === m[1])?.name ?? "channel"}</span> },
  { re: /^@(everyone|here)\b/, render: (m, _g, k) => <span key={k} className="dtext-mention">@{m[1]}</span> },
  // A backslash shows the next character as-is: \*not italic\*
  { re: /^\\([*_~`|\\>#\-[\]])/, render: (m) => m[1] },
];

function inline(text: string, guild: Guild): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = "";
  let key = 0;
  let i = 0;
  const flush = () => {
    if (plain) out.push(plain);
    plain = "";
  };
  outer: while (i < text.length) {
    const rest = text.slice(i);
    for (const rule of rules) {
      const m = rule.re.exec(rest);
      if (m) {
        flush();
        out.push(rule.render(m, guild, key++));
        i += m[0].length;
        continue outer;
      }
    }
    plain += text[i++];
  }
  flush();
  return out;
}
