extends SceneTree

const NavigationMaskScript := preload("res://scripts/NavigationMask.gd")
const LocationProbeScript := preload("res://scripts/LocationProbe.gd")

var failures: Array = []
var changed_locations: Array = []
var cleared_count := 0

func _init() -> void:
	_check_navigation_mask()
	_check_location_probe()

	if failures.is_empty():
		print("Godot spatial contract check passed.")
		quit(0)
	else:
		for failure in failures:
			push_error(str(failure))
		quit(1)

func _check_navigation_mask() -> void:
	var mask = NavigationMaskScript.new()
	var loaded: bool = mask.load_mask()
	_assert_true(loaded, "navigation mask loads")
	_assert_true(mask.is_loaded(), "navigation mask reports loaded")
	_assert_equals(str(mask.mask_path), "res://assets/qinglanRegions.json", "mask path")
	_assert_vector_near(mask.world_tiles, Vector2(96.0, 72.0), 0.001, "world tiles")
	_assert_vector_near(mask.image_size, Vector2(1448.0, 1086.0), 0.001, "source image size")
	_assert_float_near(float(mask.grid_size), 8.0, 0.001, "grid size")

	var spawn_tile := Vector2(35.0, 30.0)
	var medicine_entry_tile := Vector2(34.74, 31.558)
	var west_roof_tile := Vector2(6.63, 13.92)
	var outside_tile := Vector2(-1.0, 4.0)

	_assert_true(mask.is_tile_walkable(spawn_tile), "spawn tile is walkable")
	_assert_true(mask.is_tile_walkable(medicine_entry_tile), "medicine entry is walkable")
	_assert_false(mask.is_tile_walkable(west_roof_tile), "west roof tile is blocked")
	_assert_false(mask.is_tile_walkable(outside_tile), "out-of-bounds tile is blocked")
	_assert_equals(mask.get_mask_type_for_tile(west_roof_tile), "collision", "west roof mask type")
	_assert_equals(mask.get_mask_type_for_tile(outside_tile), "out_of_bounds", "out-of-bounds mask type")
	_assert_false(mask.is_tile_segment_walkable(spawn_tile, west_roof_tile), "segment to blocker is blocked")

	var west_roof_cell: Vector2i = mask.tile_to_cell(west_roof_tile)
	_assert_equals(str(west_roof_cell), "(12, 26)", "west roof tile-to-cell")
	var nearest := mask.nearest_walkable_tile(west_roof_tile)
	_assert_true(mask.is_tile_walkable(nearest), "nearest walkable from blocker is walkable")
	_assert_true(nearest.distance_to(west_roof_tile) <= 3.0, "nearest walkable from blocker stays local")
	mask.free()

func _check_location_probe() -> void:
	changed_locations.clear()
	cleared_count = 0

	var probe = LocationProbeScript.new()
	probe.max_entry_distance = 4.0
	probe.location_changed.connect(_on_location_changed)
	probe.location_cleared.connect(_on_location_cleared)
	probe.set_locations([
		{
			"locationId": "market_tea_stall",
			"name": "Tea Stall",
			"bounds": { "x1": 10.0, "y1": 10.0, "x2": 12.0, "y2": 12.0 },
			"entryPoints": [{ "x": 10.0, "y": 10.0 }],
		},
		{
			"locationId": "market_medicine_shop",
			"name": "Medicine Shop",
			"bounds": { "x1": 32.0, "y1": 30.0, "x2": 36.0, "y2": 33.0 },
			"entryPoints": [{ "x": 34.74, "y": 31.558 }],
		},
		{
			"locationId": "west_gate",
			"name": "West Gate",
			"bounds": { "x1": 2.0, "y1": 18.0, "x2": 9.0, "y2": 22.0 },
			"entryPoints": [{ "x": 7.96, "y": 19.89 }],
		},
	])

	probe.prime_player_tile(Vector2(11.0, 11.0))
	_assert_equals(str(probe.current_location.get("locationId", "")), "market_tea_stall", "primed bounds location")
	_assert_equals(str(changed_locations.size()), "0", "prime does not emit location_changed")
	_assert_equals(str(cleared_count), "0", "prime does not emit location_cleared")

	probe.update_player_tile(Vector2(34.74, 31.558))
	_assert_equals(str(probe.current_location.get("locationId", "")), "market_medicine_shop", "entry location")
	_assert_array_text(changed_locations, ["market_medicine_shop"], "entry emits location_changed")

	probe.update_player_tile(Vector2(38.2, 31.558))
	_assert_equals(str(probe.current_location.get("locationId", "")), "market_medicine_shop", "near entry remains location")
	_assert_array_text(changed_locations, ["market_medicine_shop"], "same location does not re-emit")

	probe.update_player_tile(Vector2(80.0, 60.0))
	_assert_true(probe.current_location.is_empty(), "far tile clears location")
	_assert_equals(str(cleared_count), "1", "leaving emits location_cleared")

	probe.update_player_tile(Vector2(12.2, 10.0))
	_assert_equals(str(probe.current_location.get("locationId", "")), "market_tea_stall", "near entry within max distance")
	_assert_array_text(changed_locations, ["market_medicine_shop", "market_tea_stall"], "near entry emits changed")

	probe.update_player_tile(Vector2(15.0, 10.0))
	_assert_true(probe.current_location.is_empty(), "beyond max entry distance clears")
	_assert_equals(str(cleared_count), "2", "second clear emitted")
	probe.free()

func _on_location_changed(location: Dictionary) -> void:
	changed_locations.append(str(location.get("locationId", "")))

func _on_location_cleared() -> void:
	cleared_count += 1

func _assert_true(value: bool, label: String) -> void:
	if not value:
		failures.append(label + " expected true")

func _assert_false(value: bool, label: String) -> void:
	if value:
		failures.append(label + " expected false")

func _assert_equals(actual: String, expected: String, label: String) -> void:
	if actual != expected:
		failures.append("%s expected %s, got %s" % [label, expected, actual])

func _assert_float_near(actual: float, expected: float, epsilon: float, label: String) -> void:
	if absf(actual - expected) > epsilon:
		failures.append("%s expected %.3f, got %.3f" % [label, expected, actual])

func _assert_vector_near(actual: Vector2, expected: Vector2, epsilon: float, label: String) -> void:
	if actual.distance_to(expected) > epsilon:
		failures.append("%s expected %s, got %s" % [label, str(expected), str(actual)])

func _assert_array_text(actual: Array, expected: Array, label: String) -> void:
	if actual.size() != expected.size():
		failures.append("%s expected %s, got %s" % [label, str(expected), str(actual)])
		return
	for index in range(expected.size()):
		if str(actual[index]) != str(expected[index]):
			failures.append("%s expected %s, got %s" % [label, str(expected), str(actual)])
			return
