extends SceneTree

const ActionClientScript := preload("res://scripts/ActionClient.gd")
const ConvexBridgeScript := preload("res://scripts/ConvexBridge.gd")

var failures: Array = []

class MockBridge:
	var payloads: Array = []
	var pending := false

	func post_action(payload: Dictionary) -> void:
		payloads.append(payload.duplicate(true))
		pending = true

	func has_pending_action() -> bool:
		return pending

func _init() -> void:
	call_deferred("_run")

func _run() -> void:
	var client = ActionClientScript.new()
	root.add_child(client)
	await process_frame
	var bridge := MockBridge.new()
	client.configure(bridge)
	var rejected: Array = []
	client.action_rejected_locally.connect(func(message: String) -> void: rejected.append(message))
	var capability := {
		"type": "talk",
		"category": "target",
		"enabled": true,
		"intent": "contract talk",
		"params": {},
	}
	var resident := {
		"actorId": "qinglan:contract-resident",
		"locationId": "market_main_street",
	}
	var location := { "locationId": "market_main_street" }

	client.submit_capability(capability, resident, location, "world_contract", Vector2(1, 2), 5.0)
	_assert(bridge.payloads.size() == 1, "first semantic action is submitted")
	var first_id := str(bridge.payloads[0].get("clientActionId", ""))
	_assert(first_id.begins_with("godot:"), "action payload has a clientActionId")

	client.submit_capability(capability, resident, location, "world_contract", Vector2(1, 2), 5.0)
	_assert(bridge.payloads.size() == 1, "pending action blocks duplicate submit")
	_assert(not rejected.is_empty(), "pending duplicate emits a local rejection")

	bridge.pending = false
	client.submit_capability(capability, resident, location, "world_contract", Vector2(1, 2), 5.0)
	_assert(bridge.payloads.size() == 2, "new command submits after pending action clears")
	_assert(str(bridge.payloads[1].get("clientActionId", "")) != first_id, "new command gets a new clientActionId")

	bridge.pending = false
	var use_item_capability := {
		"type": "use_item",
		"category": "self",
		"enabled": true,
		"params": { "itemId": "ignored_fallback", "unexpected": "must_not_submit" },
		"options": [{
			"itemId": "healing_pill",
			"params": { "itemId": "healing_pill", "previewOnly": true },
		}],
	}
	client.submit_capability(use_item_capability, resident, location, "world_contract", Vector2(1, 2), 5.0)
	_assert(bridge.payloads.size() == 3, "self healing item action submits")
	var use_item_payload: Dictionary = bridge.payloads[2]
	_assert(str(use_item_payload.get("type", "")) == "use_item", "self action preserves use_item type")
	_assert(str(use_item_payload.get("intent", "")) == "服用疗伤丹恢复气血", "self action uses a healing default intent")
	_assert(not use_item_payload.has("targetActorId"), "self action never submits a selected resident")
	_assert(not use_item_payload.has("locationId"), "self action never submits a selected location")
	_assert(not use_item_payload.has("interactionRangeTiles"), "self action does not submit an interaction range")
	var use_item_params: Dictionary = use_item_payload.get("params", {})
	_assert(use_item_params.size() == 1, "self action submits exactly one item parameter")
	_assert(str(use_item_params.get("itemId", "")) == "healing_pill", "self action submits the selected healing item")

	bridge.pending = false
	var payload_count_before_missing_item: int = bridge.payloads.size()
	client.submit_capability(
		{ "type": "use_item", "category": "self", "enabled": true, "params": {} },
		resident,
		location,
		"world_contract",
		Vector2(1, 2),
		5.0
	)
	_assert(bridge.payloads.size() == payload_count_before_missing_item, "missing self itemId is rejected locally")
	_assert(str(rejected[-1]).contains("itemId"), "missing self itemId rejection is explicit")

	var retry_bridge = ConvexBridgeScript.new()
	var request := { "label": "action", "attempt": 0 }
	_assert(retry_bridge._should_retry_action_request(request, HTTPRequest.RESULT_TIMEOUT, 0), "transport timeout retries action")
	_assert(retry_bridge._should_retry_action_request(request, HTTPRequest.RESULT_SUCCESS, 503), "server error retries action")
	_assert(not retry_bridge._should_retry_action_request({ "label": "action", "attempt": 1 }, HTTPRequest.RESULT_TIMEOUT, 0), "action retries at most once")
	_assert(not retry_bridge._should_retry_action_request({ "label": "capabilities", "attempt": 0 }, HTTPRequest.RESULT_TIMEOUT, 0), "read request is not action-retried")
	var retry_request := {
		"label": "action",
		"attempt": 0,
		"payload": { "clientActionId": first_id },
	}
	_assert(retry_bridge._queue_action_retry(retry_request, HTTPRequest.RESULT_TIMEOUT, 0), "retry is queued")
	_assert(retry_bridge._request_queue.size() == 1, "retry queue contains one action")
	_assert(int(retry_bridge._request_queue[0].get("attempt", 0)) == 1, "retry attempt increments")
	_assert(str(retry_bridge._request_queue[0].get("payload", {}).get("clientActionId", "")) == first_id, "retry preserves clientActionId")
	_assert(
		retry_bridge._response_error_message(JSON.stringify({
			"contractVersion": "godot_bridge_v1",
			"errorCode": "unknown_action_type",
			"error": "Action type is unsupported.",
		})) == "[unknown_action_type] Action type is unsupported.",
		"structured bridge errors preserve code and message"
	)
	_assert(
		retry_bridge._response_error_message(JSON.stringify({
			"contractVersion": "future_bridge_v2",
			"errorCode": "bad",
			"error": "bad",
		})) == "[bridge_contract_mismatch] Bridge contract version mismatch.",
		"error response version mismatch is explicit"
	)
	_assert(
		retry_bridge._validate_success_payload("action", {
			"ok": true,
			"actionRecordId": "ar_contract",
			"eventId": "we_contract",
			"resultCode": "conversation_started",
			"clientActionId": first_id,
		}) == "",
		"valid action response shape is accepted"
	)
	_assert(
		retry_bridge._validate_success_payload("action", { "ok": true }) == "Action response is missing lifecycle anchors.",
		"drifted action response shape is rejected"
	)
	var movement_goal := {
		"commandId": "move_contract",
		"actionRecordId": "ar_contract",
		"revision": 1,
		"actorId": "qinglan_valley_gate:resting_disciple",
		"mapId": "qinglan_valley_gate",
		"intent": "visit bridge",
		"decisionSource": "llm",
		"requestedTarget": { "kind": "location", "locationId": "creek_bridge" },
		"acceptedTile": { "x": 24, "y": 18 },
		"issuedAt": 1000,
		"expiresAt": 61000,
	}
	_assert(
		retry_bridge._validate_success_payload("movementGoals", {
			"ok": true,
			"movementProtocolVersion": 1,
			"mapId": "qinglan_valley_gate",
			"goals": [movement_goal],
			"cancellations": [{
				"commandId": "move_cancelled",
				"revision": 2,
				"actorId": "qinglan_valley_gate:resting_disciple",
				"mapId": "qinglan_valley_gate",
				"reasonCode": "actor_incapacitated",
				"cancelledAt": 62000,
			}],
		}) == "",
		"valid movement goal and cancellation response is accepted"
	)
	_assert(
		retry_bridge._validate_success_payload("movementGoals", {
			"ok": true,
			"movementProtocolVersion": 1,
			"mapId": "qinglan_valley_gate",
			"goals": [],
		}) == "",
		"legacy movement goal response may omit cancellations"
	)
	_assert(
		retry_bridge._validate_success_payload("movementGoals", {
			"ok": true,
			"movementProtocolVersion": 1,
			"mapId": "qinglan_valley_gate",
			"goals": [],
			"cancellations": {},
		}) == "Movement goals response cancellations must be an array.",
		"movement cancellation collection rejects a non-array value"
	)
	_assert(
		retry_bridge._validate_success_payload("movementGoals", {
			"ok": true,
			"movementProtocolVersion": 1,
			"mapId": "qinglan_valley_gate",
			"goals": [],
			"cancellations": [{"commandId": "move_cancelled"}],
		}) == "Movement cancellation is missing identity or reason fields.",
		"incomplete movement cancellation is rejected"
	)
	_assert(
		retry_bridge._validate_success_payload("movementGoals", {
			"ok": true,
			"movementProtocolVersion": 1,
			"mapId": "qinglan_valley_gate",
			"goals": [{ "commandId": "broken" }],
		}) == "Movement goal is missing identity fields.",
		"incomplete movement goal response is rejected"
	)
	_assert(
		retry_bridge._validate_success_payload("movementReport", {
			"ok": true,
			"movementProtocolVersion": 1,
			"commandId": "move_contract",
			"revision": 1,
			"status": "moving",
		}) == "",
		"valid movement report acknowledgement is accepted"
	)
	_assert(
		retry_bridge._should_retry_action_request({ "label": "movementReport", "attempt": 0 }, HTTPRequest.RESULT_TIMEOUT, 0),
		"movement report retries once after a transport failure"
	)
	_assert(
		not retry_bridge._should_retry_action_request({ "label": "movementGoals", "attempt": 0 }, HTTPRequest.RESULT_TIMEOUT, 0),
		"movement goal reads are deduplicated instead of write-retried"
	)
	retry_bridge._request_queue.clear()
	retry_bridge._active_label = "contract_test_busy"
	retry_bridge.post_movement_report({ "commandId": "move_contract", "revision": 1, "status": "moving", "positionTiles": { "x": 1, "y": 1 } })
	retry_bridge.post_movement_report({ "commandId": "move_contract", "revision": 1, "status": "moving", "positionTiles": { "x": 2, "y": 1 } })
	_assert(retry_bridge._request_queue.size() == 1, "queued movement samples are coalesced per command")
	_assert(float(retry_bridge._request_queue[0].get("payload", {}).get("positionTiles", {}).get("x", 0)) == 2.0, "coalesced report keeps the newest position")
	retry_bridge.post_movement_report({ "commandId": "move_contract", "revision": 2, "status": "moving", "positionTiles": { "x": 2, "y": 2 } })
	_assert(retry_bridge._request_queue.size() == 2, "movement sample coalescing does not erase a different revision")
	retry_bridge.post_movement_report({ "commandId": "move_contract", "revision": 1, "status": "arrived", "positionTiles": { "x": 3, "y": 1 } })
	_assert(retry_bridge._request_queue.size() == 3, "terminal movement report is never coalesced away")
	retry_bridge._request_queue.clear()
	retry_bridge._active_label = ""
	var complete_page := {
		"limit": 20,
		"returned": 1,
		"isDone": true,
		"truncated": false,
		"continueCursor": null,
	}
	var region_pagination := {
		"locations": complete_page.duplicate(true),
		"residents": complete_page.duplicate(true),
		"recentEvents": complete_page.duplicate(true),
	}
	_assert(
		retry_bridge._validate_success_payload("region", {
			"ok": true,
			"worldId": "world_contract",
			"mapId": "qinglan",
			"locations": [],
			"residents": [],
			"recentEvents": [],
			"pagination": region_pagination,
		}) == "",
		"valid paginated region response is accepted"
	)
	var parsed_region = JSON.parse_string(JSON.stringify({
		"ok": true,
		"worldId": "world_contract",
		"mapId": "qinglan",
		"locations": [],
		"residents": [],
		"recentEvents": [],
		"pagination": region_pagination,
	}))
	_assert(typeof(parsed_region) == TYPE_DICTIONARY, "HTTP-style region JSON parses as dictionary")
	_assert(
		retry_bridge._validate_success_payload("region", parsed_region) == "",
		"HTTP JSON numeric pagination metadata is accepted"
	)
	var fractional_region: Dictionary = parsed_region.duplicate(true)
	fractional_region["pagination"]["locations"]["limit"] = 20.5
	_assert(
		retry_bridge._validate_success_payload("region", fractional_region) == "Bridge pagination metadata is missing integer limits.",
		"fractional pagination metadata is rejected"
	)
	_assert(
		retry_bridge._validate_success_payload("region", {
			"ok": true,
			"worldId": "world_contract",
			"mapId": "qinglan",
			"locations": [],
			"residents": [],
			"recentEvents": [],
		}) == "Bridge response is missing pagination metadata.",
		"region response without pagination is rejected"
	)
	_assert(
		retry_bridge._validate_success_payload("replay", {
			"ok": true,
			"entries": [],
			"summary": {},
			"pagination": complete_page,
		}) == "",
		"valid paginated replay response is accepted"
	)
	var broken_page := complete_page.duplicate(true)
	broken_page["isDone"] = false
	broken_page["truncated"] = true
	_assert(
		retry_bridge._validate_success_payload("replay", {
			"ok": true,
			"entries": [],
			"summary": {},
			"pagination": broken_page,
		}) == "Truncated bridge page must include continueCursor.",
		"truncated replay response without cursor is rejected"
	)
	retry_bridge._request_queue.clear()
	retry_bridge._active_label = "contract_test_busy"
	retry_bridge.get_region_state_page(99, "loc cursor", "resident cursor", "event cursor")
	retry_bridge.get_replay_trace("world_contract", "actor_contract", 0, "replay cursor")
	var region_path := str(retry_bridge._request_queue[0].get("path", ""))
	var replay_path := str(retry_bridge._request_queue[1].get("path", ""))
	_assert(region_path.contains("limit=50"), "region page size is clamped to contract maximum")
	_assert(region_path.contains("locationsCursor=loc%20cursor"), "region continuation cursor is encoded")
	_assert(replay_path.contains("limit=1"), "replay page size is clamped to contract minimum")
	_assert(replay_path.contains("cursor=replay%20cursor"), "replay continuation cursor is encoded")
	client.free()
	retry_bridge.free()

	if failures.is_empty():
		print("Godot action client contract check passed.")
		quit(0)
	else:
		for failure in failures:
			push_error(str(failure))
		quit(1)

func _assert(condition: bool, message: String) -> void:
	if not condition:
		failures.append(message)
