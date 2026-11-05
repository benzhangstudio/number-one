/**
 * The K-pop card catalog: every group and member, from 2nd gen to 5th gen.
 * Cards are made from this list (src/shared/cards.ts): six versions per member, plus a Mythic for BLACKPINK.
 *
 * Lineups are the current (or final) ones. To add a group, add a line here; card IDs come from the
 * group and member IDs, so never rename an ID once it's live (people's collections point at it).
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
  // ⭐ The star of the game.
  ["blackpink", "BLACKPINK", 3, 2016, "#ff4fa3", "Jisoo, Jennie, Rosé, Lisa"],

  // 2nd generation
  ["tvxq", "TVXQ!", 2, 2003, "#d4002a", "U-Know Yunho, Max Changmin"],
  ["superjunior", "Super Junior", 2, 2005, "#1c6fd1", "Leeteuk, Heechul, Yesung, Shindong, Eunhyuk, Siwon, Donghae, Ryeowook, Kyuhyun"],
  ["bigbang", "BIGBANG", 2, 2006, "#f2c200", "G-Dragon, Taeyang, Daesung"],
  ["wondergirls", "Wonder Girls", 2, 2007, "#c8102e", "Yeeun, Sunye, Sunmi, Yubin, Hyerim"],
  ["girlsgeneration", "Girls' Generation", 2, 2007, "#f48fb1", "Taeyeon, Sunny, Tiffany, Hyoyeon, Yuri, Sooyoung, Yoona, Seohyun"],
  ["kara", "KARA", 2, 2007, "#f7a8b8", "Gyuri, Seungyeon, Nicole, Jiyoung, Youngji"],
  ["shinee", "SHINee", 2, 2008, "#4fd1c5", "Onew, Key, Minho, Taemin"],
  ["2pm", "2PM", 2, 2008, "#555b66", "Jun. K, Nichkhun, Taecyeon, Wooyoung, Junho, Chansung"],
  ["2ne1", "2NE1", 2, 2009, "#e6007e", "CL, Bom, Dara, Minzy"],
  ["fx", "f(x)", 2, 2009, "#8e7cc3", "Victoria, Amber, Luna, Krystal"],
  ["tara", "T-ara", 2, 2009, "#b39ddb", "Qri, Eunjung, Hyomin, Jiyeon"],
  ["4minute", "4minute", 2, 2009, "#9c27b0", "Hyuna, Jihyun, Gayoon, Jiyoon, Sohyun"],
  ["highlight", "Highlight", 2, 2009, "#455a64", "Doojoon, Yoseob, Gikwang, Dongwoon"],
  ["missa", "miss A", 2, 2010, "#e8b04a", "Fei, Min, Suzy"],
  ["sistar", "SISTAR", 2, 2010, "#ff7043", "Hyolyn, Bora, Soyou, Dasom"],
  ["infinite", "INFINITE", 2, 2010, "#d4af37", "Sunggyu, Dongwoo, Woohyun, Sungyeol, L, Sungjong"],
  ["cnblue", "CNBLUE", 2, 2010, "#2196f3", "Yonghwa, Minhyuk, Jungshin"],
  ["apink", "Apink", 2, 2011, "#ff8fab", "Chorong, Bomi, Eunji, Namjoo, Hayoung"],

  // 3rd generation
  ["exo", "EXO", 3, 2012, "#b0bec5", "Xiumin, Suho, Lay, Baekhyun, Chen, Chanyeol, D.O., Kai, Sehun"],
  ["vixx", "VIXX", 3, 2012, "#1a237e", "N, Leo, Ken, Hyuk"],
  ["btob", "BTOB", 3, 2012, "#4caf50", "Eunkwang, Minhyuk, Changsub, Hyunsik, Peniel"],
  ["bts", "BTS", 3, 2013, "#7b4fd6", "RM, Jin, Suga, J-Hope, Jimin, V, Jungkook"],
  ["mamamoo", "MAMAMOO", 3, 2014, "#43a047", "Solar, Moonbyul, Wheein, Hwasa"],
  ["redvelvet", "Red Velvet", 3, 2014, "#e53935", "Irene, Seulgi, Wendy, Joy, Yeri"],
  ["got7", "GOT7", 3, 2014, "#2e7d32", "Jay B, Mark, Jackson, Jinyoung, Youngjae, BamBam, Yugyeom"],
  ["winner", "WINNER", 3, 2014, "#0d47a1", "Seungyoon, Jinwoo, Seunghoon, Mino"],
  ["monstax", "MONSTA X", 3, 2015, "#212121", "Shownu, Minhyuk, Kihyun, Hyungwon, Joohoney, I.M"],
  ["twice", "TWICE", 3, 2015, "#ff9e80", "Nayeon, Jeongyeon, Momo, Sana, Jihyo, Mina, Dahyun, Chaeyoung, Tzuyu"],
  ["ikon", "iKON", 3, 2015, "#c62828", "Jay, Song, Bobby, DK, Ju-ne, Chan"],
  ["gfriend", "GFRIEND", 3, 2015, "#81d4fa", "Sowon, Yerin, Eunha, Yuju, SinB, Umji"],
  ["ohmygirl", "OH MY GIRL", 3, 2015, "#ce93d8", "Hyojung, Mimi, YooA, Seunghee, Yubin, Arin"],
  ["seventeen", "SEVENTEEN", 3, 2015, "#f8bbd0", "S.Coups, Jeonghan, Joshua, Jun, Hoshi, Wonwoo, Woozi, DK, Mingyu, The8, Seungkwan, Vernon, Dino"],
  ["astro", "ASTRO", 3, 2016, "#7e57c2", "MJ, JinJin, Cha Eun-woo, Sanha"],
  ["nct127", "NCT 127", 3, 2016, "#cddc39", "Taeyong, Johnny, Yuta, Doyoung, Jaehyun, Jungwoo, Mark, Haechan"],
  ["nctdream", "NCT DREAM", 3, 2016, "#aed581", "Mark, Renjun, Jeno, Haechan, Jaemin, Chenle, Jisung"],
  ["dreamcatcher", "Dreamcatcher", 3, 2017, "#37474f", "JiU, SuA, Siyeon, Handong, Yoohyeon, Dami, Gahyeon"],

  // 4th generation
  ["straykids", "Stray Kids", 4, 2018, "#d32f2f", "Bang Chan, Lee Know, Changbin, Hyunjin, Han, Felix, Seungmin, I.N"],
  ["ateez", "ATEEZ", 4, 2018, "#ff6f00", "Hongjoong, Seonghwa, Yunho, Yeosang, San, Mingi, Wooyoung, Jongho"],
  ["idle", "i-dle", 4, 2018, "#ad1457", "Miyeon, Minnie, Soyeon, Yuqi, Shuhua"],
  ["itzy", "ITZY", 4, 2019, "#ec407a", "Yeji, Lia, Ryujin, Chaeryeong, Yuna"],
  ["txt", "TOMORROW X TOGETHER", 4, 2019, "#29b6f6", "Soobin, Yeonjun, Beomgyu, Taehyun, Hueningkai"],
  ["treasure", "TREASURE", 4, 2020, "#00acc1", "Hyunsuk, Jihoon, Yoshi, Junkyu, Jaehyuk, Asahi, Doyoung, Haruto, Jeongwoo, Junghwan"],
  ["aespa", "aespa", 4, 2020, "#9575cd", "Karina, Giselle, Winter, Ningning"],
  ["enhypen", "ENHYPEN", 4, 2020, "#b71c1c", "Jungwon, Heeseung, Jay, Jake, Sunghoon, Sunoo, Ni-ki"],
  ["stayc", "STAYC", 4, 2020, "#ff80ab", "Sumin, Sieun, Isa, Seeun, Yoon, J"],
  ["ive", "IVE", 4, 2021, "#e57373", "Yujin, Gaeul, Rei, Wonyoung, Liz, Leeseo"],
  ["lesserafim", "LE SSERAFIM", 4, 2022, "#5c6bc0", "Chaewon, Sakura, Yunjin, Kazuha, Eunchae"],
  ["nmixx", "NMIXX", 4, 2022, "#26a69a", "Lily, Haewon, Sullyoon, Bae, Jiwoo, Kyujin"],
  ["newjeans", "NewJeans", 4, 2022, "#64b5f6", "Minji, Hanni, Danielle, Haerin, Hyein"],

  // 5th generation
  ["zerobaseone", "ZEROBASEONE", 5, 2023, "#1e88e5", "Hanbin, Jiwoong, Zhang Hao, Matthew, Taerae, Ricky, Gyuvin, Gunwook, Yujin"],
  ["riize", "RIIZE", 5, 2023, "#ff7043", "Shotaro, Eunseok, Sungchan, Wonbin, Sohee, Anton"],
  ["boynextdoor", "BOYNEXTDOOR", 5, 2023, "#8d6e63", "Sungho, Riwoo, Jaehyun, Taesan, Leehan, Woonhak"],
  ["kissoflife", "KISS OF LIFE", 5, 2023, "#c2185b", "Julie, Natty, Belle, Haneul"],
  ["tws", "TWS", 5, 2024, "#4dd0e1", "Shinyu, Dohoon, Youngjae, Hanjin, Jihoon, Kyungmin"],
  ["babymonster", "BABYMONSTER", 5, 2024, "#e91e63", "Ruka, Pharita, Asa, Ahyeon, Rami, Rora, Chiquita"],
  ["illit", "ILLIT", 5, 2024, "#f8a5c2", "Yunah, Minju, Moka, Wonhee, Iroha"],
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
  snsd: "girlsgeneration",
  gg: "girlsgeneration",
  gidle: "idle",
  gidl: "idle",
  sj: "superjunior",
  dbsk: "tvxq",
  tvxq: "tvxq",
  txt: "txt",
  tomorrowxtogether: "txt",
  skz: "straykids",
  zb1: "zerobaseone",
  bnd: "boynextdoor",
  kiof: "kissoflife",
  nct: "nct127",
  dream: "nctdream",
  lsf: "lesserafim",
  rv: "redvelvet",
  mmm: "mamamoo",
  svt: "seventeen",
  ohmygirl: "ohmygirl",
  omg: "ohmygirl",
  bm: "babymonster",
  beast: "highlight",
};

/**
 * Works out which card a photo is for from its file name, like "blackpink-jennie.jpg" (all of Jennie's cards)
 * or "blackpink_jennie_legend.png" (just that version). Spaces, dashes, dots and underscores all work, and
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
  return null;
}
