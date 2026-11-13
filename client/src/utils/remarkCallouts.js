// remark plugin: turn blockquotes into callouts.
//   > [!IMPORTANT] … | [!MISTAKE] | [!TIP] | [!EXAMPLE] | [!NOTE] | [!WARNING] | [!CAUTION]   (GitHub alerts)
//   > ⚠️ **Common mistakes:** …   /   > ⭐ **Important for exams:** …                         (older notes)
// A blockquote that holds several callouts on consecutive lines is split into one callout each.
// The callout type is passed to the renderer as the dataCallout property of the <blockquote>.

const ALIASES = {
  important: 'important',
  mistake: 'mistake',
  warning: 'mistake',
  caution: 'mistake',
  tip: 'tip',
  example: 'example',
  note: 'note',
};
const MARKER = /^\s*\[!(\w+)\]\s*/;
const EMOJI = { '⚠': 'mistake', '⭐': 'important', '💡': 'tip', 'ℹ': 'note' };
// Leading labels made redundant by the callout title ("**Common mistakes:**", "**Important for exams:**").
const REDUNDANT_LABEL = /^(common (mistakes?|pitfalls?)|important( for exams?)?|exam tip|tip|note|example)\s*:?\s*$/i;

function textOfNode(n) {
  if (!n) return '';
  if (n.type === 'text' || n.type === 'inlineCode') return n.value;
  return (n.children ?? []).map(textOfNode).join('');
}

/** Type of a line that starts a callout, or null. Also returns how to strip its marker. */
function detect(firstText) {
  const m = MARKER.exec(firstText);
  if (m && ALIASES[m[1].toLowerCase()]) return { type: ALIASES[m[1].toLowerCase()], strip: m[0].length };
  const ch = firstText.trimStart().slice(0, 1);
  const emoji = Object.keys(EMOJI).find((e) => firstText.trimStart().startsWith(e));
  if (emoji) {
    const lead = firstText.length - firstText.trimStart().length;
    let strip = lead + emoji.length;
    if (firstText.charCodeAt(strip) === 0xfe0f) strip++; // variation selector after ⚠/⭐
    return { type: EMOJI[emoji], strip: strip + (firstText.slice(strip).match(/^\s*/)?.[0].length ?? 0) };
  }
  void ch;
  return null;
}

/** Split a paragraph's inline children into lines (on "\n" inside text nodes and on hard breaks). */
function splitLines(children) {
  const lines = [[]];
  for (const node of children) {
    if (node.type === 'break') {
      lines.push([]);
      continue;
    }
    if (node.type === 'text' && node.value.includes('\n')) {
      const parts = node.value.split('\n');
      parts.forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part) lines[lines.length - 1].push({ type: 'text', value: part });
      });
      continue;
    }
    lines[lines.length - 1].push(node);
  }
  return lines.filter((l) => l.length);
}

/** Remove the marker from the first text of a line, and a now-redundant bold label right after it. */
function stripMarker(inline, strip) {
  const out = [...inline];
  if (out[0]?.type === 'text') {
    const value = out[0].value.slice(strip);
    if (value.trim()) out[0] = { ...out[0], value };
    else out.shift();
  }
  if (out[0]?.type === 'strong' && REDUNDANT_LABEL.test(textOfNode(out[0]))) {
    out.shift();
    if (out[0]?.type === 'text') out[0] = { ...out[0], value: out[0].value.replace(/^\s*:?\s*/, '') };
  }
  return out;
}

/** Turn one blockquote into one or more callout blockquotes (or leave it alone). */
function convert(bq) {
  const first = bq.children[0];
  if (first?.type !== 'paragraph') return [bq];
  const lines = splitLines(first.children);
  const starts = lines.map((l) => detect(textOfNode({ children: l })));
  if (!starts[0]) return [bq];

  // Group lines: a new callout starts at every line that has its own marker.
  const groups = [];
  lines.forEach((line, i) => {
    if (starts[i]) groups.push({ type: starts[i].type, lines: [stripMarker(line, starts[i].strip)] });
    else groups[groups.length - 1].lines.push(line);
  });
  const rest = bq.children.slice(1); // further paragraphs/lists/code belong to the last callout
  return groups.map((g, gi) => {
    const inline = g.lines.flatMap((l, li) => (li ? [{ type: 'break' }, ...l] : l));
    const children = [];
    if (inline.length) children.push({ type: 'paragraph', children: inline });
    if (gi === groups.length - 1) children.push(...rest);
    // hast property names are camelCase (dataCallout -> data-callout attribute); mdast-util-to-hast copies them verbatim.
    return { type: 'blockquote', children, data: { hProperties: { dataCallout: g.type } } };
  });
}

function walk(node) {
  if (!node.children) return;
  const next = [];
  for (const child of node.children) {
    if (child.type === 'blockquote') next.push(...convert(child));
    else next.push(child);
    walk(child);
  }
  node.children = next;
}

export default function remarkCallouts() {
  return (tree) => walk(tree);
}
