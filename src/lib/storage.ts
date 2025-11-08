import type { Prompt, StorageType, NotionConfig, SyncStatus } from "../types"
import { syncWithNotion as notionSync, deletePromptFromNotion } from "./notion"

// Declare chrome if it's not available (e.g., in a testing environment)
declare const chrome: any

// Default Tags
export const DEFAULT_TAGS = [
  "General",
  "Education & Learning",
  "Personal",
  "Coding & Development",
  "AI Roleplay & Agents",
  "Writing",
  "Research",
  "Design",
]

// Chrome storage keys
const STORAGE_KEYS = {
  PROMPTS: "prompts",
  STORAGE_TYPE: "storageType",
  NOTION_CONFIG: "notionConfig",
  SYNC_STATUS: "syncStatus",
  AUTO_SYNC: "autoSyncEnabled",
  PROMPTS_CHUNK_COUNT: "promptsChunkCount",
  NOTION_DELETE_QUEUE: "notionDeleteQueue",
  TAGS: "tags",
}

const PROMPTS_CHUNK_PREFIX = "promptsChunk_"
const PROMPT_CHUNK_SIZE = 6000
const NOTION_ID_REGEX = /^[0-9a-f]{32}$/i

function chromeSyncGet(keys?: string[] | string): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys ?? null, (result: Record<string, any>) => {
      resolve(result)
    })
  })
}

function chromeSyncSet(data: Record<string, any>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(data, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError)
      } else {
        resolve()
      }
    })
  })
}

function chromeSyncRemove(keys: string[] | string): Promise<void> {
  const removeKeys = Array.isArray(keys) ? keys : [keys]

  return new Promise((resolve, reject) => {
    chrome.storage.sync.remove(removeKeys, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError)
      } else {
        resolve()
      }
    })
  })
}

function normalizeNotionIdForQueue(id: string): string {
  return id.replace(/-/g, "").trim()
}

// Get prompts from storage
export async function getPrompts(): Promise<{ prompts: Prompt[]; storageType: StorageType }> {
  const base = await chromeSyncGet([
    STORAGE_KEYS.PROMPTS,
    STORAGE_KEYS.STORAGE_TYPE,
    STORAGE_KEYS.PROMPTS_CHUNK_COUNT,
  ])

  const storageType = (base[STORAGE_KEYS.STORAGE_TYPE] as StorageType) || "local"
  const legacyPrompts = base[STORAGE_KEYS.PROMPTS] as Prompt[] | undefined

  if (Array.isArray(legacyPrompts) && legacyPrompts.length > 0) {
    return { prompts: legacyPrompts, storageType }
  }

  const chunkCount = Number(base[STORAGE_KEYS.PROMPTS_CHUNK_COUNT] ?? 0)

  if (chunkCount > 0) {
    const chunkKeys = Array.from({ length: chunkCount }, (_, index) => `${PROMPTS_CHUNK_PREFIX}${index}`)
    const chunkData = await chromeSyncGet(chunkKeys)
    const combined = chunkKeys.map((key) => (chunkData[key] as string) ?? "").join("")

    if (combined) {
      try {
        const parsed = JSON.parse(combined) as Prompt[]
        return { prompts: Array.isArray(parsed) ? parsed : [], storageType }
      } catch (error) {
        console.error("Failed to parse prompt chunks:", error)
      }
    }
  }

  return { prompts: [], storageType }
}

// Save prompts to storage
export async function savePrompts(prompts: Prompt[], storageType: StorageType): Promise<void> {
  // Extract all unique tags
  const allTags = new Set<string>()
  prompts.forEach((prompt) => {
    if (prompt.tags) {
      prompt.tags.forEach((tag) => allTags.add(tag))
    }
  })

  const previousMetadata = await chromeSyncGet([STORAGE_KEYS.PROMPTS_CHUNK_COUNT])
  const previousChunkCount = Number(previousMetadata[STORAGE_KEYS.PROMPTS_CHUNK_COUNT] ?? 0)

  const promptsJson = JSON.stringify(prompts)
  const chunkCount = promptsJson.length === 0 ? 0 : Math.ceil(promptsJson.length / PROMPT_CHUNK_SIZE)
  const chunkPayload: Record<string, any> = {}

  for (let index = 0; index < chunkCount; index++) {
    const start = index * PROMPT_CHUNK_SIZE
    const end = start + PROMPT_CHUNK_SIZE
    chunkPayload[`${PROMPTS_CHUNK_PREFIX}${index}`] = promptsJson.slice(start, end)
  }

  const payload: Record<string, any> = {
    [STORAGE_KEYS.STORAGE_TYPE]: storageType,
    [STORAGE_KEYS.TAGS]: Array.from(allTags),
    [STORAGE_KEYS.PROMPTS_CHUNK_COUNT]: chunkCount,
    ...chunkPayload,
  }

  try {
    await chromeSyncSet(payload)
    await chromeSyncRemove(STORAGE_KEYS.PROMPTS)

    if (previousChunkCount > chunkCount) {
      const extraKeys = Array.from({ length: previousChunkCount - chunkCount }, (_, index) =>
        `${PROMPTS_CHUNK_PREFIX}${chunkCount + index}`,
      )

      if (extraKeys.length > 0) {
        await chromeSyncRemove(extraKeys)
      }
    }
  } catch (error) {
    console.error("Failed to save prompts:", error)
    throw error
  }
}

// Get all tags
export async function getAllTags(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.TAGS], (result) => {
      const savedTags = result[STORAGE_KEYS.TAGS] as string[];

      // If there are no saved tags, return the default tags
      if (!savedTags || savedTags.length === 0) {
        resolve(DEFAULT_TAGS);
      } else {
        resolve(savedTags);
      }
    })
  })
}

// Initialize default tags if none exist
export async function initializeDefaultTags(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get([STORAGE_KEYS.TAGS], (result) => {
      const existingTags = result[STORAGE_KEYS.TAGS] as string[];

      // Only initialize if no tags exist yet
      if (!existingTags || existingTags.length === 0) {
        chrome.storage.sync.set(
          {
            [STORAGE_KEYS.TAGS]: DEFAULT_TAGS,
          },
          () => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError)
            } else {
              resolve()
            }
          },
        )
      } else {
        // Tags already exist, nothing to do
        resolve();
      }
    });
  });
}

// Get Notion configuration
export async function getNotionConfig(): Promise<NotionConfig | null> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.NOTION_CONFIG], (result) => {
      resolve((result[STORAGE_KEYS.NOTION_CONFIG] as NotionConfig) || null)
    })
  })
}

async function setNotionDeletionQueue(queue: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(
      {
        [STORAGE_KEYS.NOTION_DELETE_QUEUE]: queue,
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve()
        }
      },
    )
  })
}

export async function getNotionDeletionQueue(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.NOTION_DELETE_QUEUE], (result) => {
      resolve((result[STORAGE_KEYS.NOTION_DELETE_QUEUE] as string[]) || [])
    })
  })
}

export async function addToNotionDeletionQueue(id: string): Promise<void> {
  const normalizedId = normalizeNotionIdForQueue(id)

  if (!NOTION_ID_REGEX.test(normalizedId)) {
    return
  }

  const queue = await getNotionDeletionQueue()

  if (queue.includes(normalizedId)) {
    return
  }

  await setNotionDeletionQueue([...queue, normalizedId])
}

export async function removeFromNotionDeletionQueue(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    return
  }

  const idsToRemove = new Set(ids.map(normalizeNotionIdForQueue))
  const queue = await getNotionDeletionQueue()
  const filteredQueue = queue.filter((queueId) => !idsToRemove.has(queueId))

  if (filteredQueue.length !== queue.length) {
    await setNotionDeletionQueue(filteredQueue)
  }
}

// Save Notion configuration
export async function saveNotionConfig(config: NotionConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(
      {
        [STORAGE_KEYS.NOTION_CONFIG]: config,
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve()
        }
      },
    )
  })
}

// Clear Notion configuration
export async function clearNotionConfig(): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.remove(STORAGE_KEYS.NOTION_CONFIG, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError)
      } else {
        resolve()
      }
    })
  })
}

// Get sync status
export async function getSyncStatus(): Promise<SyncStatus> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.SYNC_STATUS], (result) => {
      resolve(
        (result[STORAGE_KEYS.SYNC_STATUS] as SyncStatus) || {
          lastSynced: null,
          inProgress: false,
          error: null,
        },
      )
    })
  })
}

export async function getAutoSyncSetting(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.AUTO_SYNC], (result) => {
      const value = result[STORAGE_KEYS.AUTO_SYNC]
      resolve(Boolean(value))
    })
  })
}

export async function setAutoSyncSetting(enabled: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(
      {
        [STORAGE_KEYS.AUTO_SYNC]: enabled,
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve()
        }
      },
    )
  })
}

// Update sync status
export async function updateSyncStatus(status: Partial<SyncStatus>): Promise<void> {
  const currentStatus = await getSyncStatus()
  const newStatus = { ...currentStatus, ...status }

  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(
      {
        [STORAGE_KEYS.SYNC_STATUS]: newStatus,
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError)
        } else {
          resolve()
        }
      },
    )
  })
}

// Sync with Notion
export async function syncWithNotion(): Promise<Prompt[]> {
  const { prompts } = await getPrompts()
  const config = await getNotionConfig()

  if (!config) {
    throw new Error("Notion is not configured")
  }

  try {
    await updateSyncStatus({ inProgress: true, error: null })

    const pendingDeletions = await getNotionDeletionQueue()

    if (pendingDeletions.length > 0) {
      const remainingDeletions: string[] = []

      for (const deletionId of pendingDeletions) {
        try {
          await deletePromptFromNotion(deletionId)
        } catch (error) {
          console.error("Failed to delete Notion page:", error)
          remainingDeletions.push(deletionId)
        }
      }

      await setNotionDeletionQueue(remainingDeletions)
    }

    // Sync with Notion
    const syncedPrompts = await notionSync(prompts)

    // Save synced prompts
    await savePrompts(syncedPrompts, "notion")

    // Update sync status
    await updateSyncStatus({
      lastSynced: Date.now(),
      inProgress: false,
    })

    return syncedPrompts
  } catch (error) {
    await updateSyncStatus({
      inProgress: false,
      error: error instanceof Error ? error.message : "Unknown error during sync",
    })
    throw error
  }
}

// Search prompts
export async function searchPrompts(query: string, tags: string[] = []): Promise<Prompt[]> {
  const { prompts } = await getPrompts()

  if (!query && tags.length === 0) {
    return prompts
  }

  const normalizedQuery = query.toLowerCase().trim()

  return prompts.filter((prompt) => {
    // Filter by tags if specified
    if (tags.length > 0) {
      if (!prompt.tags || !tags.some((tag) => prompt.tags?.includes(tag))) {
        return false
      }
    }

    // Filter by search query if specified
    if (normalizedQuery) {
      const titleMatch = prompt.title.toLowerCase().includes(normalizedQuery)
      const contentMatch = prompt.content.toLowerCase().includes(normalizedQuery)
      return titleMatch || contentMatch
    }

    return true
  })
}

// Export prompts to JSON
export function exportPromptsToJson(prompts: Prompt[]): string {
  return JSON.stringify(prompts, null, 2)
}

// Import prompts from JSON
export async function importPromptsFromJson(json: string): Promise<Prompt[]> {
  try {
    const importedPrompts = JSON.parse(json) as Prompt[]

    // Validate imported data
    if (!Array.isArray(importedPrompts)) {
      throw new Error("Invalid format: Expected an array of prompts")
    }

    // Validate each prompt
    importedPrompts.forEach((prompt) => {
      if (!prompt.id || !prompt.content) {
        throw new Error("Invalid prompt format: Missing required fields")
      }
    })

    // Get current prompts
    const { prompts: currentPrompts, storageType } = await getPrompts()

    // Merge prompts, avoiding duplicates by ID
    const currentPromptsMap = new Map(currentPrompts.map((p) => [p.id, p]))

    importedPrompts.forEach((prompt) => {
      currentPromptsMap.set(prompt.id, prompt)
    })

    const mergedPrompts = Array.from(currentPromptsMap.values())

    // Save merged prompts
    await savePrompts(mergedPrompts, storageType)

    return mergedPrompts
  } catch (error) {
    console.error("Failed to import prompts:", error)
    throw error
  }
}

