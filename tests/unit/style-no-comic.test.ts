// W15 Sprint D (TW-LOOK): the dead ink helpers and the comic leftovers stay gone. The look is stylised-realistic
// (docs/design/LOOK.md): no ink, no outline pass, no comic death face. Each check fails if its piece comes back.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import * as STYLE_WEBGPU from '../../src/client/style/style-webgpu.js';
import { createCharacter } from '../../src/client/procgen/characters';
import { BONE_NAMES } from '../../src/client/procgen/characters/skeleton';
import { FaceController, type FaceInput } from '../../src/client/anim/face';
import { Species, Team } from '../../src/shared/types';

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe('dead ink helpers (W15 Sprint D)', () => {
  it('the style module exports no comic-, ink-, outline-, crease- or halftone-named helper (the old pipeline aliases are gone)', () => {
    expect(Object.keys(STYLE_WEBGPU).filter((k) => /comic|ink|outline|crease|halftone/i.test(k))).toEqual([]);
  });

  it('the labs carry no ink experiment: no outline-pass patch, no inkfar, no styleInk checks (nothing sets styleInk)', () => {
    const labs = readdirSync(new URL('../../labs/', import.meta.url)).filter((f) => f.endsWith('.ts'));
    expect(labs.length).toBeGreaterThan(5);
    for (const f of labs) {
      const src = read(`labs/${f}`);
      for (const [re, what] of [[/ToonOutlinePassNode|capInkDistance/, 'the ink-width experiment'], [/inkfar/, 'the inkfar param'],
        [/styleInk/, 'a styleInk check'], [/comic (pipeline|splat)|ink outline pass|crease ink|THWACK/, 'comic wording']] as const) {
        expect(src, `${f}: ${what}`).not.toMatch(re);
      }
    }
  });
});

describe('no styleInk or comic pipeline names anywhere (W15 Sprint D)', () => {
  it('nothing in src, labs or tests reads or sets userData.styleInk (the ink-line flag) or names the comic pipeline aliases', () => {
    const self = 'style-no-comic.test.ts';
    for (const dir of ['src', 'labs', 'tests']) {
      const files = (readdirSync(new URL(`../../${dir}/`, import.meta.url), { recursive: true }) as string[])
        .filter((f) => /\.(ts|js|mjs)$/.test(f) && !f.endsWith(self));
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) expect(read(`${dir}/${f}`), `${dir}/${f}`).not.toMatch(/styleInk|createComicPipeline|buildComicOutput/);
    }
  });
});

describe('the dead pet has no comic face (W15 Sprint D)', () => {
  const dead: FaceInput = { dead: true, firing: false, hpFrac: 0, zoomies: false, emote: false, hit: 0, falling: false, speed: 0 };

  it('a dead face shuts its lids, keeps its tongue in and does not grin or frown', () => {
    for (const cat of [false, true]) {
      const face = new FaceController(7, cat);
      let o = face.update(dead, 1 / 60);
      for (let i = 0; i < 120; i++) o = face.update(dead, 1 / 60);
      expect(o.tongue, 'no tongue out').toBe(0);
      expect(o.lidUp, 'lids shut').toBe(1);
      expect(o.smile).toBe(0);
    }
  });

  it('no X eyes: no xEyes joint in the rig template or a built pet, so no geometry can hang off one', () => {
    expect(BONE_NAMES as readonly string[]).not.toContain('xEyes');
    for (const species of [Species.Corgi, Species.Cat]) for (const isLocal of [true, false]) {
      const av = createCharacter({ species, cls: 'assault', team: species === Species.Cat ? Team.Cats : Team.Corgis, seed: 3, isLocal });
      expect(av.skinned.skeleton.bones.map((b) => b.name), `${species === Species.Cat ? 'cat' : 'corgi'} ${isLocal ? 'hero' : 'npc'}`).not.toContain('xEyes');
    }
    expect(read('src/client/anim/character-animator.ts'), 'the rig no longer drives X eyes').not.toMatch(/b\.xEyes/);
  });

  it('no eye bars on any eye bone: nothing dark is skinned to the eyeballs, sockets or lids (pupils are their own bones)', () => {
    // The X eyes were dark bars over the eye. Whatever joint they come back on, a dark (luminance < 0.05) vertex on
    // an eye, socket or lid bone fails here; the darkest real ones are the irises (> 0.1) and the lid fur (> 0.3).
    for (const species of [Species.Corgi, Species.Cat]) for (const isLocal of [true, false]) {
      const av = createCharacter({ species, cls: 'assault', team: species === Species.Cat ? Team.Cats : Team.Corgis, seed: 3, isLocal });
      const g = av.skinned.geometry, si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight'), col = g.getAttribute('color');
      const names = av.skinned.skeleton.bones.map((b) => b.name);
      let eyeVerts = 0;
      const dark: string[] = [];
      for (let i = 0; i < si.count; i++) {
        for (let c = 0; c < 4; c++) {
          if (sw.getComponent(i, c) <= 0.01) continue;
          const bone = names[si.getComponent(i, c)];
          if (!/^(eye|eyeSocket|lidUp|lidLo)\./.test(bone)) continue;
          eyeVerts++;
          const L = 0.2126 * col.getX(i) + 0.7152 * col.getY(i) + 0.0722 * col.getZ(i);
          if (L < 0.05) dark.push(`${bone}#${i}`);
        }
      }
      expect(eyeVerts).toBeGreaterThan(100);
      expect(dark.slice(0, 5), `${species === Species.Cat ? 'cat' : 'corgi'} ${isLocal ? 'hero' : 'npc'}: dark eye-bar vertices`).toEqual([]);
    }
  });
});
