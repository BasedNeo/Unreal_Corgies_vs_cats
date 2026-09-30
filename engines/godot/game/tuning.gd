extends RefCounted
## Tuning for the Godot game (lane G-GAME). Numbers are copied from the TS game so the web and Godot feel related:
## movement from src/shared/content/classes.ts (BASE_MOVE, per species) and src/shared/constants.ts (GRAVITY),
## the rifle from src/shared/content/weapons.ts (squeaker_rifle), hit points from the assault class (maxHp 120).

const CORGI := 0
const CAT := 1
const TEAM_NAMES := ["CORGI COMPANY", "CAT CADRE"]
## Team signal colours: PALETTE.teamCorgis / teamCats in src/client/style/style-tokens.js.
const TEAM_COLORS := [Color("2f6fd6"), Color("c9344a")]
const TEAM_TRIM := [Color("f2c14e"), Color("2b2a33")]

const GRAVITY := 24.0  # constants.ts GRAVITY = -24
const MAX_FALL := 40.0
const MAX_HP := 120  # classes.ts assault.maxHp

## classes.ts BASE_MOVE. Capsule: radius + half height of the cylinder part (total = 2 * (half + radius)).
const MOVE := {
	0: {"walk": 3.6, "run": 6.4, "sprint": 9.6, "accel": 70.0, "air": 22.0, "decel": 50.0, "jump": 8.4,
		"fall_scale": 1.55, "coyote": 0.12, "buffer": 0.12, "radius": 0.36, "half": 0.24},
	1: {"walk": 3.8, "run": 6.6, "sprint": 8.8, "accel": 75.0, "air": 26.0, "decel": 55.0, "jump": 9.4,
		"fall_scale": 1.45, "coyote": 0.14, "buffer": 0.12, "radius": 0.33, "half": 0.3},
}

## weapons.ts squeaker_rifle (Corgi name) / Hairball Repeater (Cat name).
const RIFLE := {
	"name": ["Squeaker Rifle", "Hairball Repeater"],
	"damage": 15.0, "head_mult": 1.6, "fire_rate": 10.0, "mag": 30, "reload": 1.6,
	"spread_hip": deg_to_rad(1.2), "spread_aim": deg_to_rad(0.35), "move_mult": 1.5, "air_mult": 2.2,
	"bloom_per_shot": deg_to_rad(0.16), "bloom_max": deg_to_rad(1.6), "bloom_recover": deg_to_rad(8.0),
	"recoil_pitch": deg_to_rad(0.55), "recoil_yaw": deg_to_rad(0.35), "recoil_recover": 0.12,
	"range": 90.0, "falloff_start": 24.0, "falloff_end": 48.0, "falloff_min": 0.6,
	"ai_range": [7.0, 24.0], "noise": 38.0,
}

## Match rules (owner brief, Wave 12).
const WIN_SCORE := 60
const MATCH_TIME := 180.0
const OVERTIME_MAX := 60.0
const RESPAWN_TIME := 3.0
const SPAWN_SHIELD := 1.0

## Physics layers (README): 1 world, 2 pets, 3 hitboxes. Rifle rays hit 1 and 3.
const L_WORLD := 1
const L_PETS := 2
const L_HITBOX := 4
const RAY_MASK := L_WORLD | L_HITBOX

static func height(species: int) -> float:
	var m: Dictionary = MOVE[species]
	return 2.0 * (float(m.radius) + float(m.half))
