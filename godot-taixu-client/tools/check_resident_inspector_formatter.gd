extends SceneTree

const ResidentInspectorFormatterScript := preload("res://scripts/ResidentInspectorFormatter.gd")

var failures: Array = []

func _init() -> void:
	var formatter = ResidentInspectorFormatterScript.new()
	var now_ms := 100000.0
	var locations: Array = [
		{ "locationId": "market_tea_stall", "name": "Tea Stall" },
		{ "locationId": "market_medicine_shop", "name": "Medicine Shop" },
	]
	var resident: Dictionary = {
		"actorId": "qinglan:qinglan-elder-mu",
		"name": "Elder Mu",
		"role": "elder",
		"locationId": "market_tea_stall",
		"tile": { "x": 34.0, "y": 31.0 },
		"targetTile": { "x": 35.0, "y": 31.5 },
		"finalTargetTile": { "x": 38.0, "y": 35.0 },
		"waypointId": "tea_stall_seat",
		"status": "teaching",
		"activityLabel": "Teaching at tea stall",
		"intent": "Offer short guidance to nearby disciples while watching the market.",
		"nextActionAt": 110000.0,
		"routePreview": {
			"waypointLabel": "Tea Stall Seat",
			"lengthTiles": 10.0,
			"remainingTiles": 3.5,
			"etaSeconds": 12.0,
			"etaLabel": "12s",
			"pathStepCount": 4,
			"nextStepDistanceTiles": 0.8,
			"routeSummary": "Moving from tea stall toward medicine shop for the next teaching loop.",
			"source": "navigation_graph",
			"nextTile": { "x": 35.2, "y": 31.6 },
			"nextStepLabel": "east",
			"movementState": "moving",
			"status": "connected",
			"schedulePreview": {
				"summary": "Teaching loop continues at the tea stall.",
				"phase": "at_waypoint",
				"destinationLabel": "Medicine Shop",
				"activityLabel": "Teaching",
				"nextActionAt": 105000.0,
			},
			"scheduleRoute": {
				"summary": "Patrol route summary",
				"source": "resident_route",
				"routeCount": 4,
				"currentIndex": 1,
				"nextStop": { "label": "River Market" },
				"upcomingStops": [
					{ "label": "Tea Stall" },
					{ "label": "Medicine Shop" },
					{ "label": "West Gate" },
					{ "label": "River Dock" },
				],
			},
		},
	}
	var actor_context: Dictionary = {
		"profile": {
			"realm": "foundation",
			"realmStage": 1,
			"health": 92,
			"spirit": 45,
			"reputation": 18,
			"inventoryCount": 7,
		},
		"relationship": {
			"viewerToActor": { "affinity": 4, "trust": 6, "suspicion": 1 },
			"actorToViewer": { "affinity": 8, "trust": 9, "suspicion": 0 },
		},
		"recentActions": [
			{
				"actionRecordId": "arabcdef123456",
				"worldEventId": "we9876543210",
				"displayText": "Trade completed by rules.",
				"type": "trade",
				"resultCode": "trade_completed",
			},
		],
	}

	var output: String = formatter.render_selected_detail(resident, actor_context, locations, now_ms)
	_assert_contains(output, "Activity: Teaching at tea stall (teaching) | place Tea Stall | waypoint tea_stall_seat | next ~10s", "activity line")
	_assert_contains(output, "Intent: Offer short guidance to nearby disciples while watching the market.", "intent line")
	_assert_contains(output, "Route: 34.0,31.0 -> 35.0,31.5 -> 38.0,35.0", "route line")
	_assert_contains(output, "Schedule: Teaching loop continues at the tea stall. | at_waypoint -> Medicine Shop | next ~5s", "schedule preview")
	_assert_contains(output, "Loop: 2/4 -> River Market | Patrol route summary | next Tea Stall / Medicine Shop / West Gate | resident_route", "schedule route")
	_assert_contains(output, "Preview: Moving from tea stall toward medicine shop for the next teaching lo... | 3.5 left of 10.0 tiles | ETA 12s | steps 4 | next east 35.2,31.6 0.8 tiles | moving/connected via navigation_graph", "route preview")
	_assert_contains(output, "Profile: foundation 1 | hp 92 spirit 45 rep 18 | items 7", "profile")
	_assert_contains(output, "Relation: you->them aff 4 trust 6 susp 1 | them->you aff 8 trust 9 susp 0", "relationship")
	_assert_contains(output, "Recent action: arabcdef->we987654 | Trade completed by rules.", "recent action")

	var memory_text: String = formatter.recent_context_text({
		"memories": [{ "summary": "Mentor praised patience." }],
	})
	_assert_contains(memory_text, "Memory: Mentor praised patience.", "memory fallback")
	var event_text: String = formatter.recent_context_text({
		"recentEvents": [{ "displayText": "A quiet event." }],
	})
	_assert_contains(event_text, "Recent: A quiet event.", "event fallback")
	var uninitialized_text: String = formatter.profile_context_text({ "profile": {} })
	_assert_contains(uninitialized_text, "Profile: not initialized", "profile fallback")
	var player_safe_text: String = formatter.render_selected_detail(resident, {
		"profile": {
			"realm": "foundation",
			"realmStage": 1,
			"reputation": 18,
		},
		"relationship": {
			"viewerToActor": { "affinity": 4, "trust": 6, "suspicion": 1 },
			"actorToViewer": null,
		},
	}, locations, now_ms)
	_assert_contains(player_safe_text, "hp ? spirit ? rep 18 | items ?", "player-safe profile")
	_assert_contains(player_safe_text, "them->you hidden", "player-safe relationship")

	if failures.is_empty():
		print("Godot resident inspector formatter check passed.")
		quit(0)
	else:
		for failure in failures:
			push_error(str(failure))
		print(output)
		quit(1)

func _assert_contains(haystack: String, needle: String, label: String) -> void:
	if not haystack.contains(needle):
		failures.append("%s missing %s" % [label, needle])
