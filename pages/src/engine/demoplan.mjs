// Pure logic (no DOM, no Sauce imports): the made-up plan the demo rides when no plan is loaded.
// Fictional riders; the same shape as a zwiftgopher export, so it goes through the normal import.
import {normalizePlan, parseTextExport} from './plan.mjs';

const RIDERS = [
    ['1000001', 'Alma Keller', 120, 72, '#ffffff', 286, 'White'],
    ['1000002', 'Ben Richter', 60, 88, '#0000ff', 338, 'Blue'],
    ['1000003', 'Cleo Maier', 60, 61.5, '#fff000', 238, 'Yellow'],
    ['1000004', 'Dana Lorenz', 60, 64.2, '#000000', 266, 'Black'],
    ['1000005', 'Eli Sommer', 15, 76.6, '#cc0000', 319, 'Red'],
    ['1000006', 'Finn Weber', 15, 91, '#00cc00', 309, 'Lime'],
];


export function samplePlan() {
    const json = {
        team: {name: 'Demo team'},
        riders: Object.fromEntries(RIDERS.map(([id, name, pullS, weight, color], order) =>
            [id, {name, order, pull_duration: pullS, weight, color}])),
        roster: {'1000007': {name: 'Gina Hoff'}},
    };
    const text = ['RiderName\tPullWatts\tPullDurationSeconds\tKitColorName\tKitColorHex',
        ...RIDERS.map(([, name, pullS, , color, watts, colorName]) =>
            [name, watts, pullS, colorName, color.toUpperCase()].join('\t'))].join('\n');
    return normalizePlan(json, parseTextExport(text)).plan;
}
