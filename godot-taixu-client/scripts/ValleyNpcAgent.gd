extends CharacterBody2D
class_name ValleyNpcAgent

signal route_completed(actor_id: String)
signal navigation_violation(actor_id: String, tile: Vector2, mask_type: String)
signal movement_sample(actor_id: String, tile: Vector2, mask_type: String, target_cell: Vector2i)
signal goal_accepted(actor_id: String, command_id: String, revision: int, path_length: int)
signal goal_state_changed(actor_id: String, command_id: String, revision: int, status: String, reason_code: String)
signal route_replanned(actor_id: String, command_id: String, revision: int, path_length: int, reason_code: String)

const TILE_SIZE := 32.0
const FRAME_SIZE := Vector2i(48, 64)
const FOOTPRINT_RADIUS := 7.0
const ARRIVAL_DISTANCE := TILE_SIZE * 0.25
const STUCK_TIMEOUT_SECONDS := 1.5
const TARGET_OCCUPIED_TIMEOUT_SECONDS := 1.5
const MAX_REPLANS_PER_GOAL := 4
const PROGRESS_EPSILON_PIXELS := 4.0
const UI_FONT := preload("res://assets/fonts/NotoSansCJKsc-Regular.otf")

@export var move_speed := 230.0
@export var sample_interval_seconds := 0.5

var actor_id := ""
var display_name := ""
var navigation_mask: NavigationMask
var navigator: GridNavigator
var route_cells: Array = []
var route_index := 0
var completed_routes := 0
var current_state := "idle"
var current_revision := -1
var active_goal: Dictionary = {}
var replan_count := 0
var last_command_id := ""
var last_intent := ""
var last_decision_source := ""

var _sample_elapsed := 0.0
var _sprite: AnimatedSprite2D
var _avoidance_agent: NavigationAgent2D
var _safe_velocity := Vector2.ZERO
var _safe_velocity_frame := -1
var _movement_paused := false
var _pause_reason := ""
var _stall_elapsed := 0.0
var _stall_replanned := false
var _progress_route_index := -1
var _progress_waypoint_distance := INF
var _target_occupied_elapsed := 0.0
var _last_valid_position := Vector2.ZERO
var _last_sample_cell := Vector2i(-1, -1)
var _yielding_to_actor := false
var _halted := false

func _ready() -> void:
	add_to_group("valley_npc_agents")

func configure(
	id: String,
	name_value: String,
	sprite_sheet: Texture2D,
	sprite_group: int,
	start_cell: Vector2i,
	mask: NavigationMask,
	navigator_value: GridNavigator = null
) -> void:
	actor_id = id
	display_name = name_value
	navigation_mask = mask
	navigator = navigator_value
	position = navigation_mask.cell_to_tile(start_cell) * TILE_SIZE
	_last_valid_position = position
	_last_sample_cell = start_cell
	_build_collision_and_avoidance()
	_build_visual(sprite_sheet, sprite_group)
	queue_redraw()

func accept_goal(goal: Dictionary, navigator_value: GridNavigator = null) -> bool:
	_halted = false
	if navigator_value != null:
		navigator = navigator_value
	if navigator == null or navigation_mask == null:
		return false

	var revision := int(goal.get("revision", 0))
	var command_id := str(goal.get("commandId", ""))
	if command_id == "" or revision <= current_revision:
		return false
	last_intent = str(goal.get("intent", ""))
	last_decision_source = str(goal.get("decisionSource", ""))

	if not active_goal.is_empty():
		_emit_state("cancelled", "replaced_by_new_revision")

	var accepted = goal.get("acceptedTile", {})
	if typeof(accepted) != TYPE_DICTIONARY:
		return false
	var target := Vector2i(int(accepted.get("x", -1)), int(accepted.get("y", -1)))
	var path := navigator.plan_route(current_cell(), target, _other_actor_cells())
	if path.is_empty() or not navigator.is_route_walkable(path):
		current_revision = revision
		last_command_id = command_id
		active_goal = goal.duplicate(true)
		current_state = "blocked"
		_emit_state("blocked", "no_route")
		active_goal.clear()
		return false

	current_revision = revision
	last_command_id = command_id
	active_goal = goal.duplicate(true)
	route_cells = path
	route_index = 1 if path.size() > 1 else path.size()
	replan_count = 0
	_target_occupied_elapsed = 0.0
	_reset_progress_watch(true)
	_sample_elapsed = sample_interval_seconds
	current_state = "accepted"
	goal_accepted.emit(actor_id, command_id, current_revision, path.size())
	_emit_state("accepted", "")
	if route_index >= route_cells.size():
		_finish_goal()
	else:
		current_state = "moving"
		_emit_state("moving", "")
	return true

func cancel_goal(revision: int, reason_code: String = "cancelled") -> bool:
	if active_goal.is_empty() or revision != current_revision:
		return false
	_emit_state("cancelled", reason_code)
	_clear_route("cancelled")
	return true

func replan(reason_code: String = "manual_replan", additional_blocked_cells: Array = []) -> bool:
	if active_goal.is_empty() or navigator == null:
		return false
	if replan_count >= MAX_REPLANS_PER_GOAL:
		_block_goal("replan_limit")
		return false
	var target := _active_target_cell()
	var blocked := _other_actor_cells()
	for cell in additional_blocked_cells:
		blocked.append(cell)
	var path := navigator.plan_route(current_cell(), target, blocked)
	if path.is_empty():
		_block_goal("replan_no_route")
		return false
	route_cells = path
	route_index = 1 if path.size() > 1 else path.size()
	replan_count += 1
	_stall_elapsed = 0.0
	_reset_progress_watch(false)
	route_replanned.emit(actor_id, current_command_id(), current_revision, path.size(), reason_code)
	return true

## Backwards-compatible entry point for callers that already computed a path.
func follow_cell_path(path_cells: Array) -> void:
	if path_cells.is_empty():
		return
	var target: Vector2i = path_cells[path_cells.size() - 1]
	accept_goal({
		"commandId": "legacy:%s:%d" % [actor_id, Time.get_ticks_usec()],
		"actionRecordId": "legacy",
		"revision": current_revision + 1,
		"actorId": actor_id,
		"mapId": "qinglan_valley_gate",
		"intent": "legacy_route",
		"decisionSource": "test",
		"requestedTarget": {"kind": "point", "tile": {"x": target.x, "y": target.y}},
		"acceptedTile": {"x": target.x, "y": target.y},
	}, navigator)

func current_cell() -> Vector2i:
	if navigation_mask == null:
		return Vector2i.ZERO
	return navigation_mask.tile_to_cell(position / TILE_SIZE)

func logical_tile_position() -> Vector2:
	## Map assets and Convex identify a tile by its integer cell coordinate, while
	## the CharacterBody anchor lives at that cell's visual centre.
	return position / TILE_SIZE - Vector2(0.5, 0.5)

func current_command_id() -> String:
	return str(active_goal.get("commandId", last_command_id))

func current_target_cell() -> Vector2i:
	if route_index < route_cells.size():
		return Vector2i(route_cells[route_index])
	return current_cell()

func active_path_length() -> int:
	return maxi(route_cells.size() - route_index, 0)

func is_active() -> bool:
	return not _halted and not active_goal.is_empty() and ["accepted", "moving"].has(current_state)

func accepted_target_cell() -> Vector2i:
	return _active_target_cell()

func sync_confirmed_tile(confirmed_tile: Vector2) -> bool:
	if not active_goal.is_empty() or navigation_mask == null:
		return false
	if not is_finite(confirmed_tile.x) or not is_finite(confirmed_tile.y):
		return false
	var mask_tile := confirmed_tile + Vector2(0.5, 0.5)
	if not navigation_mask.is_tile_walkable(mask_tile):
		return false
	position = mask_tile * TILE_SIZE
	_last_valid_position = position
	_last_sample_cell = current_cell()
	route_cells.clear()
	route_index = 0
	velocity = Vector2.ZERO
	current_state = "idle"
	_movement_paused = false
	_pause_reason = ""
	_target_occupied_elapsed = 0.0
	_reset_progress_watch(true)
	if _avoidance_agent != null:
		_avoidance_agent.velocity = Vector2.ZERO
	_set_idle()
	return logical_tile_position().distance_to(confirmed_tile) <= 0.001

func halt_without_report() -> void:
	_halted = true
	_clear_route("idle")

func settle_to_idle() -> void:
	if not is_active() and ["arrived", "blocked", "cancelled"].has(current_state):
		current_state = "idle"
		_set_idle()

func needs_bridge_access() -> bool:
	if not is_active() or navigation_mask == null:
		return false
	return navigation_mask.get_mask_type_for_cell(current_cell()) == "dock" or navigation_mask.get_mask_type_for_cell(current_target_cell()) == "dock"

func set_bridge_access(allowed: bool, reason_code: String = "bridge_reserved") -> void:
	_movement_paused = not allowed
	_pause_reason = "" if allowed else reason_code
	if _movement_paused:
		velocity = Vector2.ZERO

func goal_snapshot() -> Dictionary:
	return {
		"actorId": actor_id,
		"commandId": current_command_id(),
		"revision": current_revision,
		"intent": str(active_goal.get("intent", last_intent)),
		"decisionSource": str(active_goal.get("decisionSource", last_decision_source)),
		"state": current_state,
		"cell": {"x": current_cell().x, "y": current_cell().y},
		"targetCell": {"x": current_target_cell().x, "y": current_target_cell().y},
		"pathRemaining": active_path_length(),
		"replans": replan_count,
		"replanLimit": MAX_REPLANS_PER_GOAL,
		"stallSeconds": snappedf(_stall_elapsed, 0.01),
		"targetOccupiedSeconds": snappedf(_target_occupied_elapsed, 0.01),
		"pauseReason": _pause_reason,
	}

func _physics_process(delta: float) -> void:
	if _halted or navigation_mask == null or not is_active() or route_index >= route_cells.size():
		velocity = Vector2.ZERO
		if _avoidance_agent != null:
			_avoidance_agent.velocity = Vector2.ZERO
		_set_idle()
		return
	if _lease_has_expired():
		cancel_goal(current_revision, "lease_expired")
		return
	if _movement_paused:
		velocity = Vector2.ZERO
		if _avoidance_agent != null:
			_avoidance_agent.velocity = Vector2.ZERO
		_set_idle()
		return

	var target_cell: Vector2i = route_cells[route_index]
	var target_position := navigation_mask.cell_to_tile(target_cell) * TILE_SIZE
	var delta_to_target := target_position - position
	var maximum_step := move_speed * delta
	var is_final_waypoint := route_index == route_cells.size() - 1
	if is_final_waypoint and _position_overlaps_actor(target_position, FOOTPRINT_RADIUS * 2.1):
		_target_occupied_elapsed += delta
		velocity = Vector2.ZERO
		if _avoidance_agent != null:
			_avoidance_agent.velocity = Vector2.ZERO
		_set_idle()
		if _target_occupied_elapsed >= TARGET_OCCUPIED_TIMEOUT_SECONDS:
			_block_goal("target_occupied")
			return
		_emit_movement_sample(delta, target_cell)
		return
	_target_occupied_elapsed = 0.0
	var waypoint_tolerance := ARRIVAL_DISTANCE if is_final_waypoint else maximum_step
	if delta_to_target.length() <= maxf(maximum_step, waypoint_tolerance):
		if _can_enter_position(target_position):
			position = target_position
			_last_valid_position = position
			velocity = Vector2.ZERO
			route_index += 1
			_validate_navigation(target_cell)
			if not is_active():
				return
			if route_index >= route_cells.size():
				_finish_goal()
			else:
				_reset_progress_watch(true)
			return
		_yielding_to_actor = true
		if not _track_progress(delta):
			return
		return

	var direction := delta_to_target.normalized()
	var desired_velocity := direction * move_speed
	if _avoidance_agent != null:
		_avoidance_agent.velocity = desired_velocity
	var adjusted_velocity := _local_avoidance_velocity(desired_velocity, delta)
	if not _yielding_to_actor and _safe_velocity_frame >= Engine.get_physics_frames() - 2 and _safe_velocity.dot(desired_velocity) > 0.0:
		var blended := adjusted_velocity.lerp(_safe_velocity.limit_length(move_speed), 0.25)
		if _velocity_stays_walkable(blended, delta):
			adjusted_velocity = blended
	if not _velocity_stays_walkable(adjusted_velocity, delta):
		adjusted_velocity = desired_velocity if _velocity_stays_walkable(desired_velocity, delta) else Vector2.ZERO

	velocity = adjusted_velocity
	if not velocity.is_zero_approx():
		var previous_position := position
		move_and_slide()
		if _position_overlaps_actor(position, FOOTPRINT_RADIUS * 2.0):
			position = previous_position
			velocity = Vector2.ZERO
			_yielding_to_actor = true
			_set_idle()
		else:
			_update_animation(velocity.normalized())
	else:
		_set_idle()
	_validate_navigation(target_cell)
	if not is_active():
		return
	if not _track_progress(delta):
		return
	_emit_movement_sample(delta, target_cell)

func _track_progress(delta: float) -> bool:
	_yielding_to_actor = false
	var waypoint_distance := _distance_to_current_waypoint()
	var made_progress := route_index > _progress_route_index
	if route_index == _progress_route_index and waypoint_distance <= _progress_waypoint_distance - PROGRESS_EPSILON_PIXELS:
		made_progress = true
	if made_progress:
		_reset_progress_watch(true)
		return true

	_stall_elapsed += delta
	if _stall_elapsed < STUCK_TIMEOUT_SECONDS:
		return true
	_stall_elapsed = 0.0
	if not _stall_replanned:
		_stall_replanned = true
		var replanned := replan("stuck_timeout")
		if replanned:
			_reset_progress_watch(false)
		return replanned and is_active()
	_block_goal("stuck_after_replan")
	return false

func _reset_progress_watch(reset_stall_episode: bool) -> void:
	_progress_route_index = route_index
	_progress_waypoint_distance = _distance_to_current_waypoint()
	if reset_stall_episode:
		_stall_elapsed = 0.0
		_stall_replanned = false

func _distance_to_current_waypoint() -> float:
	if navigation_mask == null or route_index < 0 or route_index >= route_cells.size():
		return INF
	var cell: Vector2i = route_cells[route_index]
	return position.distance_to(navigation_mask.cell_to_tile(cell) * TILE_SIZE)

func _emit_movement_sample(delta: float, target_cell: Vector2i) -> void:
	_sample_elapsed += delta
	var cell := current_cell()
	if _sample_elapsed < sample_interval_seconds and cell == _last_sample_cell:
		return
	_sample_elapsed = 0.0
	_last_sample_cell = cell
	var world_tile := position / TILE_SIZE
	movement_sample.emit(actor_id, logical_tile_position(), navigation_mask.get_mask_type_for_tile(world_tile), target_cell)

func _finish_goal() -> void:
	if active_goal.is_empty():
		return
	completed_routes += 1
	current_state = "arrived"
	_emit_state("arrived", "")
	_clear_route("arrived")
	route_completed.emit(actor_id)

func _block_goal(reason_code: String) -> void:
	if active_goal.is_empty():
		return
	current_state = "blocked"
	_emit_state("blocked", reason_code)
	_clear_route("blocked")

func _clear_route(next_state: String) -> void:
	route_cells.clear()
	route_index = 0
	velocity = Vector2.ZERO
	active_goal.clear()
	current_state = next_state
	_movement_paused = false
	_pause_reason = ""
	_stall_elapsed = 0.0
	_stall_replanned = false
	_progress_route_index = -1
	_progress_waypoint_distance = INF
	_target_occupied_elapsed = 0.0
	_set_idle()

func _emit_state(status: String, reason_code: String) -> void:
	goal_state_changed.emit(actor_id, current_command_id(), current_revision, status, reason_code)

func _active_target_cell() -> Vector2i:
	var accepted = active_goal.get("acceptedTile", {})
	if typeof(accepted) != TYPE_DICTIONARY:
		return current_cell()
	return Vector2i(int(accepted.get("x", current_cell().x)), int(accepted.get("y", current_cell().y)))

func _lease_has_expired() -> bool:
	var expires_at := int(active_goal.get("expiresAt", 0))
	return expires_at > 0 and int(Time.get_unix_time_from_system() * 1000.0) >= expires_at

func _other_actor_cells() -> Array:
	var result: Array = []
	var seen: Dictionary = {}
	if not is_inside_tree():
		return result
	for node in get_tree().get_nodes_in_group("valley_npc_agents"):
		if node == self or not is_instance_valid(node) or not node.has_method("current_cell"):
			continue
		var occupied: Vector2i = node.current_cell()
		seen["%d,%d" % [occupied.x, occupied.y]] = true
		result.append(occupied)
		if node.has_method("is_active") and node.is_active() and node.has_method("accepted_target_cell"):
			var reserved: Vector2i = node.accepted_target_cell()
			var key := "%d,%d" % [reserved.x, reserved.y]
			if not seen.has(key):
				seen[key] = true
				result.append(reserved)
	return result

func _can_enter_position(candidate_position: Vector2) -> bool:
	if not navigation_mask.is_tile_walkable(candidate_position / TILE_SIZE):
		return false
	return not _position_overlaps_actor(candidate_position, FOOTPRINT_RADIUS * 2.1)

func _position_overlaps_actor(candidate_position: Vector2, clearance: float) -> bool:
	if not is_inside_tree():
		return false
	for node in get_tree().get_nodes_in_group("valley_npc_agents"):
		if node == self or not is_instance_valid(node) or not node is Node2D:
			continue
		if candidate_position.distance_to(node.position) < clearance:
			return true
	return false

func _local_avoidance_velocity(desired_velocity: Vector2, delta: float) -> Vector2:
	_yielding_to_actor = false
	if not is_inside_tree():
		return desired_velocity
	var adjusted := desired_velocity
	var predicted := position + desired_velocity * delta
	for node in get_tree().get_nodes_in_group("valley_npc_agents"):
		if node == self or not is_instance_valid(node) or not node is Node2D:
			continue
		var distance := predicted.distance_to(node.position)
		if distance >= 42.0:
			continue
		var other_id := str(node.get("actor_id"))
		var other_active := bool(node.call("is_active")) if node.has_method("is_active") else false
		if distance < FOOTPRINT_RADIUS * 2.4:
			if not other_active or actor_id > other_id:
				_yielding_to_actor = true
				return Vector2.ZERO
		var away: Vector2 = position - node.position
		if away.length_squared() > 0.01:
			adjusted += away.normalized() * move_speed * (1.0 - distance / 42.0) * 0.4
	return adjusted.limit_length(move_speed)

func _velocity_stays_walkable(candidate_velocity: Vector2, delta: float) -> bool:
	if candidate_velocity.is_zero_approx():
		return true
	var from_tile := position / TILE_SIZE
	var to_tile := (position + candidate_velocity * delta) / TILE_SIZE
	return navigation_mask.is_tile_segment_walkable(from_tile, to_tile)

func _validate_navigation(_target_cell: Vector2i) -> void:
	var tile := position / TILE_SIZE
	if navigation_mask.is_tile_walkable(tile):
		_last_valid_position = position
		return
	var mask_type := navigation_mask.get_mask_type_for_tile(tile)
	navigation_violation.emit(actor_id, tile, mask_type)
	position = _last_valid_position
	velocity = Vector2.ZERO
	_block_goal("navigation_violation")

func _build_collision_and_avoidance() -> void:
	collision_layer = 2
	collision_mask = 2
	safe_margin = 0.05
	var collision_shape := CollisionShape2D.new()
	collision_shape.name = "NpcFootprint"
	var circle := CircleShape2D.new()
	circle.radius = FOOTPRINT_RADIUS
	collision_shape.shape = circle
	collision_shape.position = Vector2(0, -2)
	add_child(collision_shape)

	_avoidance_agent = NavigationAgent2D.new()
	_avoidance_agent.name = "LocalAvoidance"
	_avoidance_agent.avoidance_enabled = true
	_avoidance_agent.radius = FOOTPRINT_RADIUS
	_avoidance_agent.neighbor_distance = 64.0
	_avoidance_agent.max_neighbors = 8
	_avoidance_agent.time_horizon_agents = 0.6
	_avoidance_agent.time_horizon_obstacles = 0.4
	_avoidance_agent.max_speed = move_speed
	_avoidance_agent.velocity_computed.connect(_on_safe_velocity_computed)
	add_child(_avoidance_agent)

func _on_safe_velocity_computed(safe_velocity: Vector2) -> void:
	_safe_velocity = safe_velocity
	_safe_velocity_frame = Engine.get_physics_frames()

func _build_visual(sprite_sheet: Texture2D, sprite_group: int) -> void:
	_sprite = AnimatedSprite2D.new()
	_sprite.name = "AnimatedNpcSprite"
	_sprite.position = Vector2(0, -27)
	_sprite.scale = Vector2(0.82, 0.82)
	_sprite.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_sprite.sprite_frames = _build_sprite_frames(sprite_sheet, sprite_group)
	_sprite.animation = "walk_down"
	_sprite.play()
	add_child(_sprite)

	var name_label := Label.new()
	name_label.name = "NameLabel"
	name_label.text = display_name
	name_label.position = Vector2(-48, -72)
	name_label.size = Vector2(96, 20)
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.add_theme_font_override("font", UI_FONT)
	name_label.add_theme_font_size_override("font_size", 12)
	name_label.add_theme_color_override("font_color", Color(0.94, 0.92, 0.76))
	name_label.add_theme_color_override("font_shadow_color", Color(0.05, 0.07, 0.06, 0.92))
	name_label.add_theme_constant_override("shadow_offset_x", 1)
	name_label.add_theme_constant_override("shadow_offset_y", 1)
	add_child(name_label)

func _build_sprite_frames(sprite_sheet: Texture2D, sprite_group: int) -> SpriteFrames:
	var frames := SpriteFrames.new()
	if frames.has_animation("default"):
		frames.remove_animation("default")
	var group_col := (sprite_group % 4) * 3
	var group_row := int(sprite_group / 4) * 4
	var directions := {
		"walk_down": 0,
		"walk_left": 1,
		"walk_right": 2,
		"walk_up": 3,
	}
	for animation_name in directions.keys():
		frames.add_animation(animation_name)
		frames.set_animation_loop(animation_name, true)
		frames.set_animation_speed(animation_name, 8.0)
		var direction_row: int = directions[animation_name]
		for frame_index in range(3):
			var frame_texture := AtlasTexture.new()
			frame_texture.atlas = sprite_sheet
			frame_texture.region = Rect2(
				(group_col + frame_index) * FRAME_SIZE.x,
				(group_row + direction_row) * FRAME_SIZE.y,
				FRAME_SIZE.x,
				FRAME_SIZE.y
			)
			frames.add_frame(animation_name, frame_texture)
	return frames

func _update_animation(direction: Vector2) -> void:
	var next_animation := "walk_down"
	if absf(direction.x) > absf(direction.y):
		next_animation = "walk_right" if direction.x > 0.0 else "walk_left"
	else:
		next_animation = "walk_down" if direction.y > 0.0 else "walk_up"
	if _sprite.animation != next_animation:
		_sprite.play(next_animation)
	elif not _sprite.is_playing():
		_sprite.play()

func _set_idle() -> void:
	if _sprite == null:
		return
	_sprite.pause()
	_sprite.frame = 1

func _draw() -> void:
	draw_ellipse_shadow(Vector2(0, -2), Vector2(13, 6), Color(0.02, 0.04, 0.03, 0.34))

func draw_ellipse_shadow(center: Vector2, radius: Vector2, color: Color) -> void:
	var points := PackedVector2Array()
	for index in range(20):
		var angle := TAU * float(index) / 20.0
		points.append(center + Vector2(cos(angle) * radius.x, sin(angle) * radius.y))
	draw_colored_polygon(points, color)
