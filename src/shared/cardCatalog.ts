/**
 * The card catalog: the groups and members the card game has cards for. For now that's BLACKPINK only.
 * Cards are made from this list (src/shared/cards.ts): seven versions per member.
 *
 * To add a group later, add a line here; card IDs come from the group and member IDs, so never rename
 * an ID once it's live (people's collections point at it).
 */

export interface CardGroup {
  /** Lowercase, letters and numbers only. Never change once live. */
  id: string;
  name: string;
  gen: 2 | 3 | 4 | 5;
  debut: number;
  /** The card's main colour. */
  color: string;
  members: { id: string; name: string }[];
}

type Row = [id: string, name: string, gen: CardGroup["gen"], debut: number, color: string, members: string];

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

// prettier-ignore
const rows: Row[] = [
  ["blackpink", "BLACKPINK", 3, 2016, "#ff4fa3", "Jisoo, Jennie, Rosé, Lisa"],
];

export const cardGroups: CardGroup[] = rows.map(([id, name, gen, debut, color, members]) => ({
  id,
  name,
  gen,
  debut,
  color,
  members: members.split(", ").map((m) => ({ id: slug(m), name: m })),
}));

export const groupById = new Map(cardGroups.map((g) => [g.id, g]));

export const generationNames: Record<CardGroup["gen"], string> = { 2: "2nd gen", 3: "3rd gen", 4: "4th gen", 5: "5th gen" };

/* ------------------------------------------------------------ matching photo file names */

/** Other names people use for groups in file names. */
const groupAliases: Record<string, string> = {
  bp: "blackpink",
};

/**
 * Works out which card a photo is for from its file name, like "jennie.jpg" or "blackpink-jennie.jpg" (all of
 * Jennie's cards), or "jennie-legend.png" (just that version). Spaces, dashes, dots and underscores all work, and
 * so do accents and capitals. Returns the photo key ("blackpink.jennie" or "blackpink.jennie.legend"), or null.
 */
export function photoKeyFromFileName(fileName: string, versionIds: { id: string; name: string }[]): string | null {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/\s*\(\d+\)$/, "");
  const parts = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (let g = 1; g <= Math.min(4, parts.length - 1); g++) {
    const joined = parts.slice(0, g).join("");
    const group = groupById.get(groupAliases[joined] ?? joined);
    if (!group) continue;
    for (let m = 1; m <= Math.min(3, parts.length - g); m++) {
      const memberId = parts.slice(g, g + m).join("");
      const member = group.members.find((x) => x.id === memberId);
      if (!member) continue;
      const rest = parts.slice(g + m).join("");
      if (!rest) return `${group.id}.${member.id}`;
      const version = versionIds.find((v) => v.id === rest || slug(v.name) === rest);
      if (version) return `${group.id}.${member.id}.${version.id}`;
    }
  }
  // Just the member's name ("jennie.jpg", "lisa-legend.png") works when only one group has that member.
  for (let m = 1; m <= Math.min(3, parts.length); m++) {
    const memberId = parts.slice(0, m).join("");
    const found = cardGroups.flatMap((g) => g.members.filter((x) => x.id === memberId).map((x) => ({ g, x })));
    if (found.length !== 1) continue;
    const { g, x } = found[0];
    const rest = parts.slice(m).join("");
    if (!rest) return `${g.id}.${x.id}`;
    const version = versionIds.find((v) => v.id === rest || slug(v.name) === rest);
    if (version) return `${g.id}.${x.id}.${version.id}`;
  }
  return null;
}
