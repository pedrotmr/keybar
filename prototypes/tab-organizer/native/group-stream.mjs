// A preview is provisional; the complete response is validated before a proposal can be applied.
export function createGroupStream() {
  let text = '';
  let position = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let stringStart = 0;
  let expectingKey = true;
  let rootKey;
  let inGroups = false;
  let groupStart;
  let disabled = false;

  return {
    push(delta) {
      if (disabled) return [];
      text += delta;
      if (text.length > 1024 * 1024) {
        disabled = true;
        text = '';
        return [];
      }
      const completed = [];
      for (; position < text.length; position++) {
        const char = text[position];
        if (inString) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') {
            inString = false;
            if (depth === 1 && expectingKey) {
              try {
                rootKey = JSON.parse(text.slice(stringStart, position + 1));
              } catch {
                rootKey = undefined;
              }
              expectingKey = false;
            }
          }
          continue;
        }
        if (char === '"') {
          inString = true;
          stringStart = position;
        } else if (char === '{') {
          if (inGroups && depth === 2) groupStart = position;
          depth++;
        } else if (char === '[') {
          if (depth === 1 && rootKey === 'groups') inGroups = true;
          depth++;
        } else if (char === '}') {
          if (inGroups && depth === 3 && groupStart !== undefined) {
            try {
              completed.push(JSON.parse(text.slice(groupStart, position + 1)));
            } catch {
              // A malformed preview group must not prevent later groups from being previewed.
            }
            groupStart = undefined;
          }
          depth--;
        } else if (char === ']') {
          if (inGroups && depth === 2) inGroups = false;
          depth--;
        } else if (char === ',' && depth === 1) {
          expectingKey = true;
          rootKey = undefined;
        }
      }
      return completed;
    },
  };
}
