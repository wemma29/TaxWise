// Streams an official PDF, inflating text-bearing content streams until a section anchor is found.
// Stops early so large IRS PDFs are never fully downloaded or decoded on the server.
const WIN_ANSI: Record<number, string> = { 0x91: "'", 0x92: "'", 0x93: '"', 0x94: '"', 0x95: "•", 0x96: "–", 0x97: "—", 0xa0: " ", 0xad: "" };

function decodeLiteral(s: string) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== "\\") { const code = c.charCodeAt(0); out += WIN_ANSI[code] ?? c; continue; }
    const n = s[++i] ?? "";
    if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? "")) oct += s[++i];
      const code = parseInt(oct, 8);
      out += WIN_ANSI[code] ?? String.fromCharCode(code);
    } else out += ({ n: "\n", r: " ", t: " ", b: "", f: "" } as Record<string, string>)[n] ?? n;
  }
  return out;
}

// Embedded Type0 subset fonts here show 2-byte glyph IDs in standard Macintosh glyph order
// (glyph + 29 = ASCII). Hex text is kept only if it decodes to recognizable English, so an
// unexpected font ordering is dropped as missing evidence rather than turned into wrong numbers.
function decodeHex(hex: string) {
  const h = hex.replace(/\s+/g, "");
  if (h.length % 4 !== 0 || !/^(00[0-9a-f]{2})*$/i.test(h)) return "\u0000";
  let out = "";
  for (let i = 0; i < h.length; i += 4) {
    const g = parseInt(h.slice(i, i + 4), 16);
    out += g >= 3 && g <= 0x61 ? String.fromCharCode(g + 29) : "\u0000";
  }
  return out;
}

export function contentStreamText(content: string) {
  let out = "", hexText = "";
  const ops = /\[((?:\\[\s\S]|[^\]\\])*)\]\s*TJ|\(((?:\\[\s\S]|[^\\)])*)\)\s*(?:Tj|'|")|<([0-9a-fA-F\s]*)>\s*Tj|(?:^|\s)(Td|TD|Tm|T\*|ET)(?=\s)/g;
  const hex = (h: string) => { const t = decodeHex(h); hexText += t; return t; };
  for (const m of content.matchAll(ops)) {
    if (m[4]) { if (!out.endsWith("\n")) out += "\n"; continue; }
    if (m[2] !== undefined) { out += decodeLiteral(m[2]); continue; }
    if (m[3] !== undefined) { out += hex(m[3]); continue; }
    for (const p of (m[1] ?? "").matchAll(/\(((?:\\[\s\S]|[^\\)])*)\)|<([0-9a-fA-F\s]*)>|(-?\d+(?:\.\d+)?)/g)) {
      if (p[1] !== undefined) out += decodeLiteral(p[1]);
      else if (p[2] !== undefined) out += hex(p[2]);
      else if (Number(p[3]) < -250) out += " ";
    }
  }
  const words = hexText.toLowerCase().match(/\b(the|of|and|income|your|you|a|or|if|to|return)\b/g)?.length ?? 0;
  if (hexText && (hexText.includes("\u0000") || words < Math.max(2, hexText.length / 80))) out = out.replace(/[^\n]*\u0000[^\n]*/g, "");
  return out.replace(/[ \t\r]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n+/g, "\n").trim();
}

async function inflate(bytes: Uint8Array) {
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
  const stream = source.pipeThrough(new DecompressionStream("deflate") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
  } catch { /* trailing bytes after a complete zlib stream are tolerated */ }
  let s = "";
  for (const c of chunks) for (let i = 0; i < c.length; i += 8192) s += String.fromCharCode(...c.subarray(i, i + 8192));
  return s;
}

export async function extractPdfSection(res: Response, opts: { anchor: string; requires: string; context?: string[]; maxBytes?: number }) {
  if (!res.body) throw new Error("empty PDF body");
  const reader = res.body.getReader();
  const maxBytes = opts.maxBytes ?? 20_000_000;
  let buf = "", read = 0, firstPage = "", section = "";
  const context: string[] = [];
  try {
    for (;;) {
      const s = buf.search(/>>\s*stream\r?\n/);
      const end = s >= 0 ? buf.indexOf("endstream", s) : -1;
      if (s < 0 || end < 0) {
        if (read >= maxBytes) throw new Error(`section "${opts.anchor}" not found in first ${maxBytes} bytes`);
        const { done, value } = await reader.read();
        if (done) throw new Error(`section "${opts.anchor}" not found in PDF`);
        read += value.length;
        for (let i = 0; i < value.length; i += 8192) buf += String.fromCharCode(...value.subarray(i, i + 8192));
        continue;
      }
      const header = buf.slice(Math.max(0, buf.lastIndexOf(" obj", s)), s);
      const dataStart = buf.indexOf("\n", buf.indexOf("stream", s)) + 1;
      const raw = buf.slice(dataStart, end).replace(/\r?\n?$/, "");
      buf = buf.slice(end + 9);
      if (!/FlateDecode/.test(header) || /\/Image|\/XRef|\/ObjStm|\/FontFile|\/Length1/.test(header)) continue;
      const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
      const content = await inflate(bytes);
      if (!/\bBT\b/.test(content)) continue;
      const text = contentStreamText(content);
      if (!text) continue;
      if (!firstPage) firstPage = text.slice(0, 600);
      for (const marker of opts.context ?? []) {
        const at = text.replace(/\s+/g, " ").indexOf(marker);
        if (at >= 0) context.push(text.replace(/\s+/g, " ").slice(Math.max(0, at - 200), at + 500));
      }
      if (text.includes(opts.anchor) && text.includes(opts.requires)) { section = text; break; }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { firstPage, context, section, bytesRead: read };
}
