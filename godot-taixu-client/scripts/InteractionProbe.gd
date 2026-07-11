extends Node
class_name InteractionProbe

signal selection_changed(resident: Dictionary)

var selected_resident: Dictionary = {}

func select_resident(resident: Dictionary) -> void:
	selected_resident = resident
	selection_changed.emit(selected_resident)

func has_selection() -> bool:
	return not selected_resident.is_empty()
