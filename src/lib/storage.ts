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
  PROMPT_CHUNKS: "promptChunks",
}

// Constants for chunking
const MAX_PROMPT_SIZE_KB = 7 // Leave buffer below 8KB Chrome limit
const CHUNK_SIZE_CHARS = 3000 // Characters per chunk to stay under size limit

// Utility function to chunk a large prompt
function chunkPrompt(prompt: Prompt): { metadata: any; chunks: string[] } {
  const promptJson = JSON.stringify(prompt)
  const promptSizeKB = new Blob([promptJson]).size / 1024

  if (promptSizeKB <= MAX_PROMPT_SIZE_KB) {
    return { metadata: null, chunks: [] }
  }

  console.log(`[PromptManager] Chunking prompt "${prompt.title}" (${promptSizeKB.toFixed(2)} KB)`)

  // Split content into chunks
  const chunks: string[] = []
  const content = prompt.content

  for (let i = 0; i < content.length; i += CHUNK_SIZE_CHARS) {
    chunks.push(content.slice(i, i + CHUNK_SIZE_CHARS))
  }

  // Create metadata without content
  const metadata = {
    ...prompt,
    content: undefined, // Will be reconstructed from chunks
    chunkCount: chunks.length,
    originalSize: promptSizeKB,
  }

  return { metadata, chunks }
}

// Utility function to reconstruct a prompt from chunks
function reconstructPrompt(metadata: any, chunks: string[]): Prompt {
  return {
    ...metadata,
    content: chunks.join(''),
    chunkCount: undefined,
    originalSize: undefined,
  }
}

const PROMPTS_CHUNK_PREFIX = "promptsChunk_"
const PROMPT_CHUNK_SIZE = 6000
const NOTION_ID_REGEX = /^[0-9a-f]{32}$/i

function chromeSyncGet(keys?: string[] | string): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const storage = chrome.storage.sync // Try sync first, fallback to local if needed

    storage.get([STORAGE_KEYS.PROMPTS, STORAGE_KEYS.STORAGE_TYPE, STORAGE_KEYS.PROMPT_CHUNKS], (result: { [key: string]: any }) => {
      // If no data in sync, try local storage
      if (!result[STORAGE_KEYS.PROMPTS] && !result[STORAGE_KEYS.STORAGE_TYPE]) {
        chrome.storage.local.get([STORAGE_KEYS.PROMPTS, STORAGE_KEYS.STORAGE_TYPE, STORAGE_KEYS.PROMPT_CHUNKS], (localResult: { [key: string]: any }) => {
          processPrompts(localResult, resolve)
        })
      } else {
        processPrompts(result, resolve)
      }
    })

    function processPrompts(result: { [key: string]: any }, resolve: (value: { prompts: Prompt[]; storageType: StorageType }) => void) {
      const storageType = (result[STORAGE_KEYS.STORAGE_TYPE] as StorageType) || "local"
      const savedPrompts = (result[STORAGE_KEYS.PROMPTS] as any[]) || []
      const chunks = (result[STORAGE_KEYS.PROMPT_CHUNKS] as { [key: string]: string[] }) || {}

      // Reconstruct chunked prompts
      const prompts: Prompt[] = savedPrompts.map(prompt => {
        if (prompt.chunkCount && prompt.chunkCount > 0) {
          // This is a chunked prompt metadata, reconstruct it
          const promptChunks = chunks[prompt.id]
          if (promptChunks && promptChunks.length === prompt.chunkCount) {
            return reconstructPrompt(prompt, promptChunks)
          } else {
            console.error(`[PromptManager] Missing or incomplete chunks for prompt "${prompt.title}" (expected ${prompt.chunkCount}, got ${promptChunks?.length || 0})`)
            // Return metadata as-is if chunks are missing
            return { ...prompt, content: '[Error: Content chunks missing]' }
          }
        } else {
          // Regular prompt
          return prompt
        }
      })

      resolve({ prompts, storageType })
    }
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

  // Process prompts for chunking
  const regularPrompts: Prompt[] = []
  const chunkedPromptsMetadata: any[] = []
  const allChunks: { [key: string]: string[] } = {}

  prompts.forEach((prompt, index) => {
    const promptSize = new Blob([JSON.stringify(prompt)]).size
    const promptSizeKB = promptSize / 1024
    console.log(`[PromptManager] Prompt ${index + 1}: "${prompt.title}" - ${prompt.content.length} chars, ${promptSizeKB.toFixed(2)} KB`)

    // Check for problematic characters
    const hasEmoji = /[\uD83C-\uDBFF\uDC00-\uDFFF]/.test(prompt.content)
    const hasNullChars = /\0/.test(prompt.content)
    const hasControlChars = /[\x00-\x1F\x7F-\x9F]/.test(prompt.content)

    if (hasEmoji || hasNullChars || hasControlChars) {
      console.warn(`[PromptManager] Prompt "${prompt.title}" contains special characters: emoji=${hasEmoji}, null=${hasNullChars}, control=${hasControlChars}`)
    }

    // Check if prompt needs chunking
    if (promptSizeKB > MAX_PROMPT_SIZE_KB) {
      console.log(`[PromptManager] Prompt "${prompt.title}" exceeds ${MAX_PROMPT_SIZE_KB}KB limit, chunking...`)
      const { metadata, chunks } = chunkPrompt(prompt)
      if (metadata && chunks.length > 0) {
        chunkedPromptsMetadata.push(metadata)
        allChunks[prompt.id] = chunks
      }
    } else {
      regularPrompts.push(prompt)
    }
  })

  // Combine regular prompts with chunked metadata
  const allPromptsToSave = [...regularPrompts, ...chunkedPromptsMetadata]

  // Debug: Check storage size before saving
  const dataToSave = {
    [STORAGE_KEYS.PROMPTS]: allPromptsToSave,
    [STORAGE_KEYS.STORAGE_TYPE]: storageType,
    [STORAGE_KEYS.TAGS]: Array.from(allTags),
    [STORAGE_KEYS.PROMPT_CHUNKS]: allChunks,
  }

  const dataString = JSON.stringify(dataToSave)
  const dataSize = new Blob([dataString]).size
  const dataSizeMB = dataSize / (1024 * 1024)
  const dataSizeKB = dataSize / 1024

  console.log(`[PromptManager] Saving ${allPromptsToSave.length} prompts (${Object.keys(allChunks).length} chunked) (${dataSizeMB.toFixed(2)} MB / ${dataSizeKB.toFixed(1)} KB)`)

  // Chrome sync storage has 5MB limit
  if (dataSizeMB > 4.5) {
    console.warn(`[PromptManager] Total storage size (${dataSizeMB.toFixed(2)} MB) approaching Chrome sync limit (5MB)`)
  }

  // Chrome sync storage has per-item limit of ~8KB for individual items
  if (dataSizeKB > 8000) {
    console.error(`[PromptManager] Data size (${dataSizeKB.toFixed(1)} KB) exceeds Chrome sync per-item limit (~8KB)!`)
  }

  return new Promise((resolve, reject) => {
    const storage = storageType === 'local' ? chrome.storage.local : chrome.storage.sync

    storage.set(dataToSave, () => {
      if (chrome.runtime.lastError) {
        console.error(`[PromptManager] Save failed:`, chrome.runtime.lastError)

        // If sync storage fails due to quota, try local storage as fallback
        if (storageType !== 'local' && (chrome.runtime.lastError.message?.includes('QUOTA_BYTES') ||
            chrome.runtime.lastError.message?.includes('QUOTA_BYTES_PER_ITEM'))) {
          console.warn(`[PromptManager] Sync storage quota exceeded. Trying local storage as fallback.`)

          chrome.storage.local.set(dataToSave, () => {
            if (chrome.runtime.lastError) {
              console.error(`[PromptManager] Local storage fallback also failed:`, chrome.runtime.lastError)
              reject(new Error(`Storage quota exceeded. Please reduce prompt content size or clear some prompts.`))
            } else {
              console.log(`[PromptManager] Saved to local storage as fallback`)
              resolve()
            }
          })
        } else {
          reject(chrome.runtime.lastError)
        }
      } else {
        console.log(`[PromptManager] Save successful (${Object.keys(allChunks).length} prompts chunked)`)
        resolve()
      }
    })
  })
}

// Get all tags
export async function getAllTags(): Promise<string[]> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.TAGS], (result: { [key: string]: any }) => {
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
    chrome.storage.sync.get([STORAGE_KEYS.TAGS], (result: { [key: string]: any }) => {
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
    chrome.storage.sync.get([STORAGE_KEYS.NOTION_CONFIG], (result: { [key: string]: any }) => {
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
    chrome.storage.sync.get([STORAGE_KEYS.SYNC_STATUS], (result: { [key: string]: any }) => {
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

// Download prompts as JSON file
export function downloadPromptsAsJson(prompts: Prompt[]): void {
  try {
    const jsonString = exportPromptsToJson(prompts)
    const blob = new Blob([jsonString], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5)
    const filename = `prompts-export-${timestamp}.json`
    
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error("Failed to download prompts:", error)
    throw error
  }
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
    importedPrompts.forEach((prompt, index) => {
      if (!prompt.id || !prompt.title || !prompt.content) {
        throw new Error(
          `Invalid prompt format at index ${index}: Missing required fields (id, title, or content)`
        )
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

