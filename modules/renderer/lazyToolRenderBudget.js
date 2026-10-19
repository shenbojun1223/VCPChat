import {
    collectToolResultRanges,
    collectCodeDomainsOutsideToolResults,
} from './toolResultRegions.js';
import { replaceToolRequestBlocks, readToolRequestField } from './toolRequestScanner.js';


export const MAX_LAZY_TOOL_BLOCKS = 512;
export const LAZY_TOOL_BLOCK_COST = 128;

/**
 * Estimate collapsed rendering work, not stored size or AI context length.
 * Uncertain structures retain the original budget. No rendering or lazy-map registration.
 */
export function estimateLazyToolRenderLength(source) {
    if (typeof source !== 'string') return 0;
    const originalLength = source.length;
    // Keep thought-chain ownership conservative, including incomplete chains.
    if (/<\/?think(?:ing)?>|\[--- (?:VCP元思考链|元思考链结束)/i.test(source)) {
        return originalLength;
    }

    const resultRanges = collectToolResultRanges(source);
    const ranges = resultRanges.filter(range => range.closed).map(range => ({
        start: range.start, end: range.end,
    }));
    replaceToolRequestBlocks(source, (full, body, start, end) => {
        const name = readToolRequestField(body, 'tool_name')
            || body.match(/<tool_name>([\s\S]*?)<\/tool_name>/i)?.[1]?.trim()
            || '';
        if (name.toLowerCase() !== 'dailynote') ranges.push({ start, end });
        return full; // Scan only; do not allocate replacement HTML or register tool entries.
    });
    if (!ranges.length || ranges.length > MAX_LAZY_TOOL_BLOCKS) return originalLength;

    // Result payloads are opaque: their fences cannot open code domains across later tools.
    // Fences outside those payloads still protect literal protocol examples.
    const code = collectCodeDomainsOutsideToolResults(source, resultRanges, {
        includeUnclosedInline: true,
    });
    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    let length = originalLength;
    let previousEnd = 0;
    let codeIndex = 0;
    for (const range of ranges) {
        if (range.start < previousEnd) continue;
        previousEnd = range.end;
        while (codeIndex < code.length && code[codeIndex].end <= range.start) codeIndex++;
        if (codeIndex < code.length && code[codeIndex].start <= range.start) continue;
        length -= Math.max(0, range.end - range.start - LAZY_TOOL_BLOCK_COST);
    }
    return length;
}