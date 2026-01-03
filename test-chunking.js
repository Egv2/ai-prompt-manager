// Test script to verify prompt chunking functionality
const fs = require('fs');

// Import the chunking functions (simplified versions for testing)
function chunkPrompt(prompt) {
  const promptJson = JSON.stringify(prompt);
  const promptSizeKB = Buffer.byteLength(promptJson, 'utf8') / 1024;

  const MAX_PROMPT_SIZE_KB = 7;
  const CHUNK_SIZE_CHARS = 3000;

  if (promptSizeKB <= MAX_PROMPT_SIZE_KB) {
    return { metadata: null, chunks: [] };
  }

  console.log(`[Test] Chunking prompt "${prompt.title}" (${promptSizeKB.toFixed(2)} KB)`);

  // Split content into chunks
  const chunks = [];
  const content = prompt.content;

  for (let i = 0; i < content.length; i += CHUNK_SIZE_CHARS) {
    chunks.push(content.slice(i, i + CHUNK_SIZE_CHARS));
  }

  // Create metadata without content
  const metadata = {
    ...prompt,
    content: undefined, // Will be reconstructed from chunks
    chunkCount: chunks.length,
    originalSize: promptSizeKB,
  };

  return { metadata, chunks };
}

function reconstructPrompt(metadata, chunks) {
  return {
    ...metadata,
    content: chunks.join(''),
    chunkCount: undefined,
    originalSize: undefined,
  };
}

// Test with a large prompt
const largePrompt = {
  id: 'test-large-prompt',
  title: 'Test Large Prompt for Chunking',
  content: 'A'.repeat(10000) + ' Special content with emoji 🔥🚀 and numbers 12345',
  tags: ['test', 'large', 'chunking'],
  createdAt: Date.now(),
  updatedAt: Date.now()
};

console.log('=== Testing Prompt Chunking ===');
console.log(`Original prompt: ${largePrompt.content.length} characters`);

const { metadata, chunks } = chunkPrompt(largePrompt);

if (metadata && chunks.length > 0) {
  console.log(`✅ Prompt chunked into ${chunks.length} chunks`);
  console.log(`Metadata size: ${JSON.stringify(metadata).length} chars`);
  console.log(`Chunk sizes: ${chunks.map(chunk => chunk.length).join(', ')}`);

  // Test reconstruction
  const reconstructed = reconstructPrompt(metadata, chunks);
  console.log(`Reconstructed prompt: ${reconstructed.content.length} characters`);

  // Verify content integrity
  const contentMatches = reconstructed.content === largePrompt.content;
  console.log(`Content integrity check: ${contentMatches ? '✅ PASS' : '❌ FAIL'}`);

  if (!contentMatches) {
    console.log('Content mismatch!');
    console.log('Original length:', largePrompt.content.length);
    console.log('Reconstructed length:', reconstructed.content.length);
  }

  // Test chunk size limits
  const maxChunkSize = Math.max(...chunks.map(chunk => Buffer.byteLength(JSON.stringify({ content: chunk }), 'utf8') / 1024));
  console.log(`Max chunk size: ${maxChunkSize.toFixed(2)} KB (should be < 8KB)`);

} else {
  console.log('❌ Prompt was not chunked (size might be within limits)');
}

// Test with small prompt
const smallPrompt = {
  id: 'test-small-prompt',
  title: 'Test Small Prompt',
  content: 'This is a small prompt that should not need chunking.',
  tags: ['test', 'small'],
  createdAt: Date.now(),
  updatedAt: Date.now()
};

console.log('\n=== Testing Small Prompt (No Chunking) ===');
const smallResult = chunkPrompt(smallPrompt);
console.log(`Small prompt chunked: ${smallResult.metadata !== null ? '❌ Unexpected' : '✅ Correct (not chunked)'}`);

console.log('\n=== Test Complete ===');
