extends RefCounted

static func actor_context_matches(
	payload: Dictionary,
	world_id: String,
	selected_resident: Dictionary
) -> bool:
	if payload.is_empty() or selected_resident.is_empty():
		return false
	if not _world_matches(payload, world_id):
		return false
	return str(payload.get("actorId", "")) == str(selected_resident.get("actorId", ""))

static func replay_trace_matches(
	payload: Dictionary,
	world_id: String,
	selected_resident: Dictionary
) -> bool:
	if payload.is_empty() or not _world_matches(payload, world_id):
		return false
	var payload_actor = payload.get("actorId", null)
	var payload_actor_id := "" if payload_actor == null else str(payload_actor)
	var selected_actor_id := ""
	if not selected_resident.is_empty():
		selected_actor_id = str(selected_resident.get("actorId", ""))
	return payload_actor_id == selected_actor_id

static func capabilities_match(
	payload: Dictionary,
	world_id: String,
	selected_resident: Dictionary,
	current_location: Dictionary,
	actor_tile: Vector2,
	has_actor_tile: bool,
	tile_tolerance: float = 0.75
) -> bool:
	if payload.is_empty() or not _world_matches(payload, world_id):
		return false
	if has_actor_tile:
		var payload_tile = payload.get("actorTile", null)
		if typeof(payload_tile) == TYPE_DICTIONARY:
			var request_tile := Vector2(
				float(payload_tile.get("x", INF)),
				float(payload_tile.get("y", INF))
			)
			if request_tile.distance_to(actor_tile) > tile_tolerance:
				return false

	var selected_actor_id := ""
	if not selected_resident.is_empty():
		selected_actor_id = str(selected_resident.get("actorId", ""))
	var target = payload.get("target", null)
	if selected_actor_id == "":
		if typeof(target) == TYPE_DICTIONARY and str(target.get("actorId", "")) != "":
			return false
	else:
		if typeof(target) != TYPE_DICTIONARY:
			return false
		if str(target.get("actorId", "")) != selected_actor_id:
			return false

	var current = payload.get("currentLocation", null)
	if current_location.is_empty():
		if typeof(current) == TYPE_DICTIONARY and str(current.get("locationId", "")) != "":
			return false
	else:
		if typeof(current) != TYPE_DICTIONARY:
			return false
		if str(current.get("locationId", "")) != str(current_location.get("locationId", "")):
			return false

	return true

static func _world_matches(payload: Dictionary, world_id: String) -> bool:
	var payload_world_id := str(payload.get("worldId", ""))
	return payload_world_id == "" or payload_world_id == world_id
