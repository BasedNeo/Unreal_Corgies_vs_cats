// P2: a cosmetics fixture in C3's shape (COSMETICS { id, slot, species, name, unlock }) for the profile tests.
import type { CosmeticLike } from '../../src/client/profile/unlocks';

export const FIXTURE: CosmeticLike[] = [
  { id: 'coat_red', slot: 'coat', species: 'corgi', name: 'Red', unlock: { kind: 'default' } },
  { id: 'coat_tricolor', slot: 'coat', species: 'corgi', name: 'Tricolor', unlock: { kind: 'level', level: 2 } },
  { id: 'coat_merle', slot: 'coat', species: 'corgi', name: 'Merle', unlock: { kind: 'medal', chapter: 'garage_job', medal: 'gold' } },
  { id: 'coat_tabby', slot: 'coat', species: 'cat', name: 'Tabby', unlock: { kind: 'default' } },
  { id: 'coat_tuxedo', slot: 'coat', species: 'cat', name: 'Tuxedo', unlock: { kind: 'level', level: 4 } },
  { id: 'coat_calico', slot: 'coat', species: 'cat', name: 'Calico', unlock: { kind: 'firstWin', mode: 'core-rush' } },
  { id: 'neck_none', slot: 'neck', species: 'both', name: 'None', unlock: { kind: 'default' } },
  { id: 'neck_bandana', slot: 'neck', species: 'both', name: 'Bandana', unlock: { kind: 'level', level: 3 } },
  { id: 'neck_bowtie', slot: 'neck', species: 'both', name: 'Bow Tie', unlock: { kind: 'medal', chapter: 'yard_day', medal: 'silver' } },
  { id: 'taunt_corgi', slot: 'taunt', species: 'corgi', name: 'Good Boy', unlock: { kind: 'default' } },
  { id: 'taunt_cat', slot: 'taunt', species: 'cat', name: 'Aloof', unlock: { kind: 'default' } },
  { id: 'taunt_zoomies', slot: 'taunt', species: 'corgi', name: 'Zoomies', unlock: { kind: 'firstWin', mode: 'team-deathmatch' } },
];
