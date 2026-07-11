extends SceneTree

const PolicyScript := preload("res://scripts/ResponseContextPolicy.gd")

var failures: Array = []

func _init() -> void:
	var resident := { "actorId": "qinglan:resident" }
	var location := { "locationId": "market_tea_stall" }
	var base := {
		"worldId": "world_context",
		"actorTile": { "x": 12.0, "y": 13.0 },
		"target": resident,
		"currentLocation": location,
	}

	_assert(
		PolicyScript.capabilities_match(
			base,
			"world_context",
			resident,
			location,
			Vector2(12.0, 13.0),
			true
		),
		"matching capability context is accepted"
	)
	var stale_tile: Dictionary = base.duplicate(true)
	stale_tile["actorTile"] = { "x": 20.0, "y": 20.0 }
	_assert(
		not PolicyScript.capabilities_match(
			stale_tile,
			"world_context",
			resident,
			location,
			Vector2(12.0, 13.0),
			true
		),
		"stale actor tile is rejected"
	)
	var stale_target: Dictionary = base.duplicate(true)
	stale_target["target"] = { "actorId": "qinglan:other" }
	_assert(
		not PolicyScript.capabilities_match(
			stale_target,
			"world_context",
			resident,
			location,
			Vector2(12.0, 13.0),
			true
		),
		"stale target is rejected"
	)
	var stale_location: Dictionary = base.duplicate(true)
	stale_location["currentLocation"] = { "locationId": "market_west_gate" }
	_assert(
		not PolicyScript.capabilities_match(
			stale_location,
			"world_context",
			resident,
			location,
			Vector2(12.0, 13.0),
			true
		),
		"stale semantic location is rejected"
	)

	_assert(
		PolicyScript.actor_context_matches(
			{ "worldId": "world_context", "actorId": "qinglan:resident" },
			"world_context",
			resident
		),
		"matching actor context is accepted"
	)
	_assert(
		not PolicyScript.actor_context_matches(
			{ "worldId": "other_world", "actorId": "qinglan:resident" },
			"world_context",
			resident
		),
		"cross-world actor context is rejected"
	)
	_assert(
		PolicyScript.replay_trace_matches(
			{ "worldId": "world_context", "actorId": "qinglan:resident" },
			"world_context",
			resident
		),
		"matching replay actor is accepted"
	)
	_assert(
		not PolicyScript.replay_trace_matches(
			{ "worldId": "world_context", "actorId": "qinglan:other" },
			"world_context",
			resident
		),
		"stale replay actor is rejected"
	)

	if failures.is_empty():
		print("Godot response context policy check passed.")
		quit(0)
	else:
		for failure in failures:
			push_error(str(failure))
		quit(1)

func _assert(condition: bool, message: String) -> void:
	if not condition:
		failures.append(message)
