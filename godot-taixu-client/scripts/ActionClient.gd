extends Node
class_name ActionClient

const ActionMenuPolicyScript := preload("res://scripts/ActionMenuPolicy.gd")

signal action_rejected_locally(message: String)

@export var actor_id := "godot_player"
@export var map_id := "qinglan"

var bridge
var _client_session_id := ""
var _client_action_sequence := 0

func _ready() -> void:
	_client_session_id = "%x-%x" % [int(Time.get_unix_time_from_system() * 1000.0), randi()]

func configure(bridge_ref) -> void:
	bridge = bridge_ref

func talk_to(
	resident: Dictionary,
	world_id: String,
	actor_tile: Vector2,
	interaction_range_tiles: float,
	current_location: Dictionary = {}
) -> void:
	submit_capability(
		{
			"type": "talk",
			"category": "target",
			"enabled": true,
			"intent": "打个招呼，询问今日坊市见闻",
			"params": {}
		},
		resident,
		current_location,
		world_id,
		actor_tile,
		interaction_range_tiles
	)

func arrive_at(location: Dictionary, world_id: String, actor_tile: Vector2) -> void:
	if bridge == null:
		action_rejected_locally.emit("Convex bridge is not ready.")
		return
	if location.is_empty():
		return

	var location_id := str(location.get("locationId", ""))
	if location_id == "":
		action_rejected_locally.emit("Location has no locationId.")
		return

	var payload := {
		"worldId": world_id if world_id != "" else null,
		"actorId": actor_id,
		"clientActionId": _next_client_action_id("arrive"),
		"type": "arrive",
		"mapId": map_id,
		"locationId": location_id,
		"actorTile": _tile_payload(actor_tile),
		"intent": "抵达" + str(location.get("name", location_id)),
		"metadata": {
			"clientEvent": "location_changed"
		}
	}
	bridge.post_action(payload)

func explore_location(location: Dictionary, world_id: String, actor_tile: Vector2) -> void:
	submit_capability(
		{
			"type": "explore",
			"category": "location",
			"enabled": true,
			"intent": "在" + str(location.get("name", location.get("locationId", "当前地点"))) + "探查周遭",
			"params": {}
		},
		{},
		location,
		world_id,
		actor_tile,
		0.0
	)

func submit_capability(
	capability: Dictionary,
	resident: Dictionary,
	location: Dictionary,
	world_id: String,
	actor_tile: Vector2,
	interaction_range_tiles: float
) -> void:
	if bridge == null:
		action_rejected_locally.emit("Convex bridge is not ready.")
		return
	if bridge.has_method("has_pending_action") and bridge.has_pending_action():
		action_rejected_locally.emit("An action is already pending.")
		return
	if capability.is_empty():
		action_rejected_locally.emit("No action is selected.")
		return
	if capability.get("enabled", false) != true:
		action_rejected_locally.emit(str(capability.get("reason", "Action is not available.")))
		return

	var action_type := str(capability.get("type", ""))
	if action_type == "":
		action_rejected_locally.emit("Action has no type.")
		return

	var payload: Dictionary = {
		"worldId": world_id if world_id != "" else null,
		"actorId": actor_id,
		"clientActionId": _next_client_action_id(action_type),
		"type": action_type,
		"mapId": map_id,
		"actorTile": _tile_payload(actor_tile),
		"intent": str(capability.get("intent", _default_intent(action_type))),
		"metadata": {
			"clientEvent": "action_menu"
		}
	}

	if interaction_range_tiles > 0.0:
		payload["interactionRangeTiles"] = interaction_range_tiles

	var category := str(capability.get("category", ""))
	if category == "target" or ActionMenuPolicyScript.is_target_action(action_type):
		if resident.is_empty():
			action_rejected_locally.emit("Select a resident first.")
			return
		payload["targetActorId"] = str(capability.get("targetActorId", resident.get("actorId", "")))

	var location_id := str(capability.get("locationId", ""))
	if location_id == "" and not location.is_empty():
		location_id = str(location.get("locationId", ""))
	if location_id == "" and not resident.is_empty():
		location_id = str(resident.get("locationId", ""))
	if location_id != "":
		payload["locationId"] = location_id
	elif category == "location" or ActionMenuPolicyScript.is_location_action(action_type):
		action_rejected_locally.emit("Enter a location first.")
		return

	var params = _capability_params(capability)
	if typeof(params) == TYPE_DICTIONARY:
		payload["params"] = params

	bridge.post_action(payload)

func _next_client_action_id(action_type: String) -> String:
	if _client_session_id == "":
		_client_session_id = "%x-%x" % [int(Time.get_unix_time_from_system() * 1000.0), randi()]
	_client_action_sequence += 1
	return "godot:%s:%s:%d" % [_client_session_id, action_type, _client_action_sequence]

func _capability_params(capability: Dictionary):
	var selected_option = capability.get("selectedOption", {})
	if typeof(selected_option) == TYPE_DICTIONARY:
		var selected_params = selected_option.get("params", {})
		if typeof(selected_params) == TYPE_DICTIONARY:
			return selected_params

	var options = capability.get("options", [])
	if typeof(options) == TYPE_ARRAY and not options.is_empty():
		var first_option = options[0]
		if typeof(first_option) == TYPE_DICTIONARY:
			var option_params = first_option.get("params", {})
			if typeof(option_params) == TYPE_DICTIONARY:
				return option_params

	return capability.get("params", {})

func _default_intent(action_type: String) -> String:
	match action_type:
		"talk":
			return "打个招呼，询问今日坊市见闻"
		"trade":
			return "尝试交易"
		"gift":
			return "赠出一份薄礼"
		"request_teaching":
			return "请教修行经验"
		"spar":
			return "请求切磋"
		"explore":
			return "探查当前地点"
		"cultivate":
			return "吐纳修行"
		"breakthrough":
			return "尝试突破"
		_:
			return "执行 " + action_type

func _tile_payload(tile: Vector2) -> Dictionary:
	return {
		"x": tile.x,
		"y": tile.y
	}
