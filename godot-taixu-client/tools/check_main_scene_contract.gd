extends SceneTree

var failures: Array = []

class MockActionClient:
	var actor_id := "godot_player"
	var calls: Array = []

	func submit_capability(
		capability: Dictionary,
		resident: Dictionary,
		location: Dictionary,
		world_id: String,
		actor_tile: Vector2,
		interaction_range_tiles: float
	) -> void:
		calls.append({
			"capability": capability.duplicate(true),
			"resident": resident.duplicate(true),
			"location": location.duplicate(true),
			"worldId": world_id,
			"actorTile": actor_tile,
			"interactionRangeTiles": interaction_range_tiles,
		})

func _init() -> void:
	call_deferred("_run")

func _run() -> void:
	OS.set_environment("GODOT_BRIDGE_TOKEN", "main-scene-contract-player-token")
	OS.set_environment("GODOT_BRIDGE_DEBUG_TOKEN", "main-scene-contract-debug-token")
	OS.set_environment("GODOT_BRIDGE_DISABLE_AUTOLOAD", "1")
	OS.set_environment("GODOT_BRIDGE_DISABLE_NETWORK", "1")
	var scene: PackedScene = load("res://scenes/Main.tscn")
	var main = scene.instantiate()
	root.add_child(main)
	await process_frame

	var mock_action_client := MockActionClient.new()
	main.action_client = mock_action_client
	main.player.position = Vector2(35.0, 30.0) * main.TILE_SIZE

	var now := Time.get_unix_time_from_system() * 1000.0
	var resident := _resident(now)
	var location := _location()
	main.store.absorb_region({
		"ok": true,
		"worldId": "world_main_contract",
		"mapId": "qinglan",
		"residents": [resident],
		"locations": [location],
		"recentEvents": [],
	})
	main.store.select_resident(resident)
	main.location_probe.current_location = location
	main._on_capabilities_received(_capabilities(resident, location))

	_assert(main.status_label != null, "status label exists")
	_assert(main.UI_FONT.has_char("青".unicode_at(0)), "bundled UI font covers Chinese world text")
	_assert(main.hud_panel.theme.default_font == main.UI_FONT, "HUD inherits bundled CJK font")
	_assert(main.status_label.clip_text == true, "long debug status cannot widen the sidebar")
	_assert(main.status_label.text_overrun_behavior == TextServer.OVERRUN_TRIM_ELLIPSIS, "debug status uses ellipsis")
	_assert(main.selected_label.autowrap_mode != TextServer.AUTOWRAP_OFF, "selected resident label wraps")
	_assert(main.location_label.autowrap_mode != TextServer.AUTOWRAP_OFF, "location label wraps")
	_assert(main.hud_sidebar_width >= main.HUD_MIN_WIDTH, "responsive HUD keeps minimum width")
	_assert(main.hud_sidebar_width <= main.HUD_MAX_WIDTH, "responsive HUD respects maximum width")
	_assert(is_equal_approx(main.hud_panel.offset_right, -main.HUD_EDGE_MARGIN), "HUD keeps right edge margin")
	_assert(
		is_equal_approx(main.hud_panel.offset_left, -main.hud_sidebar_width - main.HUD_EDGE_MARGIN),
		"HUD panel width matches responsive layout"
	)
	_assert(main.selected_detail_label != null, "selected detail label exists")
	_assert(main.action_menu != null, "action menu exists")
	_assert(main.confirmation_panel != null, "confirmation panel exists")
	_assert(main.trace_log != null, "trace log exists")
	_assert(main.bridge.debug_tick_available(), "debug credential enables tick controls")
	_assert(main.tick_button != null and main.tick_button.disabled == false, "tick button enabled after world load")
	_assert(main.auto_tick_toggle != null and main.auto_tick_toggle.disabled == false, "auto tick enabled after world load")
	_assert(main.selected_detail_label.visible == true, "selected inspector visible")
	_assert(str(main.selected_detail_label.text).contains("Activity:"), "selected inspector renders activity")

	_assert(main.action_buttons.has("talk"), "talk button exists")
	_assert(main.action_buttons.has("gift"), "gift button exists")
	_assert(main.action_buttons.has("trade"), "trade button exists")
	_assert(main.action_buttons.has("cultivate"), "cultivate button exists")
	_assert(main.action_buttons.has("breakthrough"), "breakthrough button exists")
	_assert(not main.action_buttons.has("arrive"), "hidden arrive action is not rendered")
	_assert(main.action_option_selectors.has("trade"), "trade selector exists")
	_assert(main.action_option_selectors["trade"].get_item_count() == 1, "trade selector has option")
	_assert(main.action_buttons["breakthrough"].disabled == true, "disabled breakthrough stays disabled")
	_assert(str(main.action_buttons["breakthrough"].tooltip_text).contains("not ready"), "disabled reason appears as tooltip")
	_assert(main.action_detail_label.visible == true, "action detail panel visible")
	_assert(str(main.action_detail_label.text).contains("Selection:"), "action detail includes selected option policy")

	var correct_payload := _capabilities(resident, location)
	_assert(main._capabilities_matches_current_context(correct_payload), "current capabilities accepted")
	var stale_tile_payload := _capabilities(resident, location)
	stale_tile_payload["actorTile"] = { "x": 5.0, "y": 5.0 }
	_assert(not main._capabilities_matches_current_context(stale_tile_payload), "stale actor tile rejected")
	var stale_target_payload := _capabilities(resident, location)
	stale_target_payload["target"] = { "actorId": "qinglan:other" }
	_assert(not main._capabilities_matches_current_context(stale_target_payload), "stale target rejected")

	var talk_capability: Dictionary = main.action_buttons["talk"].get_meta("capability")
	main._submit_menu_action(talk_capability)
	_assert(mock_action_client.calls.size() == 1, "talk submits immediately")
	_assert(mock_action_client.calls[0]["worldId"] == "world_main_contract", "submit preserves world id")
	_assert(str(mock_action_client.calls[0]["capability"].get("type", "")) == "talk", "submit preserves action type")
	_assert(str(mock_action_client.calls[0]["resident"].get("actorId", "")) == resident.actorId, "submit passes selected resident")

	var gift_capability: Dictionary = main.action_buttons["gift"].get_meta("capability")
	main._submit_menu_action(gift_capability)
	_assert(mock_action_client.calls.size() == 1, "gift waits for confirmation")
	_assert(main.confirmation_panel.visible == true, "gift shows confirmation")
	_assert(str(main.confirmation_body_label.text).contains("Convex preview"), "confirmation uses Convex preview")
	_assert(str(main.confirmation_body_label.text).contains("POST /godot/action"), "confirmation keeps formal submit path")
	main._confirm_pending_action()
	_assert(mock_action_client.calls.size() == 2, "confirmed gift submits")
	_assert(main.confirmation_panel.visible == false, "confirmation hides after submit")

	main._show_action_confirmation(gift_capability)
	main.store.selected_resident = { "actorId": "qinglan:someone-else" }
	main._confirm_pending_action()
	_assert(mock_action_client.calls.size() == 2, "stale confirmation does not submit")
	_assert(main.confirmation_panel.visible == false, "stale confirmation closes")
	main.store.selected_resident = resident

	main._on_action_changed(_action_payload())
	_assert(main.trace_entries.size() >= 1, "action trace recorded")
	_assert(str(main.trace_entries[0].get("actionRecordId", "")) == "ar_main_contract", "action trace keeps actionRecordId")
	_assert(str(main.trace_log.text).contains("conversation_started"), "trace log renders action result")

	main._on_tick_completed(_tick_payload())
	_assert(main.trace_entries.size() >= 2, "tick traces recorded")
	_assert(str(main.trace_entries[0].get("tickOnly", false)) == "true", "tickOnly trace remains explicit")
	_assert(str(main.trace_log.text).contains("tickOnly"), "trace log renders tickOnly")

	var trace_count_before_stale_replay: int = main.trace_entries.size()
	main._on_replay_trace_received(_stale_replay_payload(resident))
	_assert(main.trace_entries.size() == trace_count_before_stale_replay, "stale replay trace ignored")

	main._on_replay_trace_received(_replay_payload(resident))
	_assert(main.trace_entries.size() == 2, "replay trace rebuilds trace entries")
	_assert(int(main.latest_replay_summary.get("entryCount", 0)) == 2, "replay summary preserved")
	_assert(main.trace_records.has("ar_replay_contract"), "replay action seeds readback state")
	_assert(str(main.trace_log.text).contains("Replay facets:"), "trace log renders replay facets")
	_assert(str(main.trace_log.text).contains("Trace health: linked 1/2 durable | eventOnly 1 | actionOnly 0 | tickOnly 0 | gaps 1 | readback ok 1/pending 0/failed 0"), "trace log renders replay trace health")
	_assert(str(main.trace_log.text).contains("Replay talk/conversation_started"), "trace log renders replay action")
	_assert(str(main.trace_log.text).contains("ActionRecord ar_repla"), "trace log renders replay actionRecord step")
	_assert(str(main.trace_log.text).contains("WorldEvent we_repla"), "trace log renders replay worldEvent step")
	_assert(str(main.trace_log.text).contains("eventOnly replay row"), "trace log renders replay event-only row")

	if failures.is_empty():
		print("Godot main scene contract check passed.")
		quit(0)
	else:
		for failure in failures:
			push_error(str(failure))
		quit(1)

func _resident(now: float) -> Dictionary:
	return {
		"actorId": "qinglan:main-contract-resident",
		"name": "Contract Resident",
		"role": "medicine_keeper",
		"locationId": "market_tea_stall",
		"tile": { "x": 35.0, "y": 30.0 },
		"targetTile": { "x": 36.0, "y": 30.0 },
		"finalTargetTile": { "x": 38.0, "y": 31.0 },
		"status": "waiting",
		"activityLabel": "teaching",
		"intent": "在茶摊清静处点拨后辈。",
		"waypointId": "market_tea_stall",
		"nextActionAt": now + 5000.0,
		"updatedAt": now,
		"routePreview": _route_preview(now),
	}

func _route_preview(now: float) -> Dictionary:
	var current_stop := {
		"spotId": "tea_now",
		"label": "Tea Stall",
		"locationId": "market_tea_stall",
		"tile": { "x": 35.0, "y": 30.0 },
		"intent": "teaching",
		"offset": 0,
	}
	var next_stop := {
		"spotId": "tea_next",
		"label": "Tea Corner",
		"locationId": "market_tea_stall",
		"tile": { "x": 38.0, "y": 31.0 },
		"intent": "listen",
		"offset": 1,
	}
	return {
		"routeId": "main-contract-route",
		"waypointId": "market_tea_stall",
		"waypointLabel": "Tea Stall",
		"status": "connected",
		"connected": true,
		"lengthTiles": 4.0,
		"remainingTiles": 3.0,
		"etaSeconds": 8.0,
		"etaLabel": "8s",
		"nextStepLabel": "east",
		"nextStepDistanceTiles": 1.0,
		"progressLabel": "3/4 tiles",
		"routeSummary": "Tea Stall -> Tea Corner",
		"movementState": "scheduled",
		"source": "resident_path",
		"locationId": "market_tea_stall",
		"currentTile": { "x": 35.0, "y": 30.0 },
		"nextTile": { "x": 36.0, "y": 30.0 },
		"finalTargetTile": { "x": 38.0, "y": 31.0 },
		"pathTiles": [
			{ "x": 35.0, "y": 30.0 },
			{ "x": 36.0, "y": 30.0 },
			{ "x": 38.0, "y": 31.0 },
		],
		"pathStepCount": 3,
		"schedulePreview": {
			"phase": "scheduled",
			"activityLabel": "teaching",
			"destinationLabel": "Tea Corner",
			"destinationLocationId": "market_tea_stall",
			"intent": "listen",
			"summary": "teaching at Tea Stall",
			"nextActionAt": now + 5000.0,
		},
		"scheduleRoute": {
			"source": "resident_route",
			"routeId": "main-contract-loop",
			"routeCount": 2,
			"currentIndex": 0,
			"currentStop": current_stop,
			"previousStop": next_stop,
			"nextStop": next_stop,
			"upcomingStops": [next_stop],
			"loopLabel": "Tea loop",
			"summary": "Tea loop summary",
		},
	}

func _location() -> Dictionary:
	return {
		"locationId": "market_tea_stall",
		"name": "Tea Stall",
		"kind": "social",
		"allowedActions": ["talk", "gift", "trade", "cultivate", "breakthrough"],
		"bounds": { "x1": 34.0, "y1": 29.0, "x2": 39.0, "y2": 33.0 },
		"entryPoints": [{ "x": 35.0, "y": 30.0 }],
	}

func _capabilities(resident: Dictionary, location: Dictionary) -> Dictionary:
	var gift_option := {
		"label": "Spirit Stone x1",
		"params": { "itemId": "spirit_stone" },
		"itemName": "Spirit Stone",
		"itemId": "spirit_stone",
		"qtyAvailable": 2,
		"confirmationPreview": _confirmation_preview("gift"),
		"inventoryDeltaPreview": {
			"deltas": [
				{ "owner": "actor", "itemName": "Spirit Stone", "before": 2, "after": 1, "delta": -1 },
				{ "owner": "target", "itemName": "Spirit Stone", "before": 0, "after": 1, "delta": 1 },
			],
		},
	}
	var trade_option := {
		"label": "Spirit Herb x1",
		"params": { "offeredItemId": "spirit_stone", "offeredQty": 8, "requestedItemId": "spirit_herb", "requestedQty": 1 },
		"requestedItemName": "Spirit Herb",
		"requestedItemId": "spirit_herb",
		"requestedQty": 1,
		"offeredQty": 8,
		"priceSpiritStones": 8,
		"unitPriceSpiritStones": 8,
		"buyerSpiritStones": 20,
		"requestedQtyAvailable": 3,
		"quantityChoiceIndex": 0,
		"quantityChoiceCount": 1,
		"maxSelectableQty": 1,
		"quantityChoices": [{ "requestedQty": 1, "label": "x1 / 8 stones" }],
		"exchangeTerms": [
			{ "from": "actor", "to": "target", "itemName": "Spirit Stone", "itemId": "spirit_stone", "qty": 8 },
			{ "from": "target", "to": "actor", "itemName": "Spirit Herb", "itemId": "spirit_herb", "qty": 1 },
		],
		"confirmationPreview": _confirmation_preview("trade"),
		"inventoryDeltaPreview": {
			"deltas": [
				{ "owner": "actor", "itemName": "Spirit Stone", "before": 20, "after": 12, "delta": -8 },
				{ "owner": "actor", "itemName": "Spirit Herb", "before": 0, "after": 1, "delta": 1 },
			],
		},
	}
	return {
		"ok": true,
		"worldId": "world_main_contract",
		"mapId": "qinglan",
		"actorId": "godot_player",
		"actorTile": { "x": 35.0, "y": 30.0 },
		"interactionRangeTiles": 5.0,
		"target": {
			"actorId": resident.actorId,
			"name": resident.name,
			"role": resident.role,
			"tile": resident.tile,
			"locationId": resident.locationId,
		},
		"currentLocation": location,
		"actions": [
			{ "type": "talk", "label": "Talk", "enabled": true, "reason": null, "category": "target", "targetActorId": resident.actorId, "intent": "打个招呼", "params": {}, "visible": true },
			{ "type": "gift", "label": "Gift", "enabled": true, "reason": null, "category": "target", "targetActorId": resident.actorId, "intent": "赠一枚灵石", "params": { "itemId": "spirit_stone" }, "options": [gift_option], "visible": true },
			{ "type": "trade", "label": "Trade", "enabled": true, "reason": null, "category": "target", "targetActorId": resident.actorId, "intent": "交易灵草", "params": trade_option.params, "options": [trade_option], "visible": true },
			{ "type": "cultivate", "label": "Cultivate", "enabled": true, "reason": null, "category": "location", "locationId": location.locationId, "intent": "吐纳修行", "params": {}, "visible": true },
			{ "type": "arrive", "label": "Arrive", "enabled": true, "reason": null, "category": "location", "locationId": location.locationId, "intent": "抵达", "params": {}, "visible": false },
			{ "type": "breakthrough", "label": "Breakthrough", "enabled": false, "reason": "not ready", "category": "location", "locationId": location.locationId, "intent": "尝试突破", "params": {}, "visible": true },
		],
	}

func _confirmation_preview(action_type: String) -> Dictionary:
	return {
		"actionType": action_type,
		"presentationSource": "rule_template",
		"previewOnly": true,
		"summary": "Convex preview for " + action_type,
		"primaryLine": "Primary " + action_type,
		"inventoryLine": "Inventory display only",
		"balanceLine": "Balance 20 -> 12",
		"termsLine": "You -> Target | Target -> You",
		"durableEffectNotes": ["actionRecords row", "worldEvents row"],
		"policy": {
			"convexAuthored": true,
			"godotMayDisplayOnly": true,
			"durableStateUnchanged": true,
			"submitPath": "POST /godot/action",
		},
	}

func _action_payload() -> Dictionary:
	return {
		"ok": true,
		"actionType": "talk",
		"resultCode": "conversation_started",
		"eventId": "we_main_contract",
		"worldEventId": "we_main_contract",
		"actionRecordId": "ar_main_contract",
		"actorIds": ["godot_player"],
		"targetActorIds": ["qinglan:main-contract-resident"],
		"summary": "Rule summary for talk.",
		"bubbleText": "聊了几句。",
		"displayText": "conversation_started display",
		"bubbleKind": "dialogue",
		"presentationSource": "rule_template",
		"presentationVersion": 1,
		"durableSummary": "Rule summary for talk.",
		"presentationPolicy": _presentation_policy(),
		"traceChain": {
			"source": "action",
			"actionType": "talk",
			"worldEventId": "we_main_contract",
			"actionRecordId": "ar_main_contract",
			"resultCode": "conversation_started",
			"tickOnly": false,
			"durable": true,
			"linkStatus": "action_record_linked",
			"label": "actionRecord -> worldEvent",
			"steps": [
				{ "kind": "semantic_action", "label": "semantic action" },
				{ "kind": "action_record", "label": "actionRecord" },
				{ "kind": "world_event", "label": "worldEvent" },
			],
		},
	}

func _tick_payload() -> Dictionary:
	return {
		"ok": true,
		"worldId": "world_main_contract",
		"mapId": "qinglan",
		"tick": {
			"ticked": 1,
			"scheduler": {
				"scope": "qinglan",
				"actorIds": ["qinglan:main-contract-resident"],
				"eligibleCount": 1,
				"wrapped": false,
			},
		},
		"qinglan": { "updated": 1 },
		"tickEvents": [
			{
				"id": "tick_only_main_contract",
				"tickOnly": true,
				"type": "agent_skipped",
				"actionType": "tick",
				"resultCode": "agent_skipped",
				"actorIds": ["qinglan:main-contract-resident"],
				"targetActorIds": [],
				"summary": "Skipped this tick.",
				"bubbleText": "暂不行动。",
				"displayText": "tickOnly display",
				"bubbleKind": "narration",
				"presentationSource": "rule_template",
				"presentationVersion": 1,
				"durableSummary": "Skipped this tick.",
				"presentationPolicy": _presentation_policy(),
				"traceChain": {
					"source": "tick",
					"actionType": "tick",
					"worldEventId": "tick_only_main_contract",
					"resultCode": "agent_skipped",
					"tickOnly": true,
					"durable": false,
					"linkStatus": "tick_only",
					"label": "tickOnly observation",
					"steps": [
						{ "kind": "tick_observation", "label": "tick observation" },
						{ "kind": "tick_only", "label": "tickOnly" },
					],
				},
			}
		],
		"recentEvents": [],
	}

func _stale_replay_payload(resident: Dictionary) -> Dictionary:
	var payload := _replay_payload(resident)
	payload["actorId"] = "qinglan:stale-replay-resident"
	return payload

func _replay_payload(resident: Dictionary) -> Dictionary:
	return {
		"ok": true,
		"worldId": "world_main_contract",
		"mapId": "qinglan",
		"actorId": resident.actorId,
		"entries": [
			{
				"source": "replay_action",
				"kind": "action",
				"actionType": "talk",
				"resultCode": "conversation_started",
				"actorIds": ["godot_player"],
				"targetActorIds": [resident.actorId],
				"locationId": resident.locationId,
				"summary": "Replay action row from Convex.",
				"actionRecordId": "ar_replay_contract",
				"worldEventId": "we_replay_contract",
				"bubbleText": "Replay bubble.",
				"displayText": "Replay display.",
				"bubbleKind": "dialogue",
				"presentationSource": "rule_template",
				"presentationVersion": 1,
				"durableSummary": "Replay action row from Convex.",
				"presentationPolicy": _presentation_policy(),
				"traceChain": {
					"source": "replay_action",
					"actionType": "talk",
					"worldEventId": "we_replay_contract",
					"actionRecordId": "ar_replay_contract",
					"resultCode": "conversation_started",
					"tickOnly": false,
					"durable": true,
					"linkStatus": "action_record_linked",
					"label": "replay actionRecord -> worldEvent",
					"steps": [
						{ "kind": "replay", "label": "replay" },
						{ "kind": "action_record", "label": "actionRecord", "actionRecordId": "ar_replay_contract" },
						{ "kind": "world_event", "label": "worldEvent", "worldEventId": "we_replay_contract" },
					],
				},
			},
			{
				"source": "replay_event",
				"kind": "event",
				"actionType": "arrive",
				"resultCode": "arrived_location",
				"actorIds": [resident.actorId],
				"targetActorIds": [],
				"locationId": resident.locationId,
				"summary": "eventOnly replay row",
				"worldEventId": "we_replay_event_only",
				"bubbleText": "Event only bubble.",
				"displayText": "Event only display.",
				"bubbleKind": "narration",
				"presentationSource": "rule_template",
				"presentationVersion": 1,
				"durableSummary": "eventOnly replay row",
				"presentationPolicy": _presentation_policy(),
				"traceChain": {
					"source": "replay_event",
					"actionType": "arrive",
					"worldEventId": "we_replay_event_only",
					"resultCode": "arrived_location",
					"tickOnly": false,
					"durable": true,
					"linkStatus": "event_only",
					"label": "replay worldEvent only",
					"steps": [
						{ "kind": "replay", "label": "replay" },
						{ "kind": "world_event", "label": "worldEvent", "worldEventId": "we_replay_event_only" },
					],
				},
			},
		],
		"summary": {
			"entryCount": 2,
			"linkedCount": 1,
			"eventOnlyCount": 1,
			"actionRecordOnlyCount": 0,
			"actionCount": 1,
			"eventCount": 1,
			"durableCount": 2,
			"tickOnlyCount": 0,
			"timeWindowLabel": "contract replay",
			"actionTypes": [{ "type": "talk", "count": 1 }],
			"resultCodes": [
				{ "resultCode": "conversation_started", "count": 1 },
				{ "resultCode": "arrived_location", "count": 1 },
			],
			"linkStatuses": [
				{ "linkStatus": "action_record_linked", "count": 1 },
				{ "linkStatus": "event_only", "count": 1 },
			],
			"sources": [
				{ "source": "replay_action", "count": 1 },
				{ "source": "replay_event", "count": 1 },
			],
			"topActionType": "talk",
			"topResultCode": "conversation_started",
			"topLinkStatus": "action_record_linked",
			"topSource": "replay_action",
		},
	}

func _presentation_policy() -> Dictionary:
	return {
		"durableSummaryLocked": true,
		"llmMayPolishDisplayText": true,
		"llmMayChangeFacts": false,
		"llmMayChangeDurableState": false,
	}

func _assert(condition: bool, label: String) -> void:
	if not condition:
		failures.append(label)
