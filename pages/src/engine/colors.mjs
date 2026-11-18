// Pure logic (no DOM, no Sauce imports): map a kit colour to a word riders can say on voice.

const TABLE = [
    ['White', [255, 255, 255]],
    ['Black', [0, 0, 0]],
    ['Red', [255, 0, 0]],
    ['Green', [0, 200, 0]],
    ['Blue', [0, 0, 255]],
    ['Yellow', [255, 255, 0]],
    ['Orange', [255, 128, 0]],
    ['Purple', [128, 0, 128]],
    ['Pink', [255, 105, 180]],
    ['Grey', [128, 128, 128]],
    ['Cyan', [0, 255, 255]],
    ['Brown', [139, 69, 19]],
];


function parseHex(hex) {
    let h = String(hex ?? '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) {
        h = h.split('').map(c => c + c).join('');
    }
    if (!/^[0-9a-f]{6}$/i.test(h)) {
        return null;
    }
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}


// Nearest named colour by squared RGB distance; ties go to the earlier table entry.
export function colorNameFor(hex) {
    const rgb = parseHex(hex);
    if (!rgb) {
        return TABLE[0][0];
    }
    let best = null;
    let bestD = Infinity;
    for (const [name, c] of TABLE) {
        const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
        if (d < bestD) {
            bestD = d;
            best = name;
        }
    }
    return best;
}
