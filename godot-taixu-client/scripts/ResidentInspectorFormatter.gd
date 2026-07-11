extends RefCounted
class_name ResidentInspectorFormatter

func render_selected_detail(
	resident: Dictionary,
	actor_context: Dictionary,
	locations: Array,
	now_ms: float
) -> String:
	if resident.is_empty():
		return ""

	var tile := dict_tile(resident.get("tile", {}))
	var target_tile := dict_tile(resident.get("targetTile", {}))
	var final_tile := dict_tile(resident.get("finalTargetTile", {}))
	var current_location_id := str(resident.get("locationId", ""))
	var waypoint_id := str(resident.get("waypointId", "?"))
	var status := str(resident.get("status", "?"))
	var activity := str(resident.get("activityLabel", status))
	var intent := str(resident.get("intent", ""))
	var next_text := next_action_text(resident.get("nextActionAt", null), now_ms)
	var lines := [
		"Activity: %s (%s) | place %s | waypoint %s | next %s" % [
			activity,
			status,
			location_name(locations, current_location_id),
			waypoint_id,
			next_text
		],
		"Intent: " + short_text(intent if intent != "" else "?", 88),
		"Route: %s -> %s -> %s" % [
			tile_text(tile),
			tile_text(target_tile),
			tile_text(final_tile)
		]
	]
	var schedule_detail := schedule_preview_detail(resident, now_ms)
	if schedule_detail != "":
		lines.append(schedule_detail)
	var schedule_route_text := schedule_route_detail(resident)
	if schedule_route_text != "":
		lines.append(schedule_route_text)
	var route_detail := route_preview_detail(resident)
	if route_detail != "":
		lines.append(route_detail)
	if not actor_context.is_empty():
		lines.append(profile_context_text(actor_context))
		lines.append(relationship_context_text(actor_context))
		var recent_text := recent_context_text(actor_context)
		if recent_text != "":
			lines.append(recent_text)
	return "\n".join(lines)

func schedule_preview_detail(resident: Dictionary, now_ms: float) -> String:
	var route_preview = resident.get("routePreview", {})
	if typeof(route_preview) != TYPE_DICTIONARY:
		return ""
	var schedule = route_preview.get("schedulePreview", {})
	if typeof(schedule) != TYPE_DICTIONARY or schedule.is_empty():
		return ""
	var summary := str(schedule.get("summary", ""))
	var phase := str(schedule.get("phase", ""))
	var destination := str(schedule.get("destinationLabel", ""))
	var next_text := next_action_text(schedule.get("nextActionAt", null), now_ms)
	if summary == "":
		summary = str(schedule.get("activityLabel", "?"))
	if destination != "":
		return "Schedule: %s | %s -> %s | next %s" % [
			short_text(summary, 66),
			phase,
			destination,
			next_text
		]
	return "Schedule: %s | %s | next %s" % [
		short_text(summary, 72),
		phase,
		next_text
	]

func schedule_route_detail(resident: Dictionary) -> String:
	var route_preview = resident.get("routePreview", {})
	if typeof(route_preview) != TYPE_DICTIONARY:
		return ""
	var schedule_route = route_preview.get("scheduleRoute", {})
	if typeof(schedule_route) != TYPE_DICTIONARY or schedule_route.is_empty():
		return ""
	var summary := str(schedule_route.get("summary", ""))
	var source := str(schedule_route.get("source", ""))
	var route_count := int(schedule_route.get("routeCount", 0))
	var current_index := int(schedule_route.get("currentIndex", 0)) + 1
	var next_stop = schedule_route.get("nextStop", {})
	var next_label := "?"
	if typeof(next_stop) == TYPE_DICTIONARY:
		next_label = str(next_stop.get("label", "?"))
	var upcoming_labels := schedule_route_stop_labels(schedule_route.get("upcomingStops", []), 3)
	var text := "Loop: %d/%d -> %s" % [
		current_index,
		maxi(route_count, 1),
		next_label
	]
	if summary != "":
		text += " | " + short_text(summary, 62)
	if not upcoming_labels.is_empty():
		text += " | next " + " / ".join(upcoming_labels)
	if source != "":
		text += " | " + source
	return text

func schedule_route_stop_labels(value: Variant, limit: int) -> Array:
	var labels := []
	if typeof(value) != TYPE_ARRAY:
		return labels
	for raw_stop in value:
		if labels.size() >= limit:
			break
		if typeof(raw_stop) != TYPE_DICTIONARY:
			continue
		var stop: Dictionary = raw_stop
		var label := str(stop.get("label", ""))
		if label != "":
			labels.append(label)
	return labels

func route_preview_detail(resident: Dictionary) -> String:
	var route_preview = resident.get("routePreview", {})
	if typeof(route_preview) != TYPE_DICTIONARY or route_preview.is_empty():
		return ""
	var waypoint_label := str(route_preview.get("waypointLabel", route_preview.get("label", "")))
	var length_tiles := float(route_preview.get("lengthTiles", 0.0))
	var remaining_tiles := float(route_preview.get("remainingTiles", length_tiles))
	var eta_seconds := float(route_preview.get("etaSeconds", 0.0))
	var eta_label := str(route_preview.get("etaLabel", ""))
	if eta_label == "":
		eta_label = "%.1fs" % eta_seconds
	var path_steps := int(route_preview.get("pathStepCount", 0))
	var next_step_distance := float(route_preview.get("nextStepDistanceTiles", 0.0))
	var route_summary := str(route_preview.get("routeSummary", ""))
	var source := str(route_preview.get("source", ""))
	var next_tile := dict_tile(route_preview.get("nextTile", {}))
	var next_step := str(route_preview.get("nextStepLabel", ""))
	var movement_state := str(route_preview.get("movementState", ""))
	var status := str(route_preview.get("status", "?"))
	var prefix := "Preview"
	if route_summary != "":
		prefix = "Preview: " + short_text(route_summary, 68)
	elif waypoint_label != "":
		prefix = "Preview: " + waypoint_label
	return "%s | %.1f left of %.1f tiles | ETA %s | steps %d | next %s %s %.1f tiles | %s/%s" % [
		prefix,
		remaining_tiles,
		length_tiles,
		eta_label,
		path_steps,
		next_step if next_step != "" else "?",
		tile_text(next_tile),
		next_step_distance,
		movement_state if movement_state != "" else "?",
		status
	] + (" via " + source if source != "" else "")

func profile_context_text(context: Dictionary) -> String:
	var profile = context.get("profile", {})
	if typeof(profile) != TYPE_DICTIONARY or profile.is_empty():
		return "Profile: not initialized | actions can create a durable profile"
	var realm := str(profile.get("realm", "?"))
	var stage := str(profile.get("realmStage", "?"))
	var health := field_text(profile, "health")
	var spirit := field_text(profile, "spirit")
	var reputation := field_text(profile, "reputation")
	var inventory_count := field_text(profile, "inventoryCount")
	return "Profile: %s %s | hp %s spirit %s rep %s | items %s" % [
		realm,
		stage,
		health,
		spirit,
		reputation,
		inventory_count
	]

func relationship_context_text(context: Dictionary) -> String:
	var relationship = context.get("relationship", {})
	if typeof(relationship) != TYPE_DICTIONARY:
		return "Relation: ?"
	var viewer = relationship.get("viewerToActor", {})
	if typeof(viewer) != TYPE_DICTIONARY:
		viewer = {}
	var actor = relationship.get("actorToViewer", null)
	if typeof(actor) != TYPE_DICTIONARY:
		return "Relation: you->them aff %d trust %d susp %d | them->you hidden" % [
			int(viewer.get("affinity", 0)),
			int(viewer.get("trust", 0)),
			int(viewer.get("suspicion", 0))
		]
	return "Relation: you->them aff %d trust %d susp %d | them->you aff %d trust %d susp %d" % [
		int(viewer.get("affinity", 0)),
		int(viewer.get("trust", 0)),
		int(viewer.get("suspicion", 0)),
		int(actor.get("affinity", 0)),
		int(actor.get("trust", 0)),
		int(actor.get("suspicion", 0))
	]

func recent_context_text(context: Dictionary) -> String:
	var actions = context.get("recentActions", [])
	if typeof(actions) == TYPE_ARRAY and not actions.is_empty() and typeof(actions[0]) == TYPE_DICTIONARY:
		var action: Dictionary = actions[0]
		var trace := short_id(str(action.get("actionRecordId", action.get("id", ""))))
		var world_event_id := str(action.get("worldEventId", ""))
		if world_event_id != "":
			trace += "->" + short_id(world_event_id)
		var text := display_text(action, str(action.get("reason", "")))
		if text == "":
			text = "%s/%s" % [
				str(action.get("type", "?")),
				str(action.get("resultCode", "?"))
			]
		return "Recent action: %s | %s" % [
			trace,
			short_text(text, 78)
		]
	var memories = context.get("memories", [])
	if typeof(memories) == TYPE_ARRAY and not memories.is_empty() and typeof(memories[0]) == TYPE_DICTIONARY:
		return "Memory: " + short_text(str(memories[0].get("summary", "")), 92)
	var events = context.get("recentEvents", [])
	if typeof(events) == TYPE_ARRAY and not events.is_empty() and typeof(events[0]) == TYPE_DICTIONARY:
		return "Recent: " + short_text(display_text(events[0], ""), 92)
	return ""

func field_text(source: Dictionary, key: String) -> String:
	return str(source.get(key)) if source.has(key) else "?"

func location_name(locations: Array, location_id: String) -> String:
	if location_id == "":
		return "?"
	for location in locations:
		if typeof(location) == TYPE_DICTIONARY and str(location.get("locationId", "")) == location_id:
			return str(location.get("name", location_id))
	return location_id

func dict_tile(value) -> Vector2:
	if typeof(value) != TYPE_DICTIONARY:
		return Vector2(INF, INF)
	return Vector2(float(value.get("x", INF)), float(value.get("y", INF)))

func tile_text(tile: Vector2) -> String:
	if is_inf(tile.x) or is_inf(tile.y):
		return "?,?"
	return "%.1f,%.1f" % [tile.x, tile.y]

func next_action_text(value, now_ms: float) -> String:
	if typeof(value) != TYPE_FLOAT and typeof(value) != TYPE_INT:
		return "?"
	var remaining := (float(value) - now_ms) / 1000.0
	if remaining <= 0.0:
		return "ready"
	return "~%ds" % int(ceil(remaining))

func display_text(source, fallback: String = "") -> String:
	if typeof(source) != TYPE_DICTIONARY:
		return fallback
	var text := str(source.get("displayText", ""))
	if text != "":
		return text
	text = str(source.get("bubbleText", ""))
	if text != "":
		return text
	return str(source.get("summary", fallback))

func short_text(text: String, max_chars: int) -> String:
	if text.length() <= max_chars:
		return text
	return text.substr(0, max_chars - 1) + "..."

func short_id(value: String) -> String:
	if value == "":
		return "?"
	return value.substr(0, min(8, value.length()))
