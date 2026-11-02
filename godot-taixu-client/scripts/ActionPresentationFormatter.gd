extends RefCounted
class_name ActionPresentationFormatter

func option_label(option: Dictionary) -> String:
	var label := str(option.get("label", ""))
	if label != "":
		return label
	var item_name := str(option.get("itemName", option.get("requestedItemName", "")))
	if item_name != "":
		return item_name
	return "Option"

func detail_text(capability: Dictionary, selected_resident_distance: float, interaction_range_tiles: float) -> String:
	match str(capability.get("type", "")):
		"trade":
			return trade_detail_text(capability)
		"gift":
			return gift_detail_text(capability)
		"request_teaching":
			return teaching_detail_text(capability)
		"spar":
			return spar_detail_text(capability, selected_resident_distance, interaction_range_tiles)
		"attack":
			return conflict_detail_text(capability, "Attack", selected_resident_distance, interaction_range_tiles)
		"flee":
			return conflict_detail_text(capability, "Flee", selected_resident_distance, interaction_range_tiles)
		"loot":
			return loot_detail_text(capability, selected_resident_distance, interaction_range_tiles)
		"breakthrough":
			return breakthrough_detail_text(capability)
		"cultivate":
			return cultivation_detail_text(capability)
		"use_item":
			return use_item_detail_text(capability)
		_:
			return ""

func confirmation_title(capability: Dictionary) -> String:
	match str(capability.get("type", "")):
		"trade":
			return "Confirm Trade"
		"gift":
			return "Confirm Gift"
		"request_teaching":
			return "Confirm Teaching Request"
		"accept_request":
			return "Confirm Request Acceptance"
		"decline_request":
			return "Confirm Request Decline"
		"turn_in_request":
			return "Confirm Request Turn-in"
		"spar":
			return "Confirm Spar"
		"attack":
			return "Confirm Hostile Attack"
		"flee":
			return "Confirm Flee"
		"loot":
			return "Confirm Loot"
		"breakthrough":
			return "Confirm Breakthrough"
		"cultivate":
			return "Confirm Cultivation"
		"steal":
			return "Confirm Risky Action"
		"use_item":
			return "Confirm Use Item"
		_:
			return "Confirm Action"

func confirmation_body(
	capability: Dictionary,
	target_name: String,
	selected_resident_distance: float,
	interaction_range_tiles: float
) -> String:
	match str(capability.get("type", "")):
		"trade":
			return trade_confirmation_text(capability)
		"gift":
			return gift_confirmation_text(capability, target_name)
		"request_teaching":
			return teaching_confirmation_text(capability)
		"accept_request", "decline_request", "turn_in_request":
			return str(capability.get("requestSummary", capability.get("intent", "Confirm request action.")))
		"spar":
			return spar_confirmation_text(capability, selected_resident_distance, interaction_range_tiles)
		"attack":
			return conflict_confirmation_text(capability, "Attack", target_name, selected_resident_distance, interaction_range_tiles)
		"flee":
			return conflict_confirmation_text(capability, "Flee", target_name, selected_resident_distance, interaction_range_tiles)
		"loot":
			return conflict_confirmation_text(capability, "Loot", target_name, selected_resident_distance, interaction_range_tiles)
		"breakthrough":
			return breakthrough_confirmation_text(capability)
		"cultivate":
			return cultivation_confirmation_text(capability)
		"steal":
			return "This action can create suspicion, grudges, and reputation loss.\nConvex will adjudicate the final outcome."
		"use_item":
			return use_item_confirmation_text(capability)
		_:
			return action_button_text(capability)

func action_button_text(capability: Dictionary) -> String:
	return str(capability.get("label", capability.get("type", "Action")))

func conflict_detail_text(
	capability: Dictionary,
	label: String,
	selected_resident_distance: float,
	interaction_range_tiles: float
) -> String:
	if capability.is_empty():
		return ""
	var duration_seconds := float(capability.get("durationMs", 0)) / 1000.0
	var range_text := ""
	if is_finite(selected_resident_distance):
		range_text = " | distance %.2f/%.0f tiles" % [selected_resident_distance, interaction_range_tiles]
	var state := "ready" if bool(capability.get("enabled", false)) else str(capability.get("reason", "unavailable"))
	return "%s: %.1fs%s | %s | Convex adjudicates outcome" % [label, duration_seconds, range_text, state]

func loot_detail_text(
	capability: Dictionary,
	selected_resident_distance: float,
	interaction_range_tiles: float
) -> String:
	var text := conflict_detail_text(capability, "Loot", selected_resident_distance, interaction_range_tiles)
	var option := selected_action_option(capability)
	if not option.is_empty():
		text += " | item %s x1" % str(option.get("itemId", option.get("label", "unknown")))
	return text

func conflict_confirmation_text(
	capability: Dictionary,
	label: String,
	target_name: String,
	selected_resident_distance: float,
	interaction_range_tiles: float
) -> String:
	var detail := (
		loot_detail_text(capability, selected_resident_distance, interaction_range_tiles)
		if str(capability.get("type", "")) == "loot"
		else conflict_detail_text(capability, label, selected_resident_distance, interaction_range_tiles)
	)
	var target_text := "" if target_name == "" else "\nTarget: " + target_name
	return detail + target_text + "\nNo damage, escape result, or item transfer is applied until the timed body action completes and Convex revalidates it."

func trade_detail_text(capability: Dictionary) -> String:
	if capability.is_empty() or str(capability.get("type", "")) != "trade":
		return ""
	var option := selected_action_option(capability)
	if option.is_empty():
		return "Trade: " + str(capability.get("reason", "no affordable option from this seller."))

	var quote = option.get("quote", {})
	if typeof(quote) != TYPE_DICTIONARY:
		quote = {}
	var item_name := str(option.get("requestedItemName", option.get("requestedItemId", "item")))
	var item_id := str(option.get("requestedItemId", ""))
	var requested_qty := int(option.get("requestedQty", 1))
	var price := int(option.get("priceSpiritStones", 0))
	var unit_price := int(option.get("unitPriceSpiritStones", price))
	var buyer_stones := int(option.get("buyerSpiritStones", -1))
	var stock := int(option.get("requestedQtyAvailable", 0))
	var base_price := int(quote.get("basePrice", price))
	var relationship_mult := float(quote.get("relationshipMultiplier", 1.0))
	var suspicion_mult := float(quote.get("suspicionMultiplier", 1.0))
	var regular_mult := float(quote.get("regularMultiplier", 1.0))
	var affordability := "ready" if bool(option.get("affordable", true)) else "short"
	var quantity_text := trade_quantity_choices_text(option)
	var terms_text := exchange_terms_text(option)
	var delta_text := inventory_delta_preview_text(option)
	var selection_text := option_selection_text(option)
	var text := "Trade: buy %s (%s) x%d | cost %d (%d ea) | you %s | stock %d | %s\nQuote: base %d x relation %.2f x suspicion %.2f x regular %.2f" % [
		item_name,
		item_id,
		requested_qty,
		price,
		unit_price,
		str(buyer_stones) if buyer_stones >= 0 else "?",
		stock,
		affordability,
		base_price,
		relationship_mult,
		suspicion_mult,
		regular_mult
	]
	if quantity_text != "":
		text += "\n" + quantity_text
	if terms_text != "":
		text += "\n" + terms_text
	var confirmation_preview := confirmation_preview_text(option, true)
	if confirmation_preview != "":
		text = confirmation_preview + "\n" + text
	if selection_text != "":
		text += "\n" + selection_text
	return text + ("\n" + delta_text if delta_text != "" else "")

func gift_detail_text(capability: Dictionary) -> String:
	if capability.is_empty() or str(capability.get("type", "")) != "gift":
		return ""
	var option := selected_action_option(capability)
	if option.is_empty():
		return "Gift: " + str(capability.get("reason", "no item available."))
	var item_name := str(option.get("itemName", option.get("itemId", "item")))
	var item_id := str(option.get("itemId", ""))
	var qty := int(option.get("qtyAvailable", 0))
	var state := "ready" if capability.get("enabled", false) == true else str(capability.get("reason", "blocked"))
	var delta_text := inventory_delta_preview_text(option)
	var selection_text := option_selection_text(option)
	var text := "Gift: give %s (%s) x1 | you have %d | %s" % [
		item_name,
		item_id,
		qty,
		state
	]
	var confirmation_preview := confirmation_preview_text(option, true)
	if confirmation_preview != "":
		text = confirmation_preview + "\n" + text
	if selection_text != "":
		text += "\n" + selection_text
	return text + ("\n" + delta_text if delta_text != "" else "")

func teaching_detail_text(capability: Dictionary) -> String:
	if capability.is_empty() or str(capability.get("type", "")) != "request_teaching":
		return ""
	var actor_realm := realm_label(capability, "actorRealm", "actorRealmStage")
	var target_realm := realm_label(capability, "targetRealm", "targetRealmStage")
	var relationship := int(capability.get("actorRelationship", 0))
	var required_relationship := int(capability.get("requiredRelationship", 0))
	var reputation := int(capability.get("actorReputation", 0))
	var minimum_reputation := int(capability.get("minimumReputation", -50))
	var state := "ready" if capability.get("enabled", false) == true else str(capability.get("reason", "blocked"))
	var text := "Teaching: you %s -> teacher %s | relation %d/%d | reputation %d/%d | %s" % [
		actor_realm,
		target_realm,
		relationship,
		required_relationship,
		reputation,
		minimum_reputation,
		state
	]
	var risk_text := risk_preview_text(capability, true)
	return text + ("\n" + risk_text if risk_text != "" else "")

func spar_detail_text(capability: Dictionary, selected_resident_distance: float, interaction_range_tiles: float) -> String:
	if capability.is_empty() or str(capability.get("type", "")) != "spar":
		return ""
	var distance := float(capability.get("distanceTiles", selected_resident_distance))
	var range_tiles := float(capability.get("rangeTiles", interaction_range_tiles))
	var state := "ready" if capability.get("enabled", false) == true else str(capability.get("reason", "blocked"))
	var text := "Spar: distance %.1f/%.1f tiles | %s" % [
		distance,
		range_tiles,
		state
	]
	var risk_text := risk_preview_text(capability, true)
	return text + ("\n" + risk_text if risk_text != "" else "")

func breakthrough_detail_text(capability: Dictionary) -> String:
	if capability.is_empty() or str(capability.get("type", "")) != "breakthrough":
		return ""
	var realm := realm_label(capability, "realm", "realmStage")
	var cultivation_xp := int(capability.get("cultivationXp", 0))
	var threshold := int(capability.get("breakthroughThreshold", 0))
	var gate := "realm gate" if capability.get("realmGate", false) == true else "minor layers auto"
	var state := "ready" if capability.get("enabled", false) == true else str(capability.get("reason", "blocked"))
	var elapsed_days := float(capability.get("breakthroughElapsedMs", 0)) / 86400000.0
	var required_days := float(capability.get("breakthroughRequiredDwellMs", 0)) / 86400000.0
	var material_item := str(capability.get("breakthroughMaterialItemId", "spirit_stone"))
	var material_qty := int(capability.get("breakthroughMaterialQuantity", 0))
	var material_owned := int(capability.get("breakthroughMaterialOwned", 0))
	var duration_seconds := float(capability.get("durationMs", 10000)) / 1000.0
	var text := "Breakthrough: %s | XP %d/%d | %s | time %.1f/%.0f days | cost %s x%d (owned %d) | %.1fs | %s" % [
		realm,
		cultivation_xp,
		threshold,
		gate,
		elapsed_days,
		required_days,
		material_item,
		material_qty,
		material_owned,
		duration_seconds,
		state
	]
	var risk_text := risk_preview_text(capability, true)
	return text + ("\n" + risk_text if risk_text != "" else "")

func cultivation_detail_text(capability: Dictionary) -> String:
	if capability.is_empty() or str(capability.get("type", "")) != "cultivate":
		return ""
	var option := selected_action_option(capability)
	var source: Dictionary = option if not option.is_empty() else capability
	var mode := str(source.get("cultivationMode", source.get("params", {}).get("cultivationMode", "ambient")))
	var mode_label := "Ambient Qi"
	if mode == "spirit_stone":
		mode_label = "Spirit Stone"
	elif mode == "qi_pill":
		mode_label = "Qi Pill"
	var energy := int(source.get("spiritualEnergy", capability.get("spiritualEnergy", 0)))
	var duration_ms := int(source.get("durationMs", capability.get("durationMs", 8000)))
	var estimated = source.get("estimatedXp", {})
	if typeof(estimated) != TYPE_DICTIONARY:
		estimated = {}
	var min_xp := int(estimated.get("min", 0))
	var max_xp := int(estimated.get("max", min_xp))
	var item_cost = source.get("itemCost", null)
	var cost_text := "free"
	if typeof(item_cost) == TYPE_DICTIONARY:
		cost_text = "%s x%d" % [str(item_cost.get("itemId", "resource")), int(item_cost.get("qty", 1))]
	var pendant_bonus := float(capability.get("pendantBonus", 0.0))
	var pendant_text := " | pendant +%d%% included" % int(round(pendant_bonus * 100.0)) if pendant_bonus > 0.0 else ""
	var state := "ready" if capability.get("enabled", false) == true else str(capability.get("reason", "blocked"))
	return "Cultivation: %s | %.1fs | spiritual energy %d/10 | XP %d-%d | cost %s%s | %s" % [
		mode_label,
		float(duration_ms) / 1000.0,
		energy,
		min_xp,
		max_xp,
		cost_text,
		pendant_text,
		state,
	]

func cultivation_confirmation_text(capability: Dictionary) -> String:
	var detail := cultivation_detail_text(capability)
	if detail == "":
		return "Cultivation details are unavailable."
	return detail + "\nThe resource is reserved now and only consumed by Convex after the full body duration completes."

func use_item_detail_text(capability: Dictionary) -> String:
	if capability.is_empty() or str(capability.get("type", "")) != "use_item":
		return ""
	var option := selected_action_option(capability)
	var source: Dictionary = option if not option.is_empty() else capability
	var item_name := str(source.get("itemName", source.get("itemId", "healing item")))
	var item_id := str(source.get("itemId", capability.get("params", {}).get("itemId", "")))
	var qty := int(source.get("qtyAvailable", capability.get("qtyAvailable", 0)))
	var current_health := int(source.get("currentHealth", capability.get("currentHealth", 0)))
	var max_health := int(source.get("maxHealth", capability.get("maxHealth", current_health)))
	var heal_value := int(source.get("healValue", capability.get("healValue", 0)))
	var effective_heal := int(source.get("effectiveHeal", capability.get("effectiveHeal", heal_value)))
	var resulting_health := mini(max_health, current_health + maxi(0, effective_heal))
	var state := "ready" if capability.get("enabled", false) == true else str(capability.get("reason", "blocked"))
	var text := "Use item: %s (%s) x1 | inventory %d -> %d | health %d -> %d/%d (+%d, up to %d) | %s" % [
		item_name,
		item_id,
		qty,
		maxi(0, qty - 1),
		current_health,
		resulting_health,
		max_health,
		maxi(0, effective_heal),
		maxi(0, heal_value),
		state
	]
	var confirmation_preview := confirmation_preview_text(source, true)
	if confirmation_preview != "":
		text = confirmation_preview + "\n" + text
	var selection_text := option_selection_text(source)
	if selection_text != "":
		text += "\n" + selection_text
	var delta_text := inventory_delta_preview_text(source)
	return text + ("\n" + delta_text if delta_text != "" else "")

func selected_action_option(capability: Dictionary) -> Dictionary:
	var selected_option = capability.get("selectedOption", {})
	if typeof(selected_option) == TYPE_DICTIONARY and not selected_option.is_empty():
		return selected_option
	var options = capability.get("options", [])
	if typeof(options) == TYPE_ARRAY and not options.is_empty() and typeof(options[0]) == TYPE_DICTIONARY:
		return options[0]
	return {}

func trade_confirmation_text(capability: Dictionary) -> String:
	var option := selected_action_option(capability)
	if option.is_empty():
		return "Trade details are unavailable."
	var quote = option.get("quote", {})
	if typeof(quote) != TYPE_DICTIONARY:
		quote = {}
	var item_name := str(option.get("requestedItemName", option.get("requestedItemId", "item")))
	var item_id := str(option.get("requestedItemId", ""))
	var requested_qty := int(option.get("requestedQty", 1))
	var price := int(option.get("priceSpiritStones", 0))
	var unit_price := int(option.get("unitPriceSpiritStones", price))
	var buyer_stones := int(option.get("buyerSpiritStones", 0))
	var stock := int(option.get("requestedQtyAvailable", 0))
	var base_price := int(quote.get("basePrice", price))
	var relationship_mult := float(quote.get("relationshipMultiplier", 1.0))
	var suspicion_mult := float(quote.get("suspicionMultiplier", 1.0))
	var regular_mult := float(quote.get("regularMultiplier", 1.0))
	var quantity_text := trade_quantity_choices_text(option)
	var terms_text := exchange_terms_text(option)
	var delta_text := inventory_delta_preview_text(option)
	var selection_text := option_selection_text(option)
	var text := "Buy %s (%s) x%d for %d spirit stone(s) (%d each).\nBalance %d -> %d | seller stock %d\nQuote: base %d x relation %.2f x suspicion %.2f x regular %.2f" % [
		item_name,
		item_id,
		requested_qty,
		price,
		unit_price,
		buyer_stones,
		maxi(0, buyer_stones - price),
		stock,
		base_price,
		relationship_mult,
		suspicion_mult,
		regular_mult
	]
	if quantity_text != "":
		text += "\n" + quantity_text
	if terms_text != "":
		text += "\n" + terms_text
	var confirmation_preview := confirmation_preview_text(option)
	if confirmation_preview != "":
		text = confirmation_preview + "\n\n" + text
	if selection_text != "":
		text += "\n" + selection_text
	return text + ("\n" + delta_text if delta_text != "" else "")

func gift_confirmation_text(capability: Dictionary, target_name: String) -> String:
	var option := selected_action_option(capability)
	if option.is_empty():
		return "Gift details are unavailable."
	var item_name := str(option.get("itemName", option.get("itemId", "item")))
	var item_id := str(option.get("itemId", ""))
	var qty := int(option.get("qtyAvailable", 0))
	var resolved_target := target_name if target_name != "" else "target"
	var delta_text := inventory_delta_preview_text(option)
	var selection_text := option_selection_text(option)
	var text := "Give %s (%s) x1 to %s.\nInventory %d -> %d\nConvex will decide acceptance and relationship effects." % [
		item_name,
		item_id,
		resolved_target,
		qty,
		maxi(0, qty - 1)
	]
	var confirmation_preview := confirmation_preview_text(option)
	if confirmation_preview != "":
		text = confirmation_preview + "\n\n" + text
	if selection_text != "":
		text += "\n" + selection_text
	return text + ("\n" + delta_text if delta_text != "" else "")

func use_item_confirmation_text(capability: Dictionary) -> String:
	var option := selected_action_option(capability)
	var source: Dictionary = option if not option.is_empty() else capability
	var item_name := str(source.get("itemName", source.get("itemId", "healing item")))
	var item_id := str(source.get("itemId", capability.get("params", {}).get("itemId", "")))
	var qty := int(source.get("qtyAvailable", capability.get("qtyAvailable", 0)))
	var current_health := int(source.get("currentHealth", capability.get("currentHealth", 0)))
	var max_health := int(source.get("maxHealth", capability.get("maxHealth", current_health)))
	var heal_value := int(source.get("healValue", capability.get("healValue", 0)))
	var effective_heal := int(source.get("effectiveHeal", capability.get("effectiveHeal", heal_value)))
	var resulting_health := mini(max_health, current_health + maxi(0, effective_heal))
	var text := "Use %s (%s) x1.\nInventory %d -> %d\nHealth %d -> %d/%d (+%d; restores up to %d).\nConvex will atomically consume one item and clamp health to the server-owned maximum." % [
		item_name,
		item_id,
		qty,
		maxi(0, qty - 1),
		current_health,
		resulting_health,
		max_health,
		maxi(0, effective_heal),
		maxi(0, heal_value)
	]
	var confirmation_preview := confirmation_preview_text(source)
	if confirmation_preview != "":
		text = confirmation_preview + "\n\n" + text
	var selection_text := option_selection_text(source)
	if selection_text != "":
		text += "\n" + selection_text
	var delta_text := inventory_delta_preview_text(source)
	return text + ("\n" + delta_text if delta_text != "" else "")

func option_selection_text(option: Dictionary) -> String:
	if option.is_empty():
		return ""
	var parts: Array = []
	var choice_count := int(option.get("quantityChoiceCount", 0))
	var choice_index := int(option.get("quantityChoiceIndex", -1))
	if choice_count > 0 and choice_index >= 0:
		parts.append("option %d/%d" % [choice_index + 1, choice_count])
	var requested_qty := int(option.get("requestedQty", 0))
	if requested_qty > 0:
		parts.append("qty x%d" % requested_qty)
	var max_selectable_qty := int(option.get("maxSelectableQty", 0))
	if max_selectable_qty > 0:
		parts.append("max x%d" % max_selectable_qty)
	var price := int(option.get("priceSpiritStones", 0))
	if price > 0:
		parts.append("%d spirit stones" % price)
	var preview = option.get("confirmationPreview", {})
	if typeof(preview) == TYPE_DICTIONARY:
		if preview.get("previewOnly", false) == true:
			parts.append("previewOnly")
		var policy = preview.get("policy", {})
		if typeof(policy) == TYPE_DICTIONARY:
			if policy.get("convexAuthored", false) == true:
				parts.append("Convex-owned")
			if policy.get("godotMayDisplayOnly", false) == true:
				parts.append("display-only")
			if policy.get("durableStateUnchanged", false) == true:
				parts.append("durable unchanged until submit")
	if parts.is_empty():
		return ""
	return "Selection: " + " | ".join(parts)

func confirmation_preview_text(source: Dictionary, compact: bool = false) -> String:
	var preview = source.get("confirmationPreview", {})
	if typeof(preview) != TYPE_DICTIONARY:
		return ""
	var summary := str(preview.get("summary", ""))
	var primary_line := str(preview.get("primaryLine", ""))
	if summary == "" and primary_line == "":
		return ""
	var source_label := str(preview.get("presentationSource", ""))
	var preview_only: bool = preview.get("previewOnly", false) == true
	if compact:
		var compact_text := "Confirm: " + (summary if summary != "" else primary_line)
		if source_label != "":
			compact_text += " | " + source_label
		if preview_only:
			compact_text += " | preview"
		return compact_text
	var lines: Array = []
	lines.append("Convex preview: " + (summary if summary != "" else primary_line))
	if primary_line != "" and primary_line != summary:
		lines.append(primary_line)
	var balance_line := str(preview.get("balanceLine", ""))
	if balance_line != "":
		lines.append(balance_line)
	var terms_line := str(preview.get("termsLine", ""))
	if terms_line != "":
		lines.append("Terms: " + terms_line)
	var inventory_line := str(preview.get("inventoryLine", ""))
	if inventory_line != "":
		lines.append("Inventory: " + inventory_line)
	var effects := strings_from_array(preview.get("durableEffectNotes", []), 4)
	if not effects.is_empty():
		lines.append("Durable: " + " | ".join(effects))
	var policy = preview.get("policy", {})
	if typeof(policy) == TYPE_DICTIONARY:
		var submit_path := str(policy.get("submitPath", ""))
		if submit_path != "":
			lines.append("Submit: " + submit_path)
	return "\n".join(lines)

func inventory_delta_preview_text(source: Dictionary) -> String:
	var preview = source.get("inventoryDeltaPreview", {})
	if typeof(preview) != TYPE_DICTIONARY:
		return ""
	var deltas = preview.get("deltas", [])
	if typeof(deltas) != TYPE_ARRAY or deltas.is_empty():
		return ""
	var parts: Array = []
	for raw_delta in deltas:
		if typeof(raw_delta) != TYPE_DICTIONARY:
			continue
		var delta: Dictionary = raw_delta
		var owner := "You" if str(delta.get("owner", "")) == "actor" else "Target"
		var item_label := str(delta.get("itemName", delta.get("itemId", "item")))
		var before := int(delta.get("before", 0))
		var after := int(delta.get("after", before))
		var amount := int(delta.get("delta", after - before))
		var sign := "+" if amount > 0 else ""
		parts.append("%s %s %d -> %d (%s%d)" % [
			owner,
			item_label,
			before,
			after,
			sign,
			amount
		])
	if parts.is_empty():
		return ""
	return "Inventory: " + " | ".join(parts)

func trade_quantity_choices_text(source: Dictionary) -> String:
	var choices = source.get("quantityChoices", [])
	if typeof(choices) != TYPE_ARRAY or choices.size() <= 1:
		return ""
	var requested_qty := int(source.get("requestedQty", 1))
	var parts: Array = []
	for raw_choice in choices:
		if typeof(raw_choice) != TYPE_DICTIONARY:
			continue
		var choice: Dictionary = raw_choice
		var qty := int(choice.get("requestedQty", 0))
		if qty <= 0:
			continue
		var label := str(choice.get("label", "x" + str(qty)))
		if qty == requested_qty:
			label = "[" + label + "]"
		parts.append(label)
	if parts.is_empty():
		return ""
	return "Quantities: " + " / ".join(parts)

func exchange_terms_text(source: Dictionary) -> String:
	var terms = source.get("exchangeTerms", [])
	if typeof(terms) != TYPE_ARRAY or terms.is_empty():
		return ""
	var parts: Array = []
	for raw_term in terms:
		if typeof(raw_term) != TYPE_DICTIONARY:
			continue
		var term: Dictionary = raw_term
		var from_label := trade_owner_label(str(term.get("from", "")))
		var to_label := trade_owner_label(str(term.get("to", "")))
		var item_label := str(term.get("itemName", term.get("itemId", "item")))
		var qty := int(term.get("qty", 0))
		if qty <= 0:
			continue
		parts.append("%s -> %s: %s x%d" % [
			from_label,
			to_label,
			item_label,
			qty
		])
	if parts.is_empty():
		return ""
	return "Terms: " + " | ".join(parts)

func trade_owner_label(owner: String) -> String:
	match owner:
		"actor":
			return "You"
		"target":
			return "Target"
		_:
			return owner if owner != "" else "?"

func risk_preview_text(capability: Dictionary, compact: bool = false) -> String:
	var preview = capability.get("riskPreview", {})
	if typeof(preview) != TYPE_DICTIONARY:
		return ""
	var level := str(preview.get("level", ""))
	var summary := str(preview.get("summary", ""))
	if summary == "":
		return ""
	var header := "Risk: " + summary if level == "" else "Risk: %s | %s" % [level, summary]
	if compact:
		return header
	var lines: Array = [header]
	var gates := strings_from_array(preview.get("ruleGates", []), 3)
	if not gates.is_empty():
		lines.append("Rules: " + " | ".join(gates))
	var codes := strings_from_array(preview.get("possibleResultCodes", []), 4)
	if not codes.is_empty():
		lines.append("Possible: " + ", ".join(codes))
	var effects := strings_from_array(preview.get("durableEffects", []), 3)
	if not effects.is_empty():
		lines.append("Durable: " + " | ".join(effects))
	return "\n".join(lines)

func strings_from_array(value: Variant, limit: int = 0) -> Array:
	var parts: Array = []
	if typeof(value) != TYPE_ARRAY:
		return parts
	for item in value:
		if limit > 0 and parts.size() >= limit:
			break
		var text := str(item)
		if text != "":
			parts.append(text)
	return parts

func teaching_confirmation_text(capability: Dictionary) -> String:
	var detail := teaching_detail_text(capability)
	if detail == "":
		detail = "Request guidance from the selected teacher."
	var risk_text := risk_preview_text(capability)
	if risk_text != "":
		return detail + "\n" + risk_text
	return detail + "\nConvex will decide whether the teacher accepts and what cultivation changes occur."

func spar_confirmation_text(capability: Dictionary, selected_resident_distance: float, interaction_range_tiles: float) -> String:
	var detail := spar_detail_text(capability, selected_resident_distance, interaction_range_tiles)
	if detail == "":
		detail = "Request a spar with the selected resident."
	var risk_text := risk_preview_text(capability)
	if risk_text != "":
		return detail + "\n" + risk_text
	return detail + "\nConvex may change health, mood, and relationship based on the result."

func breakthrough_confirmation_text(capability: Dictionary) -> String:
	var detail := breakthrough_detail_text(capability)
	if detail == "":
		detail = "Attempt a breakthrough."
	var risk_text := risk_preview_text(capability)
	if risk_text != "":
		return detail + "\n" + risk_text + "\nSpirit stones are reserved at start and consumed by Convex only after the full body duration completes; interruption consumes nothing. A failed completed attempt starts a bounded recovery window."
	return detail + "\nSpirit stones are reserved at start and consumed by Convex only after the full body duration completes; interruption consumes nothing."

func realm_label(source: Dictionary, realm_key: String, stage_key: String) -> String:
	var realm := str(source.get(realm_key, "?"))
	var stage_value := str(source.get(stage_key, "?"))
	return realm + " " + stage_value
