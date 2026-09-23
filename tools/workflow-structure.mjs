// Minimal structural reader for the GitHub Actions YAML subset used in this repository.
//
// The publication contract has to be expressed against job dependencies, step ids, step
// conditions, and invoked actions rather than against display text, so the checks need
// the parsed structure. This reader covers the constructs these files actually use:
// nested mappings, sequences of mappings, plain and quoted scalars, and folded/literal
// block scalars. It deliberately does not implement YAML generally.

function stripComment(line) {
    let inSingle = false;
    let inDouble = false;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === "'" && !inDouble) {
            inSingle = !inSingle;
        } else if (character === '"' && !inSingle) {
            inDouble = !inDouble;
        } else if (character === '#' && !inSingle && !inDouble && (index === 0 || /\s/u.test(line[index - 1]))) {
            return line.slice(0, index);
        }
    }
    return line;
}

function tokenize(source) {
    const tokens = [];
    for (const raw of source.split('\n')) {
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const withoutComment = stripComment(raw).replace(/\s+$/u, '');
        if (!withoutComment.trim()) {
            continue;
        }
        tokens.push({ indent: withoutComment.length - withoutComment.trimStart().length, text: withoutComment.trim() });
    }
    return tokens;
}

function splitKey(text) {
    let inSingle = false;
    let inDouble = false;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character === "'" && !inDouble) {
            inSingle = !inSingle;
        } else if (character === '"' && !inSingle) {
            inDouble = !inDouble;
        } else if (character === ':' && !inSingle && !inDouble) {
            const rest = text.slice(index + 1);
            if (rest === '' || rest.startsWith(' ')) {
                return { key: text.slice(0, index).trim(), value: rest.trim() };
            }
        }
    }
    return null;
}

function parseScalar(value) {
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    if (value.length >= 2 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
        return value.slice(1, -1);
    }
    return value;
}

function isBlockScalarHeader(value) {
    return value === '>' || value === '|' || /^[>|][+-]?\d*$/u.test(value);
}

function parseMapping(tokens, start, indent) {
    const map = {};
    let index = start;
    while (index < tokens.length && tokens[index].indent === indent && !tokens[index].text.startsWith('- ')) {
        const token = tokens[index];
        const pair = splitKey(token.text);
        if (!pair) {
            throw new Error(`workflow-structure: unsupported line "${token.text}" at indent ${indent}`);
        }
        const next = tokens[index + 1];
        if (pair.value === '') {
            if (next && next.indent > indent) {
                if (next.text.startsWith('- ')) {
                    const [sequence, nextIndex] = parseSequence(tokens, index + 1, next.indent);
                    map[pair.key] = sequence;
                    index = nextIndex;
                } else {
                    const [child, nextIndex] = parseMapping(tokens, index + 1, next.indent);
                    map[pair.key] = child;
                    index = nextIndex;
                }
            } else {
                map[pair.key] = null;
                index += 1;
            }
        } else if (isBlockScalarHeader(pair.value)) {
            const literal = pair.value.startsWith('|');
            const lines = [];
            index += 1;
            while (index < tokens.length && tokens[index].indent > indent) {
                lines.push(tokens[index].text);
                index += 1;
            }
            map[pair.key] = lines.join(literal ? '\n' : ' ');
        } else {
            map[pair.key] = parseScalar(pair.value);
            index += 1;
        }
    }
    return [map, index];
}

function parseSequence(tokens, start, indent) {
    const items = [];
    let index = start;
    while (index < tokens.length && tokens[index].indent === indent && tokens[index].text.startsWith('- ')) {
        const inline = tokens[index].text.slice(2);
        const itemIndent = indent + 2;
        if (!splitKey(inline)) {
            items.push(parseScalar(inline));
            index += 1;
            continue;
        }
        const [item, consumed] = parseMapping([{ indent: itemIndent, text: inline }, ...tokens.slice(index + 1)], 0, itemIndent);
        items.push(item);
        index += consumed;
    }
    return [items, index];
}

export function parseYamlStructure(source) {
    const tokens = tokenize(source);
    if (tokens.length === 0) {
        return {};
    }
    const [structure] = parseMapping(tokens, 0, tokens[0].indent);
    return structure;
}

export function asArray(value) {
    return Array.isArray(value) ? value : [];
}

export function findStep(steps, predicate) {
    return asArray(steps).find(predicate) ?? null;
}
