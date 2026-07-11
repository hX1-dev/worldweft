/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agent_conversation from "../agent/conversation.js";
import type * as agent_embeddingsCache from "../agent/embeddingsCache.js";
import type * as agent_memory from "../agent/memory.js";
import type * as aiTown_agent from "../aiTown/agent.js";
import type * as aiTown_agentDescription from "../aiTown/agentDescription.js";
import type * as aiTown_agentInputs from "../aiTown/agentInputs.js";
import type * as aiTown_agentOperations from "../aiTown/agentOperations.js";
import type * as aiTown_conversation from "../aiTown/conversation.js";
import type * as aiTown_conversationMembership from "../aiTown/conversationMembership.js";
import type * as aiTown_game from "../aiTown/game.js";
import type * as aiTown_ids from "../aiTown/ids.js";
import type * as aiTown_inputHandler from "../aiTown/inputHandler.js";
import type * as aiTown_inputs from "../aiTown/inputs.js";
import type * as aiTown_insertInput from "../aiTown/insertInput.js";
import type * as aiTown_location from "../aiTown/location.js";
import type * as aiTown_main from "../aiTown/main.js";
import type * as aiTown_movement from "../aiTown/movement.js";
import type * as aiTown_player from "../aiTown/player.js";
import type * as aiTown_playerDescription from "../aiTown/playerDescription.js";
import type * as aiTown_world from "../aiTown/world.js";
import type * as aiTown_worldMap from "../aiTown/worldMap.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as engine_abstractGame from "../engine/abstractGame.js";
import type * as engine_historicalObject from "../engine/historicalObject.js";
import type * as godot from "../godot.js";
import type * as godotBridgeAuth from "../godotBridgeAuth.js";
import type * as godotBridgeContract from "../godotBridgeContract.js";
import type * as godotCapabilities from "../godotCapabilities.js";
import type * as godotExchange from "../godotExchange.js";
import type * as godotMapBoundary from "../godotMapBoundary.js";
import type * as godotMapPages from "../godotMapPages.js";
import type * as godotPresentation from "../godotPresentation.js";
import type * as godotReadModel from "../godotReadModel.js";
import type * as godotSpatial from "../godotSpatial.js";
import type * as godotTesting from "../godotTesting.js";
import type * as godotTestingPolicy from "../godotTestingPolicy.js";
import type * as godotViewerPolicy from "../godotViewerPolicy.js";
import type * as http from "../http.js";
import type * as init from "../init.js";
import type * as messages from "../messages.js";
import type * as music from "../music.js";
import type * as testing from "../testing.js";
import type * as util_FastIntegerCompression from "../util/FastIntegerCompression.js";
import type * as util_assertNever from "../util/assertNever.js";
import type * as util_asyncMap from "../util/asyncMap.js";
import type * as util_compression from "../util/compression.js";
import type * as util_geometry from "../util/geometry.js";
import type * as util_isSimpleObject from "../util/isSimpleObject.js";
import type * as util_llm from "../util/llm.js";
import type * as util_minheap from "../util/minheap.js";
import type * as util_object from "../util/object.js";
import type * as util_sleep from "../util/sleep.js";
import type * as util_types from "../util/types.js";
import type * as util_xxhash from "../util/xxhash.js";
import type * as world from "../world.js";
import type * as xianxia_access from "../xianxia/access.js";
import type * as xianxia_actionIdempotency from "../xianxia/actionIdempotency.js";
import type * as xianxia_actionSchema from "../xianxia/actionSchema.js";
import type * as xianxia_actions from "../xianxia/actions.js";
import type * as xianxia_agent from "../xianxia/agent.js";
import type * as xianxia_agentLogic from "../xianxia/agentLogic.js";
import type * as xianxia_agentTickLease from "../xianxia/agentTickLease.js";
import type * as xianxia_agentTickLeasePolicy from "../xianxia/agentTickLeasePolicy.js";
import type * as xianxia_agentTickScheduler from "../xianxia/agentTickScheduler.js";
import type * as xianxia_config from "../xianxia/config.js";
import type * as xianxia_cultivationLogic from "../xianxia/cultivationLogic.js";
import type * as xianxia_durableContracts from "../xianxia/durableContracts.js";
import type * as xianxia_events from "../xianxia/events.js";
import type * as xianxia_gm from "../xianxia/gm.js";
import type * as xianxia_gmLogic from "../xianxia/gmLogic.js";
import type * as xianxia_groupScene from "../xianxia/groupScene.js";
import type * as xianxia_groupSceneLogic from "../xianxia/groupSceneLogic.js";
import type * as xianxia_growth from "../xianxia/growth.js";
import type * as xianxia_grudgeLogic from "../xianxia/grudgeLogic.js";
import type * as xianxia_items from "../xianxia/items.js";
import type * as xianxia_locations from "../xianxia/locations.js";
import type * as xianxia_memory from "../xianxia/memory.js";
import type * as xianxia_memoryLogic from "../xianxia/memoryLogic.js";
import type * as xianxia_movement from "../xianxia/movement.js";
import type * as xianxia_movementLogic from "../xianxia/movementLogic.js";
import type * as xianxia_personalityLogic from "../xianxia/personalityLogic.js";
import type * as xianxia_policy from "../xianxia/policy.js";
import type * as xianxia_priceLogic from "../xianxia/priceLogic.js";
import type * as xianxia_profiles from "../xianxia/profiles.js";
import type * as xianxia_qinglan from "../xianxia/qinglan.js";
import type * as xianxia_qinglanFangshiZones from "../xianxia/qinglanFangshiZones.js";
import type * as xianxia_qinglanNavigation from "../xianxia/qinglanNavigation.js";
import type * as xianxia_qinglanProfiles from "../xianxia/qinglanProfiles.js";
import type * as xianxia_questLogic from "../xianxia/questLogic.js";
import type * as xianxia_quests from "../xianxia/quests.js";
import type * as xianxia_refusalLogic from "../xianxia/refusalLogic.js";
import type * as xianxia_relationshipLogic from "../xianxia/relationshipLogic.js";
import type * as xianxia_relationships from "../xianxia/relationships.js";
import type * as xianxia_routineLogic from "../xianxia/routineLogic.js";
import type * as xianxia_rules from "../xianxia/rules.js";
import type * as xianxia_rumorLogic from "../xianxia/rumorLogic.js";
import type * as xianxia_seed from "../xianxia/seed.js";
import type * as xianxia_timeLogic from "../xianxia/timeLogic.js";
import type * as xianxia_world from "../xianxia/world.js";
import type * as xianxia_zones from "../xianxia/zones.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agent/conversation": typeof agent_conversation;
  "agent/embeddingsCache": typeof agent_embeddingsCache;
  "agent/memory": typeof agent_memory;
  "aiTown/agent": typeof aiTown_agent;
  "aiTown/agentDescription": typeof aiTown_agentDescription;
  "aiTown/agentInputs": typeof aiTown_agentInputs;
  "aiTown/agentOperations": typeof aiTown_agentOperations;
  "aiTown/conversation": typeof aiTown_conversation;
  "aiTown/conversationMembership": typeof aiTown_conversationMembership;
  "aiTown/game": typeof aiTown_game;
  "aiTown/ids": typeof aiTown_ids;
  "aiTown/inputHandler": typeof aiTown_inputHandler;
  "aiTown/inputs": typeof aiTown_inputs;
  "aiTown/insertInput": typeof aiTown_insertInput;
  "aiTown/location": typeof aiTown_location;
  "aiTown/main": typeof aiTown_main;
  "aiTown/movement": typeof aiTown_movement;
  "aiTown/player": typeof aiTown_player;
  "aiTown/playerDescription": typeof aiTown_playerDescription;
  "aiTown/world": typeof aiTown_world;
  "aiTown/worldMap": typeof aiTown_worldMap;
  constants: typeof constants;
  crons: typeof crons;
  "engine/abstractGame": typeof engine_abstractGame;
  "engine/historicalObject": typeof engine_historicalObject;
  godot: typeof godot;
  godotBridgeAuth: typeof godotBridgeAuth;
  godotBridgeContract: typeof godotBridgeContract;
  godotCapabilities: typeof godotCapabilities;
  godotExchange: typeof godotExchange;
  godotMapBoundary: typeof godotMapBoundary;
  godotMapPages: typeof godotMapPages;
  godotPresentation: typeof godotPresentation;
  godotReadModel: typeof godotReadModel;
  godotSpatial: typeof godotSpatial;
  godotTesting: typeof godotTesting;
  godotTestingPolicy: typeof godotTestingPolicy;
  godotViewerPolicy: typeof godotViewerPolicy;
  http: typeof http;
  init: typeof init;
  messages: typeof messages;
  music: typeof music;
  testing: typeof testing;
  "util/FastIntegerCompression": typeof util_FastIntegerCompression;
  "util/assertNever": typeof util_assertNever;
  "util/asyncMap": typeof util_asyncMap;
  "util/compression": typeof util_compression;
  "util/geometry": typeof util_geometry;
  "util/isSimpleObject": typeof util_isSimpleObject;
  "util/llm": typeof util_llm;
  "util/minheap": typeof util_minheap;
  "util/object": typeof util_object;
  "util/sleep": typeof util_sleep;
  "util/types": typeof util_types;
  "util/xxhash": typeof util_xxhash;
  world: typeof world;
  "xianxia/access": typeof xianxia_access;
  "xianxia/actionIdempotency": typeof xianxia_actionIdempotency;
  "xianxia/actionSchema": typeof xianxia_actionSchema;
  "xianxia/actions": typeof xianxia_actions;
  "xianxia/agent": typeof xianxia_agent;
  "xianxia/agentLogic": typeof xianxia_agentLogic;
  "xianxia/agentTickLease": typeof xianxia_agentTickLease;
  "xianxia/agentTickLeasePolicy": typeof xianxia_agentTickLeasePolicy;
  "xianxia/agentTickScheduler": typeof xianxia_agentTickScheduler;
  "xianxia/config": typeof xianxia_config;
  "xianxia/cultivationLogic": typeof xianxia_cultivationLogic;
  "xianxia/durableContracts": typeof xianxia_durableContracts;
  "xianxia/events": typeof xianxia_events;
  "xianxia/gm": typeof xianxia_gm;
  "xianxia/gmLogic": typeof xianxia_gmLogic;
  "xianxia/groupScene": typeof xianxia_groupScene;
  "xianxia/groupSceneLogic": typeof xianxia_groupSceneLogic;
  "xianxia/growth": typeof xianxia_growth;
  "xianxia/grudgeLogic": typeof xianxia_grudgeLogic;
  "xianxia/items": typeof xianxia_items;
  "xianxia/locations": typeof xianxia_locations;
  "xianxia/memory": typeof xianxia_memory;
  "xianxia/memoryLogic": typeof xianxia_memoryLogic;
  "xianxia/movement": typeof xianxia_movement;
  "xianxia/movementLogic": typeof xianxia_movementLogic;
  "xianxia/personalityLogic": typeof xianxia_personalityLogic;
  "xianxia/policy": typeof xianxia_policy;
  "xianxia/priceLogic": typeof xianxia_priceLogic;
  "xianxia/profiles": typeof xianxia_profiles;
  "xianxia/qinglan": typeof xianxia_qinglan;
  "xianxia/qinglanFangshiZones": typeof xianxia_qinglanFangshiZones;
  "xianxia/qinglanNavigation": typeof xianxia_qinglanNavigation;
  "xianxia/qinglanProfiles": typeof xianxia_qinglanProfiles;
  "xianxia/questLogic": typeof xianxia_questLogic;
  "xianxia/quests": typeof xianxia_quests;
  "xianxia/refusalLogic": typeof xianxia_refusalLogic;
  "xianxia/relationshipLogic": typeof xianxia_relationshipLogic;
  "xianxia/relationships": typeof xianxia_relationships;
  "xianxia/routineLogic": typeof xianxia_routineLogic;
  "xianxia/rules": typeof xianxia_rules;
  "xianxia/rumorLogic": typeof xianxia_rumorLogic;
  "xianxia/seed": typeof xianxia_seed;
  "xianxia/timeLogic": typeof xianxia_timeLogic;
  "xianxia/world": typeof xianxia_world;
  "xianxia/zones": typeof xianxia_zones;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
