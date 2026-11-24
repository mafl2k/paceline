// Pure logic (no DOM, no Sauce imports): the made-up plan the demo rides when no plan is loaded.
// Fictional riders; the same shape as a zwiftgopher export, so it goes through the normal import.
import {normalizePlan, parseTextExport} from './plan.mjs';

const RIDERS = [
    ['1001', 'Alma Keller', 120, 72, '#ffffff', 286, 'White'],
    ['1002', 'Ben Richter', 60, 88, '#0000ff', 338, 'Blue'],
    ['1003', 'Cleo Maier', 60, 61.5, '#fff000', 238, 'Yellow'],
    ['1004', 'Dana Lorenz', 60, 64.2, '#000000', 266, 'Black'],
    ['1005', 'Eli Sommer', 15, 76.6, '#cc0000', 319, 'Red'],
    ['1006', 'Finn Weber', 15, 91, '#00cc00', 309, 'Lime'],
];


// The plan as a zwiftgopher export, its pull watts in pull_power too. The plan server's screenshot
// run (server/tests/smoke-captain.mjs) stores this as "Rollers · fast", so the mod's and the plan
// server's pictures show the same plan code (user, 24 Nov 2026); its riders have the ids the
// server's tests use (1001-1007).
export function sampleJson() {
    return {
        team: {name: 'Rollers · fast demo'},
        riders: Object.fromEntries(RIDERS.map(([id, name, pullS, weight, color, watts], order) =>
            [id, {name, order, pull_duration: pullS, weight, color, pull_power: watts}])),
        roster: {'1007': {name: 'Gina Hoff'}},
    };
}


export function samplePlan() {
    const json = sampleJson();
    const text = ['RiderName\tPullWatts\tPullDurationSeconds\tKitColorName\tKitColorHex',
        ...RIDERS.map(([, name, pullS, , color, watts, colorName]) =>
            [name, watts, pullS, colorName, color.toUpperCase()].join('\t'))].join('\n');
    return normalizePlan(json, parseTextExport(text)).plan;
}
