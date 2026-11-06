// A deliberately tiny Itanium C++ demangler: it recovers the *qualified name*
// of a function (e.g. `_ZN2nn2fs8OpenFileEPNS0_10FileHandle...` -> `nn::fs::OpenFile`)
// and ignores parameter types. That's all the crash explainer needs, and a full
// demangler is thousands of lines.

export function demangle(symbol: string): string {
  if (!symbol.startsWith('_Z')) return symbol;
  let i = 2;
  const readSourceName = (): string | null => {
    let len = 0;
    const start = i;
    while (i < symbol.length && symbol[i]! >= '0' && symbol[i]! <= '9') {
      len = len * 10 + Number(symbol[i]);
      i++;
    }
    if (i === start || len === 0 || i + len > symbol.length) return null;
    const name = symbol.slice(i, i + len);
    i += len;
    return name;
  };

  try {
    if (symbol[i] === 'N') {
      i++;
      // skip CV / ref qualifiers on member functions
      while ('rVKRO'.includes(symbol[i] ?? '')) i++;
      const parts: string[] = [];
      while (i < symbol.length && symbol[i] !== 'E') {
        if (symbol.startsWith('St', i)) {
          parts.push('std');
          i += 2;
          continue;
        }
        if (symbol[i] === 'S') {
          // substitution like S_ or S0_: we can't resolve without a table, stop
          return parts.length ? parts.join('::') : symbol;
        }
        if (symbol[i] === 'I') return parts.join('::'); // template args: stop at the name
        if (symbol[i] === 'C' || symbol[i] === 'D') {
          // constructor / destructor
          const last = parts[parts.length - 1] ?? '';
          parts.push(symbol[i] === 'D' ? `~${last}` : last);
          i += 2;
          continue;
        }
        const name = readSourceName();
        if (name === null) return parts.length ? parts.join('::') : symbol;
        parts.push(name);
      }
      return parts.join('::');
    }
    const name = readSourceName();
    return name ?? symbol;
  } catch {
    return symbol;
  }
}
