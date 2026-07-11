extends SceneTree

var failures: Array[String] = []
var main
var width := 1024
var height := 720
var output_path := "/tmp/taixu-live-ui.png"

func _init() -> void:
	call_deferred("_run")

func _run() -> void:
	_parse_args()
	root.size = Vector2i(width, height)
	DisplayServer.window_set_size(Vector2i(width, height))

	var scene: PackedScene = load("res://scenes/Main.tscn")
	main = scene.instantiate()
	root.add_child(main)
	await process_frame

	var loaded := await _wait_until(func() -> bool:
		return (
			main.store != null
			and main.store.world_id != ""
			and not main.store.residents.is_empty()
			and not main.store.locations.is_empty()
		)
	, 30.0)
	_assert(loaded, "connected region loads residents and locations")
	if not loaded:
		_finish()
		return

	_assert(main.get_node_or_null("QinglanMap") != null, "map node exists")
	_assert(main.get_node("QinglanMap").texture != null, "map texture is nonblank")
	var visible_rect: Rect2 = root.get_visible_rect()
	var hud_rect: Rect2 = main.hud_panel.get_global_rect()
	print("LIVE_UI_LAYOUT visible=%s hud=%s" % [str(visible_rect), str(hud_rect)])
	_assert(hud_rect.position.x >= visible_rect.position.x, "HUD starts inside viewport")
	_assert(
		hud_rect.end.x <= visible_rect.end.x + 0.5,
		"HUD does not overflow viewport width"
	)
	_assert(main.hud_sidebar_width >= main.HUD_MIN_WIDTH, "HUD preserves minimum width")
	_assert(main.hud_sidebar_width <= main.HUD_MAX_WIDTH, "HUD preserves maximum width")
	_assert(main.UI_FONT.has_char("青".unicode_at(0)), "live UI font covers Chinese text")
	_assert(main.tick_button != null and not main.tick_button.disabled, "debug tick is enabled")

	var resident: Dictionary = _pick_trace_resident(main.store.residents)
	main._on_resident_selected(resident)
	var selected := await _wait_until(func() -> bool:
		return (
			str(main.store.selected_resident.get("actorId", "")) == str(resident.get("actorId", ""))
			and not main.latest_actor_context.is_empty()
			and not main.latest_capabilities.is_empty()
		)
	, 30.0)
	_assert(selected, "resident selection loads actorContext and capabilities")
	_assert(main.selected_detail_label.visible, "selected resident inspector is visible")
	_assert(
		str(main.selected_label.text).contains(str(resident.get("name", ""))),
		"selected resident heading names the Convex resident"
	)

	var replayed := await _wait_until(func() -> bool:
		return not main.latest_replay_summary.is_empty() or not main.trace_entries.is_empty()
	, 20.0)
	_assert(replayed, "selected resident replay populates the trace view")

	var before_log := str(main.event_log.text)
	main._run_debug_tick()
	var ticked := await _wait_until(func() -> bool:
		return (
			str(main.event_log.text) != before_log
			and str(main.event_log.text).contains("Tick completed:")
		)
	, 45.0)
	_assert(ticked, "windowed client receives a real debug tick")
	await _wait_until(func() -> bool:
		return main.bridge != null and not main.bridge.is_busy()
	, 20.0)
	await create_timer(0.5).timeout

	var trace_text := str(main.trace_log.text)
	_assert(not main.trace_entries.is_empty(), "tick/replay leaves visible trace entries")
	_assert(
		trace_text.contains("ActionRecord") or trace_text.contains("tickOnly"),
		"trace view shows actionRecord readback or explicit tickOnly observation"
	)
	_assert(
		trace_text.contains("WorldEvent") or trace_text.contains("tickOnly"),
		"trace view shows worldEvent linkage or explicit tickOnly observation"
	)

	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	_assert(image.get_width() == width, "captured viewport width matches requested size")
	_assert(image.get_height() == height, "captured viewport height matches requested size")
	var save_error := image.save_png(output_path)
	_assert(save_error == OK, "live UI screenshot is saved")
	print(
		"LIVE_UI_RESULT size=%dx%d resident=%s traces=%d output=%s"
		% [width, height, str(resident.get("actorId", "")), main.trace_entries.size(), output_path]
	)
	_finish()

func _parse_args() -> void:
	var args := OS.get_cmdline_user_args()
	var index := 0
	while index < args.size():
		match args[index]:
			"--width":
				index += 1
				width = int(args[index])
			"--height":
				index += 1
				height = int(args[index])
			"--output":
				index += 1
				output_path = args[index]
		index += 1

func _pick_trace_resident(residents: Array) -> Dictionary:
	for raw_resident in residents:
		if typeof(raw_resident) != TYPE_DICTIONARY:
			continue
		if str(raw_resident.get("actorId", "")).contains("medicine-keeper"):
			return raw_resident
	for raw_resident in residents:
		if typeof(raw_resident) == TYPE_DICTIONARY:
			return raw_resident
	return {}

func _wait_until(predicate: Callable, timeout_seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(timeout_seconds * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if predicate.call():
			return true
		await create_timer(0.1).timeout
	return predicate.call()

func _assert(condition: bool, message: String) -> void:
	if not condition:
		failures.append(message)

func _finish() -> void:
	if failures.is_empty():
		print("Godot live client check passed.")
		quit(0)
		return
	for failure in failures:
		push_error(failure)
	quit(1)
