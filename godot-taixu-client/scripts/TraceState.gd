extends RefCounted
class_name TraceState

var entries: Array = []
var records: Dictionary = {}
var polish_previews: Dictionary = {}
var replay_summary: Dictionary = {}

var _max_entries := 8

func _init(max_entries: int = 8) -> void:
	_max_entries = maxi(1, max_entries)

func append_live_entry(entry: Dictionary) -> void:
	replay_summary.clear()
	entries.push_front(entry.duplicate(true))
	while entries.size() > _max_entries:
		entries.pop_back()

func mark_record_pending(action_record_id: String) -> bool:
	if action_record_id == "":
		return false
	records[action_record_id] = { "status": "pending" }
	return true

func apply_action_record(payload: Dictionary) -> String:
	var action_record_id := str(payload.get("actionRecordId", ""))
	if action_record_id == "":
		return ""
	records[action_record_id] = payload.duplicate(true)
	return action_record_id

func apply_polish_preview(payload: Dictionary) -> String:
	var action_record_id := str(payload.get("actionRecordId", ""))
	if action_record_id == "":
		return ""
	polish_previews[action_record_id] = payload.duplicate(true)
	return action_record_id

func replace_from_replay(payload: Dictionary) -> bool:
	var raw_entries = payload.get("entries", null)
	if typeof(raw_entries) != TYPE_ARRAY:
		return false
	var raw_summary = payload.get("summary", {})
	if typeof(raw_summary) != TYPE_DICTIONARY:
		return false

	entries.clear()
	records.clear()
	polish_previews.clear()
	replay_summary.clear()
	replay_summary.assign(raw_summary.duplicate(true))
	for raw_entry in raw_entries:
		if typeof(raw_entry) != TYPE_DICTIONARY:
			continue
		var entry: Dictionary = raw_entry.duplicate(true)
		entries.append(entry)
		var action_record_id := str(entry.get("actionRecordId", ""))
		if action_record_id != "":
			records[action_record_id] = {
				"ok": true,
				"worldEventId": str(entry.get("worldEventId", "")),
			}
		if entries.size() >= _max_entries:
			break
	return true
