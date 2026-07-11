extends SceneTree

const ResidentRendererScript := preload("res://scripts/ResidentRenderer.gd")

var failures: Array = []

func _init() -> void:
	var renderer = ResidentRendererScript.new()
	var resident: Dictionary = {
		"actorId": "qinglan:qinglan-elder-mu",
		"activityLabel": "Fallback activity",
		"intent": "Fallback intent",
		"routePreview": {
			"waypointLabel": "Medicine Shop",
			"etaLabel": "12s",
			"movementState": "moving",
			"pathTiles": [
				{ "x": 34.0, "y": 31.0 },
				{ "x": 35.25, "y": 31.5 },
				{ "x": 38.0, "y": 35.0 },
			],
			"schedulePreview": {
				"phase": "en_route",
				"activityLabel": "Teaching",
				"destinationLabel": "Medicine Shop",
				"summary": "Teaching, heading to Medicine Shop",
			},
			"scheduleRoute": {
				"currentStop": {
					"spotId": "tea_table",
					"label": "Tea Stall",
					"locationId": "market_tea_stall",
					"tile": { "x": 56.0, "y": 53.0 },
					"offset": 0,
				},
				"upcomingStops": [
					{
						"spotId": "medicine_counter",
						"label": "Medicine Shop",
						"locationId": "market_medicine_shop",
						"tile": { "x": 35.0, "y": 30.0 },
						"offset": 1,
					},
					{
						"spotId": "west_gate_watch",
						"label": "West Gate",
						"locationId": "market_west_gate",
						"tile": { "x": 8.0, "y": 20.0 },
						"offset": 2,
					},
					{
						"spotId": "dock_boat",
						"label": "River Dock",
						"locationId": "market_dock",
						"tile": { "x": 80.0, "y": 52.0 },
						"offset": 3,
					},
				],
			},
		},
	}

	var points: Array = renderer.route_preview_points(resident)
	_assert_equals(points.size(), 3, "route point count")
	_assert_vector_near(points[0], Vector2(1088.0, 992.0), 0.001, "first route point")
	_assert_vector_near(points[1], Vector2(1128.0, 1008.0), 0.001, "second route point")
	_assert_vector_near(points[2], Vector2(1216.0, 1120.0), 0.001, "third route point")

	var markers: Array = renderer.schedule_route_markers(resident, 4)
	_assert_equals(markers.size(), 4, "schedule marker count")
	_assert_marker(markers[0], "current", "Tea Stall", Vector2(1792.0, 1696.0), "current marker")
	_assert_marker(markers[1], "next", "Medicine Shop", Vector2(1120.0, 960.0), "next marker")
	_assert_marker(markers[2], "upcoming", "West Gate", Vector2(256.0, 640.0), "upcoming marker")
	_assert_marker(markers[3], "upcoming", "River Dock", Vector2(2560.0, 1664.0), "fourth marker")

	var limited_markers: Array = renderer.schedule_route_markers(resident, 2)
	_assert_equals(limited_markers.size(), 2, "limited marker count")
	_assert_marker(limited_markers[1], "next", "Medicine Shop", Vector2(1120.0, 960.0), "limited next marker")

	_assert_equals(renderer.resident_presence_label(resident), "Teaching -> Medicine Sh...", "moving presence label")
	var arrived_resident := resident.duplicate(true)
	arrived_resident["routePreview"]["movementState"] = "arrived"
	arrived_resident["routePreview"]["schedulePreview"]["phase"] = "at_waypoint"
	_assert_equals(renderer.resident_presence_label(arrived_resident), "Teaching @ Medicine Shop", "arrived presence label")
	_assert_equals(renderer.resident_presence_label({ "intent": "Watching the west gate" }), "Watching the west gate", "presence intent fallback")

	var empty_points: Array = renderer.route_preview_points({ "routePreview": { "pathTiles": [{ "x": 1.0, "y": 1.0 }] } })
	_assert_equals(empty_points.size(), 0, "single point route is ignored")
	var empty_markers: Array = renderer.schedule_route_markers({ "routePreview": { "scheduleRoute": { "currentStop": { "label": "No Tile" } } } })
	_assert_equals(empty_markers.size(), 0, "marker without tile is ignored")

	renderer.free()

	if failures.is_empty():
		print("Godot resident renderer check passed.")
		quit(0)
	else:
		for failure in failures:
			push_error(str(failure))
		quit(1)

func _assert_marker(marker, kind: String, label: String, position: Vector2, context: String) -> void:
	if typeof(marker) != TYPE_DICTIONARY:
		failures.append("%s marker is not a dictionary" % context)
		return
	_assert_equals(str(marker.get("kind", "")), kind, context + " kind")
	_assert_equals(str(marker.get("label", "")), label, context + " label")
	_assert_vector_near(marker.get("position", Vector2.ZERO), position, 0.001, context + " position")

func _assert_equals(actual, expected, context: String) -> void:
	if actual != expected:
		failures.append("%s expected %s, got %s" % [context, str(expected), str(actual)])

func _assert_vector_near(actual, expected: Vector2, tolerance: float, context: String) -> void:
	if typeof(actual) != TYPE_VECTOR2:
		failures.append("%s expected Vector2, got %s" % [context, str(actual)])
		return
	var value: Vector2 = actual
	if value.distance_to(expected) > tolerance:
		failures.append("%s expected %s, got %s" % [context, str(expected), str(value)])
