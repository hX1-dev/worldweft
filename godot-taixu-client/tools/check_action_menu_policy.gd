extends SceneTree

const ActionMenuPolicyScript := preload("res://scripts/ActionMenuPolicy.gd")

var failures: Array = []

func _init() -> void:
	call_deferred("_run")

func _run() -> void:
	_assert(ActionMenuPolicyScript.is_target_action("talk"), "talk is a target action")
	_assert(not ActionMenuPolicyScript.is_target_action("cultivate"), "cultivate is not a target action")
	_assert(ActionMenuPolicyScript.is_location_action("breakthrough"), "breakthrough is a location action")
	_assert(ActionMenuPolicyScript.requires_confirmation({ "type": "trade" }), "trade requires confirmation")
	_assert(not ActionMenuPolicyScript.requires_confirmation({ "type": "talk" }), "talk does not require confirmation")

	var no_target := ActionMenuPolicyScript.local_availability(
		{ "type": "gift", "category": "target" }, false, INF, true, 5.0
	)
	_assert(no_target.get("enabled", true) == false, "target action requires a selected resident")
	_assert(str(no_target.get("reason", "")).contains("Select"), "missing target reason is explicit")
	var far_target := ActionMenuPolicyScript.local_availability(
		{ "type": "spar" }, true, 7.0, true, 5.0
	)
	_assert(far_target.get("enabled", true) == false, "out-of-range target action is disabled")
	var nearby_target := ActionMenuPolicyScript.local_availability(
		{ "type": "talk" }, true, 4.9, false, 5.0
	)
	_assert(nearby_target.get("enabled", false) == true, "nearby target action is locally enabled")
	var no_location := ActionMenuPolicyScript.local_availability(
		{ "type": "cultivate", "category": "location" }, false, INF, false, 5.0
	)
	_assert(no_location.get("enabled", true) == false, "location action requires a semantic location")

	var resident := { "actorId": "qinglan:test" }
	var location := { "locationId": "market_test" }
	var snapshot := ActionMenuPolicyScript.confirmation_snapshot("world_test", resident, location)
	_assert(
		ActionMenuPolicyScript.confirmation_context_is_current(snapshot, "world_test", resident, location),
		"unchanged confirmation context is accepted"
	)
	_assert(
		not ActionMenuPolicyScript.confirmation_context_is_current(snapshot, "world_other", resident, location),
		"world change invalidates confirmation"
	)
	_assert(
		not ActionMenuPolicyScript.confirmation_context_is_current(snapshot, "world_test", { "actorId": "qinglan:other" }, location),
		"target change invalidates confirmation"
	)
	_assert(
		not ActionMenuPolicyScript.confirmation_context_is_current(snapshot, "world_test", resident, {}),
		"leaving a location invalidates confirmation"
	)
	var empty_snapshot := ActionMenuPolicyScript.confirmation_snapshot("world_test", {}, {})
	_assert(
		not ActionMenuPolicyScript.confirmation_context_is_current(empty_snapshot, "world_test", {}, location),
		"entering a location invalidates an empty-location snapshot"
	)

	if failures.is_empty():
		print("Godot action menu policy check passed.")
		quit(0)
	else:
		for failure in failures:
			push_error(str(failure))
		quit(1)

func _assert(condition: bool, message: String) -> void:
	if not condition:
		failures.append(message)
