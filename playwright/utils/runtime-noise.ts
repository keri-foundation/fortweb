export function isKnownRuntimeNoise(text: string): boolean {
    return (
        text.includes('SyntaxWarning: invalid escape sequence') ||
        text.includes('/lib/python3.13/site-packages/') ||
        text.includes("b'(?P<kind2>") ||
        text.includes('MapDom is a subclass of IceMapDom') ||
        text.includes('RawDom is subclass of MapDom')
    );
}
