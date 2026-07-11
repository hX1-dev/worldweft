extends RefCounted
class_name ActionMenuPolicy

const TARGET_ACTIONS := ["talk", "trade", "gift", "request_teaching", "spar", "steal"]
const LOCATION_ACTIONS := ["arrive", "explore", "cultivate", "breakthrough"]
const CONFIRMATION_ACTIONS := ["trade", "gift", "request_teaching", "spar", "steal", "breakthrough"]

static func is_target_action(action_type: String) -> bool:
	return TARGET_ACTIONS.has(action_type)

static func is_location_action(action_type: String) -> bool:
	return LOCATION_ACTIONS.has(action_type)

static func requires_confirmation(capability: Dictionary) -> bool:
	return CONFIRMATION_ACTIONS.has(str(capability.get("type", "")))

static func local_availability(
	capability: Dictionary,
	has_selected_resident: bool,
	selected_resident_distance: float,
	has_current_location: bool,
	interaction_range_tiles: float
) -> Dictionary:
	var action_type := str(capability.get("type", ""))
	var category := str(capability.get("category", ""))
	if category == "target" or is_target_action(action_type):
		if not has_selected_resident:
			return { "enabled": false, "reason": "Select a resident." }
		if selected_resident_distance > interaction_range_tiles:
			return {
				"enabled": false,
				"reason": "Move within %.0f tiles." % interaction_range_tiles,
			}
		return { "enabled": true, "reason": "" }
	if category == "location" or is_location_action(action_type):
		if not has_current_location:
			return { "enabled": false, "reason": "Enter a marked location." }
		return { "enabled": true, "reason": "" }
	return { "enabled": true, "reason": "" }

static func confirmation_snapshot(
	world_id: String,
	selected_resident: Dictionary,
	current_location: Dictionary
) -> Dictionary:
	return {
		"worldId": world_id,
		"targetActorId": str(selected_resident.get("actorId", "")),
		"locationId": str(current_location.get("locationId", "")),
	}

static func confirmation_context_is_current(
	snapshot: Dictionary,
	world_id: String,
	selected_resident: Dictionary,
	current_location: Dictionary
) -> bool:
	return (
		str(snapshot.get("worldId", "")) == world_id
		and str(snapshot.get("targetActorId", "")) == str(selected_resident.get("actorId", ""))
		and str(snapshot.get("locationId", "")) == str(current_location.get("locationId", ""))
	)
