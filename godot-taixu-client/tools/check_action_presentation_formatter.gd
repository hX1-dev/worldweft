extends SceneTree

const ActionPresentationFormatterScript := preload("res://scripts/ActionPresentationFormatter.gd")

var failures: Array = []

func _init() -> void:
	var formatter = ActionPresentationFormatterScript.new()

	var trade_option: Dictionary = {
		"label": "Spirit Herb x2",
		"requestedItemName": "Spirit Herb",
		"requestedItemId": "spirit_herb",
		"requestedQty": 2,
		"offeredQty": 16,
		"priceSpiritStones": 16,
		"unitPriceSpiritStones": 8,
		"buyerSpiritStones": 42,
		"requestedQtyAvailable": 5,
		"quantityChoiceIndex": 1,
		"quantityChoiceCount": 3,
		"maxSelectableQty": 3,
		"affordable": true,
		"quote": {
			"basePrice": 10,
			"relationshipMultiplier": 0.9,
			"suspicionMultiplier": 1.1,
			"regularMultiplier": 0.95,
		},
		"quantityChoices": [
			{ "requestedQty": 1, "label": "x1 / 8 stones" },
			{ "requestedQty": 2, "label": "x2 / 16 stones" },
		],
		"exchangeTerms": [
			{ "from": "target", "to": "actor", "itemName": "Spirit Herb", "itemId": "spirit_herb", "qty": 2 },
			{ "from": "actor", "to": "target", "itemName": "Spirit Stone", "itemId": "spirit_stone", "qty": 16 },
		],
		"inventoryDeltaPreview": {
			"deltas": [
				{ "owner": "actor", "itemName": "Spirit Herb", "before": 0, "after": 2, "delta": 2 },
				{ "owner": "actor", "itemName": "Spirit Stone", "before": 42, "after": 26, "delta": -16 },
				{ "owner": "target", "itemName": "Spirit Herb", "before": 5, "after": 3, "delta": -2 },
			],
		},
		"confirmationPreview": {
			"summary": "Buy Spirit Herb x2 for 16 spirit stones",
			"primaryLine": "Spirit Herb x2",
			"balanceLine": "Balance 42 -> 26",
			"termsLine": "You pay 16 stones; target gives herbs",
			"inventoryLine": "Spirit Herb 0 -> 2",
			"durableEffectNotes": ["rules transfer item effects"],
			"presentationSource": "rule_template",
			"previewOnly": true,
			"policy": {
				"convexAuthored": true,
				"godotMayDisplayOnly": true,
				"durableStateUnchanged": true,
				"submitPath": "POST /godot/action",
			},
		},
	}
	var trade_capability: Dictionary = {
		"type": "trade",
		"label": "Trade",
		"enabled": true,
		"selectedOption": trade_option,
	}

	var gift_option: Dictionary = {
		"label": "Give Spirit Stone",
		"itemName": "Spirit Stone",
		"itemId": "spirit_stone",
		"qtyAvailable": 3,
		"inventoryDeltaPreview": {
			"deltas": [
				{ "owner": "actor", "itemName": "Spirit Stone", "before": 3, "after": 2, "delta": -1 },
				{ "owner": "target", "itemName": "Spirit Stone", "before": 0, "after": 1, "delta": 1 },
			],
		},
		"confirmationPreview": {
			"summary": "Offer one spirit stone",
			"primaryLine": "Spirit Stone x1",
			"inventoryLine": "Spirit Stone 3 -> 2",
			"durableEffectNotes": ["relationship may improve if accepted"],
			"presentationSource": "rule_template",
			"previewOnly": true,
			"policy": {
				"convexAuthored": true,
				"godotMayDisplayOnly": true,
				"durableStateUnchanged": true,
				"submitPath": "POST /godot/action",
			},
		},
	}
	var gift_capability: Dictionary = {
		"type": "gift",
		"label": "Gift",
		"enabled": true,
		"selectedOption": gift_option,
	}

	var risk_preview: Dictionary = {
		"level": "moderate",
		"summary": "Outcome depends on rule gates.",
		"ruleGates": ["relationship gate", "realm gate"],
		"possibleResultCodes": ["teaching_granted", "teaching_refused"],
		"durableEffects": ["actionRecords row", "worldEvents row"],
		"presentationSource": "rule_template",
	}
	var teaching_capability: Dictionary = {
		"type": "request_teaching",
		"label": "Request Teaching",
		"enabled": true,
		"actorRealm": "qi_refining",
		"actorRealmStage": 3,
		"targetRealm": "foundation",
		"targetRealmStage": 1,
		"actorRelationship": 12,
		"requiredRelationship": 10,
		"actorReputation": 3,
		"minimumReputation": -10,
		"riskPreview": risk_preview,
	}
	var spar_capability: Dictionary = {
		"type": "spar",
		"label": "Spar",
		"enabled": true,
		"distanceTiles": 2.25,
		"rangeTiles": 5.0,
		"riskPreview": {
			"level": "low",
			"summary": "Spar may affect health and mood.",
			"ruleGates": ["public zone"],
			"possibleResultCodes": ["spar_actor_win", "spar_actor_lose"],
			"durableEffects": ["health delta", "relationship delta"],
		},
	}
	var breakthrough_capability: Dictionary = {
		"type": "breakthrough",
		"label": "Breakthrough",
		"enabled": false,
		"realm": "qi_refining",
		"realmStage": 9,
		"cultivationXp": 88,
		"breakthroughThreshold": 120,
		"realmGate": false,
		"reason": "Minor layer advancement is automatic.",
		"riskPreview": {
			"level": "high",
			"summary": "Breakthrough can fail or backfire.",
			"ruleGates": ["realm gate", "xp threshold"],
			"possibleResultCodes": ["breakthrough_success", "breakthrough_failed"],
			"durableEffects": ["cultivation delta", "injury risk"],
		},
	}

	var trade_detail: String = formatter.detail_text(trade_capability, 1.0, 5.0)
	var trade_confirmation: String = formatter.confirmation_body(trade_capability, "Medicine Keeper", 1.0, 5.0)
	var gift_detail: String = formatter.detail_text(gift_capability, 1.0, 5.0)
	var gift_confirmation: String = formatter.confirmation_body(gift_capability, "Medicine Keeper", 1.0, 5.0)
	var teaching_detail: String = formatter.detail_text(teaching_capability, 1.0, 5.0)
	var teaching_confirmation: String = formatter.confirmation_body(teaching_capability, "Elder Mu", 1.0, 5.0)
	var spar_detail: String = formatter.detail_text(spar_capability, 2.25, 5.0)
	var spar_confirmation: String = formatter.confirmation_body(spar_capability, "Guard West", 2.25, 5.0)
	var breakthrough_detail: String = formatter.detail_text(breakthrough_capability, 0.0, 5.0)
	var breakthrough_confirmation: String = formatter.confirmation_body(breakthrough_capability, "", 0.0, 5.0)

	_assert_equals(formatter.option_label(trade_option), "Spirit Herb x2", "explicit option label")
	_assert_equals(formatter.option_label({ "itemName": "Fallback Herb" }), "Fallback Herb", "item option fallback")
	_assert_equals(formatter.confirmation_title(trade_capability), "Confirm Trade", "trade title")
	_assert_equals(formatter.confirmation_title(breakthrough_capability), "Confirm Breakthrough", "breakthrough title")
	_assert_contains(formatter.option_selection_text(trade_option), "Selection: option 2/3 | qty x2 | max x3 | 16 spirit stones | previewOnly | Convex-owned | display-only | durable unchanged until submit", "trade selection helper")

	_assert_contains(trade_detail, "Confirm: Buy Spirit Herb x2 for 16 spirit stones | rule_template | preview", "trade compact preview")
	_assert_contains(trade_detail, "Trade: buy Spirit Herb (spirit_herb) x2 | cost 16 (8 ea) | you 42 | stock 5 | ready", "trade detail")
	_assert_contains(trade_detail, "Quote: base 10 x relation 0.90 x suspicion 1.10 x regular 0.95", "trade quote")
	_assert_contains(trade_detail, "Quantities: x1 / 8 stones / [x2 / 16 stones]", "trade quantity choices")
	_assert_contains(trade_detail, "Selection: option 2/3 | qty x2 | max x3 | 16 spirit stones | previewOnly | Convex-owned | display-only | durable unchanged until submit", "trade detail selection")
	_assert_contains(trade_detail, "Terms: Target -> You: Spirit Herb x2 | You -> Target: Spirit Stone x16", "trade exchange terms")
	_assert_contains(trade_detail, "Inventory: You Spirit Herb 0 -> 2 (+2)", "trade inventory gain")
	_assert_contains(trade_detail, "You Spirit Stone 42 -> 26 (-16)", "trade inventory payment")
	_assert_contains(trade_confirmation, "Convex preview: Buy Spirit Herb x2 for 16 spirit stones", "trade full preview")
	_assert_contains(trade_confirmation, "Submit: POST /godot/action", "trade submit policy")
	_assert_contains(trade_confirmation, "Balance 42 -> 26 | seller stock 5", "trade balance")
	_assert_contains(trade_confirmation, "Selection: option 2/3 | qty x2 | max x3 | 16 spirit stones | previewOnly | Convex-owned | display-only | durable unchanged until submit", "trade confirmation selection")

	_assert_contains(gift_detail, "Confirm: Offer one spirit stone | rule_template | preview", "gift compact preview")
	_assert_contains(gift_detail, "Gift: give Spirit Stone (spirit_stone) x1 | you have 3 | ready", "gift detail")
	_assert_contains(gift_detail, "Selection: previewOnly | Convex-owned | display-only | durable unchanged until submit", "gift detail selection")
	_assert_contains(gift_detail, "Target Spirit Stone 0 -> 1 (+1)", "gift target inventory")
	_assert_contains(gift_confirmation, "Give Spirit Stone (spirit_stone) x1 to Medicine Keeper.", "gift target name")
	_assert_contains(gift_confirmation, "Selection: previewOnly | Convex-owned | display-only | durable unchanged until submit", "gift confirmation selection")
	_assert_contains(gift_confirmation, "Convex will decide acceptance and relationship effects.", "gift authority text")

	_assert_contains(teaching_detail, "Teaching: you qi_refining 3 -> teacher foundation 1", "teaching gates")
	_assert_contains(teaching_detail, "Risk: moderate | Outcome depends on rule gates.", "teaching compact risk")
	_assert_contains(teaching_confirmation, "Rules: relationship gate | realm gate", "teaching risk gates")
	_assert_contains(teaching_confirmation, "Possible: teaching_granted, teaching_refused", "teaching result codes")
	_assert_contains(teaching_confirmation, "Durable: actionRecords row | worldEvents row", "teaching durable notes")

	_assert_contains(spar_detail, "Spar: distance 2.2/5.0 tiles | ready", "spar distance")
	_assert_contains(spar_confirmation, "Risk: low | Spar may affect health and mood.", "spar risk")
	_assert_contains(spar_confirmation, "Possible: spar_actor_win, spar_actor_lose", "spar result codes")

	_assert_contains(breakthrough_detail, "Breakthrough: qi_refining 9 | XP 88/120 | minor layers auto | Minor layer advancement is automatic.", "breakthrough disabled detail")
	_assert_contains(breakthrough_detail, "Risk: high | Breakthrough can fail or backfire.", "breakthrough compact risk")
	_assert_contains(breakthrough_confirmation, "Rules: realm gate | xp threshold", "breakthrough rule gates")

	var disabled_trade: String = formatter.detail_text({
		"type": "trade",
		"enabled": false,
		"reason": "target_not_present",
	}, 9.0, 5.0)
	_assert_contains(disabled_trade, "Trade: target_not_present", "disabled trade reason")

	if failures.is_empty():
		print("Godot action presentation formatter check passed.")
		quit(0)
	else:
		for failure in failures:
			push_error(str(failure))
		print("TRADE DETAIL\n" + trade_detail)
		print("TRADE CONFIRMATION\n" + trade_confirmation)
		print("GIFT DETAIL\n" + gift_detail)
		print("GIFT CONFIRMATION\n" + gift_confirmation)
		print("TEACHING CONFIRMATION\n" + teaching_confirmation)
		print("SPAR CONFIRMATION\n" + spar_confirmation)
		print("BREAKTHROUGH CONFIRMATION\n" + breakthrough_confirmation)
		quit(1)

func _assert_contains(haystack: String, needle: String, label: String) -> void:
	if not haystack.contains(needle):
		failures.append("%s missing %s" % [label, needle])

func _assert_equals(actual: String, expected: String, label: String) -> void:
	if actual != expected:
		failures.append("%s expected %s, got %s" % [label, expected, actual])
