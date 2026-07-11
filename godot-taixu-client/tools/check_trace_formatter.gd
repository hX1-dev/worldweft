extends SceneTree

const TraceFormatterScript := preload("res://scripts/TraceFormatter.gd")

var failures: Array = []

func _init() -> void:
	var formatter = TraceFormatterScript.new()
	var action_record_id := "ar1234567890"
	var world_event_id := "we9876543210"
	var trace_entries: Array = [
		{
			"source": "replay_action",
			"kind": "action",
			"actionType": "trade",
			"resultCode": "trade_completed",
			"actorIds": ["godot_smoke_trace"],
			"targetActorIds": ["qinglan:qinglan-medicine-keeper"],
			"locationId": "market_main_street",
			"summary": "godot_smoke_trace以 16 枚灵石购得2件「spirit_herb」。",
			"actionRecordId": action_record_id,
			"worldEventId": world_event_id,
			"bubbleKind": "reaction",
			"presentationSource": "rule_template",
			"presentationVersion": 1,
			"presentationPolicy": {
				"durableSummaryLocked": true,
				"llmMayPolishDisplayText": true,
				"llmMayChangeFacts": false,
				"llmMayChangeDurableState": false,
			},
			"settlementPreview": {
				"summary": "godot_smoke_trace receives 2 x spirit_herb",
				"presentationSource": "rule_template",
				"durableSource": "rules.effects.items",
			},
			"traceChain": {
				"linkStatus": "action_record_linked",
				"durable": true,
				"tickOnly": false,
				"steps": [
					{ "kind": "replay", "label": "replay" },
					{ "kind": "action_record", "label": "actionRecord", "actionRecordId": action_record_id },
					{ "kind": "world_event", "label": "worldEvent", "worldEventId": world_event_id },
				],
			},
			"tickOnly": false,
		},
		{
			"source": "tick",
			"actionType": "tick",
			"resultCode": "tick_observed",
			"actorIds": ["qinglan:qinglan-elder-mu"],
			"targetActorIds": [],
			"summary": "穆前辈暂不行动：无新的可执行意图。",
			"traceChain": {
				"linkStatus": "tick_only",
				"durable": false,
				"tickOnly": true,
				"steps": [
					{ "kind": "tick_observation", "label": "tick observation" },
					{ "kind": "tick_only", "label": "tickOnly" },
				],
			},
			"tickOnly": true,
		},
	]
	var trace_records: Dictionary = {
		action_record_id: {
			"ok": true,
			"status": "completed",
			"resultCode": "trade_completed",
			"worldEventId": world_event_id,
			"settlementPreview": {
				"summary": "record settlement fallback",
				"durableSource": "rules.effects.items",
			},
		},
	}
	var trace_polish_previews: Dictionary = {
		action_record_id: {
			"actionRecordId": action_record_id,
			"polishPreview": {
				"status": "llm_not_configured",
				"mode": "llm_polish",
				"guardrails": [
					{ "id": "durable_summary_locked" },
					{ "id": "no_durable_writes" },
				],
				"validation": { "previewOnly": true },
				"presentationPolicy": { "durableSummaryLocked": true },
				"input": { "durableSummaryHash": "hash-abcdef123456" },
			},
		},
	}
	var replay_summary: Dictionary = {
		"entryCount": 2,
		"linkedCount": 1,
		"eventOnlyCount": 0,
		"actionRecordOnlyCount": 0,
		"actionCount": 1,
		"eventCount": 1,
		"durableCount": 1,
		"tickOnlyCount": 1,
		"timeWindowLabel": "2s window",
		"actionTypes": [{ "type": "trade", "count": 1 }],
		"resultCodes": [{ "resultCode": "trade_completed", "count": 1 }],
		"linkStatuses": [
			{ "linkStatus": "action_record_linked", "count": 1 },
			{ "linkStatus": "tick_only", "count": 1 },
		],
		"sources": [{ "source": "replay_action", "count": 1 }],
		"topActionType": "trade",
		"topResultCode": "trade_completed",
		"topLinkStatus": "action_record_linked",
		"topSource": "replay_action",
	}

	var output: String = formatter.render_trace_log(
		trace_entries,
		trace_records,
		trace_polish_previews,
		replay_summary
	)
	var live_output: String = formatter.render_trace_log(
		[
			{
				"source": "action",
				"actionType": "talk",
				"resultCode": "conversation_started",
				"summary": "live action waiting for readback",
				"actionRecordId": "ar-live-pending",
				"worldEventId": "we-live-linked",
				"traceChain": {
					"linkStatus": "action_record_linked",
					"durable": true,
					"steps": [
						{ "kind": "semantic_action", "label": "semantic action" },
						{ "kind": "action_record", "label": "actionRecord", "actionRecordId": "ar-live-pending" },
						{ "kind": "world_event", "label": "worldEvent", "worldEventId": "we-live-linked" },
					],
				},
			},
			{
				"source": "event",
				"actionType": "arrive",
				"resultCode": "arrived_location",
				"summary": "event without action record",
				"worldEventId": "we-event-only",
				"traceChain": { "linkStatus": "event_only", "durable": true },
			},
		],
		{ "ar-live-pending": { "status": "pending" } },
		{},
		{}
	)
	var settlement_text: String = formatter.settlement_preview_text(trace_entries[0], false)

	_assert_contains(output, "Trace: 2 rows", "header row count")
	_assert_contains(output, "Replay facets:", "replay facet line")
	_assert_contains(output, "Trace health: linked 1/1 durable | eventOnly 0 | actionOnly 0 | tickOnly 1 | gaps 0 | readback ok 1/pending 0/failed 0", "summary trace health")
	_assert_contains(output, "actions trade x1", "action type count")
	_assert_contains(output, "results trade_completed x1", "result code count")
	_assert_contains(output, "links action_record_linked x1", "link status count")
	_assert_contains(output, "sources replay_action x1", "source count")
	_assert_contains(output, "Replay trade/trade_completed", "trade row")
	_assert_contains(output, "ActionRecord ar123456", "actionRecord step")
	_assert_contains(output, "WorldEvent we987654", "worldEvent step")
	_assert_contains(output, "Settlement: godot_smoke_trace receives 2 x spirit_herb", "settlement summary")
	_assert_contains(output, "rules.effects.items", "settlement durable source")
	_assert_contains(output, "presentation=rule_template v1", "presentation source")
	_assert_contains(output, "bubble=reaction", "bubble kind")
	_assert_contains(output, "summary locked", "durable summary policy")
	_assert_contains(output, "facts locked", "facts policy")
	_assert_contains(output, "state locked", "state policy")
	_assert_contains(output, "readback ok completed trade_completed event we987654", "readback detail")
	_assert_contains(output, "polish llm_not_configured/locked/preview g2", "compact polish status")
	_assert_contains(output, "polish llm_not_configured/llm_polish/previewOnly/hash hash-abc", "polish detail")
	_assert_contains(output, "Tick tick/tick_observed", "tick row")
	_assert_contains(output, "TickOnly", "tick-only lifecycle")
	_assert_contains(live_output, "Trace health: linked 1/2 durable | eventOnly 1 | actionOnly 0 | tickOnly 0 | gaps 1 | readback ok 0/pending 1/failed 0", "live trace health")
	_assert_contains(settlement_text, "Source: rule_template", "full settlement source")
	_assert_contains(settlement_text, "Durable: rules.effects.items", "full settlement durable source")

	if failures.is_empty():
		print("Godot trace formatter check passed.")
		quit(0)
	else:
		for failure in failures:
			push_error(str(failure))
		print(output)
		quit(1)

func _assert_contains(haystack: String, needle: String, label: String) -> void:
	if not haystack.contains(needle):
		failures.append("%s missing %s" % [label, needle])
