// modules/chat/contextCompactionFidelity.js

/**
 * Deterministic identifier-fidelity audit for context checkpoints.
 *
 * The compaction prompt demands zero-paraphrase preservation for identifiers,
 * but a prompt rule is a probability, not a guarantee. This audit is the
 * host-owned net underneath: it re-extracts high-value anchors (paths, hashes,
 * URLs) from the exact history handed to the compression model and checks,
 * with plain substring matching, that each one survived into the checkpoint.
 *
 * Pure functions, no model calls, bounded work. A missing anchor is recorded
 * as metadata for humans and future audits; it never blocks the commit,
 * because summarization may legitimately retire superseded identifiers.
 */

const PER_KIND_CAP = 64;
// Sample cap mirrors the DSH forge-context review style: name a bounded sample,
// carry the full count separately, never flood the metadata.
const MISSING_SAMPLE_CAP = 8;

import { collectToolResultRanges } from '../renderer/toolResultRegions.js';

const PATH_PATTERN = /(?:[A-Za-z]:\/|\/~)?[\w@.-]+(?:\/[\w@.-]+)+/g;
// 7-40 char hex with at least one letter: git sha, short sha, hex tokens (not plain numbers).
const HASH_PATTERN = /\b(?=[0-9a-f]{7,40}\b)[0-9a-f]*[a-f][0-9a-f]*\b/gi;
// Absolute http(s) URLs; ASCII delimiters and CJK punctuation end the match.
const URL_PATTERN = /https?:\/\/[^\s<>"'`\\^|{}\])\u3000-\u303f\uff01-\uff5e]+/g;
const EMOJI_ASSET_URL_PATTERN = /\/images\/[^/\s]*表情包\//u;

const ANCHOR_RULES = [
    ['path', PATH_PATTERN],
    ['hash', HASH_PATTERN],
    ['url', URL_PATTERN],
];

function normalizeAnchor(kind, value) {
    if (kind === 'hash') return value.toLowerCase();
    // Trailing dots usually belong to the sentence, not the identifier.
    if (kind === 'path') return value.replace(/\.+$/, '');
    return value.replace(/[.,;:!?'"]+$/, '');
}

export function flattenContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content
        .map(part => (typeof part?.text === 'string' ? part.text : '')).join('\n');
    if (content && typeof content.text === 'string') return content.text;
    return '';
}

// Dates (2026/10/22), slash phrases (and/or), and regex flags (./g) are not path anchors:
// require at least two non-dot segments and either depth >= 3 or a filename dot.
function keepsPathAnchor(value) {
    const segments = value.split(/[\\/]/).filter(Boolean);
    const meaningful = segments.filter(segment => segment !== '.' && segment !== '..');
    if (meaningful.length < 2) return false;
    if (meaningful.every(segment => /^\d+$/.test(segment))) return false;
    return meaningful.length >= 3 || meaningful.some(segment => segment.includes(String.fromCharCode(46)));
}

function stripToolResultBlocks(text) {
    if (!text) return '';
    const ranges = collectToolResultRanges(text);
    if (!ranges.length) return text;
    let output = '';
    let cursor = 0;
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
        if (range.start >= cursor) output += text.slice(cursor, range.start);
        cursor = Math.max(cursor, range.end);
    }
    return output + text.slice(cursor);
}

/**
 * Anchor extraction for one text block: URLs first, then paths and hashes
 * from the URL-stripped remainder. Exported for the continuity audit.
 * @param {string} text
 * @returns {Map<string, Set<string>>} normalized anchors keyed by kind
 */
export function extractAnchors(text) {
    const byKind = new Map(ANCHOR_RULES.map(([kind]) => [kind, new Set()]));
    if (!text) return byKind;
    for (const match of text.match(URL_PATTERN) || []) {
        const normalized = normalizeAnchor('url', match);
        if (!EMOJI_ASSET_URL_PATTERN.test(normalized)) {
            byKind.get('url').add(normalized);
        }
    }
    // Paths and hashes are extracted outside URLs only; otherwise every URL
    // would donate pseudo-anchors from its host and query segments.
    const withoutUrls = text.replace(URL_PATTERN, ' ');
    for (const [kind, pattern] of ANCHOR_RULES) {
        if (kind === 'url') continue;
        for (const match of withoutUrls.match(pattern) || []) {
            const anchor = normalizeAnchor(kind, match);
            if (kind !== 'path' || keepsPathAnchor(anchor)) {
                byKind.get(kind).add(anchor);
            }
        }
    }
    return byKind;
}

function collectAnchors(messages) {
    const byKind = new Map(ANCHOR_RULES.map(([kind]) => [kind, new Set()]));
    for (const message of messages || []) {
        const text = stripToolResultBlocks(flattenContent(message?.content));
        for (const [kind, anchors] of extractAnchors(text)) {
            for (const anchor of anchors) byKind.get(kind).add(anchor);
        }
    }
    return byKind;
}

/**
 * @param {Array<{content: string|Array|{text: string}}>} messages history as prepared for compression
 * @param {string} checkpoint the model-authored checkpoint report
 * @returns {{total: number, preserved: number, missing: {path: string[], hash: string[], url: string[]}, capped: string[]}}
 */
export function auditCheckpointFidelity(messages, checkpoint) {
    const checkpointText = typeof checkpoint === 'string' ? checkpoint : '';
    const checkpointLower = checkpointText.toLowerCase();
    const byKind = collectAnchors(messages);
    const result = {
        total: 0,
        preserved: 0,
        missing: {},
        capped: [],
        // Humility metadata (same spirit as forge-context quality flags):
        // a miss is a signal for humans, never proof of semantic loss, and
        // never a refusal reason — summarization may retire stale identifiers.
        note: '宿主本地子串核对；缺失是审计信号而非拒收依据，也不证明语义无损。',
    };
    for (const [kind] of ANCHOR_RULES) {
        const anchors = [...byKind.get(kind)].sort();
        let considered = anchors;
        if (anchors.length > PER_KIND_CAP) {
            considered = anchors.slice(0, PER_KIND_CAP);
            result.capped.push(kind);
        }
        const missing = [];
        for (const anchor of considered) {
            result.total += 1;
            const hit = kind === 'hash'
                ? checkpointLower.includes(anchor)
                : checkpointText.includes(anchor);
            if (hit) result.preserved += 1;
            else if (missing.length < MISSING_SAMPLE_CAP) missing.push(anchor);
        }
        result.missing[kind] = missing;
    }
    return result;
}
