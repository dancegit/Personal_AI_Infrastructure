/**
 * Assistant Module — DA Identity and Personality management
 *
 * Reads from ~/.claude/PAI/USER/DA/{name}/ and provides endpoints for:
 * - Health check (identity_loaded status)
 * - Identity (name, voice, role)
 * - Personality (traits, preferences)
 * - Tasks (scheduled DA tasks)
 * - Diary (session reflections)
 * - Opinions (DA's positions about the principal)
 *
 * Usage: Registered in PULSE.toml under [da], auto-loaded by pulse.ts
 */

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { parse as parseYaml } from "yaml"

const HOME = process.env.HOME ?? ""
const PAI_DIR = process.env.PAI_DIR || join(HOME, ".claude", "PAI")
const DA_DIR = join(PAI_DIR, "USER", "DA")
const REGISTRY_PATH = join(DA_DIR, "_registry.yaml")

const MODULE_NAME = "assistant"

// ── Types (matching frontend interfaces) ──

interface Registry {
  version: number
  primary: string
  das: Record<string, { role: string; enabled: boolean; created: string; channels: string[] }>
}

interface Identity {
  name: string
  full_name: string
  display_name: string
  color: string
  role: string
  origin_story: string
  has_avatar: boolean
  principal: string
  uptime_ms: number
}

interface Personality {
  base_description: string
  traits: Record<string, number>
  anchors?: Array<{ name: string; description: string }>
  preferences?: {
    what_i_love: string[]
    what_i_dislike: string[]
    working_style: string[]
    intellectual_interests: string[]
  }
  companion?: { name: string; species: string; personality: string }
  relationship: { dynamic: string; interaction_style: string }
  autonomy: { can_initiate: string[]; must_ask: string[] }
  writing: { style: string; avoid: string[]; prefer: string[] }
  voice: { provider: string } | null
}

interface Health {
  status: string
  primary_da: string
  identity_loaded: boolean
  scheduled_tasks: number
  last_heartbeat: string | null
  diary_entries_today: number
  opinions_count: number
}

// ── Module State ──

interface ModuleState {
  running: boolean
  startedAt: Date | null
  primaryDA: string | null
  lastHeartbeat: Date | null
}

const state: ModuleState = {
  running: false,
  startedAt: null,
  primaryDA: null,
  lastHeartbeat: null,
}

// ── Helpers ──

function loadRegistry(): Registry | null {
  if (!existsSync(REGISTRY_PATH)) return null
  try {
    const content = readFileSync(REGISTRY_PATH, "utf-8")
    return parseYaml(content) as Registry
  } catch {
    return null
  }
}

function loadPrimaryDADir(): string | null {
  const registry = loadRegistry()
  if (!registry || !registry.primary) return null

  const primaryDir = join(DA_DIR, registry.primary)
  if (!existsSync(primaryDir)) return null

  return primaryDir
}

function loadYaml<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return parseYaml(readFileSync(path, "utf-8")) as T
  } catch {
    return null
  }
}

function parseJSONL<T>(path: string): T[] {
  if (!existsSync(path)) return []
  try {
    const content = readFileSync(path, "utf-8")
    return content
      .split("\n")
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line) as T
        } catch {
          return null
        }
      })
      .filter(Boolean) as T[]
  } catch {
    return []
  }
}

function getIdentity(): Identity | null {
  const daDir = loadPrimaryDADir()
  if (!daDir) return null

  const yamlPath = join(daDir, "DA_IDENTITY.yaml")
  const yaml = loadYaml<any>(yamlPath)
  if (!yaml) return null

  return {
    name: yaml.core?.name || "Unknown",
    full_name: yaml.core?.full_name || yaml.core?.name || "Unknown",
    display_name: yaml.core?.display_name || yaml.core?.name || "Unknown",
    color: yaml.core?.color || "#3B82F6",
    role: yaml.core?.role || "primary",
    origin_story: yaml.core?.origin_story || "",
    has_avatar: false,
    principal: yaml.relationship?.principal || "Unknown",
    uptime_ms: state.startedAt ? Date.now() - state.startedAt.getTime() : 0,
  }
}

function getPersonality(): Personality | null {
  const daDir = loadPrimaryDADir()
  if (!daDir) return null

  const yamlPath = join(daDir, "DA_IDENTITY.yaml")
  const yaml = loadYaml<any>(yamlPath)
  if (!yaml) return null

  return {
    base_description: yaml.personality?.base_description || "",
    traits: yaml.personality?.traits || {},
    anchors: yaml.personality?.anchors,
    preferences: yaml.personality?.preferences,
    companion: yaml.personality?.companion,
    relationship: {
      dynamic: yaml.relationship?.dynamic || "peers",
      interaction_style: yaml.relationship?.framing || "Direct and clear",
    },
    autonomy: yaml.autonomy || { can_initiate: [], must_ask: [] },
    writing: {
      style: yaml.writing_style?.voice || "",
      avoid: yaml.writing_style?.avoid || [],
      prefer: yaml.writing_style?.prefer || [],
    },
    voice: yaml.voice?.provider ? { provider: yaml.voice.provider } : null,
  }
}

function countDiaryEntriesToday(): number {
  const daDir = loadPrimaryDADir()
  if (!daDir) return 0

  const diaryPath = join(daDir, "diary.jsonl")
  const entries = parseJSONL<any>(diaryPath)

  const today = new Date().toISOString().slice(0, 10)
  return entries.filter(e => e.timestamp?.startsWith(today)).length
}

function countOpinions(): number {
  const daDir = loadPrimaryDADir()
  if (!daDir) return 0

  const opinionsPath = join(daDir, "opinions.yaml")
  const opinions = loadYaml<any>(opinionsPath)
  if (!opinions) return 0

  let count = 0
  for (const key in opinions) {
    if (Array.isArray(opinions[key])) {
      count += opinions[key].length
    } else {
      count++
    }
  }
  return count
}

// ── Pulse Module Contract ──

export async function start(): Promise<void> {
  console.log(`[${MODULE_NAME}] Starting...`)
  state.running = true
  state.startedAt = new Date()

  const registry = loadRegistry()
  if (registry?.primary) {
    state.primaryDA = registry.primary
    console.log(`[${MODULE_NAME}] Primary DA: ${registry.primary}`)
  }

  console.log(`[${MODULE_NAME}] Started`)
}

export async function startAssistant(
  config: { primary: string; heartbeat_schedule?: string; heartbeat_model?: string; heartbeat_cost_ceiling?: number },
  enabledJobs: Map<string, any>
): Promise<void> {
  console.log(`[${MODULE_NAME}] Starting Assistant...`)
  await start()
  state.primaryDA = config.primary || null
  console.log(`[${MODULE_NAME}] Assistant started with primary: ${state.primaryDA}`)
}

export async function stop(): Promise<void> {
  console.log(`[${MODULE_NAME}] Stopping...`)
  state.running = false
  console.log(`[${MODULE_NAME}] Stopped`)
}

export async function stopAssistant(): Promise<void> {
  await stop()
}

export function assistantHealth(): Health {
  const identity = getIdentity()
  return {
    status: "ok",
    primary_da: state.primaryDA || "none",
    identity_loaded: identity !== null,
    scheduled_tasks: 0,
    last_heartbeat: state.lastHeartbeat?.toISOString() || null,
    diary_entries_today: countDiaryEntriesToday(),
    opinions_count: countOpinions(),
  }
}

export function health(): { status: string; details?: Record<string, unknown> } {
  return {
    status: state.running ? "healthy" : "stopped",
    details: {
      uptime_seconds: state.startedAt
        ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000)
        : 0,
      primary_da: state.primaryDA,
      identity_loaded: getIdentity() !== null,
    },
  }
}

export async function handleAssistantRequest(req: Request, pathname: string): Promise<Response | null> {
  const path = pathname.replace(/^\/assistant\//, "")

  if (path === "health") {
    return Response.json(assistantHealth())
  }

  if (path === "identity") {
    const identity = getIdentity()
    if (!identity) {
      return Response.json({ error: "Identity not loaded" }, { status: 503 })
    }
    return Response.json(identity)
  }

  if (path === "personality") {
    const personality = getPersonality()
    if (!personality) {
      return Response.json({ error: "Personality not loaded" }, { status: 503 })
    }
    return Response.json(personality)
  }

  if (path === "traits") {
    const personality = getPersonality()
    if (!personality) {
      return Response.json({ error: "Personality not loaded" }, { status: 503 })
    }
    return Response.json({ traits: personality.traits })
  }

  if (path === "diary") {
    const daDir = loadPrimaryDADir()
    if (!daDir) {
      return Response.json({ entries: [] })
    }
    const diaryPath = join(daDir, "diary.jsonl")
    const entries = parseJSONL<any>(diaryPath)
    return Response.json({ entries })
  }

  if (path === "opinions") {
    const daDir = loadPrimaryDADir()
    if (!daDir) {
      return Response.json({ raw: "" })
    }
    const opinionsPath = join(daDir, "opinions.yaml")
    if (!existsSync(opinionsPath)) {
      return Response.json({ raw: "" })
    }
    const raw = readFileSync(opinionsPath, "utf-8")
    return Response.json({ raw })
  }

  if (path === "tasks") {
    // TODO: Implement task management
    return Response.json({ tasks: [], count: 0, by_source: { da: 0, pulse: 0, "claude-code": 0 } })
  }

  return null
}
