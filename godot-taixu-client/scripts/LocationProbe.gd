extends Node
class_name LocationProbe

signal location_changed(location: Dictionary)
signal location_cleared()

@export var max_entry_distance := 4.0

var locations: Array = []
var current_location: Dictionary = {}

func set_locations(next_locations: Array) -> void:
	locations = next_locations

func prime_player_tile(tile: Vector2) -> void:
	_set_location(_location_at_tile(tile), false)

func update_player_tile(tile: Vector2) -> void:
	_set_location(_location_at_tile(tile), true)

func _set_location(location: Dictionary, should_emit: bool) -> void:
	var previous_id := str(current_location.get("locationId", ""))
	var next_id := str(location.get("locationId", ""))
	if previous_id == next_id:
		return

	current_location = location
	if not should_emit:
		return

	if current_location.is_empty():
		location_cleared.emit()
	else:
		location_changed.emit(current_location)

func _location_at_tile(tile: Vector2) -> Dictionary:
	for location in locations:
		if typeof(location) != TYPE_DICTIONARY:
			continue
		if _tile_in_bounds(tile, location.get("bounds", {})):
			return location

	var best_location: Dictionary = {}
	var best_distance := INF
	for location in locations:
		if typeof(location) != TYPE_DICTIONARY:
			continue
		var entry_points = location.get("entryPoints", [])
		if typeof(entry_points) != TYPE_ARRAY:
			continue
		for entry in entry_points:
			if typeof(entry) != TYPE_DICTIONARY:
				continue
			var entry_tile := Vector2(float(entry.get("x", 0.0)), float(entry.get("y", 0.0)))
			var distance := tile.distance_to(entry_tile)
			if distance < best_distance:
				best_location = location
				best_distance = distance

	return best_location if best_distance <= max_entry_distance else {}

func _tile_in_bounds(tile: Vector2, bounds) -> bool:
	if typeof(bounds) != TYPE_DICTIONARY:
		return false
	return (
		tile.x >= float(bounds.get("x1", INF)) and
		tile.x <= float(bounds.get("x2", -INF)) and
		tile.y >= float(bounds.get("y1", INF)) and
		tile.y <= float(bounds.get("y2", -INF))
	)
