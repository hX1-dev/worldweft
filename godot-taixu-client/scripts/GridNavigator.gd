extends RefCounted
class_name GridNavigator

## A thin, deterministic AStarGrid2D adapter around the generated colour mask.
## The mask remains the source of truth; temporary actor occupancy is applied only
## for the duration of a single route query.

var navigation_mask: NavigationMask
var _grid: AStarGrid2D

func configure(mask: NavigationMask) -> bool:
	navigation_mask = mask
	if navigation_mask == null or not navigation_mask.is_loaded():
		return false

	_grid = AStarGrid2D.new()
	_grid.region = Rect2i(0, 0, navigation_mask.cols, navigation_mask.rows)
	_grid.cell_size = Vector2.ONE
	_grid.diagonal_mode = AStarGrid2D.DIAGONAL_MODE_NEVER
	_grid.default_compute_heuristic = AStarGrid2D.HEURISTIC_MANHATTAN
	_grid.default_estimate_heuristic = AStarGrid2D.HEURISTIC_MANHATTAN
	_grid.update()

	for row in range(navigation_mask.rows):
		for col in range(navigation_mask.cols):
			var cell := Vector2i(col, row)
			if not navigation_mask.is_cell_walkable(cell):
				_grid.set_point_solid(cell, true)
	return true

func plan_route(start: Vector2i, destination: Vector2i, blocked_cells: Array = []) -> Array:
	if _grid == null:
		return []
	if not navigation_mask.is_cell_walkable(start) or not navigation_mask.is_cell_walkable(destination):
		return []

	var temporary_solids: Array[Vector2i] = []
	for value in blocked_cells:
		var cell := _as_cell(value)
		# The actor may leave its own occupied cell, but a claimed destination is
		# never silently treated as reachable. Semantic goal resolution must choose
		# another legal stand position first.
		if cell == start:
			continue
		if not _in_bounds(cell) or _grid.is_point_solid(cell):
			continue
		_grid.set_point_solid(cell, true)
		temporary_solids.append(cell)

	var raw_path := _grid.get_id_path(start, destination)
	for cell in temporary_solids:
		_grid.set_point_solid(cell, false)

	var route: Array = []
	for value in raw_path:
		route.append(Vector2i(value))
	return route

func is_route_walkable(route: Array) -> bool:
	if route.is_empty():
		return false
	var previous := _as_cell(route[0])
	if not navigation_mask.is_cell_walkable(previous):
		return false
	for index in range(1, route.size()):
		var current := _as_cell(route[index])
		if not navigation_mask.is_cell_walkable(current):
			return false
		if absi(current.x - previous.x) + absi(current.y - previous.y) != 1:
			return false
		previous = current
	return true

func nearest_reachable_cell(start: Vector2i, desired: Vector2i, max_radius: int = 2, blocked_cells: Array = []) -> Vector2i:
	if navigation_mask.is_cell_walkable(desired) and not _contains_cell(blocked_cells, desired) and not plan_route(start, desired, blocked_cells).is_empty():
		return desired
	for radius in range(1, max_radius + 1):
		var candidates: Array[Vector2i] = []
		for row in range(desired.y - radius, desired.y + radius + 1):
			for col in range(desired.x - radius, desired.x + radius + 1):
				if abs(col - desired.x) != radius and abs(row - desired.y) != radius:
					continue
				var candidate := Vector2i(col, row)
				if navigation_mask.is_cell_walkable(candidate) and not _contains_cell(blocked_cells, candidate):
					candidates.append(candidate)
		candidates.sort_custom(func(a: Vector2i, b: Vector2i) -> bool:
			var a_distance := Vector2(a - desired).length_squared()
			var b_distance := Vector2(b - desired).length_squared()
			if not is_equal_approx(a_distance, b_distance):
				return a_distance < b_distance
			return a.y < b.y or (a.y == b.y and a.x < b.x)
		)
		for candidate in candidates:
			if not plan_route(start, candidate, blocked_cells).is_empty():
				return candidate
	return Vector2i(-1, -1)

func _in_bounds(cell: Vector2i) -> bool:
	return cell.x >= 0 and cell.y >= 0 and cell.x < navigation_mask.cols and cell.y < navigation_mask.rows

func _as_cell(value) -> Vector2i:
	if value is Vector2i:
		return value
	if value is Vector2:
		return Vector2i(roundi(value.x), roundi(value.y))
	return Vector2i(-1, -1)

func _contains_cell(cells: Array, expected: Vector2i) -> bool:
	for value in cells:
		if _as_cell(value) == expected:
			return true
	return false
