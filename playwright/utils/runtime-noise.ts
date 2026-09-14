export function isKnownRuntimeNoise(text: string): boolean {
    // Suppress only the specific cosmetic Python SyntaxWarnings emitted while
    // keri/hio import under Pyodide (invalid escape sequences in regex
    // docstrings) plus their continuation lines. Match semantic markers, never
    // a bare filesystem/package path, so a fatal traceback that merely contains
    // a site-packages path is always collected as an error.
    return (
        text.includes('SyntaxWarning: invalid escape sequence') ||
        text.includes("b'(?P<kind2>") ||
        text.includes('MapDom is a subclass of IceMapDom') ||
        text.includes('RawDom is subclass of MapDom')
    );
}
