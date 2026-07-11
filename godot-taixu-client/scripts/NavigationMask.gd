extends Node
class_name NavigationMask

signal mask_loaded()
signal mask_failed(message: String)

const NAVIGABLE_TYPES := {
	"walkable": true,
	"grass": true,
	"dock": true
}

@export var mask_path := "res://assets/qinglanRegions.json"
@export var world_tiles := Vector2(96.0, 72.0)

var image_size := Vector2(1448.0, 1086.0)
var grid_size := 8.0
var cols := 0
var rows := 0
var error_message := ""

var _loaded := false
var _cells: Dictionary = {}

func _ready() -> void:
	if not _loaded:
		load_mask()

func load_mask() -> bool:
	_loaded = false
	error_message = ""
	_cells.clear()

	if not FileAccess.file_exists(mask_path):
		return _fail("Navigation mask not found: " + mask_path)

	var text := FileAccess.get_file_as_string(mask_path)
	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return _fail("Navigation mask is not valid JSON.")

	var data: Dictionary = parsed
	var image = data.get("image", {})
	if typeof(image) == TYPE_DICTIONARY:
		image_size = Vector2(
			float(image.get("width", image_size.x)),
			float(image.get("height", image_size.y))
		)

	var cell_mask = data.get("cellMask", {})
	if typeof(cell_mask) != TYPE_DICTIONARY:
		return _fail("Navigation mask has no cellMask.")

	grid_size = float(cell_mask.get("gridSize", grid_size))
	cols = ceili(image_size.x / grid_size)
	rows = ceili(image_size.y / grid_size)

	var raw_cells = cell_mask.get("cells", [])
	if typeof(raw_cells) != TYPE_ARRAY:
		return _fail("Navigation mask cellMask.cells is not an array.")

	for cell in raw_cells:
		if typeof(cell) != TYPE_DICTIONARY:
			continue
		var col := int(cell.get("col", -1))
		var row := int(cell.get("row", -1))
		if col < 0 or row < 0:
			continue
		_cells[_cell_key(Vector2i(col, row))] = str(cell.get("type", "unclassified"))

	_loaded = true
	mask_loaded.emit()
	return true

func is_loaded() -> bool:
	return _loaded

func is_tile_walkable(tile: Vector2) -> bool:
	if not _loaded:
		return true
	if not _tile_in_bounds(tile):
		return false
	return is_cell_walkable(tile_to_cell(tile))

func is_tile_segment_walkable(from_tile: Vector2, to_tile: Vector2) -> bool:
	if not _loaded:
		return true
	var from_cell := tile_to_cell(from_tile)
	var to_cell := tile_to_cell(to_tile)
	var steps := maxi(abs(to_cell.x - from_cell.x), abs(to_cell.y - from_cell.y))
	steps = maxi(steps, 1)
	for i in range(steps + 1):
		var t := float(i) / float(steps)
		var cell := Vector2i(
			roundi(lerpf(float(from_cell.x), float(to_cell.x), t)),
			roundi(lerpf(float(from_cell.y), float(to_cell.y), t))
		)
		if not is_cell_walkable(cell):
			return false
	return true

func is_cell_walkable(cell: Vector2i) -> bool:
	var mask_type := _mask_type_at_cell(cell)
	return NAVIGABLE_TYPES.has(mask_type)

func get_mask_type_for_tile(tile: Vector2) -> String:
	if not _loaded:
		return "loading"
	if not _tile_in_bounds(tile):
		return "out_of_bounds"
	return _mask_type_at_cell(tile_to_cell(tile))

func tile_to_cell(tile: Vector2) -> Vector2i:
	var image_x := clampf((tile.x / world_tiles.x) * image_size.x, 0.0, image_size.x - 1.0)
	var image_y := clampf((tile.y / world_tiles.y) * image_size.y, 0.0, image_size.y - 1.0)
	return Vector2i(int(floor(image_x / grid_size)), int(floor(image_y / grid_size)))

func cell_to_tile(cell: Vector2i) -> Vector2:
	return Vector2(
		(((float(cell.x) + 0.5) * grid_size) / image_size.x) * world_tiles.x,
		(((float(cell.y) + 0.5) * grid_size) / image_size.y) * world_tiles.y
	)

func nearest_walkable_tile(tile: Vector2, max_radius: int = 28) -> Vector2:
	var origin := tile_to_cell(tile)
	if is_cell_walkable(origin):
		return cell_to_tile(origin)

	for radius in range(1, max_radius + 1):
		var best := Vector2i(-1, -1)
		var best_distance := INF
		for row in range(origin.y - radius, origin.y + radius + 1):
			for col in range(origin.x - radius, origin.x + radius + 1):
				if abs(col - origin.x) != radius and abs(row - origin.y) != radius:
					continue
				var candidate := Vector2i(col, row)
				if not is_cell_walkable(candidate):
					continue
				var distance := Vector2(candidate - origin).length()
				if distance < best_distance:
					best = candidate
					best_distance = distance
		if best.x >= 0:
			return cell_to_tile(best)

	return tile

func _mask_type_at_cell(cell: Vector2i) -> String:
	if cell.x < 0 or cell.y < 0 or cell.x >= cols or cell.y >= rows:
		return "out_of_bounds"
	return str(_cells.get(_cell_key(cell), "unclassified"))

func _tile_in_bounds(tile: Vector2) -> bool:
	return tile.x >= 0.0 and tile.y >= 0.0 and tile.x < world_tiles.x and tile.y < world_tiles.y

func _cell_key(cell: Vector2i) -> String:
	return "%d,%d" % [cell.x, cell.y]

func _fail(message: String) -> bool:
	error_message = message
	mask_failed.emit(message)
	return false
