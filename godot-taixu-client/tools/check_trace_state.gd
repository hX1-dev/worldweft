extends SceneTree

const TraceStateScript := preload("res://scripts/TraceState.gd")

var failures: Array = []

func _init() -> void:
	var state = TraceStateScript.new(2)
	var entries_alias: Array = state.entries
	var records_alias: Dictionary = state.records
	var summary_alias: Dictionary = state.replay_summary

	state.replay_summary.assign({ "entryCount": 9 })
	state.append_live_entry({ "worldEventId": "we-1", "actionRecordId": "ar-1" })
	_assert(state.replay_summary.is_empty(), "live entry clears stale replay summary")
	state.append_live_entry({ "worldEventId": "we-2" })
	state.append_live_entry({ "worldEventId": "we-3" })
	_assert(state.entries.size() == 2, "live entries honor max size")
	_assert(str(state.entries[0].get("worldEventId", "")) == "we-3", "newest live entry is first")
	_assert(state.entries == entries_alias, "entry alias remains valid")

	_assert(not state.mark_record_pending(""), "empty actionRecord id is ignored")
	_assert(state.mark_record_pending("ar-3"), "valid actionRecord id becomes pending")
	_assert(str(state.records["ar-3"].get("status", "")) == "pending", "pending state is stored")
	_assert(state.apply_action_record({}) == "", "record payload without id is rejected")
	_assert(
		state.apply_action_record({ "actionRecordId": "ar-3", "ok": true }) == "ar-3",
		"record readback is applied"
	)
	_assert(state.records["ar-3"].get("ok", false) == true, "record readback replaces pending state")
	_assert(
		state.apply_polish_preview({ "actionRecordId": "ar-3", "polishPreview": { "status": "locked" } }) == "ar-3",
		"polish preview is keyed by actionRecord"
	)

	var replay := {
		"summary": { "entryCount": 3 },
		"entries": [
			{ "worldEventId": "we-r1", "actionRecordId": "ar-r1" },
			{ "worldEventId": "we-r2" },
			{ "worldEventId": "we-r3", "actionRecordId": "ar-r3" },
		],
	}
	_assert(state.replace_from_replay(replay), "valid replay replaces trace state")
	_assert(state.entries.size() == 2, "replay also honors max size")
	_assert(int(state.replay_summary.get("entryCount", 0)) == 3, "replay summary is preserved")
	_assert(state.records.has("ar-r1"), "replay action seeds readback state")
	_assert(not state.records.has("ar-r3"), "trimmed replay action does not seed hidden record")
	_assert(state.polish_previews.is_empty(), "replay clears live polish previews")
	_assert(state.entries == entries_alias, "replay mutates the existing entry array")
	_assert(state.records == records_alias, "replay mutates the existing record dictionary")
	_assert(state.replay_summary == summary_alias, "replay mutates the existing summary dictionary")
	var prior_entries: Array = state.entries.duplicate(true)
	_assert(not state.replace_from_replay({ "entries": "bad", "summary": {} }), "invalid replay is rejected")
	_assert(state.entries == prior_entries, "invalid replay leaves state unchanged")

	if failures.is_empty():
		print("Godot trace state check passed.")
		quit(0)
	else:
		for failure in failures:
			push_error(str(failure))
		quit(1)

func _assert(condition: bool, message: String) -> void:
	if not condition:
		failures.append(message)
