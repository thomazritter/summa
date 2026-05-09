import React from 'react';
import ReactMarkdown from 'react-markdown';

export interface FactualitySentence {
  sentence: string;
  label: 'supported' | 'neutral' | 'contradicted';
  confidence: number;
  sourceSentence: string;
}

interface Props {
  content: string;
  factualityDetails: FactualitySentence[] | null;
}

const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+/;
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

function highlightString(text: string, index: Map<string, FactualitySentence>, prefix: string): React.ReactNode[] {
  const sentences = text.split(SENTENCE_SPLIT_REGEX);
  const nodes: React.ReactNode[] = [];

  sentences.forEach((sentence, i) => {
    const detail = index.get(normalizeKey(sentence));
    const isLast = i === sentences.length - 1;
    const trailingSpace = isLast ? '' : ' ';

    if (!detail || detail.label === 'supported') {
      nodes.push(
        <React.Fragment key={`${prefix}-${i}`}>
          {sentence}
          {trailingSpace}
        </React.Fragment>,
      );
      return;
    }

    const className =
      detail.label === 'contradicted'
        ? 'bg-red-50 border-b-2 border-red-300'
        : 'bg-amber-50 border-b-2 border-amber-300';

    const tooltip =
      detail.label === 'contradicted'
        ? `Contraditada pelo artigo (confiança ${(detail.confidence * 100).toFixed(0)}%)\nTrecho: "${detail.sourceSentence.slice(0, 200)}"`
        : `Sem confirmação direta no artigo (confiança ${(detail.confidence * 100).toFixed(0)}%)\nTrecho mais próximo: "${detail.sourceSentence.slice(0, 200)}"`;

    nodes.push(
      <span
        key={`${prefix}-${i}`}
        className={`${className} px-0.5 rounded-sm cursor-help`}
        title={tooltip}
      >
        {sentence}
      </span>,
    );
    if (trailingSpace) nodes.push(' ');
  });

  return nodes;
}

function highlightChildren(
  children: React.ReactNode,
  index: Map<string, FactualitySentence>,
  pathPrefix: string,
): React.ReactNode {
  const childArray = React.Children.toArray(children);
  return childArray.map((child, idx) => {
    if (typeof child === 'string') {
      return (
        <React.Fragment key={`${pathPrefix}-s-${idx}`}>
          {highlightString(child, index, `${pathPrefix}-s-${idx}`)}
        </React.Fragment>
      );
    }
    return child;
  });
}

export function FactualityHighlightedMarkdown({ content, factualityDetails }: Props) {
  const index = React.useMemo(() => buildIndex(factualityDetails), [factualityDetails]);
  const hasHighlights = index.size > 0;

  return (
    <>
      {hasHighlights && (
        <div className="mb-4 flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-50 border border-amber-300"></span>
            sem confirmação direta no artigo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-50 border border-red-300"></span>
            contraditada pelo artigo
          </span>
        </div>
      )}
      <div className="prose prose-gray max-w-none">
        <ReactMarkdown
          components={{
            p: ({ children }) => <p>{highlightChildren(children, index, 'p')}</p>,
            li: ({ children }) => <li>{highlightChildren(children, index, 'li')}</li>,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </>
  );
}
