extends Node
class_name ConvexBridge

const CONTRACT_VERSION := "godot_bridge_v1"

signal world_state_received(payload: Dictionary)
signal region_state_received(payload: Dictionary)
signal action_completed(payload: Dictionary)
signal action_record_received(payload: Dictionary)
signal presentation_preview_received(payload: Dictionary)
signal capabilities_received(payload: Dictionary)
signal actor_context_received(payload: Dictionary)
signal replay_trace_received(payload: Dictionary)
signal tick_completed(payload: Dictionary)
signal request_failed(label: String, status_code: int, message: String)

@export var base_url := "http://127.0.0.1:3211"
@export var map_id := "qinglan"
@export var player_token_environment := "GODOT_BRIDGE_TOKEN"
@export var debug_token_environment := "GODOT_BRIDGE_DEBUG_TOKEN"

var _http: HTTPRequest
var _active_label := ""
var _active_request: Dictionary = {}
var _request_queue: Array = []
var _player_bearer_token := ""
var _debug_bearer_token := ""

func _ready() -> void:
	_player_bearer_token = OS.get_environment(player_token_environment).strip_edges()
	_debug_bearer_token = OS.get_environment(debug_token_environment).strip_edges()
	_http = HTTPRequest.new()
	_http.name = "ConvexHTTPRequest"
	_http.timeout = 30.0
	_http.request_completed.connect(_on_request_completed)
	add_child(_http)

func get_world_state() -> void:
	get_world_state_page()

func get_world_state_page(limit: int = 12, residents_cursor: String = "", events_cursor: String = "") -> void:
	var path := "/godot/worldState?mapId=" + map_id.uri_encode()
	path += "&limit=" + str(clampi(limit, 1, 50))
	if residents_cursor != "":
		path += "&residentsCursor=" + residents_cursor.uri_encode()
	if events_cursor != "":
		path += "&eventsCursor=" + events_cursor.uri_encode()
	_request("world", path, HTTPClient.METHOD_GET)

func get_region_state() -> void:
	get_region_state_page()

func get_region_state_page(
	limit: int = 20,
	locations_cursor: String = "",
	residents_cursor: String = "",
	events_cursor: String = ""
) -> void:
	var path := "/godot/regionState?mapId=" + map_id.uri_encode()
	path += "&limit=" + str(clampi(limit, 1, 50))
	if locations_cursor != "":
		path += "&locationsCursor=" + locations_cursor.uri_encode()
	if residents_cursor != "":
		path += "&residentsCursor=" + residents_cursor.uri_encode()
	if events_cursor != "":
		path += "&eventsCursor=" + events_cursor.uri_encode()
	_request("region", path, HTTPClient.METHOD_GET)

func post_action(payload: Dictionary) -> void:
	_request("action", "/godot/action", HTTPClient.METHOD_POST, payload)

func get_action_record(world_id: String, action_record_id: String) -> void:
	if action_record_id == "":
		request_failed.emit("actionRecord", 0, "Missing actionRecordId.")
		return
	var path := "/godot/actionRecord?actionRecordId=" + action_record_id.uri_encode()
	if world_id != "":
		path += "&worldId=" + world_id.uri_encode()
	_request("actionRecord", path, HTTPClient.METHOD_GET)

func get_presentation_preview(world_id: String, action_record_id: String, mode: String = "llm_polish") -> void:
	if action_record_id == "":
		request_failed.emit("presentationPreview", 0, "Missing actionRecordId.")
		return
	var path := "/godot/presentationPreview?actionRecordId=" + action_record_id.uri_encode()
	if world_id != "":
		path += "&worldId=" + world_id.uri_encode()
	if mode != "":
		path += "&mode=" + mode.uri_encode()
	_request("presentationPreview", path, HTTPClient.METHOD_GET)

func post_capabilities(payload: Dictionary) -> void:
	_request("capabilities", "/godot/capabilities", HTTPClient.METHOD_POST, payload)

func get_actor_context(world_id: String, actor_id: String, viewer_actor_id: String = "godot_player") -> void:
	var path := "/godot/actorContext?mapId=" + map_id.uri_encode()
	path += "&actorId=" + actor_id.uri_encode()
	if world_id != "":
		path += "&worldId=" + world_id.uri_encode()
	if viewer_actor_id != "":
		path += "&viewerActorId=" + viewer_actor_id.uri_encode()
	_request("actorContext", path, HTTPClient.METHOD_GET)

func get_replay_trace(world_id: String, actor_id: String = "", limit: int = 10, cursor: String = "") -> void:
	var path := "/godot/replay?mapId=" + map_id.uri_encode()
	path += "&limit=" + str(clampi(limit, 1, 50))
	if world_id != "":
		path += "&worldId=" + world_id.uri_encode()
	if actor_id != "":
		path += "&actorId=" + actor_id.uri_encode()
	if cursor != "":
		path += "&cursor=" + cursor.uri_encode()
	_request("replay", path, HTTPClient.METHOD_GET)

func post_tick(world_id: String, limit: int = 2) -> void:
	var payload := {
		"worldId": world_id if world_id != "" else null,
		"mapId": map_id,
		"limit": limit,
		"tickId": "godot:%d:%d" % [int(Time.get_unix_time_from_system()), Time.get_ticks_usec()]
	}
	_request("tick", "/godot/tick", HTTPClient.METHOD_POST, payload)

func is_busy() -> bool:
	return _active_label != "" or (_http != null and _http.get_http_client_status() != HTTPClient.STATUS_DISCONNECTED)

func has_pending_action() -> bool:
	if _active_label == "action" or str(_active_request.get("label", "")) == "action":
		return true
	for request in _request_queue:
		if typeof(request) == TYPE_DICTIONARY and str(request.get("label", "")) == "action":
			return true
	return false

func debug_tick_available() -> bool:
	return _debug_bearer_token != ""

func configure_bearer_tokens(player_token: String, debug_token: String = "") -> void:
	_player_bearer_token = player_token.strip_edges()
	_debug_bearer_token = debug_token.strip_edges()

func _request(label: String, path: String, method: int, payload: Dictionary = {}) -> void:
	if OS.get_environment("GODOT_BRIDGE_DISABLE_NETWORK") == "1":
		return
	if is_busy():
		_enqueue_request({
			"label": label,
			"path": path,
			"method": method,
			"payload": payload.duplicate(true),
			"attempt": 0,
		})
		return

	_start_request({
		"label": label,
		"path": path,
		"method": method,
		"payload": payload.duplicate(true),
		"attempt": 0,
	})

func _enqueue_request(request: Dictionary) -> void:
	if ["capabilities", "actorContext", "replay"].has(str(request.get("label", ""))):
		for index in range(_request_queue.size() - 1, -1, -1):
			var queued = _request_queue[index]
			if typeof(queued) == TYPE_DICTIONARY and str(queued.get("label", "")) == str(request.get("label", "")):
				_request_queue.remove_at(index)
	_request_queue.append(request)

func _start_next_request() -> void:
	if _active_label != "" or _request_queue.is_empty():
		return
	if _http != null and _http.get_http_client_status() != HTTPClient.STATUS_DISCONNECTED:
		call_deferred("_start_next_request")
		return
	var request = _request_queue.pop_front()
	if typeof(request) != TYPE_DICTIONARY:
		call_deferred("_start_next_request")
		return
	_start_request(request)

func _start_request(request: Dictionary) -> void:
	if _http == null:
		request_failed.emit(str(request.get("label", "request")), 0, "HTTPRequest node is not ready.")
		call_deferred("_start_next_request")
		return

	var label := str(request.get("label", "request"))
	var path := str(request.get("path", "/"))
	var method := int(request.get("method", HTTPClient.METHOD_GET))
	var payload = request.get("payload", {})
	if typeof(payload) != TYPE_DICTIONARY:
		payload = {}
	var bearer_token := _debug_bearer_token if label == "tick" else _player_bearer_token
	if bearer_token == "":
		request_failed.emit(label, 0, _missing_credential_message(label))
		call_deferred("_start_next_request")
		return

	_active_label = label
	_active_request = request.duplicate(true)
	var headers := PackedStringArray([
		"Content-Type: application/json",
		"Authorization: Bearer " + bearer_token,
	])
	var body := ""
	if method != HTTPClient.METHOD_GET:
		body = JSON.stringify(payload)

	var err := _http.request(base_url + path, headers, method, body)
	if err != OK:
		_active_label = ""
		_active_request = {}
		if _queue_action_retry(request, HTTPRequest.RESULT_CANT_CONNECT, 0):
			return
		request_failed.emit(label, 0, "Failed to start request: " + str(err))
		call_deferred("_start_next_request")

func _on_request_completed(
	result: int,
	response_code: int,
	_headers: PackedStringArray,
	body: PackedByteArray
) -> void:
	var label := _active_label
	var request := _active_request.duplicate(true)
	_active_label = ""
	_active_request = {}
	var text := body.get_string_from_utf8()
	if result != HTTPRequest.RESULT_SUCCESS:
		if _queue_action_retry(request, result, response_code):
			return
		request_failed.emit(label, response_code, "Transport error: " + str(result))
		call_deferred("_start_next_request")
		return
	if response_code < 200 or response_code >= 300:
		if _queue_action_retry(request, result, response_code):
			return
		request_failed.emit(label, response_code, _response_error_message(text))
		call_deferred("_start_next_request")
		return
	if text.strip_edges() == "":
		request_failed.emit(label, response_code, "Response was empty.")
		call_deferred("_start_next_request")
		return
	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		request_failed.emit(label, response_code, "Response was not JSON: " + text)
		call_deferred("_start_next_request")
		return

	var payload: Dictionary = parsed
	if str(payload.get("contractVersion", "")) != CONTRACT_VERSION:
		request_failed.emit(label, response_code, "Bridge contract version mismatch.")
		call_deferred("_start_next_request")
		return
	var shape_error := _validate_success_payload(label, payload)
	if shape_error != "":
		request_failed.emit(label, response_code, shape_error)
		call_deferred("_start_next_request")
		return
	match label:
		"world":
			world_state_received.emit(payload)
		"region":
			region_state_received.emit(payload)
		"action":
			action_completed.emit(payload)
		"actionRecord":
			action_record_received.emit(payload)
		"presentationPreview":
			presentation_preview_received.emit(payload)
		"capabilities":
			capabilities_received.emit(payload)
		"actorContext":
			actor_context_received.emit(payload)
		"replay":
			replay_trace_received.emit(payload)
		"tick":
			tick_completed.emit(payload)
		_:
			request_failed.emit(label, response_code, "Unknown request label.")
	call_deferred("_start_next_request")

func _missing_credential_message(label: String) -> String:
	if label == "tick":
		return "Debug tick is unavailable. Set GODOT_BRIDGE_DEBUG_TOKEN in the process environment."
	return "Godot bridge credential is missing. Set GODOT_BRIDGE_TOKEN in the process environment."

func _queue_action_retry(request: Dictionary, result: int, response_code: int) -> bool:
	if not _should_retry_action_request(request, result, response_code):
		return false
	var retry := request.duplicate(true)
	retry["attempt"] = int(request.get("attempt", 0)) + 1
	_request_queue.push_front(retry)
	call_deferred("_start_next_request")
	return true

func _should_retry_action_request(request: Dictionary, result: int, response_code: int) -> bool:
	if str(request.get("label", "")) != "action" or int(request.get("attempt", 0)) >= 1:
		return false
	if result != HTTPRequest.RESULT_SUCCESS:
		return true
	return response_code == 408 or response_code == 425 or response_code == 429 or response_code >= 500

func _response_error_message(text: String) -> String:
	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return text
	var payload: Dictionary = parsed
	var code := str(payload.get("errorCode", "bridge_error"))
	var message := str(payload.get("error", "Bridge request failed."))
	var version := str(payload.get("contractVersion", ""))
	if version != "" and version != CONTRACT_VERSION:
		return "[bridge_contract_mismatch] Bridge contract version mismatch."
	return "[%s] %s" % [code, message]

func _validate_success_payload(label: String, payload: Dictionary) -> String:
	if payload.get("ok", false) != true:
		return "Bridge success response must include ok=true."
	match label:
		"world":
			if str(payload.get("worldId", "")) == "" or str(payload.get("mapId", "")) == "" or typeof(payload.get("actors", null)) != TYPE_DICTIONARY or typeof(payload.get("recentEvents", null)) != TYPE_ARRAY:
				return "World response is missing worldId, mapId, actors, or recentEvents."
			var world_page_error := _pagination_error(payload, PackedStringArray(["residents", "recentEvents"]))
			if world_page_error != "":
				return world_page_error
		"region":
			if str(payload.get("worldId", "")) == "" or str(payload.get("mapId", "")) == "" or typeof(payload.get("residents", null)) != TYPE_ARRAY or typeof(payload.get("locations", null)) != TYPE_ARRAY or typeof(payload.get("recentEvents", null)) != TYPE_ARRAY:
				return "Region response is missing worldId, mapId, residents, locations, or recentEvents."
			var region_page_error := _pagination_error(payload, PackedStringArray(["locations", "residents", "recentEvents"]))
			if region_page_error != "":
				return region_page_error
		"action":
			if str(payload.get("actionRecordId", "")) == "" or str(payload.get("eventId", "")) == "" or str(payload.get("resultCode", "")) == "" or str(payload.get("clientActionId", "")) == "":
				return "Action response is missing lifecycle anchors."
		"actionRecord":
			if str(payload.get("actionRecordId", "")) == "" or str(payload.get("worldEventId", "")) == "":
				return "Action record response is missing lifecycle anchors."
		"presentationPreview":
			if str(payload.get("actionRecordId", "")) == "" or typeof(payload.get("polishPreview", null)) != TYPE_DICTIONARY:
				return "Presentation preview response is incomplete."
		"capabilities":
			if typeof(payload.get("actions", null)) != TYPE_ARRAY:
				return "Capabilities response is missing actions."
		"actorContext":
			if str(payload.get("actorId", "")) == "" or typeof(payload.get("recentActions", null)) != TYPE_ARRAY or typeof(payload.get("contextWindow", null)) != TYPE_DICTIONARY:
				return "Actor context response is incomplete."
		"replay":
			if typeof(payload.get("entries", null)) != TYPE_ARRAY or typeof(payload.get("summary", null)) != TYPE_DICTIONARY:
				return "Replay response is incomplete."
			var replay_page_error := _pagination_error(payload, PackedStringArray())
			if replay_page_error != "":
				return replay_page_error
		"tick":
			var tick = payload.get("tick", null)
			if typeof(tick) != TYPE_DICTIONARY:
				return "Tick response is missing tick metadata."
			var lease = tick.get("lease", null)
			if typeof(lease) != TYPE_DICTIONARY or typeof(lease.get("acquired", null)) != TYPE_BOOL or str(lease.get("tickId", "")) == "":
				return "Tick response is missing lease metadata."
			var scheduler = tick.get("scheduler", null)
			if typeof(scheduler) != TYPE_DICTIONARY or str(scheduler.get("scope", "")) == "" or typeof(scheduler.get("actorIds", null)) != TYPE_ARRAY or not _is_json_integer(scheduler.get("eligibleCount", null)) or typeof(scheduler.get("wrapped", null)) != TYPE_BOOL:
				return "Tick response is missing scheduler metadata."
			if typeof(payload.get("tickEvents", null)) != TYPE_ARRAY or typeof(payload.get("recentEvents", null)) != TYPE_ARRAY:
				return "Tick response is incomplete."
	return ""

func _pagination_error(payload: Dictionary, collection_keys: PackedStringArray) -> String:
	var pagination = payload.get("pagination", null)
	if typeof(pagination) != TYPE_DICTIONARY:
		return "Bridge response is missing pagination metadata."
	var pages: Array = [pagination] if collection_keys.is_empty() else []
	for key in collection_keys:
		var page = pagination.get(key, null)
		if typeof(page) != TYPE_DICTIONARY:
			return "Bridge response is missing pagination metadata for " + key + "."
		pages.append(page)
	for page_value in pages:
		var page: Dictionary = page_value
		if not _is_json_integer(page.get("limit", null)) or not _is_json_integer(page.get("returned", null)):
			return "Bridge pagination metadata is missing integer limits."
		if typeof(page.get("isDone", null)) != TYPE_BOOL or typeof(page.get("truncated", null)) != TYPE_BOOL:
			return "Bridge pagination metadata is missing completion state."
		var cursor = page.get("continueCursor", null)
		if bool(page.get("isDone", false)):
			if cursor != null:
				return "Completed bridge page must clear continueCursor."
		elif typeof(cursor) != TYPE_STRING or str(cursor) == "":
			return "Truncated bridge page must include continueCursor."
	return ""

func _is_json_integer(value) -> bool:
	var value_type := typeof(value)
	if value_type == TYPE_INT:
		return int(value) >= 0
	if value_type == TYPE_FLOAT:
		var number := float(value)
		return is_finite(number) and number >= 0.0 and number == floor(number)
	return false
