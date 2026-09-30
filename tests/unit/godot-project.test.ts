// W12: the Godot game is the main build and the look is locked. This fails if the Godot project or its main scene
// goes missing, if the scene stops composing World / Look / Game, or if the look flag is not stylised-realistic.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const root = 'engines/godot';
describe('W12 Godot project', () => {
  it('exists, boots main.tscn, and composes World, Look and Game', () => {
    const project = readFileSync(`${root}/project.godot`, 'utf8');
    expect(project).toMatch(/run\/main_scene="res:\/\/main\.tscn"/);
    const main = readFileSync(`${root}/main.tscn`, 'utf8');
    for (const n of ['World', 'Look', 'Game']) expect(main).toContain(`[node name="${n}"`);
    for (const s of ['world/world.gd', 'look/look.gd', 'game/match.gd', 'tests/run.gd']) expect(existsSync(`${root}/${s}`), s).toBe(true);
  });
  it('the look is stylised-realistic, not HARDENED', () => {
    const look = readFileSync(`${root}/look/look.gd`, 'utf8');
    expect(look).toMatch(/const LOOK := "stylised-realistic"/);
    expect(look.toLowerCase()).not.toContain('hardened');
  });
  it('the README documents the launch command', () => {
    expect(readFileSync('README.md', 'utf8')).toContain('npm run godot');
  });
});
