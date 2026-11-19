interface HighlightedTextProps {
  text: string;
  highlightQuery: string;
}

export function HighlightedText({ text, highlightQuery }: HighlightedTextProps) {
  const terms = [...new Set(highlightQuery.trim().split(/\s+/).filter(Boolean))];

  if (!terms.length) {
    return <>{text}</>;
  }

  const escapeRegExp = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const searchableTerms = new Set(terms.map((term) => term.toLocaleLowerCase()));
  return (
    <>
      {text
        .split(expression)
        .map((part, index) =>
          searchableTerms.has(part.toLocaleLowerCase()) ? <mark key={`${index}-${part}`}>{part}</mark> : part,
        )}
    </>
  );
}
