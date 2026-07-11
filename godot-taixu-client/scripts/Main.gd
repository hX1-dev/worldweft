extends Node2D

const MAP_COLS := 96
const MAP_ROWS := 72
const TILE_SIZE := 32.0
const WORLD_SIZE := Vector2(MAP_COLS, MAP_ROWS) * TILE_SIZE
const MAP_TEXTURE := "res://assets/qinglan-reference-town-footprint-no-bamboo-v1.png"
const UI_FONT := preload("res://assets/fonts/NotoSansCJKsc-Regular.otf")
const INTERACTION_RANGE_TILES := 5.0
const AUTO_TICK_SECONDS := 8.0
const MAX_TRACE_ENTRIES := 8
const HUD_MIN_WIDTH := 340.0
const HUD_MAX_WIDTH := 460.0
const HUD_VIEWPORT_RATIO := 0.34
const HUD_EDGE_MARGIN := 12.0

const ConvexBridgeScript := preload("res://scripts/ConvexBridge.gd")
const WorldStateStoreScript := preload("res://scripts/WorldStateStore.gd")
const ResidentRendererScript := preload("res://scripts/ResidentRenderer.gd")
const PlayerControllerScript := preload("res://scripts/PlayerController.gd")
const ActionClientScript := preload("res://scripts/ActionClient.gd")
const InteractionProbeScript := preload("res://scripts/InteractionProbe.gd")
const NavigationMaskScript := preload("res://scripts/NavigationMask.gd")
const LocationProbeScript := preload("res://scripts/LocationProbe.gd")
const TraceFormatterScript := preload("res://scripts/TraceFormatter.gd")
const TraceStateScript := preload("res://scripts/TraceState.gd")
const ActionPresentationFormatterScript := preload("res://scripts/ActionPresentationFormatter.gd")
const ResidentInspectorFormatterScript := preload("res://scripts/ResidentInspectorFormatter.gd")
const ActionMenuPolicyScript := preload("res://scripts/ActionMenuPolicy.gd")
const ResponseContextPolicyScript := preload("res://scripts/ResponseContextPolicy.gd")

var bridge
var store
var renderer
var player
var action_client
var probe
var navigation_mask
var location_probe
var trace_formatter
var trace_state
var action_formatter
var resident_formatter
var camera: Camera2D
var hud_panel: PanelContainer
var hud_margin: MarginContainer
var hud_stack: VBoxContainer
var hud_sidebar_width := HUD_MIN_WIDTH
var status_label: Label
var selected_label: Label
var selected_detail_label: RichTextLabel
var location_label: Label
var event_log: RichTextLabel
var tick_button: Button
var auto_tick_toggle: CheckButton
var action_menu: VBoxContainer
var action_detail_label: RichTextLabel
var trace_log: RichTextLabel
var confirmation_panel: PanelContainer
var confirmation_title_label: Label
var confirmation_body_label: RichTextLabel
var action_buttons: Dictionary = {}
var action_option_selectors: Dictionary = {}
var latest_capabilities: Dictionary = {}
var latest_actor_context: Dictionary = {}
var pending_confirmation: Dictionary = {}
var trace_entries: Array = []
var trace_records: Dictionary = {}
var trace_polish_previews: Dictionary = {}
var latest_replay_summary: Dictionary = {}
var capabilities_timer: Timer
var auto_tick_timer: Timer

func _ready() -> void:
	_build_world_nodes()
	_build_system_nodes()
	_build_hud()
	_connect_signals()
	_configure_debug_controls()
	if OS.get_environment("GODOT_BRIDGE_DISABLE_AUTOLOAD") != "1":
		bridge.get_region_state()

func _process(_delta: float) -> void:
	var camera_shift := hud_sidebar_width / maxf(camera.zoom.x * 2.0, 0.1)
	camera.position = player.position + Vector2(camera_shift, 0.0)
	_update_status()
	_update_selected_detail()
	_update_action_buttons()

func _build_world_nodes() -> void:
	var texture: Texture2D = load(MAP_TEXTURE)
	var map_sprite := Sprite2D.new()
	map_sprite.name = "QinglanMap"
	map_sprite.texture = texture
	map_sprite.centered = false
	if texture:
		map_sprite.scale = Vector2(WORLD_SIZE.x / texture.get_width(), WORLD_SIZE.y / texture.get_height())
	add_child(map_sprite)

	renderer = ResidentRendererScript.new()
	renderer.name = "ResidentRenderer"
	add_child(renderer)

	player = PlayerControllerScript.new()
	player.name = "Player"
	add_child(player)

	camera = Camera2D.new()
	camera.name = "PlayerCamera"
	camera.enabled = true
	camera.zoom = Vector2(0.72, 0.72)
	camera.limit_left = 0
	camera.limit_top = 0
	camera.limit_right = int(WORLD_SIZE.x)
	camera.limit_bottom = int(WORLD_SIZE.y)
	add_child(camera)

func _build_system_nodes() -> void:
	bridge = ConvexBridgeScript.new()
	bridge.name = "ConvexBridge"
	add_child(bridge)

	capabilities_timer = Timer.new()
	capabilities_timer.name = "CapabilitiesRefreshTimer"
	capabilities_timer.one_shot = true
	capabilities_timer.wait_time = 0.2
	capabilities_timer.timeout.connect(_request_capabilities)
	add_child(capabilities_timer)

	auto_tick_timer = Timer.new()
	auto_tick_timer.name = "AutoTickTimer"
	auto_tick_timer.one_shot = false
	auto_tick_timer.wait_time = AUTO_TICK_SECONDS
	auto_tick_timer.timeout.connect(_on_auto_tick_timeout)
	add_child(auto_tick_timer)

	navigation_mask = NavigationMaskScript.new()
	navigation_mask.name = "NavigationMask"
	add_child(navigation_mask)
	navigation_mask.load_mask()
	player.configure_navigation(navigation_mask)

	store = WorldStateStoreScript.new()
	store.name = "WorldStateStore"
	add_child(store)

	action_client = ActionClientScript.new()
	action_client.name = "ActionClient"
	action_client.configure(bridge)
	add_child(action_client)

	probe = InteractionProbeScript.new()
	probe.name = "InteractionProbe"
	add_child(probe)

	location_probe = LocationProbeScript.new()
	location_probe.name = "LocationProbe"
	add_child(location_probe)

	trace_formatter = TraceFormatterScript.new()
	trace_state = TraceStateScript.new(MAX_TRACE_ENTRIES)
	trace_entries = trace_state.entries
	trace_records = trace_state.records
	trace_polish_previews = trace_state.polish_previews
	latest_replay_summary = trace_state.replay_summary
	action_formatter = ActionPresentationFormatterScript.new()
	resident_formatter = ResidentInspectorFormatterScript.new()

func _build_hud() -> void:
	var hud := CanvasLayer.new()
	hud.name = "HUD"
	add_child(hud)

	hud_panel = PanelContainer.new()
	hud_panel.name = "OperationsPanel"
	hud_panel.anchor_left = 1.0
	hud_panel.anchor_top = 0.0
	hud_panel.anchor_right = 1.0
	hud_panel.anchor_bottom = 1.0
	var hud_theme := Theme.new()
	hud_theme.default_font = UI_FONT
	hud_panel.theme = hud_theme
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(0.035, 0.045, 0.055, 0.96)
	panel_style.border_color = Color(0.28, 0.34, 0.38, 0.9)
	panel_style.set_border_width_all(1)
	panel_style.corner_radius_top_left = 6
	panel_style.corner_radius_top_right = 6
	panel_style.corner_radius_bottom_left = 6
	panel_style.corner_radius_bottom_right = 6
	hud_panel.add_theme_stylebox_override("panel", panel_style)
	hud.add_child(hud_panel)

	var scroll := ScrollContainer.new()
	scroll.name = "OperationsScroll"
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	hud_panel.add_child(scroll)

	hud_margin = MarginContainer.new()
	hud_margin.add_theme_constant_override("margin_left", 14)
	hud_margin.add_theme_constant_override("margin_top", 12)
	hud_margin.add_theme_constant_override("margin_right", 14)
	hud_margin.add_theme_constant_override("margin_bottom", 12)
	hud_margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(hud_margin)

	hud_stack = VBoxContainer.new()
	hud_stack.add_theme_constant_override("separation", 8)
	hud_stack.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hud_margin.add_child(hud_stack)

	status_label = Label.new()
	status_label.clip_text = true
	status_label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	status_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	status_label.add_theme_font_size_override("font_size", 15)
	hud_stack.add_child(status_label)

	selected_label = Label.new()
	selected_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	selected_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	selected_label.add_theme_font_size_override("font_size", 14)
	hud_stack.add_child(selected_label)

	selected_detail_label = RichTextLabel.new()
	selected_detail_label.custom_minimum_size = Vector2(0, 150)
	selected_detail_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	selected_detail_label.fit_content = false
	selected_detail_label.scroll_active = true
	selected_detail_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	selected_detail_label.add_theme_font_size_override("normal_font_size", 12)
	selected_detail_label.visible = false
	hud_stack.add_child(selected_detail_label)

	location_label = Label.new()
	location_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	location_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	location_label.add_theme_font_size_override("font_size", 14)
	hud_stack.add_child(location_label)

	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 8)
	hud_stack.add_child(buttons)

	var refresh_button := Button.new()
	refresh_button.text = "Refresh"
	refresh_button.custom_minimum_size = Vector2(72, 34)
	refresh_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	refresh_button.pressed.connect(func() -> void: bridge.get_region_state())
	buttons.add_child(refresh_button)

	tick_button = Button.new()
	tick_button.text = "Tick"
	tick_button.custom_minimum_size = Vector2(72, 34)
	tick_button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tick_button.pressed.connect(_run_debug_tick)
	buttons.add_child(tick_button)

	auto_tick_toggle = CheckButton.new()
	auto_tick_toggle.text = "Auto Tick"
	auto_tick_toggle.custom_minimum_size = Vector2(104, 34)
	auto_tick_toggle.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	auto_tick_toggle.toggled.connect(_on_auto_tick_toggled)
	buttons.add_child(auto_tick_toggle)

	action_menu = VBoxContainer.new()
	action_menu.add_theme_constant_override("separation", 6)
	action_menu.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hud_stack.add_child(action_menu)

	action_detail_label = RichTextLabel.new()
	action_detail_label.custom_minimum_size = Vector2(0, 140)
	action_detail_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	action_detail_label.fit_content = false
	action_detail_label.scroll_active = false
	action_detail_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	action_detail_label.add_theme_font_size_override("normal_font_size", 13)
	action_detail_label.visible = false
	hud_stack.add_child(action_detail_label)

	trace_log = RichTextLabel.new()
	trace_log.custom_minimum_size = Vector2(0, 170)
	trace_log.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	trace_log.fit_content = false
	trace_log.scroll_active = true
	trace_log.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	trace_log.add_theme_font_size_override("normal_font_size", 12)
	hud_stack.add_child(trace_log)
	_render_trace_log()

	_build_confirmation_panel(hud_stack)

	event_log = RichTextLabel.new()
	event_log.custom_minimum_size = Vector2(0, 110)
	event_log.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	event_log.fit_content = false
	event_log.scroll_active = true
	event_log.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	event_log.add_theme_font_size_override("normal_font_size", 13)
	hud_stack.add_child(event_log)

	get_viewport().size_changed.connect(_layout_hud)
	_layout_hud()

func _layout_hud() -> void:
	if hud_panel == null or hud_margin == null or hud_stack == null:
		return
	var viewport_size := get_viewport_rect().size
	var responsive_max := maxf(HUD_MIN_WIDTH, viewport_size.x * 0.48)
	hud_sidebar_width = clampf(
		viewport_size.x * HUD_VIEWPORT_RATIO,
		HUD_MIN_WIDTH,
		minf(HUD_MAX_WIDTH, responsive_max)
	)
	hud_panel.offset_left = -hud_sidebar_width - HUD_EDGE_MARGIN
	hud_panel.offset_top = HUD_EDGE_MARGIN
	hud_panel.offset_right = -HUD_EDGE_MARGIN
	hud_panel.offset_bottom = -HUD_EDGE_MARGIN
	hud_margin.custom_minimum_size.x = maxf(0.0, hud_sidebar_width - 2.0 * HUD_EDGE_MARGIN)
	hud_stack.custom_minimum_size.x = maxf(0.0, hud_sidebar_width - 44.0)

func _build_confirmation_panel(stack: VBoxContainer) -> void:
	confirmation_panel = PanelContainer.new()
	confirmation_panel.custom_minimum_size = Vector2(0, 170)
	confirmation_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	confirmation_panel.visible = false
	stack.add_child(confirmation_panel)

	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 10)
	margin.add_theme_constant_override("margin_top", 8)
	margin.add_theme_constant_override("margin_right", 10)
	margin.add_theme_constant_override("margin_bottom", 8)
	confirmation_panel.add_child(margin)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	margin.add_child(box)

	confirmation_title_label = Label.new()
	confirmation_title_label.text = "Confirm Action"
	confirmation_title_label.add_theme_font_size_override("font_size", 14)
	box.add_child(confirmation_title_label)

	confirmation_body_label = RichTextLabel.new()
	confirmation_body_label.custom_minimum_size = Vector2(0, 94)
	confirmation_body_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	confirmation_body_label.fit_content = false
	confirmation_body_label.scroll_active = true
	confirmation_body_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	confirmation_body_label.add_theme_font_size_override("normal_font_size", 13)
	box.add_child(confirmation_body_label)

	var buttons := HBoxContainer.new()
	buttons.add_theme_constant_override("separation", 8)
	box.add_child(buttons)

	var confirm_button := Button.new()
	confirm_button.text = "Confirm"
	confirm_button.custom_minimum_size = Vector2(96, 32)
	confirm_button.pressed.connect(_confirm_pending_action)
	buttons.add_child(confirm_button)

	var cancel_button := Button.new()
	cancel_button.text = "Cancel"
	cancel_button.custom_minimum_size = Vector2(96, 32)
	cancel_button.pressed.connect(_cancel_pending_action)
	buttons.add_child(cancel_button)

func _connect_signals() -> void:
	bridge.world_state_received.connect(store.absorb_world)
	bridge.region_state_received.connect(store.absorb_region)
	bridge.action_completed.connect(store.absorb_action)
	bridge.action_record_received.connect(_on_action_record_received)
	bridge.presentation_preview_received.connect(_on_presentation_preview_received)
	bridge.capabilities_received.connect(_on_capabilities_received)
	bridge.actor_context_received.connect(_on_actor_context_received)
	bridge.replay_trace_received.connect(_on_replay_trace_received)
	bridge.tick_completed.connect(_on_tick_completed)
	bridge.request_failed.connect(_on_request_failed)
	store.region_changed.connect(_on_region_changed)
	store.selection_changed.connect(_on_selection_changed)
	store.action_changed.connect(_on_action_changed)
	renderer.resident_selected.connect(_on_resident_selected)
	player.moved.connect(_on_player_moved)
	player.movement_blocked.connect(_on_movement_blocked)
	probe.selection_changed.connect(store.select_resident)
	location_probe.location_changed.connect(_on_location_changed)
	location_probe.location_cleared.connect(_on_location_cleared)
	action_client.action_rejected_locally.connect(_log)

func _on_region_changed() -> void:
	_hide_action_confirmation()
	renderer.set_region(store.residents, store.locations)
	renderer.set_recent_events(store.recent_events)
	location_probe.set_locations(store.locations)
	location_probe.prime_player_tile(player.current_tile_point())
	latest_capabilities = {}
	_rebuild_action_menu()
	if not store.selected_resident.is_empty():
		renderer.select_actor(str(store.selected_resident.get("actorId", "")))
		_request_actor_context()
	_update_location_label()
	_update_selected_detail()
	_log_region_summary()
	_queue_capabilities_refresh()
	_request_replay_trace()

func _on_resident_selected(resident: Dictionary) -> void:
	probe.select_resident(resident)

func _on_selection_changed(resident: Dictionary) -> void:
	_hide_action_confirmation()
	latest_actor_context = {}
	latest_capabilities = {}
	_rebuild_action_menu()
	renderer.select_actor(str(resident.get("actorId", "")))
	_update_selected_label()
	_update_selected_detail()
	_update_action_buttons()
	_queue_capabilities_refresh()
	_request_actor_context()
	_request_replay_trace()

func _on_action_changed(payload: Dictionary) -> void:
	_hide_action_confirmation()
	var summary := str(payload.get("summary", "Action completed."))
	renderer.show_action_result(payload)
	_record_action_trace(payload)
	var settlement: String = trace_formatter.settlement_preview_text(payload, true) if trace_formatter != null else ""
	var display := _display_text(payload, summary)
	if settlement != "":
		display += " | " + settlement
	_log(display)
	bridge.get_region_state()
	_request_actor_context()
	_request_replay_trace()

func _on_request_failed(label: String, status_code: int, message: String) -> void:
	_log(label + " failed (" + str(status_code) + "): " + message)

func _talk_to_selected() -> void:
	if not _selected_resident_in_range():
		_log("Selected resident is out of range.")
		return
	action_client.talk_to(
		store.selected_resident,
		store.world_id,
		player.current_tile_point(),
		INTERACTION_RANGE_TILES,
		location_probe.current_location
	)

func _explore_current_location() -> void:
	action_client.explore_location(
		location_probe.current_location,
		store.world_id,
		player.current_tile_point()
	)

func _run_debug_tick() -> void:
	if bridge == null or not bridge.debug_tick_available():
		_log("Debug tick is unavailable in this client environment.")
		return
	if store.world_id == "":
		_log("World is not loaded yet.")
		return
	bridge.post_tick(store.world_id, 2)

func _on_auto_tick_toggled(enabled: bool) -> void:
	if auto_tick_timer == null:
		return
	if enabled:
		if bridge == null or not bridge.debug_tick_available():
			auto_tick_toggle.set_pressed_no_signal(false)
			return
		if store.world_id == "":
			_log("World is not loaded yet.")
			auto_tick_toggle.set_pressed_no_signal(false)
			return
		auto_tick_timer.start()
		_log("Auto tick enabled.")
	else:
		auto_tick_timer.stop()
		_log("Auto tick paused.")

func _on_auto_tick_timeout() -> void:
	if auto_tick_toggle == null or auto_tick_toggle.button_pressed != true:
		return
	if store == null or store.world_id == "":
		return
	if bridge == null or bridge.is_busy():
		return
	bridge.post_tick(store.world_id, 1)

func _configure_debug_controls() -> void:
	var available: bool = bridge != null and bridge.debug_tick_available()
	if status_label != null:
		status_label.visible = available
	if trace_log != null:
		trace_log.visible = available
	if tick_button != null:
		tick_button.visible = available
		tick_button.disabled = not available
	if auto_tick_toggle != null:
		auto_tick_toggle.visible = available
		auto_tick_toggle.disabled = not available
		if not available:
			auto_tick_toggle.set_pressed_no_signal(false)
	if not available and auto_tick_timer != null:
		auto_tick_timer.stop()

func _on_tick_completed(payload: Dictionary) -> void:
	var tick = payload.get("tick", {})
	var qinglan = payload.get("qinglan", {})
	var tick_events = payload.get("tickEvents", [])
	var recent_events = payload.get("recentEvents", [])
	var ticked := 0
	var moved := 0
	var scheduled := 0
	var eligible := 0
	if typeof(tick) == TYPE_DICTIONARY:
		ticked = int(tick.get("ticked", 0))
		var scheduler = tick.get("scheduler", {})
		if typeof(scheduler) == TYPE_DICTIONARY:
			var actor_ids = scheduler.get("actorIds", [])
			if typeof(actor_ids) == TYPE_ARRAY:
				scheduled = actor_ids.size()
			eligible = int(scheduler.get("eligibleCount", 0))
	if typeof(qinglan) == TYPE_DICTIONARY:
		moved = int(qinglan.get("updated", 0))
	if typeof(tick_events) == TYPE_ARRAY and not tick_events.is_empty():
		renderer.set_recent_events(tick_events)
		_log_tick_events(tick_events)
		_record_tick_traces(tick_events)
	elif typeof(recent_events) == TYPE_ARRAY:
		renderer.set_recent_events(recent_events)
	_log("Tick completed: %d agent(s), scheduler %d/%d, %d resident update(s)." % [ticked, scheduled, eligible, moved])
	bridge.get_region_state()
	_request_replay_trace()

func _on_player_moved(tile: Vector2) -> void:
	location_probe.update_player_tile(tile)
	_update_selected_label()
	_update_selected_detail()
	_update_location_label()
	_update_action_buttons()
	if not store.selected_resident.is_empty() or not location_probe.current_location.is_empty():
		_queue_capabilities_refresh(0.25)

func _on_movement_blocked(tile: Vector2, mask_type: String) -> void:
	_log("Blocked by %s at tile %.1f,%.1f." % [mask_type, tile.x, tile.y])

func _on_location_changed(location: Dictionary) -> void:
	_hide_action_confirmation()
	latest_capabilities = {}
	_rebuild_action_menu()
	_update_location_label()
	_update_action_buttons()
	_queue_capabilities_refresh()
	_log("Entered " + str(location.get("name", location.get("locationId", "location"))) + ".")
	action_client.arrive_at(location, store.world_id, player.current_tile_point())

func _on_location_cleared() -> void:
	_hide_action_confirmation()
	latest_capabilities = {}
	_rebuild_action_menu()
	_update_location_label()
	_update_action_buttons()
	_queue_capabilities_refresh()
	_log("Left marked location.")

func _on_capabilities_received(payload: Dictionary) -> void:
	if not _capabilities_matches_current_context(payload):
		return
	_hide_action_confirmation()
	latest_capabilities = payload
	_rebuild_action_menu()
	_update_action_buttons()

func _on_actor_context_received(payload: Dictionary) -> void:
	if not _actor_context_matches_current_selection(payload):
		return
	latest_actor_context = payload
	_update_selected_detail()

func _on_action_record_received(payload: Dictionary) -> void:
	var action_record_id: String = trace_state.apply_action_record(payload)
	if action_record_id == "":
		return
	if payload.get("ok", false) == true and bridge != null:
		var world_id: String = store.world_id if store != null else ""
		bridge.get_presentation_preview(world_id, action_record_id, "llm_polish")
	_render_trace_log()

func _on_presentation_preview_received(payload: Dictionary) -> void:
	if trace_state.apply_polish_preview(payload) == "":
		return
	_render_trace_log()

func _on_replay_trace_received(payload: Dictionary) -> void:
	if not _replay_trace_matches_current_context(payload):
		return
	if not trace_state.replace_from_replay(payload):
		return
	_render_trace_log()

func _queue_capabilities_refresh(delay: float = 0.2) -> void:
	if capabilities_timer == null or store == null or store.world_id == "":
		return
	capabilities_timer.wait_time = delay
	capabilities_timer.start()

func _request_capabilities() -> void:
	if bridge == null or store == null or store.world_id == "":
		return
	if bridge.is_busy():
		_queue_capabilities_refresh(0.35)
		return

	var payload := {
		"worldId": store.world_id,
		"actorId": action_client.actor_id,
		"mapId": bridge.map_id,
		"actorTile": _tile_payload(player.current_tile_point()),
		"interactionRangeTiles": INTERACTION_RANGE_TILES
	}
	if not store.selected_resident.is_empty():
		payload["targetActorId"] = str(store.selected_resident.get("actorId", ""))
	if location_probe != null and not location_probe.current_location.is_empty():
		payload["locationId"] = str(location_probe.current_location.get("locationId", ""))

	bridge.post_capabilities(payload)

func _request_actor_context() -> void:
	if bridge == null or store == null or store.world_id == "" or store.selected_resident.is_empty():
		return
	var actor_id := str(store.selected_resident.get("actorId", ""))
	if actor_id == "":
		return
	bridge.get_actor_context(store.world_id, actor_id, action_client.actor_id)

func _request_replay_trace() -> void:
	if bridge == null or store == null or store.world_id == "":
		return
	var actor_id := ""
	if not store.selected_resident.is_empty():
		actor_id = str(store.selected_resident.get("actorId", ""))
	bridge.get_replay_trace(store.world_id, actor_id, MAX_TRACE_ENTRIES)

func _update_status() -> void:
	if status_label == null:
		return
	var tile: Vector2i = player.current_tile()
	var mask_type := "loading"
	if navigation_mask != null and navigation_mask.is_loaded():
		mask_type = navigation_mask.get_mask_type_for_tile(player.current_tile_point())
	status_label.text = "Convex " + bridge.base_url + " | world " + _short_world_id() + " | player tile %d,%d | %s" % [tile.x, tile.y, mask_type]
	status_label.tooltip_text = status_label.text

func _update_selected_label() -> void:
	if selected_label == null:
		return
	if store.selected_resident.is_empty():
		selected_label.text = "Selected: none"
		_update_selected_detail()
		return
	var resident: Dictionary = store.selected_resident
	var distance := _selected_resident_distance()
	var activity := str(resident.get("activityLabel", resident.get("status", "?")))
	selected_label.text = "Selected: %s | %s | %s | %.1f tiles" % [
		str(resident.get("name", "?")),
		str(resident.get("role", "?")),
		activity,
		distance
	]

func _update_selected_detail() -> void:
	if selected_detail_label == null:
		return
	if store == null or store.selected_resident.is_empty():
		selected_detail_label.visible = false
		selected_detail_label.text = ""
		return
	selected_detail_label.visible = true
	if resident_formatter == null:
		selected_detail_label.text = "Inspector formatter unavailable."
		return
	var actor_context := {}
	if _actor_context_matches_current_selection(latest_actor_context):
		actor_context = latest_actor_context
	selected_detail_label.text = resident_formatter.render_selected_detail(
		store.selected_resident,
		actor_context,
		store.locations,
		Time.get_unix_time_from_system() * 1000.0
	)

func _actor_context_matches_current_selection(payload: Dictionary) -> bool:
	if payload.is_empty() or store == null or store.selected_resident.is_empty():
		return false
	return ResponseContextPolicyScript.actor_context_matches(
		payload,
		store.world_id,
		store.selected_resident
	)

func _replay_trace_matches_current_context(payload: Dictionary) -> bool:
	if payload.is_empty() or store == null:
		return false
	return ResponseContextPolicyScript.replay_trace_matches(
		payload,
		store.world_id,
		store.selected_resident
	)

func _short_text(text: String, max_chars: int) -> String:
	if text.length() <= max_chars:
		return text
	return text.substr(0, max_chars - 1) + "..."

func _display_text(source, fallback: String = "") -> String:
	if typeof(source) != TYPE_DICTIONARY:
		return fallback
	var text := str(source.get("displayText", ""))
	if text != "":
		return text
	text = str(source.get("bubbleText", ""))
	if text != "":
		return text
	return str(source.get("summary", fallback))

func _update_location_label() -> void:
	if location_label == null:
		return
	if location_probe == null or location_probe.current_location.is_empty():
		location_label.text = "Location: nearby wilds"
		return
	var location: Dictionary = location_probe.current_location
	location_label.text = "Location: %s" % str(location.get("name", location.get("locationId", "?")))

func _update_action_buttons() -> void:
	for key in action_buttons.keys():
		var button: Button = action_buttons[key]
		var raw_capability: Variant = button.get_meta("capability")
		if typeof(raw_capability) != TYPE_DICTIONARY:
			button.disabled = true
			continue
		var capability: Dictionary = raw_capability
		var local: Dictionary = _local_action_availability(capability)
		var backend_enabled: bool = capability.get("enabled", false) == true
		var local_enabled: bool = local.get("enabled", false) == true
		var enabled: bool = backend_enabled and local_enabled
		var reason := str(capability.get("reason", ""))
		if reason == "":
			reason = str(local.get("reason", ""))
		button.disabled = not enabled
		button.tooltip_text = "" if enabled else reason
		if action_option_selectors.has(key):
			var selector: OptionButton = action_option_selectors[key]
			selector.disabled = not enabled
			selector.tooltip_text = "" if enabled else reason
	_refresh_action_detail_from_menu()
	var action_pending: bool = bridge != null and bridge.has_pending_action()
	if action_pending:
		for key in action_buttons.keys():
			var pending_button: Button = action_buttons[key]
			pending_button.disabled = true
			pending_button.tooltip_text = "An action is pending."
			if action_option_selectors.has(key):
				var pending_selector: OptionButton = action_option_selectors[key]
				pending_selector.disabled = true
				pending_selector.tooltip_text = "An action is pending."
	var debug_tick_available: bool = bridge != null and bridge.debug_tick_available()
	if tick_button != null:
		tick_button.disabled = not debug_tick_available or store == null or store.world_id == ""
	if auto_tick_toggle != null:
		auto_tick_toggle.disabled = not debug_tick_available or store == null or store.world_id == ""
		if auto_tick_toggle.disabled and auto_tick_timer != null:
			auto_tick_timer.stop()

func _rebuild_action_menu() -> void:
	if action_menu == null:
		return
	for child in action_menu.get_children():
		child.queue_free()
	action_buttons.clear()
	action_option_selectors.clear()
	_update_action_detail([])

	var raw_actions: Variant = latest_capabilities.get("actions", [])
	if typeof(raw_actions) != TYPE_ARRAY:
		return
	var actions: Array = raw_actions
	for raw_action in actions:
		if typeof(raw_action) != TYPE_DICTIONARY:
			continue
		var action: Dictionary = raw_action
		if action.get("visible", true) == false:
			continue
		var action_copy: Dictionary = action.duplicate(true)
		var action_key := str(action_copy.get("type", ""))
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 6)
		row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var button := Button.new()
		button.text = _action_button_text(action_copy)
		button.custom_minimum_size = Vector2(100, 34)
		button.set_meta("capability", action_copy)
		button.pressed.connect(func() -> void: _submit_menu_action(action_copy))
		row.add_child(button)

		var options = action_copy.get("options", [])
		if typeof(options) == TYPE_ARRAY and not options.is_empty():
			var selector := OptionButton.new()
			selector.custom_minimum_size = Vector2(160, 34)
			selector.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			for index in range(options.size()):
				var option = options[index]
				if typeof(option) != TYPE_DICTIONARY:
					continue
				selector.add_item(_option_label(option), index)
			selector.item_selected.connect(func(index: int) -> void: _select_action_option(action_copy, button, index))
			row.add_child(selector)
			action_option_selectors[action_key] = selector
			if selector.get_item_count() > 0:
				selector.select(0)
				_select_action_option(action_copy, button, 0)

		action_menu.add_child(row)
		action_buttons[action_key] = button
	_update_action_buttons()

func _action_button_text(capability: Dictionary) -> String:
	if action_formatter != null:
		return action_formatter.action_button_text(capability)
	return str(capability.get("label", capability.get("type", "Action")))

func _option_label(option: Dictionary) -> String:
	if action_formatter != null:
		return action_formatter.option_label(option)
	return str(option.get("label", "Option"))

func _select_action_option(capability: Dictionary, button: Button, index: int) -> void:
	var options = capability.get("options", [])
	if typeof(options) != TYPE_ARRAY or index < 0 or index >= options.size():
		return
	var option = options[index]
	if typeof(option) != TYPE_DICTIONARY:
		return
	capability["selectedOption"] = option.duplicate(true)
	button.set_meta("capability", capability)
	_refresh_action_detail_from_menu()
	_update_action_buttons()

func _refresh_action_detail_from_menu() -> void:
	var sections := []
	var trade_text := _trade_detail_text(_menu_capability("trade"))
	if trade_text != "":
		sections.append(trade_text)
	var gift_text := _gift_detail_text(_menu_capability("gift"))
	if gift_text != "":
		sections.append(gift_text)
	var teaching_text := _teaching_detail_text(_menu_capability("request_teaching"))
	if teaching_text != "":
		sections.append(teaching_text)
	var spar_text := _spar_detail_text(_menu_capability("spar"))
	if spar_text != "":
		sections.append(spar_text)
	var breakthrough_text := _breakthrough_detail_text(_menu_capability("breakthrough"))
	if breakthrough_text != "":
		sections.append(breakthrough_text)
	_update_action_detail(sections)

func _update_action_detail(sections: Array) -> void:
	if action_detail_label == null:
		return
	if sections.is_empty():
		action_detail_label.visible = false
		action_detail_label.text = ""
		return
	action_detail_label.visible = true
	action_detail_label.text = "\n".join(sections)

func _trade_detail_text(capability: Dictionary) -> String:
	return _formatted_action_detail(capability)

func _gift_detail_text(capability: Dictionary) -> String:
	return _formatted_action_detail(capability)

func _teaching_detail_text(capability: Dictionary) -> String:
	return _formatted_action_detail(capability)

func _spar_detail_text(capability: Dictionary) -> String:
	return _formatted_action_detail(capability)

func _breakthrough_detail_text(capability: Dictionary) -> String:
	return _formatted_action_detail(capability)

func _formatted_action_detail(capability: Dictionary) -> String:
	if action_formatter == null:
		return ""
	return action_formatter.detail_text(capability, _selected_resident_distance(), INTERACTION_RANGE_TILES)

func _menu_capability(action_type: String) -> Dictionary:
	if not action_buttons.has(action_type):
		return {}
	var raw_capability: Variant = action_buttons[action_type].get_meta("capability")
	return raw_capability if typeof(raw_capability) == TYPE_DICTIONARY else {}

func _submit_menu_action(capability: Dictionary) -> void:
	if not _validate_menu_action(capability):
		return
	if _requires_confirmation(capability):
		_show_action_confirmation(capability)
		return
	_submit_capability_now(capability)

func _validate_menu_action(capability: Dictionary) -> bool:
	if bridge != null and bridge.has_pending_action():
		_log("An action is already pending.")
		return false
	var local: Dictionary = _local_action_availability(capability)
	if capability.get("enabled", false) != true:
		_log(str(capability.get("reason", "Action is not available.")))
		return false
	if local.get("enabled", false) != true:
		_log(str(local.get("reason", "Action is not available here.")))
		return false
	return true

func _submit_capability_now(capability: Dictionary) -> void:
	_hide_action_confirmation()
	action_client.submit_capability(
		capability,
		store.selected_resident,
		location_probe.current_location,
		store.world_id,
		player.current_tile_point(),
		INTERACTION_RANGE_TILES
	)

func _requires_confirmation(capability: Dictionary) -> bool:
	return ActionMenuPolicyScript.requires_confirmation(capability)

func _show_action_confirmation(capability: Dictionary) -> void:
	var current_location: Dictionary = location_probe.current_location if location_probe != null else {}
	pending_confirmation = ActionMenuPolicyScript.confirmation_snapshot(
		store.world_id,
		store.selected_resident,
		current_location
	)
	pending_confirmation["capability"] = capability.duplicate(true)
	if confirmation_title_label != null:
		confirmation_title_label.text = _confirmation_title(capability)
	if confirmation_body_label != null:
		confirmation_body_label.text = _confirmation_body(capability)
	if confirmation_panel != null:
		confirmation_panel.visible = true

func _confirm_pending_action() -> void:
	if pending_confirmation.is_empty():
		return
	var capability = pending_confirmation.get("capability", {})
	if typeof(capability) != TYPE_DICTIONARY:
		_hide_action_confirmation()
		return
	if not _confirmation_context_is_current(pending_confirmation):
		_log("Action context changed; refresh and try again.")
		_hide_action_confirmation()
		return
	if not _validate_menu_action(capability):
		_hide_action_confirmation()
		return
	_submit_capability_now(capability)

func _cancel_pending_action() -> void:
	_hide_action_confirmation()

func _hide_action_confirmation() -> void:
	pending_confirmation = {}
	if confirmation_panel != null:
		confirmation_panel.visible = false
	if confirmation_body_label != null:
		confirmation_body_label.text = ""

func _confirmation_context_is_current(snapshot: Dictionary) -> bool:
	var current_location: Dictionary = location_probe.current_location if location_probe != null else {}
	return ActionMenuPolicyScript.confirmation_context_is_current(
		snapshot,
		store.world_id,
		store.selected_resident,
		current_location
	)

func _confirmation_title(capability: Dictionary) -> String:
	if action_formatter != null:
		return action_formatter.confirmation_title(capability)
	return "Confirm Action"

func _confirmation_body(capability: Dictionary) -> String:
	if action_formatter == null:
		return _action_button_text(capability)
	var target_name: String = str(store.selected_resident.get("name", store.selected_resident.get("actorId", "target"))) if not store.selected_resident.is_empty() else "target"
	return action_formatter.confirmation_body(
		capability,
		target_name,
		_selected_resident_distance(),
		INTERACTION_RANGE_TILES
	)

func _local_action_availability(capability: Dictionary) -> Dictionary:
	return ActionMenuPolicyScript.local_availability(
		capability,
		store != null and not store.selected_resident.is_empty(),
		_selected_resident_distance(),
		location_probe != null and not location_probe.current_location.is_empty(),
		INTERACTION_RANGE_TILES
	)

func _capability(action_type: String) -> Dictionary:
	var actions = latest_capabilities.get("actions", [])
	if typeof(actions) != TYPE_ARRAY:
		return {}
	for action in actions:
		if typeof(action) == TYPE_DICTIONARY and str(action.get("type", "")) == action_type:
			return action
	return {}

func _capabilities_matches_current_context(payload: Dictionary) -> bool:
	if store == null:
		return false
	var current_location: Dictionary = {}
	if location_probe != null:
		current_location = location_probe.current_location
	var actor_tile := Vector2.ZERO
	var has_actor_tile := player != null
	if has_actor_tile:
		actor_tile = player.current_tile_point()
	return ResponseContextPolicyScript.capabilities_match(
		payload,
		store.world_id,
		store.selected_resident,
		current_location,
		actor_tile,
		has_actor_tile
	)

func _selected_resident_in_range() -> bool:
	if store == null or store.selected_resident.is_empty():
		return false
	return _selected_resident_distance() <= INTERACTION_RANGE_TILES

func _selected_resident_distance() -> float:
	if store == null or store.selected_resident.is_empty():
		return INF
	return player.current_tile_point().distance_to(_resident_tile(store.selected_resident))

func _resident_tile(resident: Dictionary) -> Vector2:
	var tile = resident.get("tile", {})
	if typeof(tile) != TYPE_DICTIONARY:
		return Vector2(INF, INF)
	return Vector2(float(tile.get("x", INF)), float(tile.get("y", INF)))

func _tile_payload(tile: Vector2) -> Dictionary:
	return {
		"x": tile.x,
		"y": tile.y
	}

func _log_region_summary() -> void:
	_update_selected_label()
	_log("Region loaded: %d residents, %d locations, %d recent events." % [
		store.residents.size(),
		store.locations.size(),
		store.recent_events.size()
	])
	for event in store.recent_events:
		if typeof(event) == TYPE_DICTIONARY:
			_log(_display_text(event, str(event.get("summary", ""))))
			break

func _log_tick_events(events: Array) -> void:
	var shown := 0
	for raw_event in events:
		if typeof(raw_event) != TYPE_DICTIONARY:
			continue
		var event: Dictionary = raw_event
		var text := _display_text(event, str(event.get("bubbleText", event.get("summary", ""))))
		if text == "":
			continue
		var world_event_id := str(event.get("worldEventId", event.get("id", "")))
		var action_record_id := str(event.get("actionRecordId", ""))
		var trace := "event " + _short_id(world_event_id)
		if action_record_id != "":
			trace += " action " + _short_id(action_record_id)
		_log("Tick event: %s (%s)" % [_short_text(text, 70), trace])
		shown += 1
		if shown >= 2:
			return

func _record_action_trace(payload: Dictionary) -> void:
	var action = payload.get("action", {})
	var action_type := str(payload.get("actionType", ""))
	if action_type == "" and typeof(action) == TYPE_DICTIONARY:
		action_type = str(action.get("type", "action"))
	if action_type == "":
		action_type = "action"
	var world_event_id := str(payload.get("worldEventId", payload.get("eventId", "")))
	var entry := {
		"source": "action",
		"actionType": action_type,
		"resultCode": str(payload.get("resultCode", "")),
		"worldEventId": world_event_id,
		"actionRecordId": str(payload.get("actionRecordId", "")),
		"actorIds": payload.get("actorIds", []),
		"targetActorIds": payload.get("targetActorIds", []),
		"locationId": str(payload.get("locationId", "")),
		"summary": _display_text(payload, str(payload.get("summary", ""))),
		"bubbleKind": str(payload.get("bubbleKind", "")),
		"presentationSource": str(payload.get("presentationSource", "")),
		"presentationVersion": payload.get("presentationVersion", null),
		"durableSummary": str(payload.get("durableSummary", "")),
		"presentationPolicy": payload.get("presentationPolicy", {}),
		"settlementPreview": payload.get("settlementPreview", {}),
		"traceChain": payload.get("traceChain", {}),
		"tickOnly": false
	}
	_append_trace_entry(entry)
	_request_trace_record(entry)

func _record_tick_traces(events: Array) -> void:
	var recorded := 0
	for raw_event in events:
		if typeof(raw_event) != TYPE_DICTIONARY:
			continue
		var event: Dictionary = raw_event
		var action_type := str(event.get("actionType", event.get("type", "tick")))
		var entry := {
			"source": "tick",
			"actionType": action_type,
			"resultCode": str(event.get("resultCode", event.get("status", ""))),
			"worldEventId": str(event.get("worldEventId", event.get("id", ""))),
			"actionRecordId": str(event.get("actionRecordId", "")),
			"actorIds": event.get("actorIds", []),
			"targetActorIds": event.get("targetActorIds", []),
			"locationId": str(event.get("locationId", "")),
			"summary": _display_text(event, str(event.get("summary", ""))),
			"bubbleKind": str(event.get("bubbleKind", "")),
			"presentationSource": str(event.get("presentationSource", "")),
			"presentationVersion": event.get("presentationVersion", null),
			"durableSummary": str(event.get("durableSummary", "")),
			"presentationPolicy": event.get("presentationPolicy", {}),
			"settlementPreview": event.get("settlementPreview", {}),
			"traceChain": event.get("traceChain", {}),
			"tickOnly": event.get("tickOnly", false) == true
		}
		_append_trace_entry(entry)
		_request_trace_record(entry)
		recorded += 1
		if recorded >= 4:
			return

func _append_trace_entry(entry: Dictionary) -> void:
	trace_state.append_live_entry(entry)
	_render_trace_log()

func _request_trace_record(entry: Dictionary) -> void:
	var action_record_id := str(entry.get("actionRecordId", ""))
	if action_record_id == "" or bridge == null:
		return
	var world_id: String = store.world_id if store != null else ""
	trace_state.mark_record_pending(action_record_id)
	bridge.get_action_record(world_id, action_record_id)
	_render_trace_log()

func _render_trace_log() -> void:
	if trace_log == null:
		return
	if trace_formatter == null:
		trace_log.text = "Trace: formatter unavailable."
		return
	trace_log.text = trace_formatter.render_trace_log(
		trace_entries,
		trace_records,
		trace_polish_previews,
		latest_replay_summary
	)

func _log(message: String) -> void:
	if event_log == null:
		return
	var stamp := Time.get_time_string_from_system()
	event_log.text = "[" + stamp + "] " + message + "\n\n" + event_log.text

func _short_id(value: String) -> String:
	if value == "":
		return "?"
	return value.substr(0, min(8, value.length()))

func _short_world_id() -> String:
	if store.world_id == "":
		return "?"
	return store.world_id.substr(0, 8)
