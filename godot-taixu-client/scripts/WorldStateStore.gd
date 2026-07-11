extends Node
class_name WorldStateStore

signal world_changed()
signal region_changed()
signal selection_changed(resident: Dictionary)
signal action_changed(payload: Dictionary)

var world_id := ""
var map_id := "qinglan"
var residents: Array = []
var locations: Array = []
var recent_events: Array = []
var selected_resident: Dictionary = {}
var last_action_result: Dictionary = {}

func absorb_world(payload: Dictionary) -> void:
	world_id = str(payload.get("worldId", world_id))
	var actors = payload.get("actors", {})
	if typeof(actors) == TYPE_DICTIONARY:
		residents = _array_or_empty(actors.get("residents", []))
	recent_events = _array_or_empty(payload.get("recentEvents", []))
	world_changed.emit()

func absorb_region(payload: Dictionary) -> void:
	world_id = str(payload.get("worldId", world_id))
	map_id = str(payload.get("mapId", map_id))
	residents = _array_or_empty(payload.get("residents", []))
	locations = _array_or_empty(payload.get("locations", []))
	recent_events = _array_or_empty(payload.get("recentEvents", []))
	_reselect_if_possible()
	region_changed.emit()

func absorb_action(payload: Dictionary) -> void:
	last_action_result = payload
	action_changed.emit(payload)

func select_resident(resident: Dictionary) -> void:
	selected_resident = resident
	selection_changed.emit(selected_resident)

func _reselect_if_possible() -> void:
	if selected_resident.is_empty():
		return
	var selected_actor_id := str(selected_resident.get("actorId", ""))
	for resident in residents:
		if typeof(resident) == TYPE_DICTIONARY and str(resident.get("actorId", "")) == selected_actor_id:
			selected_resident = resident
			return
	selected_resident = {}

func _array_or_empty(value) -> Array:
	return value if typeof(value) == TYPE_ARRAY else []
