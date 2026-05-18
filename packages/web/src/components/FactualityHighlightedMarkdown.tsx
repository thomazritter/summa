import React from 'react';
import ReactMarkdown from 'react-markdown';

export interface FactualitySentence {
  sentence: string;
  label: 'supported' | 'neutral' | 'contradicted';
  confidence: number;
  category: string;
  rationale: string;
}

interface Props {
  content: string;
  factualityDetails: FactualitySentence[] | null;
}

// Mirror backend splitIntoSentences abbreviations + placeholder so that
// sentence segmentation here matches the segmentation used to build the
// factuality index on the server.
const SENTENCE_ABBREVS = [
  'sr', 'sra', 'srta', 'dr', 'dra', 'prof', 'profa', 'eng', 'gen', 'cel',
  'fig', 'figs', 'tab', 'tabs', 'eq', 'eqs', 'ref', 'refs', 'cap', 'caps',
  'pg', 'pgs', 'p', 'pp', 'vol', 'no', 'etc', 'ed', 'eds', 'art', 'arts',
  'ex', 'i.e', 'e.g', 'cf', 'vs', 'ca',
];
const ABBREV_REGEX = new RegExp(`\\b(${SENTENCE_ABBREVS.join('|')})\\.`, 'gi');
const DOT_PLACEHOLDER = String.fromCharCode(1);
const NORM_KEY_LEN = 60;

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`#~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NORM_KEY_LEN);
}

function buildIndex(details: FactualitySentence[] | null): Map<string, FactualitySentence> {
  const index = new Map<string, FactualitySentence>();
  if (!details) return index;
  for (const d of details) {
    const key = normalizeKey(d.sentence);
    if (key) index.set(key, d);
  }
  return index;
}

const LABEL_TEXT: Record<FactualitySentence['label'], string> = {
  supported: 'Suportada pelo artigo',
  contradicted: 'Contraditada pelo artigo',
  neutral: 'Sem confirmação direta no artigo',
};

const SPAN_CLASS: Record<FactualitySentence['label'], string> = {
  supported: 'bg-emerald-50 border-b-2 border-emerald-300',
  contradicted: 'bg-red-50 border-b-2 border-red-300',
  neutral: 'bg-amber-50 border-b-2 border-amber-300',
};

const POPOVER_HEADER_CLASS: Record<FactualitySentence['label'], string> = {
  supported: 'text-emerald-700',
  contradicted: 'text-red-700',
  neutral: 'text-amber-700',
};

function HighlightedSentence({
  detail,
  children,
}: {
  detail: FactualitySentence;
  children: React.ReactNode;
}) {
  const showCategory = detail.category && detail.category !== 'no error';
  return (
    <span className={`relative inline group ${SPAN_CLASS[detail.label]} px-0.5 rounded-sm cursor-help`}>
      {children}
      <span
        role="tooltip"
        className="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 max-w-[90vw] bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs text-gray-700 leading-snug whitespace-normal text-left"
      >
        <span className={`block font-semibold mb-1 ${POPOVER_HEADER_CLASS[detail.label]}`}>
          {LABEL_TEXT[detail.label]}
        </span>
        {showCategory && (
          <span className="block mb-1">
            <span className="font-medium text-gray-900">Categoria FineSurE: </span>
            {detail.category}
          </span>
        )}
        {detail.rationale && (
          <span className="block">
            <span className="font-medium text-gray-900">Justificativa: </span>
            {detail.rationale}
          </span>
        )}
      </span>
    </span>
  );
}

// ─── Recursive tree walker ──────────────────────────────────────────
//
// The block-level highlighter cannot rely on string children alone: when the
// LLM emits markdown like "**Header:** content", react-markdown places the
// "Header:" inside a <strong> element, leaving only " content" as a string
// sibling. A flat string-only walk would miss any sentence that spans across
// a React element, which is the common case for bold/italic/code-formatted
// content. This walker collects EVERY leaf (text + element) of a block while
// tracking offsets in the combined plain text, segments that text by
// sentence boundaries, and then re-emits the JSX wrapping leaves that fall
// inside each sentence in a HighlightedSentence span.

type Leaf =
  | { kind: 'string'; text: string; start: number; end: number }
  | { kind: 'element'; node: React.ReactElement; text: string; start: number; end: number };

function extractText(children: React.ReactNode): string {
  let result = '';
  React.Children.forEach(children, (child) => {
    if (typeof child === 'string') result += child;
    else if (typeof child === 'number') result += String(child);
    else if (React.isValidElement(child)) {
      const elementChildren = (child.props as { children?: React.ReactNode }).children;
      if (elementChildren !== undefined) result += extractText(elementChildren);
    }
  });
  return result;
}

function flattenLeaves(children: React.ReactNode): { leaves: Leaf[]; fullText: string } {
  const leaves: Leaf[] = [];
  let cursor = 0;
  React.Children.forEach(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      const text = String(child);
      if (text.length === 0) return;
      leaves.push({ kind: 'string', text, start: cursor, end: cursor + text.length });
      cursor += text.length;
    } else if (React.isValidElement(child)) {
      const elementChildren = (child.props as { children?: React.ReactNode }).children;
      const text = elementChildren !== undefined ? extractText(elementChildren) : '';
      leaves.push({ kind: 'element', node: child, text, start: cursor, end: cursor + text.length });
      cursor += text.length;
    }
  });
  return { leaves, fullText: leaves.map((l) => l.text).join('') };
}

function splitSentencesWithOffsets(text: string): { start: number; end: number; text: string }[] {
  const masked = text.replace(ABBREV_REGEX, (m) => m.replace('.', DOT_PLACEHOLDER));
  const splitPoints: number[] = [0];
  const re = /(?<=[.!?])\s+|\n\s*\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    splitPoints.push(m.index + m[0].length);
  }
  splitPoints.push(text.length);

  const result: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < splitPoints.length - 1; i++) {
    let s = splitPoints[i];
    let e = splitPoints[i + 1];
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) {
      result.push({ start: s, end: e, text: text.slice(s, e) });
    }
  }
  return result;
}

interface Segment {
  start: number;
  end: number;
  classification: FactualitySentence | null;
}

function segmentBlock(fullText: string, index: Map<string, FactualitySentence>): Segment[] {
  const sentences = splitSentencesWithOffsets(fullText);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const sent of sentences) {
    if (sent.start > cursor) {
      segments.push({ start: cursor, end: sent.start, classification: null });
    }
    const key = normalizeKey(sent.text);
    const classification = key ? index.get(key) ?? null : null;
    segments.push({ start: sent.start, end: sent.end, classification });
    cursor = sent.end;
  }
  if (cursor < fullText.length) {
    segments.push({ start: cursor, end: fullText.length, classification: null });
  }
  return segments;
}

function renderLeavesInSegment(
  leaves: Leaf[],
  segStart: number,
  segEnd: number,
  keyPrefix: string,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    const overlapStart = Math.max(leaf.start, segStart);
    const overlapEnd = Math.min(leaf.end, segEnd);
    if (overlapStart >= overlapEnd) continue;

    if (leaf.kind === 'string') {
      const subStart = overlapStart - leaf.start;
      const subEnd = overlapEnd - leaf.start;
      const piece = leaf.text.slice(subStart, subEnd);
      nodes.push(<React.Fragment key={`${keyPrefix}-l${i}`}>{piece}</React.Fragment>);
    } else {
      // Element leaves are emitted whole. Sentence boundaries (.!?) typically
      // fall outside markdown formatting wrappers, so this rarely matters; if
      // a boundary does cut through an element, the element is attributed to
      // the segment that contains its midpoint.
      if (leaf.text.length === 0) {
        if (leaf.start >= segStart && leaf.end <= segEnd) {
          nodes.push(React.cloneElement(leaf.node, { key: `${keyPrefix}-l${i}` }));
        }
      } else {
        const midpoint = (leaf.start + leaf.end) / 2;
        if (midpoint >= segStart && midpoint < segEnd) {
          nodes.push(React.cloneElement(leaf.node, { key: `${keyPrefix}-l${i}` }));
        }
      }
    }
  }
  return nodes;
}

function highlightBlock(
  children: React.ReactNode,
  index: Map<string, FactualitySentence>,
  keyPrefix: string,
): React.ReactNode {
  if (index.size === 0) return <>{children}</>;

  const { leaves, fullText } = flattenLeaves(children);
  if (fullText.trim().length === 0) return <>{children}</>;

  const segments = segmentBlock(fullText, index);
  const nodes: React.ReactNode[] = [];
  segments.forEach((seg, segIdx) => {
    const segKey = `${keyPrefix}-seg${segIdx}`;
    const inner = renderLeavesInSegment(leaves, seg.start, seg.end, segKey);
    if (inner.length === 0) return;
    if (seg.classification) {
      nodes.push(
        <HighlightedSentence key={segKey} detail={seg.classification}>
          {inner}
        </HighlightedSentence>,
      );
    } else {
      nodes.push(<React.Fragment key={segKey}>{inner}</React.Fragment>);
    }
  });

  return <>{nodes}</>;
}

export function FactualityHighlightedMarkdown({ content, factualityDetails }: Props) {
  const index = React.useMemo(() => buildIndex(factualityDetails), [factualityDetails]);
  const hasHighlights = index.size > 0;

  return (
    <>
      {hasHighlights && (
        <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-50 border border-emerald-300"></span>
            suportada pelo artigo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-50 border border-amber-300"></span>
            sem confirmação direta no artigo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-50 border border-red-300"></span>
            contraditada pelo artigo
          </span>
          <span className="text-gray-400">· passe o cursor sobre uma frase destacada para ver a justificativa</span>
        </div>
      )}
      <div className="prose prose-gray max-w-none">
        <ReactMarkdown
          components={{
            p: ({ children }) => <p>{highlightBlock(children, index, 'p')}</p>,
            li: ({ children }) => <li>{highlightBlock(children, index, 'li')}</li>,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </>
  );
}
