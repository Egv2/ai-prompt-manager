chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-to-prompt-manager",
    title: "Add to Prompt Manager",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "add-to-prompt-manager" && info.selectionText) {
    console.log("[PromptManager] Context menu: saving selected text as temp prompt");
    chrome.storage.local.set({
      tempPrompt: info.selectionText.trim()
    }, () => {
      if (chrome.runtime.lastError) {
        console.error("[PromptManager] Failed to save temp prompt:", chrome.runtime.lastError);
      } else {
        console.log("[PromptManager] Temp prompt saved, opening popup");
        chrome.action.openPopup();
      }
    });
  }
});