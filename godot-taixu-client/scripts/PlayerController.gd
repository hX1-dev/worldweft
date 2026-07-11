extends Node2D
class_name PlayerController

signal moved(tile: Vector2)
signal movement_blocked(tile: Vector2, mask_type: String)

const COLLISION_SAMPLE_OFFSETS := [
	Vector2.ZERO,
	Vector2(0.34, 0.0),
	Vector2(-0.34, 0.0),
	Vector2(0.0, 0.34),
	Vector2(0.0, -0.34)
]

@export var speed := 320.0
@export var tile_size := 32.0
@export var map_cols := 96
@export var map_rows := 72
@export var interaction_radius_tiles := 5.0

var navigation_mask
var _blocked_cooldown := 0.0

func _ready() -> void:
	position = Vector2(35.0, 30.0) * tile_size

func configure_navigation(mask) -> void:
	navigation_mask = mask
	if navigation_mask != null and navigation_mask.is_loaded():
		_snap_to_walkable()

func _process(delta: float) -> void:
	_blocked_cooldown = maxf(0.0, _blocked_cooldown - delta)
	var direction := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	if direction.length_squared() > 0.0:
		var desired := position + direction.normalized() * speed * delta
		desired = desired.clamp(Vector2.ZERO, Vector2(map_cols, map_rows) * tile_size)
		if _try_move_to(desired):
			moved.emit(current_tile_point())
			queue_redraw()

func current_tile() -> Vector2i:
	return Vector2i(int(position.x / tile_size), int(position.y / tile_size))

func current_tile_point() -> Vector2:
	return position / tile_size

func _draw() -> void:
	draw_arc(Vector2.ZERO, interaction_radius_tiles * tile_size, 0.0, TAU, 96, Color(0.14, 0.62, 0.86, 0.42), 2.0)
	draw_circle(Vector2.ZERO, 17.0, Color(0.0, 0.0, 0.0, 0.24))
	draw_circle(Vector2.ZERO, 13.0, Color(0.28, 0.76, 1.0))
	draw_arc(Vector2.ZERO, 13.0, 0.0, TAU, 24, Color(0.03, 0.18, 0.28), 3.0)

func _try_move_to(desired: Vector2) -> bool:
	if _can_stand_at_pixel(desired):
		position = desired
		return true

	var horizontal := Vector2(desired.x, position.y)
	if _can_stand_at_pixel(horizontal):
		position = horizontal
		return true

	var vertical := Vector2(position.x, desired.y)
	if _can_stand_at_pixel(vertical):
		position = vertical
		return true

	_emit_blocked(desired)
	return false

func _can_stand_at_pixel(pixel_position: Vector2) -> bool:
	if navigation_mask == null or not navigation_mask.is_loaded():
		return true

	var target_tile := pixel_position / tile_size
	for offset in COLLISION_SAMPLE_OFFSETS:
		if not navigation_mask.is_tile_walkable(target_tile + offset):
			return false

	return navigation_mask.is_tile_segment_walkable(current_tile_point(), target_tile)

func _emit_blocked(pixel_position: Vector2) -> void:
	if _blocked_cooldown > 0.0:
		return
	_blocked_cooldown = 0.35
	var tile := pixel_position / tile_size
	var mask_type := "unknown"
	if navigation_mask != null and navigation_mask.is_loaded():
		mask_type = navigation_mask.get_mask_type_for_tile(tile)
	movement_blocked.emit(tile, mask_type)

func _snap_to_walkable() -> void:
	var tile := current_tile_point()
	if navigation_mask.is_tile_walkable(tile):
		return
	position = navigation_mask.nearest_walkable_tile(tile) * tile_size
