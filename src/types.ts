export type StorageType = "local" | "notion"

export interface Prompt {
  id: string
  title: string
  content: string
  tags?: string[]
  createdAt: number
  updatedAt: number
  // Internal properties for chunked prompts (optional)
  chunkCount?: number
  originalSize?: number
}

export interface NotionConfig {
  apiKey: string
  pageId: string
}

export interface SyncStatus {
  lastSynced: number | null
  inProgress: boolean
  error: string | null
}

