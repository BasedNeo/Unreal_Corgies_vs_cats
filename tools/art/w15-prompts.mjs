// W15 p-art: the prompt library and the jobs for the character reference sheets (tools/art/grok-sheets.mjs runs them).
// A prompt is built from shared fragments, so both characters and every view say the same thing the same way.
// PROMPTS.md is generated from this file (`node tools/art/grok-sheets.mjs prompts`), with each prompt's full text.
// Rules carried by every prompt: original IP (no existing game, franchise, studio or character is named), no text,
// logos, insignia or watermarks, stylised-realistic (not cartoon / anime / cel / comic, no ink), quadruped on all fours,
// mouth closed; sheets on plain mid-grey under even studio light, full body, nothing cropped.

const F = {
  style:
    'Stylised-realistic: realistic fur, padded fabric, painted metal plate and leather straps with believable ' +
    'material detail, and slightly exaggerated, readable proportions. Not a cartoon, not anime, not cel-shaded, not a ' +
    'comic or flat illustration: no ink outlines, no flat colour fills.',
  sheet:
    'Even, neutral, soft studio lighting from the front and both sides; a plain, flat, seamless mid-grey background ' +
    '(#808080) with only a faint soft contact shadow under the paws. The whole animal is in frame with clear space ' +
    'around it; nothing is cropped.',
  neg:
    'No text, no letters, no numbers, no logos, no emblems, no insignia, no flags, no watermark, no signature, no ' +
    'border. One animal only, no people.',
  stance: 'It stands naturally on all four legs, mouth closed, with a calm, alert, veteran expression.',
  corgiBody:
    'an original corgi soldier of the Pembroke type: a long, low, barrel-shaped body about twice as long as it is ' +
    'tall at the back, on very short, sturdy legs; big upright pointed ears, each taller than the head; a fox-like ' +
    'face with a pointed white muzzle and a black nose; a short stub tail. Coat: warm ochre-tan fur with a white bib ' +
    'on the chest, a white muzzle and white socks on all four paws.',
  corgiArmour:
    'Armour: a fitted barding vest covering the back, both flanks and the front of the chest, made of matte, ' +
    'saturated cobalt-blue painted plates (#2f6fd6) over padding, one solid colour with no pattern, with scuffed, ' +
    'worn ochre-yellow trim bands along its front and rear edges; a solid blue chest shield with a pointed bottom on ' +
    'an ochre backing rim, strapped flat on the chest and facing forward; a blue armoured collar. Light scuffs, ' +
    'chipped paint and grime from use.',
  rifle:
    'One compact, matte gunmetal rifle rides on a harness mount on the right side of the vest at the shoulder: it lies ' +
    'level along the top of the right flank, barrel pointing straight forward beside the neck, the muzzle level with ' +
    'the chest shield. The animal does not hold it; no hands anywhere.',
  view34:
    'Front three-quarter view from the animal\'s front right, the camera slightly above its back, so the face, the ' +
    'chest shield, the right flank and the rifle mount all show.',
};

// v2 (after the first tests: ears came out normal-sized, the look drifted toward a soft CG render): stronger material
// realism, the ear size and the chest shield spelled out.
const F2 = {
  style:
    'Stylised-realistic, high-end game character quality: photographic fur with visible individual hairs and natural ' +
    'sheen, real painted-steel armour plates with chipped paint and worn bare-metal edges, real leather straps and ' +
    'metal buckles. Only the proportions are slightly exaggerated for readability. Not a cartoon, not anime, not ' +
    'cel-shaded, not a comic, not a toy or a soft plastic 3D render: no ink outlines, no flat colour fills.',
  corgiBody:
    'an original corgi soldier of the Pembroke type: a long, low, barrel-shaped body about twice as long as it is ' +
    'tall at the back, on very short, sturdy legs; oversized upright pointed ears, each ear about as tall as the ' +
    'whole head (the signature of its silhouette); a fox-like face with a pointed white muzzle and a black nose; a ' +
    'short stub tail. Coat: warm ochre-tan fur with a white bib on the chest, a white muzzle and white socks on all ' +
    'four paws.',
  corgiArmour:
    'Armour: a fitted barding vest covering the back, both flanks and the front of the chest, made of matte, ' +
    'saturated cobalt-blue painted plates (#2f6fd6) over padding, one solid colour with no pattern, with scuffed, ' +
    'worn ochre-yellow trim bands along its front and rear edges; a solid cobalt-blue chest shield about as wide as ' +
    'the chest, with a pointed bottom, on an ochre backing rim, strapped flat on the front of the chest below the ' +
    'chin and facing forward; a blue armoured collar. Light scuffs, chipped paint and grime from use.',
  catBody:
    'an original cat soldier: a slim, lean body about as long as it is tall at the back, on long, slender legs; ' +
    'small pointed ears; a long tail held up high in an S-shaped curve, its tip the highest point of the whole ' +
    'silhouette, well above the head. Coat: cool grey tabby fur with darker grey stripes, a pale muzzle and a pale ' +
    'chest.',
  catArmour:
    'Armour: a fitted barding vest covering the back, both flanks and the front of the chest, made of matte ' +
    'dark-crimson painted plates (#6e1d29, a deep dark red) over padding, split into front and rear halves by a wide ' +
    'ochre-yellow band around the middle of the body, with ochre trim along its front and rear edges; a square ' +
    'dark-crimson chest shield about as wide as the chest, strapped flat on the front of the chest below the chin and ' +
    'facing forward, split down the middle by a vertical ochre stripe; a crimson armoured collar. Light scuffs, ' +
    'chipped paint and grime from use.',
};
const corgi2 = (view) => `Character reference image for an original video game: ${F2.corgiBody} ${F.stance} ${F2.corgiArmour} ${F.rifle} ${view} ${F2.style} ${F.sheet} ${F.neg}`;
const cat2 = (view) => `Character reference image for an original video game: ${F2.catBody} ${F.stance} ${F2.catArmour} ${F.rifle} ${view} ${F2.style} ${F.sheet} ${F.neg}`;
const fromPlaceholder2 = (who) =>
  `The input image is a crude, blocky 3D placeholder render of this character. Use it only as the guide for the ` +
  `camera angle, the pose, the framing, the body proportions (${who}) and where the vest, chest shield, collar and ` +
  `rifle sit. Redraw it as the finished character: natural anatomy, real fur and real armour, no blocky shapes. The ` +
  `character: `;

// views from the master: <IMAGE_0> the master (the design), <IMAGE_1> the condition render (the viewpoint)
const V = {
  right: 'a straight side view of its right side, the head to the right of the image, the camera level with its back (a flat, orthographic-like profile)',
  front: 'a straight front view, head-on: the face and the chest shield face the camera, the body symmetrical behind them',
  back: 'a straight rear view from behind: the tail, the rump and the back of the vest face the camera, the ears seen from behind',
};
const KEEP =
  '(the same animal, fur colours and markings, ear size, armour shapes, colours, trim and wear, chest shield, collar, ' +
  'and the same rifle on the same harness mount)';
const fromMaster = (v, body) =>
  `<IMAGE_0> is the finished design of this character. <IMAGE_1> is a crude, blocky 3D placeholder of the same ` +
  `character that shows only the viewpoint, pose, framing and body proportions wanted here: ${v}. Draw the character ` +
  `exactly as designed in <IMAGE_0> ${KEEP}, seen from the viewpoint of <IMAGE_1>, keeping ${body}. No blocky shapes. ` +
  `${F2.style} ${F.sheet} ${F.neg}`;
const turnaround = (body) =>
  `<IMAGE_0> is the finished design of this character. <IMAGE_1> is a crude, blocky 3D placeholder turnaround of the ` +
  `same character: three views side by side at one scale, from left to right a front view, a right side view (head ` +
  `to the right) and a rear view. Make a character turnaround sheet: draw the character exactly as designed in ` +
  `<IMAGE_0> ${KEEP} three times, in the same three viewpoints, positions, poses and scale as <IMAGE_1>, keeping ` +
  `${body}; all three are the identical character. No blocky shapes. ${F2.style} Even, neutral, soft studio lighting; ` +
  `a plain, flat, seamless mid-grey background (#808080) with only faint soft contact shadows; all three full bodies ` +
  `in frame with clear space between and around them; nothing is cropped. ${F.neg}`;
// details: close-ups from [master, a view] (both are the design references)
const detail = (second, framing) =>
  `<IMAGE_0> and <IMAGE_1> show the finished design of this character (<IMAGE_0> a front three-quarter view, ` +
  `<IMAGE_1> ${second}). Make a close-up detail reference of the same character: ${framing} Keep every design ` +
  `detail identical to the references ${KEEP}. ${F2.style} Even, neutral, soft studio lighting; a plain, flat, ` +
  `seamless mid-grey background (#808080). ${F.neg}`;
const D = {
  corgiHead:
    'the head and neck only, from the front right three-quarter, filling the frame: the oversized upright ears (each ' +
    'about as tall as the head), the fox-like face with its pointed white muzzle and black nose, the mouth closed, ' +
    'the eyes, the white blaze and the fur texture, and the blue armoured collar with its ochre trim.',
  catHead:
    'the head and neck only, from the front right three-quarter, filling the frame: the small pointed ears, the grey ' +
    'tabby face with its pale muzzle and pink nose, the mouth closed, the eyes, the whiskers and the striped fur, and ' +
    'the crimson armoured collar with its buckle.',
  corgiArmour:
    'the armour only, filling the frame, seen from the front and slightly to the right: the solid cobalt-blue chest ' +
    'shield with its pointed bottom and ochre backing rim, the front of the blue barding vest, the collar, the straps ' +
    'and buckles; show the plate construction, rivets, seams, edge wear and chipped paint.',
  catArmour:
    'the armour only, filling the frame, seen from the front and slightly to the right: the square dark-crimson chest ' +
    'shield split down the middle by its vertical ochre stripe, the front of the crimson barding vest and the wide ' +
    'ochre band around its middle, the collar, the straps and buckles; show the plate construction, rivets, seams, ' +
    'edge wear and chipped paint.',
  rifle:
    'the rifle on its harness mount only, seen from the right side, filling the frame: the compact gunmetal rifle ' +
    'lying level on the right shoulder of the vest, the bracket and the leather straps and buckles that hold it to ' +
    'the vest, the barrel pointing forward toward the chest shield; a little of the vest and fur around it for context.',
};
// in-situ mood frame (the game's wet night, docs/design/LOOK.md), from the master alone
const inSitu = (stance) =>
  `The input image shows the finished design of this character. Show the same character ${KEEP} ${stance}, mouth ` +
  `closed, in the game's look: a wet night on an industrial yard after rain. Dark wet asphalt with puddles and ` +
  `reflections; stacked shipping containers and large concrete pipes in the background; one sodium floodlight (warm ` +
  `orange, #ff9e47) high to one side casting a pool of light and glints on the wet ground; a cold moonlit overcast ` +
  `sky with a low cloud deck; light fog and height mist; a cool rim light along the character's silhouette so it ` +
  `reads against the dark. The fur is damp and the armour plates are wet with a slight gloss. Stylised-realistic, ` +
  `high-end game quality, moody but readable; the whole animal in frame, three-quarter view from the front right. ` +
  `No text, no letters, no numbers, no logos, no markings or signs on the containers, no insignia, no watermark. ` +
  `One animal only, no people.`;
const CORGI_PROP = 'its long, low body, very short legs and very tall upright ears';
const CAT_PROP = 'its slim body, long legs, small ears and the tail held up in an S above the head';

const corgi = (view) => `Character reference image for an original video game: ${F.corgiBody} ${F.stance} ${F.corgiArmour} ${F.rifle} ${view} ${F.style} ${F.sheet} ${F.neg}`;

// One input image (the condition render): sent as `image`, so the prompt calls it "the input image".
const fromPlaceholder = (who) =>
  `The input image is a crude, blocky 3D placeholder render of this character. Redraw it as the finished character ` +
  `design, keeping exactly the same camera angle, pose, framing and body proportions as the input image (${who}) and the same ` +
  `placement of the vest, chest shield, collar and rifle. Replace the primitive shapes with natural anatomy, real fur ` +
  `and real armour. The character: `;

// W15 patch (independent check FAIL: corgi proportions, cat coat): edits from [kept image, proportion guide]. The guide
// is a crude warp of the kept image (tools/art/w15-guide.py, specs in tools/art/w15-guides.json); it carries the target
// proportions only. Everything else must stay as in the kept image.
const KEEP_ALL =
  'Keep everything else exactly as in <IMAGE_0>: the same camera angle, pose and framing, the same fur colours and ' +
  'markings, face and closed mouth, the same vest colour and ochre trims, chest shield, collar, leather straps, the same ' +
  'rifle on the same right-shoulder mount, the same lighting and the plain flat mid-grey background.';
const PATCH_TAIL =
  'Stylised-realistic, high-end game character quality: photographic fur and real painted steel. Not a cartoon, no ink ' +
  'outlines. No text, no letters, no logos, no insignia, no watermark. One animal only.';
const corgiBodyEars =
  '<IMAGE_0> is the finished character reference. <IMAGE_1> is a rough proportion guide made by stretching <IMAGE_0>: it ' +
  'shows the required proportions only (its seams and repeated vest panels are artefacts, not design). Redraw <IMAGE_0> ' +
  'with the proportions of <IMAGE_1>: a much longer, low, barrel-shaped torso, the body from rump to chest about twice ' +
  'as long as the height of the back, on the same very short legs; and much taller upright ears, each ear about one and ' +
  'a half times as tall as the head, the ear tips far above the head. The cobalt-blue barding vest grows with the longer ' +
  'torso and covers most of the back and flanks between its ochre trims, one continuous smooth vest with no seams or ' +
  `repeated panels. ${KEEP_ALL} ${PATCH_TAIL}`;
const corgiEars =
  '<IMAGE_0> is the finished character reference. <IMAGE_1> is a rough proportion guide made from <IMAGE_0> by ' +
  'stretching its ears: it shows the required ear size only. Redraw <IMAGE_0> with the ears of <IMAGE_1>: tall, broad, ' +
  'upright, pointed corgi ears, each ear about one and a half times as tall as the head, taller than the whole head from ' +
  'crown to chin, with warm tan fur outside and cream fur inside and no seams. ' + `${KEEP_ALL} ${PATCH_TAIL}`;

// attempt 2 for the ear-only views: the guide alone (its ears already at the target size), cleaned up in place
const corgiEarsRefine =
  'This image is a finished character reference whose ears were enlarged by a rough stretch. Re-render the two ears as ' +
  'natural corgi ears with real fur (warm tan outside, cream inside, soft edges) at EXACTLY the size, height and shape ' +
  'they have here: the ear tips stay exactly where they are, each ear stays about one and a half times as tall as the ' +
  'head. Change nothing else: the same camera, pose, framing, head, face and closed mouth, fur, the blue vest, chest ' +
  `shield, collar, straps, the rifle and its mount, the lighting and the plain mid-grey background. ${PATCH_TAIL}`;

const CAT_COAT =
  'a cool blue-grey tabby coat: base #7d8591, a cool slate grey with a slight blue cast, with darker blue-grey tabby ' +
  'stripes, and a pale cool grey chest, muzzle and inner legs (#d9dde3); no warm brown, beige or taupe anywhere in the fur';
const catCombined =
  '<IMAGE_0> is the finished character reference. <IMAGE_1> is a rough guide made by editing <IMAGE_0>: it shows the ' +
  'required coat colour and proportions only (its smears, streaks and seams are artefacts, not design). Redraw ' +
  `<IMAGE_0> with ${CAT_COAT}; the long tail held higher in its S-curve as in <IMAGE_1>, its tip the highest point of ` +
  'the cat, nearly twice the height of the back above the ground; the head carried higher on a slightly longer neck as ' +
  'in <IMAGE_1>, the ear tips about one and a half times the height of the back. Keep everything else exactly as in ' +
  '<IMAGE_0>: the camera, pose and framing, face, eyes and closed mouth, the dark crimson vest with its ochre band and ' +
  'trims, the square split chest shield, the crimson collar, the leather straps, the same rifle on the same ' +
  `right-shoulder mount, the lighting and the plain flat mid-grey background. ${PATCH_TAIL}`;
const catCoat =
  `Recolour only the cat's fur in this image to ${CAT_COAT}. Keep everything else exactly the same: the composition, ` +
  'framing, pose, face, eyes and closed mouth, the dark crimson vest with its ochre band, the chest shield, collar, ' +
  `leather straps, the rifle and its mount, the lighting and the background. ${PATCH_TAIL}`;
const catCoatNight =
  `Recolour only the cat's fur in this image to ${CAT_COAT}; under the night lights it still reads as a cool ` +
  'blue-grey cat, not a brown one. Keep everything else exactly the same: the composition, the wet night yard, the ' +
  'sodium lamp and its glints, the rain, the puddles, the cat\'s pose, face and closed mouth, the vest, chest shield, ' +
  `collar, straps and rifle. ${PATCH_TAIL}`;

const catRefine =
  'This image is a finished character reference whose tail and head were moved by a rough edit. Re-render it cleanly ' +
  'with EXACTLY these proportions and positions: the long striped tail held up in its S-curve with the tip exactly ' +
  'where it is here (the highest point of the cat), the head and ears exactly as high as they are here on a smooth, ' +
  `natural neck; remove every smear, streak, seam and doubled edge. The fur stays ${CAT_COAT}. Keep everything else ` +
  'exactly the same: the camera, pose and framing, face, eyes and closed mouth, the dark crimson vest with its ochre ' +
  'band and trims, the square split chest shield, the crimson collar, the leather straps, the same rifle on the same ' +
  `right-shoulder mount, the lighting and the plain flat mid-grey background. ${PATCH_TAIL}`;

export const PROMPTS = {
  cat_patch_refine: catRefine,
  cat_patch_combined: catCombined,
  cat_patch_coat: catCoat,
  cat_patch_coat_night: catCoatNight,
  corgi_patch_body_ears: corgiBodyEars,
  corgi_patch_ears_refine: corgiEarsRefine,
  corgi_patch_ears: corgiEars,
  // masters (front three-quarter): text only (t2i), image to image from the condition render (i2i), then the v2 prompt
  corgi_master_t2i: corgi(F.view34),
  corgi_master_i2i: fromPlaceholder('the long, low body, the very short legs, the tall upright ears') + corgi(F.view34),
  corgi_master_i2i_v2: fromPlaceholder2('the long, low body, the very short legs, the very tall upright ears') + corgi2(F.view34),
  cat_master_i2i_v2: fromPlaceholder2('the slim body, the long legs, the small ears, the tail up in an S above the head') + cat2(F.view34),
  // proportion passes on a chosen master (the placeholder's exaggerated range cues; the model drifts to natural sizes)
  corgi_fix_ears:
    'Edit this image. Make both ears much bigger: tall, broad, upright, pointed ears, each ear clearly taller than the ' +
    'whole head (about one and a half times the height of the head, like a fennec fox\'s ears), still corgi ears with ' +
    'warm tan fur outside and cream fur inside. Keep everything else exactly the same: the pose, the camera angle, the ' +
    'body and its proportions, the coat, the blue vest, the chest shield, the collar, the rifle and its mount, the ' +
    'lighting and the plain grey background. Photographic realism; no text.',
  cat_fix_tail:
    'Edit this image. Reshape the tail into a clear S-shaped curve held high: from its base it rises up and back, ' +
    'bends forward in the middle, then curls back at the tip, and the tip is the highest point of the whole cat, well ' +
    'above the head. The tail stays a long, striped grey tabby tail. Keep everything else exactly the same: the pose, ' +
    'the camera angle, the body and long legs, the coat, the crimson vest with its ochre band, the chest shield, the ' +
    'collar, the rifle and its mount, the lighting and the plain grey background. Photographic realism; no text.',
  corgi_view_right: fromMaster(V.right, CORGI_PROP),
  corgi_view_front: fromMaster(V.front, CORGI_PROP),
  corgi_view_back: fromMaster(V.back, CORGI_PROP),
  cat_view_right: fromMaster(V.right, CAT_PROP),
  cat_view_front: fromMaster(V.front, CAT_PROP),
  cat_view_back: fromMaster(V.back, CAT_PROP),
  corgi_turnaround: turnaround(CORGI_PROP),
  corgi_detail_head: detail('a straight front view', D.corgiHead),
  corgi_detail_armour: detail('a straight front view', D.corgiArmour),
  corgi_detail_rifle: detail('a right side view', D.rifle),
  cat_detail_head: detail('a straight front view', D.catHead),
  cat_detail_armour: detail('a straight front view', D.catArmour),
  cat_detail_rifle: detail('a right side view', D.rifle),
  corgi_insitu_night: inSitu('standing alert on all four legs'),
  cat_insitu_night: inSitu('standing alert on all four legs, its tail held up high in an S'),
};

const COND = 'assets/incoming/w15-char-refs/condition';

// endpoint: 'generations' (text to image) or 'edits' (image to image; `images` are sent in order as <IMAGE_0>, ...).
export const JOBS = {
  probe_corgi_master_t2i_v1: { prompt: 'corgi_master_t2i', model: 'grok-imagine-image', endpoint: 'generations', n: 1, aspect_ratio: '4:3', resolution: '1k' },
  // master variants: text only vs image to image from the condition render, on both image models
  corgi_master_t2i_v2low: { prompt: 'corgi_master_t2i', model: 'grok-imagine-image-2.0', endpoint: 'generations', n: 2, aspect_ratio: '4:3', resolution: '1k', quality: 'low' },
  corgi_master_i2i_v2low: { prompt: 'corgi_master_i2i', model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2, resolution: '1k', quality: 'low', images: [`${COND}/corgi_threequarter.png`] },
  corgi_master_i2i_v1: { prompt: 'corgi_master_i2i', model: 'grok-imagine-image', endpoint: 'edits', n: 2, resolution: '1k', images: [`${COND}/corgi_threequarter.png`] },
  // v2 prompt on the tight 4:3 condition frame; low vs medium quality on the same prompt
  corgi_master_fit_low: { prompt: 'corgi_master_i2i_v2', model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2, resolution: '1k', quality: 'low', images: [`${COND}/corgi_threequarter_fit.png`] },
  corgi_master_fit_med: { prompt: 'corgi_master_i2i_v2', model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2, resolution: '1k', quality: 'medium', images: [`${COND}/corgi_threequarter_fit.png`] },
  cat_master_fit_med: { prompt: 'cat_master_i2i_v2', model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 3, resolution: '1k', quality: 'medium', images: [`${COND}/cat_threequarter_fit.png`] },
  corgi_master_ears: { prompt: 'corgi_fix_ears', model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2, resolution: '1k', quality: 'medium', images: ['raw:c006_0_corgi_master_fit_med.jpg'] },
  cat_master_tail: { prompt: 'cat_fix_tail', model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2, resolution: '1k', quality: 'medium', images: ['raw:c007_0_cat_master_fit_med.jpg'] },
  // views: A (one view per call) vs B (one turnaround sheet), cheap test on the corgi
  corgi_view_right_A: { prompt: 'corgi_view_right', model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2, resolution: '1k', quality: 'low', aspect_ratio: '4:3', images: ['raw:c008_1_corgi_master_ears.jpg', `${COND}/corgi_right_fit.png`] },
  corgi_turnaround_B: { prompt: 'corgi_turnaround', model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2, resolution: '1k', quality: 'low', aspect_ratio: '5:2', images: ['raw:c008_1_corgi_master_ears.jpg', `${COND}/corgi_turnaround.png`] },
  // committed: A, one view per call from [master, fit render], medium quality
  ...views('corgi', 'raw:c008_1_corgi_master_ears.jpg'),
  ...views('cat', 'raw:c009_0_cat_master_tail.jpg'),
};

// details: [master, the chosen view] at medium 1.5k
const PICK = {
  corgi: { master: 'raw:c008_1_corgi_master_ears.jpg', front: 'raw:c012_0_corgi_view_front_med.jpg', right: 'raw:c013_0_corgi_view_right_med.jpg' },
  cat: { master: 'raw:c009_0_cat_master_tail.jpg', front: 'raw:c015_1_cat_view_front_med.jpg', right: 'raw:c016_0_cat_view_right_med.jpg' },
};
for (const who of ['corgi', 'cat']) {
  const p = PICK[who];
  JOBS[`${who}_detail_head_med`] = { prompt: `${who}_detail_head`, model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2, resolution: '1.5k', quality: 'medium', aspect_ratio: '1:1', images: [p.master, p.front] };
  JOBS[`${who}_detail_armour_med`] = { prompt: `${who}_detail_armour`, model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2, resolution: '1.5k', quality: 'medium', aspect_ratio: '4:3', images: [p.master, p.front] };
  JOBS[`${who}_detail_rifle_med`] = { prompt: `${who}_detail_rifle`, model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2, resolution: '1.5k', quality: 'medium', aspect_ratio: '4:3', images: [p.master, p.right] };
}

for (const who of ['corgi', 'cat']) {
  JOBS[`${who}_insitu_night_med`] = { prompt: `${who}_insitu_night`, model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2, resolution: '1.5k', quality: 'medium', aspect_ratio: '16:9', images: [PICK[who].master] };
}

// W15 patch jobs: medium, 1.5k, n=2, [kept raw image, guide]
const PATCH = (prompt, kept, guide, aspect) => ({ prompt, model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2,
  resolution: '1.5k', quality: 'medium', aspect_ratio: aspect, images: [`raw:${kept}`, `guide:${guide}`] });
Object.assign(JOBS, {
  corgi_patch_side: PATCH('corgi_patch_body_ears', 'c013_0_corgi_view_right_med.jpg', 'corgi_side.png', '4:3'),
  corgi_patch_master: PATCH('corgi_patch_body_ears', 'c008_1_corgi_master_ears.jpg', 'corgi_master.png', '4:3'),
  corgi_patch_front: PATCH('corgi_patch_ears', 'c012_0_corgi_view_front_med.jpg', 'corgi_front.png', '3:4'),
  corgi_patch_back: PATCH('corgi_patch_ears', 'c014_0_corgi_view_back_med.jpg', 'corgi_back.png', '3:4'),
  corgi_patch_head: PATCH('corgi_patch_ears', 'c018_1_corgi_detail_head_med.jpg', 'corgi_head.png', '1:1'),
});
Object.assign(JOBS, {
  cat_patch_master: PATCH('cat_patch_combined', 'c009_0_cat_master_tail.jpg', 'cat_master.png', '4:3'),
  cat_patch_side: PATCH('cat_patch_combined', 'c016_0_cat_view_right_med.jpg', 'cat_side.png', '4:3'),
  cat_patch_front: PATCH('cat_patch_combined', 'c015_1_cat_view_front_med.jpg', 'cat_front.png', '3:4'),
  cat_patch_back: PATCH('cat_patch_combined', 'c017_0_cat_view_back_med.jpg', 'cat_back.png', '3:4'),
});
const CAT_REFINE = (guide, aspect) => ({ prompt: 'cat_patch_refine', model: 'grok-imagine-image-2.0', endpoint: 'edits',
  n: 2, resolution: '1.5k', quality: 'medium', aspect_ratio: aspect, images: [`guide:${guide}`] });
Object.assign(JOBS, {
  cat_patch2_side: CAT_REFINE('cat_side.png', '4:3'),
  cat_patch2_master: CAT_REFINE('cat_master.png', '4:3'),
  cat_patch2_front: CAT_REFINE('cat_front.png', '3:4'),
  cat_patch2_back: CAT_REFINE('cat_back.png', '3:4'),
});
const COAT = (prompt, kept, aspect) => ({ prompt, model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2,
  resolution: '1.5k', quality: 'medium', aspect_ratio: aspect, images: [`raw:${kept}`] });
Object.assign(JOBS, {
  cat_coat_head: COAT('cat_patch_coat', 'c021_1_cat_detail_head_med.jpg', '1:1'),
  cat_coat_armour: COAT('cat_patch_coat', 'c022_0_cat_detail_armour_med.jpg', '4:3'),
  cat_coat_rifle: COAT('cat_patch_coat', 'c023_0_cat_detail_rifle_med.jpg', '4:3'),
  cat_coat_insitu: COAT('cat_patch_coat_night', 'c025_0_cat_insitu_night_med.jpg', '16:9'),
});
const REFINE = (guide, aspect) => ({ prompt: 'corgi_patch_ears_refine', model: 'grok-imagine-image-2.0', endpoint: 'edits',
  n: 2, resolution: '1.5k', quality: 'medium', aspect_ratio: aspect, images: [`guide:${guide}`] });
Object.assign(JOBS, {
  corgi_patch2_front: REFINE('corgi_front.png', '3:4'),
  corgi_patch2_back: REFINE('corgi_back.png', '3:4'),
  corgi_patch2_head: REFINE('corgi_head.png', '1:1'),
});

function views(who, master) {
  const out = {};
  for (const [v, aspect] of [['front', '3:4'], ['right', '4:3'], ['back', '3:4']]) {
    out[`${who}_view_${v}_med`] = { prompt: `${who}_view_${v}`, model: 'grok-imagine-image-2.0', endpoint: 'edits', n: 2, resolution: '1.5k', quality: 'medium', aspect_ratio: aspect, images: [master, `${COND}/${who}_${v}_fit.png`] };
  }
  return out;
}
