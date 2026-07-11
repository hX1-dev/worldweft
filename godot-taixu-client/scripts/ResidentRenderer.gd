extends Node2D
class_name ResidentRenderer

signal resident_selected(resident: Dictionary)

const TILE_SIZE := 32.0
const RESIDENT_RADIUS := 9.0
const UI_FONT := preload("res://assets/fonts/NotoSansCJKsc-Regular.otf")

@export var resident_move_speed_tiles := 12.0
@export var bubble_lifetime_seconds := 9.0

var residents: Array = []
var locations: Array = []
var selected_actor_id := ""
var event_bubbles: Dictionary = {}
var location_event_bubbles: Dictionary = {}
var display_positions: Dictionary = {}
var target_positions: Dictionary = {}

func set_region(region_residents: Array, region_locations: Array) -> void:
	residents = region_residents
	locations = region_locations
	_update_resident_targets()
	queue_redraw()

func set_recent_events(events: Array) -> void:
	var seen_actors := {}
	var seen_locations := {}
	for event in events.slice(0, 6):
		if typeof(event) != TYPE_DICTIONARY:
			continue
		var summary := str(event.get("summary", ""))
		if summary == "":
			continue
		var bubble_text := str(event.get("bubbleText", summary))
		var bubble_kind := str(event.get("bubbleKind", "narration"))
		var event_id := str(event.get("id", summary))
		_add_event_bubbles(event.get("targetActorIds", []), bubble_text, event_id, seen_actors, bubble_kind)
		if event_bubbles.size() >= 6:
			break
		_add_event_bubbles(event.get("actorIds", []), bubble_text, event_id, seen_actors, bubble_kind)
		_add_location_event_bubble(str(event.get("locationId", "")), bubble_text, event_id, seen_locations, bubble_kind)
	_prune_unseen_bubbles(event_bubbles, seen_actors)
	_prune_unseen_bubbles(location_event_bubbles, seen_locations)
	queue_redraw()

func show_action_result(payload: Dictionary) -> void:
	var summary := str(payload.get("bubbleText", payload.get("summary", payload.get("reason", ""))))
	if summary == "":
		var result = payload.get("result", {})
		if typeof(result) == TYPE_DICTIONARY:
			summary = str(result.get("reason", ""))
	if summary == "":
		return
	var bubble_kind := str(payload.get("bubbleKind", "reaction"))

	var event_id := str(payload.get("eventId", payload.get("actionRecordId", summary)))
	var actor_ids = payload.get("actorIds", [])
	if typeof(actor_ids) != TYPE_ARRAY:
		actor_ids = []
	var target_actor_ids = payload.get("targetActorIds", [])
	if typeof(target_actor_ids) != TYPE_ARRAY:
		target_actor_ids = []

	var action = payload.get("action", {})
	if typeof(action) == TYPE_DICTIONARY:
		var actor_id := str(action.get("actorId", ""))
		if actor_id != "" and not actor_ids.has(actor_id):
			actor_ids.append(actor_id)
		var target_actor_id := str(action.get("targetActorId", ""))
		if target_actor_id != "" and not target_actor_ids.has(target_actor_id):
			target_actor_ids.append(target_actor_id)

	var seen_actors := {}
	_add_event_bubbles(target_actor_ids, summary, event_id, seen_actors, bubble_kind)
	_add_event_bubbles(actor_ids, summary, event_id, seen_actors, bubble_kind)

	var location_id := str(payload.get("locationId", ""))
	if location_id == "" and typeof(action) == TYPE_DICTIONARY:
		location_id = str(action.get("locationId", ""))
	if location_id != "":
		_add_location_event_bubble(location_id, summary, event_id, {}, bubble_kind)
	queue_redraw()

func _process(delta: float) -> void:
	var changed := _advance_resident_positions(delta)
	changed = _age_bubbles(delta) or changed
	if changed:
		queue_redraw()

func select_actor(actor_id: String) -> void:
	selected_actor_id = actor_id
	queue_redraw()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		var resident := resident_at_world_position(get_global_mouse_position())
		if not resident.is_empty():
			resident_selected.emit(resident)

func resident_at_world_position(world_pos: Vector2) -> Dictionary:
	for resident in residents:
		if typeof(resident) != TYPE_DICTIONARY:
			continue
		var pos := _resident_position(resident)
		if pos.distance_to(world_pos) <= 22.0:
			return resident
	return {}

func _draw() -> void:
	_draw_locations()
	_draw_residents()

func _draw_locations() -> void:
	var font := UI_FONT
	for location in locations:
		if typeof(location) != TYPE_DICTIONARY:
			continue
		var entry_points = location.get("entryPoints", [])
		if typeof(entry_points) != TYPE_ARRAY:
			continue
		var location_id := str(location.get("locationId", ""))
		var name := str(location.get("name", location.get("locationId", "location")))
		var anchor := Vector2.ZERO
		var has_anchor := false
		var drew_label := false
		for entry in entry_points:
			if typeof(entry) != TYPE_DICTIONARY:
				continue
			var pos := Vector2(float(entry.get("x", 0.0)), float(entry.get("y", 0.0))) * TILE_SIZE
			if not has_anchor:
				anchor = pos
				has_anchor = true
			draw_circle(pos, 8.0, Color(0.05, 0.68, 0.86, 0.52))
			draw_arc(pos, 8.0, 0.0, TAU, 20, Color(0.02, 0.2, 0.24, 0.92), 2.0)
			if font and not drew_label:
				draw_string(font, pos + Vector2(10, -8), name, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color(0.02, 0.17, 0.2))
				drew_label = true
		if has_anchor and location_event_bubbles.has(location_id):
			_draw_bubble(anchor + Vector2(0, 28), location_event_bubbles[location_id])

func _draw_residents() -> void:
	var font := UI_FONT
	for resident in residents:
		if typeof(resident) != TYPE_DICTIONARY:
			continue
		var pos := _resident_position(resident)
		var actor_id := str(resident.get("actorId", ""))
		var status := str(resident.get("status", "idle"))
		var fill := _status_color(status)
		var target_pos: Vector2 = target_positions.get(actor_id, pos)
		var final_pos := _final_target_position(resident, target_pos)
		var selected := actor_id == selected_actor_id
		_draw_route_preview(resident, selected)
		if target_pos.distance_to(pos) > 3.0:
			draw_line(pos, target_pos, Color(0.04, 0.5, 0.7, 0.42), 2.0)
			draw_circle(target_pos, 4.0, Color(0.04, 0.5, 0.7, 0.5))
		if final_pos.distance_to(pos) > TILE_SIZE * 0.75:
			_draw_dashed_line(pos, final_pos, Color(0.08, 0.3, 0.42, 0.28), 2.0)
			draw_circle(final_pos, 5.0, Color(0.08, 0.3, 0.42, 0.38))
		if selected:
			draw_circle(pos, RESIDENT_RADIUS + 9.0, Color(1.0, 0.95, 0.45, 0.75))
		draw_circle(pos, RESIDENT_RADIUS + 4.0, Color(0.0, 0.0, 0.0, 0.32))
		draw_circle(pos, RESIDENT_RADIUS, fill)
		draw_arc(pos, RESIDENT_RADIUS, 0.0, TAU, 24, Color(0.12, 0.06, 0.16, 0.95), 2.5)
		if font:
			var name := str(resident.get("name", actor_id))
			draw_string(font, pos + Vector2(12, -12), name, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color(0.07, 0.04, 0.1))
			var intent_label := resident_presence_label(resident)
			if intent_label != "":
				draw_string(font, pos + Vector2(12, 4), intent_label, HORIZONTAL_ALIGNMENT_LEFT, 170.0, 11, Color(0.07, 0.15, 0.16, 0.88))
		if event_bubbles.has(actor_id):
			_draw_bubble(pos, event_bubbles[actor_id])

func _resident_position(resident: Dictionary) -> Vector2:
	var actor_id := str(resident.get("actorId", ""))
	if actor_id != "" and display_positions.has(actor_id):
		return display_positions[actor_id]
	return _target_position_from_resident(resident)

func _target_position_from_resident(resident: Dictionary) -> Vector2:
	var tile = resident.get("tile", {})
	if typeof(tile) != TYPE_DICTIONARY:
		return Vector2.ZERO
	return Vector2(float(tile.get("x", 0.0)), float(tile.get("y", 0.0))) * TILE_SIZE

func _final_target_position(resident: Dictionary, fallback: Vector2) -> Vector2:
	var tile = resident.get("finalTargetTile", {})
	if typeof(tile) != TYPE_DICTIONARY:
		tile = resident.get("targetTile", {})
	if typeof(tile) != TYPE_DICTIONARY:
		return fallback
	return Vector2(float(tile.get("x", 0.0)), float(tile.get("y", 0.0))) * TILE_SIZE

func route_preview_points(resident: Dictionary) -> Array:
	var route_preview = resident.get("routePreview", {})
	if typeof(route_preview) != TYPE_DICTIONARY:
		return []
	var raw_path = route_preview.get("pathTiles", [])
	if typeof(raw_path) != TYPE_ARRAY or raw_path.size() < 2:
		return []
	var points: Array = []
	for raw_tile in raw_path:
		if typeof(raw_tile) != TYPE_DICTIONARY:
			continue
		points.append(_tile_value_to_position(raw_tile))
	return points

func schedule_route_markers(resident: Dictionary, limit: int = 4) -> Array:
	var route_preview = resident.get("routePreview", {})
	if typeof(route_preview) != TYPE_DICTIONARY:
		return []
	var schedule_route = route_preview.get("scheduleRoute", {})
	if typeof(schedule_route) != TYPE_DICTIONARY:
		return []
	var markers: Array = []
	var seen := {}
	_append_schedule_marker(markers, seen, schedule_route.get("currentStop", {}), "current", limit)
	var upcoming = schedule_route.get("upcomingStops", [])
	if typeof(upcoming) == TYPE_ARRAY:
		for raw_stop in upcoming:
			var kind := "upcoming"
			if typeof(raw_stop) == TYPE_DICTIONARY and int(raw_stop.get("offset", 0)) == 1:
				kind = "next"
			_append_schedule_marker(markers, seen, raw_stop, kind, limit)
			if markers.size() >= limit:
				break
	return markers

func _append_schedule_marker(markers: Array, seen: Dictionary, stop, kind: String, limit: int) -> void:
	if markers.size() >= limit or typeof(stop) != TYPE_DICTIONARY:
		return
	var stop_dict: Dictionary = stop
	var tile = stop_dict.get("tile", {})
	if typeof(tile) != TYPE_DICTIONARY or tile.is_empty():
		return
	var spot_id := str(stop_dict.get("spotId", stop_dict.get("label", "")))
	var key := spot_id + ":" + kind
	if seen.has(key):
		return
	seen[key] = true
	markers.append({
		"kind": kind,
		"spotId": spot_id,
		"label": str(stop_dict.get("label", spot_id)),
		"locationId": str(stop_dict.get("locationId", "")),
		"offset": int(stop_dict.get("offset", 0)),
		"position": _tile_value_to_position(tile),
	})

func _draw_route_preview(resident: Dictionary, selected: bool) -> void:
	var points := route_preview_points(resident)
	if points.size() < 2:
		return
	var color := Color(0.06, 0.38, 0.52, 0.34)
	var width := 2.0
	if selected:
		color = Color(0.0, 0.52, 0.66, 0.78)
		width = 3.2
	var previous: Vector2 = points[0]
	for index in range(1, points.size()):
		var current: Vector2 = points[index]
		if previous.distance_to(current) > 1.0:
			draw_line(previous, current, color, width)
			draw_circle(current, 3.5 if not selected else 5.0, Color(color.r, color.g, color.b, minf(color.a + 0.16, 0.86)))
		previous = current
	if selected:
		_draw_schedule_route_markers(resident)

func _draw_schedule_route_markers(resident: Dictionary) -> void:
	var markers := schedule_route_markers(resident, 4)
	if markers.is_empty():
		return
	var font := UI_FONT
	for marker in markers:
		if typeof(marker) != TYPE_DICTIONARY:
			continue
		var pos: Vector2 = marker.get("position", Vector2.ZERO)
		var kind := str(marker.get("kind", "upcoming"))
		var fill := _schedule_marker_color(kind)
		draw_circle(pos, 7.5, Color(0.02, 0.08, 0.09, 0.42))
		draw_circle(pos, 5.5, fill)
		draw_arc(pos, 5.5, 0.0, TAU, 18, Color(0.02, 0.08, 0.09, 0.82), 1.5)
		if font:
			var label := _short_text(str(marker.get("label", "")), 12)
			if kind == "next":
				label = "next " + label
			elif kind == "current":
				label = "now " + label
			draw_string(font, pos + Vector2(8, -7), label, HORIZONTAL_ALIGNMENT_LEFT, 130.0, 10, Color(0.02, 0.08, 0.09, 0.88))

func _schedule_marker_color(kind: String) -> Color:
	match kind:
		"current":
			return Color(1.0, 0.86, 0.28, 0.88)
		"next":
			return Color(0.08, 0.82, 0.86, 0.86)
		_:
			return Color(0.68, 0.9, 0.72, 0.68)

func _tile_value_to_position(value) -> Vector2:
	if typeof(value) != TYPE_DICTIONARY:
		return Vector2.ZERO
	return Vector2(float(value.get("x", 0.0)), float(value.get("y", 0.0))) * TILE_SIZE

func resident_presence_label(resident: Dictionary) -> String:
	var route_preview = resident.get("routePreview", {})
	var schedule := {}
	if typeof(route_preview) == TYPE_DICTIONARY:
		schedule = route_preview.get("schedulePreview", {})
	if typeof(schedule) != TYPE_DICTIONARY:
		schedule = {}

	var activity := str(schedule.get("activityLabel", resident.get("activityLabel", "")))
	if activity == "":
		activity = str(resident.get("activityLabel", ""))
	var destination := str(schedule.get("destinationLabel", ""))
	if destination == "" and typeof(route_preview) == TYPE_DICTIONARY:
		destination = str(route_preview.get("waypointLabel", ""))
	var phase := str(schedule.get("phase", ""))
	var movement_state := ""
	var eta_label := ""
	if typeof(route_preview) == TYPE_DICTIONARY:
		movement_state = str(route_preview.get("movementState", ""))
		eta_label = str(route_preview.get("etaLabel", ""))

	var label := ""
	if activity != "" and destination != "":
		if phase == "at_waypoint" or movement_state == "arrived":
			label = "%s @ %s" % [activity, destination]
		else:
			label = "%s -> %s" % [activity, destination]
			if eta_label != "":
				label += " " + eta_label
	if label == "":
		label = str(schedule.get("summary", ""))
	if label == "":
		label = activity
	if label == "":
		label = str(resident.get("intent", ""))
	if label == "":
		return ""
	return _short_text(label, 24)

func _draw_dashed_line(from: Vector2, to: Vector2, color: Color, width: float) -> void:
	var delta := to - from
	var length := delta.length()
	if length <= 1.0:
		return
	var direction := delta / length
	var dash := 8.0
	var gap := 6.0
	var cursor := 0.0
	while cursor < length:
		var end := minf(cursor + dash, length)
		draw_line(from + direction * cursor, from + direction * end, color, width)
		cursor += dash + gap

func _update_resident_targets() -> void:
	var active := {}
	for resident in residents:
		if typeof(resident) != TYPE_DICTIONARY:
			continue
		var actor_id := str(resident.get("actorId", ""))
		if actor_id == "":
			continue
		var target := _resident_motion_target(resident)
		active[actor_id] = true
		target_positions[actor_id] = target
		if not display_positions.has(actor_id):
			display_positions[actor_id] = _target_position_from_resident(resident)

	for actor_id in target_positions.keys():
		if not active.has(actor_id):
			target_positions.erase(actor_id)
			display_positions.erase(actor_id)

func _resident_motion_target(resident: Dictionary) -> Vector2:
	var tile = resident.get("targetTile", {})
	if typeof(tile) == TYPE_DICTIONARY:
		return Vector2(float(tile.get("x", 0.0)), float(tile.get("y", 0.0))) * TILE_SIZE
	return _target_position_from_resident(resident)

func _advance_resident_positions(delta: float) -> bool:
	var changed := false
	var speed := resident_move_speed_tiles * TILE_SIZE
	for actor_id in target_positions.keys():
		var target: Vector2 = target_positions[actor_id]
		var current: Vector2 = display_positions.get(actor_id, target)
		var distance := current.distance_to(target)
		if distance <= 0.5:
			if distance > 0.0:
				display_positions[actor_id] = target
				changed = true
			continue
		display_positions[actor_id] = current.move_toward(target, speed * delta)
		changed = true
	return changed

func _status_color(status: String) -> Color:
	match status:
		"walking", "moving":
			return Color(0.35, 1.0, 0.82)
		"waiting":
			return Color(1.0, 0.58, 0.36)
		"trading":
			return Color(1.0, 0.86, 0.28)
		"thinking":
			return Color(0.56, 0.6, 1.0)
		"speaking", "talking":
			return Color(0.86, 0.46, 1.0)
		_:
			return Color(0.72, 0.42, 1.0)

func _add_event_bubbles(actor_ids, summary: String, event_id: String, seen: Dictionary, kind: String = "narration") -> void:
	if typeof(actor_ids) != TYPE_ARRAY:
		return
	for actor_id in actor_ids:
		var id := str(actor_id)
		if id == "":
			continue
		seen[id] = true
		if event_bubbles.has(id):
			var existing: Dictionary = event_bubbles[id]
			if str(existing.get("eventId", "")) == event_id:
				continue
			event_bubbles[id] = _make_bubble(summary, event_id, kind)
			continue
		event_bubbles[id] = _make_bubble(summary, event_id, kind)

func _add_location_event_bubble(location_id: String, summary: String, event_id: String, seen: Dictionary, kind: String = "narration") -> void:
	if location_id == "":
		return
	seen[location_id] = true
	if location_event_bubbles.has(location_id):
		var existing: Dictionary = location_event_bubbles[location_id]
		if str(existing.get("eventId", "")) == event_id:
			return
	location_event_bubbles[location_id] = _make_bubble(summary, event_id, kind)

func _make_bubble(summary: String, event_id: String, kind: String = "narration") -> Dictionary:
	return {
		"text": _short_text(summary, 32),
		"eventId": event_id,
		"kind": kind,
		"age": 0.0
	}

func _prune_unseen_bubbles(bubbles: Dictionary, seen: Dictionary) -> void:
	for key in bubbles.keys():
		if not seen.has(key):
			bubbles.erase(key)

func _age_bubbles(delta: float) -> bool:
	var changed := false
	changed = _age_bubble_set(event_bubbles, delta) or changed
	changed = _age_bubble_set(location_event_bubbles, delta) or changed
	return changed

func _age_bubble_set(bubbles: Dictionary, delta: float) -> bool:
	var changed := false
	var expired := []
	for key in bubbles.keys():
		var bubble: Dictionary = bubbles[key]
		var next_age := float(bubble.get("age", 0.0)) + delta
		bubble["age"] = next_age
		bubbles[key] = bubble
		changed = true
		if next_age >= bubble_lifetime_seconds:
			expired.append(key)
	for key in expired:
		bubbles.erase(key)
	return changed

func _draw_bubble(anchor: Vector2, bubble) -> void:
	var font := UI_FONT
	if not font:
		return
	var text := str(bubble)
	var age := 0.0
	var kind := "narration"
	if typeof(bubble) == TYPE_DICTIONARY:
		var bubble_dict: Dictionary = bubble
		text = str(bubble_dict.get("text", ""))
		age = float(bubble_dict.get("age", 0.0))
		kind = str(bubble_dict.get("kind", "narration"))
	var alpha := clampf(1.0 - maxf(age - bubble_lifetime_seconds * 0.55, 0.0) / maxf(bubble_lifetime_seconds * 0.45, 0.01), 0.0, 1.0)
	var font_size := 12
	var text_size := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
	var width := minf(maxf(text_size.x + 16.0, 72.0), 230.0)
	var rect := Rect2(anchor + Vector2(14, -44), Vector2(width, 24.0))
	var palette := _bubble_palette(kind, alpha)
	draw_rect(rect, palette["fill"], true)
	draw_rect(rect, palette["stroke"], false, 1.2)
	draw_string(font, rect.position + Vector2(8, 16), text, HORIZONTAL_ALIGNMENT_LEFT, width - 16.0, font_size, palette["text"])

func _bubble_palette(kind: String, alpha: float) -> Dictionary:
	match kind:
		"dialogue":
			return {
				"fill": Color(0.9, 0.96, 1.0, 0.9 * alpha),
				"stroke": Color(0.05, 0.22, 0.34, 0.78 * alpha),
				"text": Color(0.02, 0.08, 0.12, alpha),
			}
		"reaction":
			return {
				"fill": Color(1.0, 0.95, 0.78, 0.9 * alpha),
				"stroke": Color(0.35, 0.22, 0.04, 0.78 * alpha),
				"text": Color(0.1, 0.07, 0.02, alpha),
			}
		"warning":
			return {
				"fill": Color(1.0, 0.86, 0.84, 0.92 * alpha),
				"stroke": Color(0.48, 0.08, 0.08, 0.82 * alpha),
				"text": Color(0.18, 0.03, 0.03, alpha),
			}
		_:
			return {
				"fill": Color(1.0, 0.98, 0.9, 0.88 * alpha),
				"stroke": Color(0.18, 0.12, 0.08, 0.78 * alpha),
				"text": Color(0.08, 0.06, 0.04, alpha),
			}

func _short_text(text: String, max_chars: int) -> String:
	if text.length() <= max_chars:
		return text
	return text.substr(0, max_chars - 1) + "..."
