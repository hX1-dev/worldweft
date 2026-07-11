extends RefCounted
class_name TraceFormatter

func render_trace_log(
	trace_entries: Array,
	trace_records: Dictionary,
	trace_polish_previews: Dictionary,
	latest_replay_summary: Dictionary
) -> String:
	if trace_entries.is_empty():
		return "Trace: waiting for action or tick."
	var lines: Array = [_trace_header_text(latest_replay_summary, trace_entries.size())]
	var summary_breakdown := _trace_summary_breakdown_text(latest_replay_summary)
	if summary_breakdown != "":
		lines.append(summary_breakdown)
	var health := _trace_health_text(latest_replay_summary, trace_entries, trace_records)
	if health != "":
		lines.append(health)
	for entry in trace_entries:
		if typeof(entry) == TYPE_DICTIONARY:
			lines.append(_trace_entry_text(entry, trace_records, trace_polish_previews))
	return "\n".join(lines)

func settlement_preview_text(source, compact: bool = false) -> String:
	if typeof(source) != TYPE_DICTIONARY:
		return ""
	var preview = source.get("settlementPreview", {})
	if typeof(preview) != TYPE_DICTIONARY:
		return ""
	var summary := str(preview.get("summary", ""))
	if summary == "":
		return ""
	var source_label := str(preview.get("presentationSource", ""))
	var durable_source := str(preview.get("durableSource", ""))
	if compact:
		var compact_text := "Settlement: " + summary
		if durable_source != "":
			compact_text += " | " + durable_source
		return compact_text
	var lines: Array = ["Settlement: " + summary]
	if source_label != "":
		lines.append("Source: " + source_label)
	if durable_source != "":
		lines.append("Durable: " + durable_source)
	return "\n".join(lines)

func _trace_header_text(latest_replay_summary: Dictionary, fallback_entry_count: int) -> String:
	if latest_replay_summary.is_empty():
		return "Trace"
	var entries := int(latest_replay_summary.get("entryCount", fallback_entry_count))
	var linked := int(latest_replay_summary.get("linkedCount", 0))
	var events := int(latest_replay_summary.get("eventCount", 0))
	var actions := int(latest_replay_summary.get("actionCount", 0))
	var durable := int(latest_replay_summary.get("durableCount", 0))
	var tick_only := int(latest_replay_summary.get("tickOnlyCount", 0))
	var window := str(latest_replay_summary.get("timeWindowLabel", ""))
	if window == "":
		window = "newest " + _trace_time_text(latest_replay_summary.get("newestCreatedAt", null))
	var top_action := str(latest_replay_summary.get("topActionType", ""))
	var top_result := str(latest_replay_summary.get("topResultCode", ""))
	var top_link := str(latest_replay_summary.get("topLinkStatus", ""))
	var top_source := str(latest_replay_summary.get("topSource", ""))
	var top_text := _trace_top_summary_text(top_action, top_result, top_link, top_source)
	var text := "Trace: %d rows | %d linked | %d action/%d event | %d durable/%d tickOnly | %s" % [
		entries,
		linked,
		actions,
		events,
		durable,
		tick_only,
		window
	]
	return text + (" | " + top_text if top_text != "" else "")

func _trace_summary_breakdown_text(latest_replay_summary: Dictionary) -> String:
	if latest_replay_summary.is_empty():
		return ""
	var parts: Array = []
	var action_types := _count_entries_text(latest_replay_summary.get("actionTypes", []), "type", 3)
	if action_types != "":
		parts.append("actions " + action_types)
	var result_codes := _count_entries_text(latest_replay_summary.get("resultCodes", []), "resultCode", 3)
	if result_codes != "":
		parts.append("results " + result_codes)
	var link_statuses := _count_entries_text(latest_replay_summary.get("linkStatuses", []), "linkStatus", 3)
	if link_statuses != "":
		parts.append("links " + link_statuses)
	var sources := _count_entries_text(latest_replay_summary.get("sources", []), "source", 3)
	if sources != "":
		parts.append("sources " + sources)
	var generated := _trace_time_text(latest_replay_summary.get("generatedAt", null))
	if generated != "?":
		parts.append("generated " + generated)
	if parts.is_empty():
		return ""
	return "Replay facets: " + " | ".join(parts)

func _count_entries_text(value, key: String, limit: int) -> String:
	if typeof(value) != TYPE_ARRAY:
		return ""
	var parts: Array = []
	var shown := 0
	for raw_entry in value:
		if shown >= limit:
			break
		if typeof(raw_entry) != TYPE_DICTIONARY:
			continue
		var entry: Dictionary = raw_entry
		var label := str(entry.get(key, ""))
		var count := int(entry.get("count", 0))
		if label == "" or count <= 0:
			continue
		parts.append("%s x%d" % [label, count])
		shown += 1
	if parts.is_empty():
		return ""
	return ", ".join(parts)

func _trace_top_summary_text(action_type: String, result_code: String, link_status: String = "", source: String = "") -> String:
	var parts: Array = []
	if action_type != "" and result_code != "":
		parts.append("%s/%s" % [action_type, result_code])
	elif action_type != "":
		parts.append(action_type)
	elif result_code != "":
		parts.append(result_code)
	if link_status != "":
		parts.append(link_status)
	if source != "":
		parts.append(source)
	if parts.is_empty():
		return ""
	return "top " + " | ".join(parts)

func _trace_health_text(
	latest_replay_summary: Dictionary,
	trace_entries: Array,
	trace_records: Dictionary
) -> String:
	var counts := _trace_health_counts(latest_replay_summary, trace_entries)
	var entry_count := int(counts.get("entryCount", 0))
	if entry_count <= 0:
		return ""
	var linked := int(counts.get("linkedCount", 0))
	var durable := int(counts.get("durableCount", 0))
	var event_only := int(counts.get("eventOnlyCount", 0))
	var action_record_only := int(counts.get("actionRecordOnlyCount", 0))
	var tick_only := int(counts.get("tickOnlyCount", 0))
	var unlinked := int(counts.get("unlinkedCount", 0))
	var gaps := event_only + action_record_only + unlinked
	var readback := _trace_readback_counts(trace_entries, trace_records)
	return "Trace health: linked %d/%d durable | eventOnly %d | actionOnly %d | tickOnly %d | gaps %d | readback ok %d/pending %d/failed %d" % [
		linked,
		durable,
		event_only,
		action_record_only,
		tick_only,
		gaps,
		int(readback.get("ok", 0)),
		int(readback.get("pending", 0)),
		int(readback.get("failed", 0))
	]

func _trace_health_counts(latest_replay_summary: Dictionary, trace_entries: Array) -> Dictionary:
	var has_summary := not latest_replay_summary.is_empty()
	var counts := {
		"entryCount": int(latest_replay_summary.get("entryCount", trace_entries.size())) if has_summary else trace_entries.size(),
		"linkedCount": int(latest_replay_summary.get("linkedCount", 0)) if has_summary else 0,
		"durableCount": int(latest_replay_summary.get("durableCount", 0)) if has_summary else 0,
		"eventOnlyCount": int(latest_replay_summary.get("eventOnlyCount", 0)) if has_summary else 0,
		"actionRecordOnlyCount": int(latest_replay_summary.get("actionRecordOnlyCount", 0)) if has_summary else 0,
		"tickOnlyCount": int(latest_replay_summary.get("tickOnlyCount", 0)) if has_summary else 0,
		"unlinkedCount": 0,
	}
	if has_summary:
		return counts
	for raw_entry in trace_entries:
		if typeof(raw_entry) != TYPE_DICTIONARY:
			continue
		var entry: Dictionary = raw_entry
		var link_status := _trace_entry_link_status(entry)
		match link_status:
			"action_record_linked":
				counts["linkedCount"] += 1
			"event_only":
				counts["eventOnlyCount"] += 1
			"action_record_only":
				counts["actionRecordOnlyCount"] += 1
			"tick_only":
				counts["tickOnlyCount"] += 1
			_:
				counts["unlinkedCount"] += 1
		if _trace_entry_is_durable(entry):
			counts["durableCount"] += 1
	return counts

func _trace_entry_link_status(entry: Dictionary) -> String:
	var trace_chain = entry.get("traceChain", {})
	if typeof(trace_chain) == TYPE_DICTIONARY:
		var link_status := str(trace_chain.get("linkStatus", ""))
		if link_status != "":
			return link_status
	if entry.get("tickOnly", false) == true:
		return "tick_only"
	var world_event_id := str(entry.get("worldEventId", ""))
	var action_record_id := str(entry.get("actionRecordId", ""))
	if world_event_id != "" and action_record_id != "":
		return "action_record_linked"
	if world_event_id != "":
		return "event_only"
	if action_record_id != "":
		return "action_record_only"
	return "unlinked"

func _trace_entry_is_durable(entry: Dictionary) -> bool:
	var trace_chain = entry.get("traceChain", {})
	if typeof(trace_chain) == TYPE_DICTIONARY and trace_chain.has("durable"):
		return trace_chain.get("durable", false) == true
	return str(entry.get("worldEventId", "")) != "" and entry.get("tickOnly", false) != true

func _trace_readback_counts(trace_entries: Array, trace_records: Dictionary) -> Dictionary:
	var counts := { "ok": 0, "pending": 0, "failed": 0 }
	for raw_entry in trace_entries:
		if typeof(raw_entry) != TYPE_DICTIONARY:
			continue
		var entry: Dictionary = raw_entry
		var action_record_id := str(entry.get("actionRecordId", ""))
		if action_record_id == "" or entry.get("tickOnly", false) == true:
			continue
		var record = trace_records.get(action_record_id, {})
		if typeof(record) != TYPE_DICTIONARY or record.is_empty():
			counts["pending"] += 1
		elif record.get("ok", false) == true:
			counts["ok"] += 1
		elif str(record.get("status", "pending")) == "pending":
			counts["pending"] += 1
		else:
			counts["failed"] += 1
	return counts

func _trace_time_text(value) -> String:
	if typeof(value) != TYPE_FLOAT and typeof(value) != TYPE_INT:
		return "?"
	var age_seconds := maxf(0.0, (Time.get_unix_time_from_system() * 1000.0 - float(value)) / 1000.0)
	if age_seconds < 60.0:
		return "%ds ago" % int(round(age_seconds))
	if age_seconds < 3600.0:
		return "%dm ago" % int(round(age_seconds / 60.0))
	return "%dh ago" % int(round(age_seconds / 3600.0))

func _trace_entry_text(entry: Dictionary, trace_records: Dictionary, trace_polish_previews: Dictionary) -> String:
	var source := _trace_source_label(str(entry.get("source", "event")))
	var action_type := str(entry.get("actionType", "?"))
	var result_code := str(entry.get("resultCode", "?"))
	var chain := _trace_chain_text(entry, trace_records)
	var polish := _trace_polish_text(entry, trace_polish_previews)
	if polish != "":
		chain += " | " + polish
	var actors := _trace_actor_text(entry)
	var summary := _short_text(str(entry.get("summary", "")), 70)
	if summary == "":
		summary = "No display text"
	var settlement := settlement_preview_text(entry, true)
	if settlement == "":
		var action_record_id := str(entry.get("actionRecordId", ""))
		var record = trace_records.get(action_record_id, {})
		if typeof(record) == TYPE_DICTIONARY:
			settlement = settlement_preview_text(record, true)
	if settlement != "":
		summary += "\n" + settlement
	var details := _trace_detail_text(entry, trace_records, trace_polish_previews)
	if details != "":
		summary += "\n" + details
	return "%s %s/%s | %s | %s\n%s" % [
		source,
		action_type,
		result_code,
		actors,
		chain,
		summary
	]

func _trace_detail_text(entry: Dictionary, trace_records: Dictionary, trace_polish_previews: Dictionary) -> String:
	var parts: Array = []
	var ids := _trace_id_text(entry)
	if ids != "":
		parts.append(ids)
	var presentation := _trace_presentation_text(entry)
	if presentation != "":
		parts.append(presentation)
	var policy := _trace_policy_text(entry)
	if policy != "":
		parts.append(policy)
	var readback := _trace_record_detail_text(entry, trace_records)
	if readback != "":
		parts.append(readback)
	var polish := _trace_polish_detail_text(entry, trace_polish_previews)
	if polish != "":
		parts.append(polish)
	if parts.is_empty():
		return ""
	return "Debug: " + " | ".join(parts)

func _trace_id_text(entry: Dictionary) -> String:
	var ids: Array = []
	var action_record_id := str(entry.get("actionRecordId", ""))
	var world_event_id := str(entry.get("worldEventId", ""))
	if action_record_id != "":
		ids.append("actionRecord=" + _short_id(action_record_id))
	if world_event_id != "":
		ids.append("worldEvent=" + _short_id(world_event_id))
	if ids.is_empty():
		return ""
	return "ids " + ", ".join(ids)

func _trace_presentation_text(entry: Dictionary) -> String:
	var parts: Array = []
	var source := str(entry.get("presentationSource", ""))
	var version = entry.get("presentationVersion", null)
	var kind := str(entry.get("bubbleKind", ""))
	if source != "":
		var source_text := source
		if typeof(version) == TYPE_FLOAT or typeof(version) == TYPE_INT:
			source_text += " v%d" % int(version)
		parts.append("presentation=" + source_text)
	if kind != "":
		parts.append("bubble=" + kind)
	if parts.is_empty():
		return ""
	return ", ".join(parts)

func _trace_policy_text(entry: Dictionary) -> String:
	var policy = entry.get("presentationPolicy", {})
	if typeof(policy) != TYPE_DICTIONARY:
		return ""
	var bits: Array = []
	if policy.get("durableSummaryLocked", false) == true:
		bits.append("summary locked")
	if policy.get("llmMayPolishDisplayText", false) == true:
		bits.append("polish display")
	if policy.get("llmMayChangeFacts", false) == false:
		bits.append("facts locked")
	if policy.get("llmMayChangeDurableState", false) == false:
		bits.append("state locked")
	if bits.is_empty():
		return ""
	return "policy " + ", ".join(bits)

func _trace_record_detail_text(entry: Dictionary, trace_records: Dictionary) -> String:
	var action_record_id := str(entry.get("actionRecordId", ""))
	if action_record_id == "":
		return ""
	var record = trace_records.get(action_record_id, {})
	if typeof(record) != TYPE_DICTIONARY:
		return "readback missing"
	if record.get("ok", false) == true:
		var status := str(record.get("status", ""))
		var result_code := str(record.get("resultCode", ""))
		var linked_event_id := str(record.get("worldEventId", ""))
		var parts: Array = ["readback ok"]
		if status != "":
			parts.append(status)
		if result_code != "":
			parts.append(result_code)
		if linked_event_id != "":
			parts.append("event " + _short_id(linked_event_id))
		return " ".join(parts)
	return "readback " + str(record.get("status", "pending"))

func _trace_polish_detail_text(entry: Dictionary, trace_polish_previews: Dictionary) -> String:
	var action_record_id := str(entry.get("actionRecordId", ""))
	if action_record_id == "":
		return ""
	var preview_payload = trace_polish_previews.get(action_record_id, {})
	if typeof(preview_payload) != TYPE_DICTIONARY or preview_payload.is_empty():
		return ""
	var preview = preview_payload.get("polishPreview", {})
	if typeof(preview) != TYPE_DICTIONARY:
		return ""
	var status := str(preview.get("status", ""))
	var mode := str(preview.get("mode", ""))
	var validation = preview.get("validation", {})
	var preview_only := false
	if typeof(validation) == TYPE_DICTIONARY:
		preview_only = validation.get("previewOnly", false) == true
	var input = preview.get("input", {})
	var durable_hash := ""
	if typeof(input) == TYPE_DICTIONARY:
		durable_hash = str(input.get("durableSummaryHash", ""))
	var parts: Array = []
	if status != "":
		parts.append(status)
	if mode != "":
		parts.append(mode)
	parts.append("previewOnly" if preview_only else "candidate")
	if durable_hash != "":
		parts.append("hash " + _short_id(durable_hash))
	return "polish " + "/".join(parts)

func _trace_chain_text(entry: Dictionary, trace_records: Dictionary) -> String:
	var trace_chain = entry.get("traceChain", {})
	if typeof(trace_chain) == TYPE_DICTIONARY and not trace_chain.is_empty():
		var chain_text := _trace_chain_payload_text(trace_chain)
		var readback_text := _trace_readback_status_text(entry, trace_records)
		if readback_text != "":
			chain_text += " (" + readback_text + ")"
		return chain_text
	var world_event_id := str(entry.get("worldEventId", ""))
	var action_record_id := str(entry.get("actionRecordId", ""))
	if entry.get("tickOnly", false) == true:
		return "tickOnly " + _short_id(world_event_id)
	if action_record_id == "":
		return "worldEvent " + _short_id(world_event_id)
	var readback := "pending"
	var record = trace_records.get(action_record_id, {})
	if typeof(record) == TYPE_DICTIONARY and record.get("ok", false) == true:
		var linked_event_id := str(record.get("worldEventId", ""))
		if linked_event_id == world_event_id:
			readback = "readback ok"
		elif linked_event_id != "":
			readback = "readback " + _short_id(linked_event_id)
	return "actionRecord %s -> worldEvent %s (%s)" % [
		_short_id(action_record_id),
		_short_id(world_event_id),
		readback
	]

func _trace_readback_status_text(entry: Dictionary, trace_records: Dictionary) -> String:
	var action_record_id := str(entry.get("actionRecordId", ""))
	if action_record_id == "" or entry.get("tickOnly", false) == true:
		return ""
	var world_event_id := str(entry.get("worldEventId", ""))
	var record = trace_records.get(action_record_id, {})
	if typeof(record) != TYPE_DICTIONARY:
		return "readback pending"
	if record.get("ok", false) == true:
		var linked_event_id := str(record.get("worldEventId", ""))
		if linked_event_id == "" or world_event_id == "":
			return "readback ok"
		if linked_event_id == world_event_id:
			return "readback ok"
		return "readback " + _short_id(linked_event_id)
	return str(record.get("status", "readback pending"))

func _trace_chain_payload_text(trace_chain: Dictionary) -> String:
	var steps = trace_chain.get("steps", [])
	if typeof(steps) == TYPE_ARRAY and not steps.is_empty():
		var step_text := _trace_steps_text(steps)
		if step_text != "":
			return step_text
	var label := str(trace_chain.get("label", ""))
	var link_status := str(trace_chain.get("linkStatus", ""))
	var world_event_id := str(trace_chain.get("worldEventId", ""))
	var action_record_id := str(trace_chain.get("actionRecordId", ""))
	var tick_only: bool = trace_chain.get("tickOnly", false) == true
	var durable: bool = trace_chain.get("durable", false) == true
	var ids: Array = []
	if action_record_id != "":
		ids.append("action " + _short_id(action_record_id))
	if world_event_id != "":
		ids.append("event " + _short_id(world_event_id))
	var state := link_status if link_status != "" else ("tick_only" if tick_only else "?")
	var durable_text := "durable" if durable else ("tickOnly" if tick_only else "observed")
	var prefix := label if label != "" else state
	return "%s [%s] %s" % [
		prefix,
		durable_text,
		" -> ".join(ids) if not ids.is_empty() else state
	]

func _trace_steps_text(steps: Array) -> String:
	var parts: Array = []
	for raw_step in steps:
		if typeof(raw_step) != TYPE_DICTIONARY:
			continue
		var step: Dictionary = raw_step
		var label := _trace_step_label(str(step.get("kind", "")), str(step.get("label", "")))
		var id := ""
		if step.has("actionRecordId"):
			id = str(step.get("actionRecordId", ""))
		elif step.has("worldEventId"):
			id = str(step.get("worldEventId", ""))
		if id != "":
			label += " " + _short_id(id)
		if label != "":
			parts.append(label)
	if parts.is_empty():
		return ""
	return " -> ".join(parts)

func _trace_step_label(kind: String, fallback: String) -> String:
	match kind:
		"semantic_action":
			return "Action"
		"agent_tick", "tick_observation":
			return "Tick"
		"action_record", "action_record_readback":
			return "ActionRecord"
		"world_event", "region_event":
			return "WorldEvent"
		"replay":
			return "Replay"
		"tick_only":
			return "TickOnly"
		_:
			return fallback.capitalize() if fallback != "" else "Step"

func _trace_polish_text(entry: Dictionary, trace_polish_previews: Dictionary) -> String:
	var action_record_id := str(entry.get("actionRecordId", ""))
	if action_record_id == "":
		return ""
	var preview_payload = trace_polish_previews.get(action_record_id, {})
	if typeof(preview_payload) != TYPE_DICTIONARY or preview_payload.is_empty():
		return ""
	var preview = preview_payload.get("polishPreview", {})
	if typeof(preview) != TYPE_DICTIONARY:
		return ""
	var status := str(preview.get("status", ""))
	if status == "":
		return ""
	var guardrails = preview.get("guardrails", [])
	var guardrail_count: int = 0
	if typeof(guardrails) == TYPE_ARRAY:
		guardrail_count = guardrails.size()
	var validation = preview.get("validation", {})
	var preview_only := false
	if typeof(validation) == TYPE_DICTIONARY:
		preview_only = validation.get("previewOnly", false) == true
	var policy = preview.get("presentationPolicy", {})
	var locked := false
	if typeof(policy) == TYPE_DICTIONARY:
		locked = policy.get("durableSummaryLocked", false) == true
	var lock_text := "locked" if locked else "unlocked"
	var mode_text := "preview" if preview_only else "candidate"
	return "polish %s/%s/%s g%d" % [status, lock_text, mode_text, guardrail_count]

func _trace_source_label(source: String) -> String:
	match source:
		"replay_action":
			return "Replay"
		"replay_event":
			return "Replay"
		"action":
			return "Action"
		"tick":
			return "Tick"
		_:
			return source.capitalize()

func _trace_actor_text(entry: Dictionary) -> String:
	var actor := _first_array_text(entry.get("actorIds", []))
	var target := _first_array_text(entry.get("targetActorIds", []))
	var location_id := str(entry.get("locationId", ""))
	var parts: Array = []
	if actor != "":
		parts.append(_short_actor_id(actor))
	if target != "":
		parts.append("-> " + _short_actor_id(target))
	if location_id != "":
		parts.append("@ " + location_id)
	if parts.is_empty():
		return "world"
	return " ".join(parts)

func _first_array_text(value) -> String:
	if typeof(value) == TYPE_ARRAY and not value.is_empty():
		return str(value[0])
	return ""

func _short_actor_id(value: String) -> String:
	if value.begins_with("qinglan:qinglan-"):
		return value.replace("qinglan:qinglan-", "")
	if value.begins_with("qinglan:"):
		return value.substr(8)
	return _short_text(value, 22)

func _short_text(text: String, max_chars: int) -> String:
	if text.length() <= max_chars:
		return text
	return text.substr(0, max_chars - 1) + "..."

func _short_id(value: String) -> String:
	if value == "":
		return "?"
	return value.substr(0, min(8, value.length()))
