import type { Prompt, NotionConfig } from "../types"
import { getNotionConfig } from "./storage"

// Declare chrome if it's not available (e.g., in a testing environment)
declare const chrome: any

// Notion API client
const NOTION_API_BASE_URL = "https://api.notion.com/v1"

function normalizeNotionId(id: string): string {
  return id.replace(/-/g, "").trim()
}

function chunkRichTextContent(content: string, chunkSize = 1800): string[] {
  if (!content) {
    return [""]
  }

  const chunks: string[] = []

  for (let index = 0; index < content.length; index += chunkSize) {
    chunks.push(content.slice(index, index + chunkSize))
  }

  return chunks
}

function extractDatabaseProperties(database: any): {
  title: string
  content?: string
  tags?: string
} {
  const entries = Object.entries(database.properties || {})
  const titleEntry = entries.find(([, prop]: any) => prop.type === "title")

  if (!titleEntry) {
    throw new Error("Database is missing a title property")
  }

  const richTextEntry = entries.find(([, prop]: any) => prop.type === "rich_text")
  const tagsEntry = entries.find(([, prop]: any) => prop.type === "multi_select")

  return {
    title: titleEntry[0],
    content: richTextEntry?.[0],
    tags: tagsEntry?.[0],
  }
}

// Helper function to make authenticated requests to Notion API
async function notionRequest(endpoint: string, method = "GET", body?: any, apiKey?: string): Promise<any> {
  const config = apiKey ? { apiKey } : await getNotionConfig()

  if (!config) {
    throw new Error("Notion is not configured")
  }

  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  }

  try {
    const response = await fetch(`${NOTION_API_BASE_URL}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.message || "Failed to communicate with Notion API")
    }

    return await response.json()
  } catch (error) {
    console.error("Notion API error:", error)
    throw error
  }
}

// Test Notion connection
export async function testNotionConnection(config: NotionConfig): Promise<boolean> {
  const candidates = [
    config.pageId.trim(),
    normalizeNotionId(config.pageId),
  ].filter((value, index, array) => value && array.indexOf(value) === index)

  for (const candidate of candidates) {
    try {
      await notionRequest(`/databases/${candidate}`, "GET", undefined, config.apiKey)
      return true
    } catch (databaseError) {
      console.warn("Notion database lookup failed for candidate:", candidate, databaseError)

      try {
        await notionRequest(`/pages/${candidate}`, "GET", undefined, config.apiKey)
        return true
      } catch (pageError) {
        console.error("Notion page lookup failed for candidate:", candidate, pageError)
      }
    }
  }

  return false
}

// Convert Notion page to Prompt
function notionPageToPrompt(page: any): Prompt | null {
  try {
    const properties = page.properties

    // Extract title from the title property
    const titleProperty = Object.values(properties).find((prop: any) => prop.type === "title") as any

    const title = titleProperty?.title?.map((t: any) => t.plain_text).join("") || ""

    // Extract content from the rich_text property named "Content"
    const contentProperty = properties.Content || properties.content
    const content = contentProperty?.rich_text?.map((t: any) => t.plain_text).join("") || ""

    // Extract tags if they exist
    const tagsProperty = properties.Tags || properties.tags
    const tags = tagsProperty?.multi_select?.map((tag: any) => tag.name) || []

    // Extract timestamps
    const createdTime = new Date(page.created_time).getTime()
    const lastEditedTime = new Date(page.last_edited_time).getTime()

    return {
      id: normalizeNotionId(page.id),
      title,
      content,
      tags,
      createdAt: createdTime,
      updatedAt: lastEditedTime,
    }
  } catch (error) {
    console.error("Error converting Notion page to prompt:", error)
    return null
  }
}

// Create a Notion database for prompts if it doesn't exist
export async function createNotionDatabase(parentPageId: string): Promise<string> {
  const body = {
    parent: {
      type: "page_id",
      page_id: parentPageId,
    },
    title: [
      {
        type: "text",
        text: {
          content: "Prompt Manager",
        },
      },
    ],
    properties: {
      Title: {
        title: {},
      },
      Content: {
        rich_text: {},
      },
      Tags: {
        multi_select: {
          options: [],
        },
      },
    },
  }

  const response = await notionRequest("/databases", "POST", body)
  return response.id
}

// Fetch prompts from Notion
export async function fetchPromptsFromNotion(): Promise<Prompt[]> {
  const config = await getNotionConfig()

  if (!config) {
    throw new Error("Notion is not configured")
  }

  try {
    const candidates = [
      config.pageId.trim(),
      normalizeNotionId(config.pageId),
    ].filter((value, index, array) => value && array.indexOf(value) === index)

    let databaseId: string | null = null

    for (const candidate of candidates) {
      try {
        await notionRequest(`/databases/${candidate}`, "GET")
        databaseId = candidate
        break
      } catch (databaseError) {
        console.warn("Unable to read Notion database for candidate:", candidate, databaseError)

        try {
          const pageResponse = await notionRequest(`/pages/${candidate}`)

          if (pageResponse?.object === "page") {
            const createdDatabaseId = await createNotionDatabase(candidate)
            databaseId = createdDatabaseId.trim()
            await saveNotionConfig({
              ...config,
              pageId: databaseId,
            })
            break
          }
        } catch (pageError) {
          console.error("Unable to read Notion page for candidate:", candidate, pageError)
        }
      }
    }

    if (!databaseId) {
      throw new Error("Unable to locate or create a Notion database with the provided ID")
    }

    // Query the database
    const response = await notionRequest(`/databases/${databaseId}/query`, "POST")

    // Convert Notion pages to Prompts
    const prompts = response.results.map(notionPageToPrompt).filter(Boolean) as Prompt[]

    return prompts
  } catch (error) {
    console.error("Failed to fetch prompts from Notion:", error)
    throw error
  }
}

// Save a prompt to Notion
export async function savePromptToNotion(prompt: Prompt): Promise<Prompt> {
  const config = await getNotionConfig()

  if (!config) {
    throw new Error("Notion is not configured")
  }

  const database = await notionRequest(`/databases/${normalizeNotionId(config.pageId)}`, "GET")
  const schema = extractDatabaseProperties(database)

  const notionProperties: Record<string, any> = {
    [schema.title]: {
      title: [
        {
          text: {
            content: prompt.title || "Untitled Prompt",
          },
        },
      ],
    },
  }

  if (schema.content) {
    const contentChunks = chunkRichTextContent(prompt.content)

    notionProperties[schema.content] = {
      rich_text: contentChunks.map((chunk) => ({
        text: {
          content: chunk,
        },
      })),
    }
  }

  if (schema.tags && prompt.tags && prompt.tags.length > 0) {
    notionProperties[schema.tags] = {
      multi_select: prompt.tags.map((tag) => ({ name: tag })),
    }
  }

  const requestBody = {
    parent: {
      database_id: normalizeNotionId(config.pageId),
    },
    properties: notionProperties,
  }

  const normalizedId = prompt.id ? normalizeNotionId(prompt.id) : ""
  const looksLikeNotionId =
    !!prompt.id && prompt.id === normalizedId && /^[0-9a-f]{32}$/i.test(normalizedId)

  if (looksLikeNotionId) {
    const updatedPage = await notionRequest(`/pages/${normalizedId}`, "PATCH", {
      properties: notionProperties,
      archived: false,
    })

    return {
      ...prompt,
      id: normalizeNotionId(updatedPage.id ?? normalizedId),
      updatedAt: updatedPage?.last_edited_time
        ? new Date(updatedPage.last_edited_time).getTime()
        : Date.now(),
    }
  }

  const createdPage = await notionRequest("/pages", "POST", {
    ...requestBody,
    archived: false,
  })
  const newId = normalizeNotionId(createdPage.id)

  return {
    ...prompt,
    id: newId,
    createdAt: createdPage?.created_time
      ? new Date(createdPage.created_time).getTime()
      : prompt.createdAt,
    updatedAt: createdPage?.last_edited_time
      ? new Date(createdPage.last_edited_time).getTime()
      : Date.now(),
  }
}

// Save all prompts to Notion
export async function savePromptsToNotion(prompts: Prompt[]): Promise<void> {
  // Save each prompt individually
  for (const prompt of prompts) {
    await savePromptToNotion(prompt)
  }
}

// Delete a prompt from Notion
export async function deletePromptFromNotion(promptId: string): Promise<boolean> {
  const normalizedId = normalizeNotionId(promptId)

  if (!/^[0-9a-f]{32}$/i.test(normalizedId)) {
    return false
  }

  try {
    await notionRequest(`/pages/${normalizedId}`, "PATCH", {
      archived: true,
    })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (message.toLowerCase().includes("could not find page")) {
      return false
    }

    throw error
  }
}

// Sync prompts with Notion (bidirectional)
export async function syncWithNotion(localPrompts: Prompt[]): Promise<Prompt[]> {
  try {
    // Get prompts from Notion
    const notionPrompts = await fetchPromptsFromNotion()

    // Create maps for easier lookup
    const notionPromptsMap = new Map(notionPrompts.map((p) => [p.id, p]))
    const localPromptsMap = new Map(localPrompts.map((p) => [p.id, p]))

    // Merged prompts will contain the final state
    const mergedPrompts: Prompt[] = []

    // Process local prompts
    for (const localPrompt of localPrompts) {
      const notionPrompt = notionPromptsMap.get(localPrompt.id)

      if (!notionPrompt) {
        // Prompt exists only locally, add to Notion
        const syncedPrompt = await savePromptToNotion(localPrompt)
        mergedPrompts.push(syncedPrompt)
      } else {
        // Prompt exists in both places, use the most recent version
        if (localPrompt.updatedAt > notionPrompt.updatedAt) {
          const syncedPrompt = await savePromptToNotion(localPrompt)
          mergedPrompts.push(syncedPrompt)
        } else {
          mergedPrompts.push(notionPrompt)
        }

        // Remove from Notion map to track what's been processed
        notionPromptsMap.delete(localPrompt.id)
      }
    }

    // Add remaining Notion prompts (those not in local storage)
    for (const [, notionPrompt] of notionPromptsMap) {
      mergedPrompts.push(notionPrompt)
    }

    return mergedPrompts
  } catch (error) {
    console.error("Failed to sync with Notion:", error)
    throw error
  }
}

// Helper function to save Notion config
async function saveNotionConfig(config: NotionConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(
      {
        notionConfig: config,
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

