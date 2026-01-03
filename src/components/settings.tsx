"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertCircle,
  CheckCircle,
  Link2,
  Link2Off,
  Loader2,
  Database,
  HardDrive,
  RefreshCw,
  Shield,
  Clock,
  Moon,
  Sun,
  Download,
  Upload,
  FileInput,
  FileCheck,
} from "lucide-react";
import type { StorageType, SyncStatus, Prompt } from "../types";
import { saveNotionConfig, clearNotionConfig, downloadPromptsAsJson, importPromptsFromJson } from "../lib/storage";
import { testNotionConnection } from "../lib/notion";
import { useTheme } from "./theme-provider";
import { useToast } from "../hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface SettingsProps {
  storageType: StorageType;
  notionConnected: boolean;
  onStorageChange: (storageType: StorageType) => void;
  syncStatus: SyncStatus;
  autoSync: boolean;
  onAutoSyncChange: (autoSync: boolean) => void;
  prompts: Prompt[];
  onImport: (prompts: Prompt[]) => void;
}

export default function Settings({
  storageType,
  notionConnected,
  onStorageChange,
  syncStatus,
  autoSync,
  onAutoSyncChange,
  prompts,
  onImport,
}: SettingsProps) {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const [selectedStorage, setSelectedStorage] =
    useState<StorageType>(storageType);
  const [notionApiKey, setNotionApiKey] = useState("");
  const [notionPageId, setNotionPageId] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [isApiKeyFocused, setIsApiKeyFocused] = useState(false);
  const [isPageIdFocused, setIsPageIdFocused] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importData, setImportData] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  // Determine if dark mode is active
  useEffect(() => {
    const checkDarkMode = () => {
      if (theme === "dark") {
        setIsDarkMode(true);
      } else if (theme === "light") {
        setIsDarkMode(false);
      } else {
        // system theme
        if (typeof window !== "undefined" && window.matchMedia) {
          setIsDarkMode(window.matchMedia("(prefers-color-scheme: dark)").matches);
        }
      }
    };

    checkDarkMode();

    if (theme === "system" && typeof window !== "undefined" && window.matchMedia) {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => checkDarkMode();
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
  }, [theme]);

  // Reset connection status when inputs change
  useEffect(() => {
    if (connectionStatus !== "idle") {
      setConnectionStatus("idle");
    }
  }, [notionApiKey, notionPageId]);

  const handleStorageChange = async (value: StorageType) => {
    try {
      setSelectedStorage(value);
      // Save immediately when changing storage type
      await onStorageChange(value);
    } catch (error) {
      console.error("Failed to change storage type:", error);

      // If sync storage fails due to quota, suggest local storage
      if (error instanceof Error &&
          (error.message.includes('QUOTA_BYTES') || error.message.includes('QUOTA_BYTES_PER_ITEM'))) {
        toast({
          title: "Storage quota exceeded",
          description: "Chrome sync storage is full. Switching to local storage.",
          variant: "destructive",
        });

        // Force switch to local storage
        setSelectedStorage("local");
        try {
          await onStorageChange("local");
        } catch (localError) {
          console.error("Failed to switch to local storage:", localError);
        }
      } else {
        toast({
          title: "Storage change failed",
          description: "There was a problem changing your storage settings.",
          variant: "destructive",
        });
      }
    }
  };

  const handleTestConnection = async () => {
    if (!notionApiKey || !notionPageId) {
      toast({
        title: "Missing information",
        description: "Please provide both API key and page ID.",
        variant: "destructive",
      });
      return;
    }

    setIsTesting(true);
    setConnectionStatus("idle");

    try {
      const isConnected = await testNotionConnection({
        apiKey: notionApiKey,
        pageId: notionPageId,
      });

      setConnectionStatus(isConnected ? "success" : "error");

      toast({
        title: isConnected ? "Connection successful" : "Connection failed",
        description: isConnected
          ? "Your Notion credentials are valid."
          : "Could not connect to Notion with the provided credentials.",
        variant: isConnected ? "default" : "destructive",
      });
    } catch (error) {
      setConnectionStatus("error");
      console.error("Failed to test Notion connection:", error);
      toast({
        title: "Connection failed",
        description: "There was a problem connecting to Notion.",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleConnectNotion = async () => {
    if (!notionApiKey || !notionPageId) {
      toast({
        title: "Missing information",
        description: "Please provide both API key and page ID.",
        variant: "destructive",
      });
      return;
    }

    setIsConnecting(true);

    try {
      await saveNotionConfig({
        apiKey: notionApiKey,
        pageId: notionPageId,
      });

      setNotionApiKey("");
      setNotionPageId("");
      setConnectionStatus("idle");
      onStorageChange("notion");

      toast({
        title: "Notion connected",
        description: "Your Notion account has been connected successfully.",
      });
    } catch (error) {
      console.error("Failed to connect Notion:", error);
      toast({
        title: "Connection failed",
        description: "There was a problem connecting to Notion.",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnectNotion = async () => {
    setIsDisconnecting(true);

    try {
      await clearNotionConfig();
      onStorageChange("local");

      toast({
        title: "Notion disconnected",
        description: "Your Notion account has been disconnected.",
      });
    } catch (error) {
      console.error("Failed to disconnect Notion:", error);
      toast({
        title: "Disconnection failed",
        description: "There was a problem disconnecting from Notion.",
        variant: "destructive",
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const formatLastSyncTime = (timestamp: number | null) => {
    if (!timestamp) return "Never";
    const now = new Date();
    const syncTime = new Date(timestamp);
    const diffInMinutes = Math.floor(
      (now.getTime() - syncTime.getTime()) / (1000 * 60)
    );

    if (diffInMinutes < 1) return "Just now";
    if (diffInMinutes < 60)
      return `${diffInMinutes} minute${diffInMinutes === 1 ? "" : "s"} ago`;
    if (diffInMinutes < 24 * 60)
      return `${Math.floor(diffInMinutes / 60)} hour${
        diffInMinutes / 60 < 2 ? "" : "s"
      } ago`;
    return syncTime.toLocaleString();
  };

  const handleThemeChange = (checked: boolean) => {
    const newTheme = checked ? "dark" : "light";
    setTheme(newTheme);
    toast({
      title: checked ? "Dark Mode enabled" : "Light Mode enabled",
      description: `Theme changed to ${checked ? "dark" : "light"} mode.`,
    });
  };

  const handleExportPrompts = () => {
    try {
      if (prompts.length === 0) {
        toast({
          title: "No prompts to export",
          description: "You don't have any prompts to export yet.",
          variant: "destructive",
        });
        return;
      }

      downloadPromptsAsJson(prompts);
      toast({
        title: "Export successful",
        description: `${prompts.length} prompt${prompts.length === 1 ? "" : "s"} exported successfully.`,
      });
    } catch (error) {
      console.error("Failed to export prompts:", error);
      toast({
        title: "Export failed",
        description: "There was a problem exporting your prompts.",
        variant: "destructive",
      });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        setImportData(content);
        setImportError(null);
      } catch (error) {
        setImportError("Failed to read file");
      }
    };
    reader.onerror = () => {
      setImportError("Error reading file");
    };
    reader.readAsText(file);
  };

  const handleImportPrompts = async () => {
    setImportError(null);
    setIsImporting(true);

    try {
      if (!importData.trim()) {
        setImportError("Please provide JSON data to import");
        setIsImporting(false);
        return;
      }

      const importedPrompts = await importPromptsFromJson(importData);
      onImport(importedPrompts);
      setImportData("");
      setFileName(null);
      setIsImportDialogOpen(false);

      toast({
        title: "Import successful",
        description: `${importedPrompts.length} prompt${importedPrompts.length === 1 ? "" : "s"} imported successfully.`,
      });
    } catch (error) {
      console.error("Import failed:", error);
      setImportError(
        error instanceof Error ? error.message : "Invalid JSON format"
      );
      toast({
        title: "Import failed",
        description: "The provided data is not valid",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-6">
          {/* Storage Settings Card */}
          <div className="overflow-hidden transition-shadow border rounded-lg shadow-sm bg-card border-border/40 hover:shadow-md">
            <div className="p-4 border-b border-border/40">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-primary/10 text-primary">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Storage Settings</h2>
                  <p className="text-sm text-muted-foreground">
                    Choose where to store your prompts
                  </p>
                </div>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <RadioGroup
                value={selectedStorage}
                onValueChange={handleStorageChange as (value: string) => void}
                className="space-y-3"
              >
                <div className="flex items-center p-3 space-x-3 transition-colors border rounded-lg hover:bg-accent/50">
                  <RadioGroupItem
                    value="local"
                    id="local"
                    className="w-5 h-5"
                  />
                  <Label htmlFor="local" className="flex-1 cursor-pointer">
                    <div className="font-medium">Local Storage</div>
                    <div className="text-sm text-muted-foreground">
                      Store prompts in your browser's local storage
                    </div>
                  </Label>
                  {selectedStorage === "local" && (
                    <Badge variant="secondary" className="px-2 py-1">
                      Active
                    </Badge>
                  )}
                </div>

                <div className="flex items-center p-3 space-x-3 transition-colors border rounded-lg hover:bg-accent/50">
                  <RadioGroupItem
                    value="notion"
                    id="notion"
                    className="w-5 h-5"
                    disabled={!notionConnected}
                  />
                  <Label htmlFor="notion" className="flex-1 cursor-pointer">
                    <div className="font-medium">Notion Database</div>
                    <div className="text-sm text-muted-foreground">
                      {notionConnected
                        ? "Sync prompts with your Notion workspace"
                        : "Connect your Notion account"}
                    </div>
                  </Label>
                  {notionConnected ? (
                    selectedStorage === "notion" ? (
                      <Badge variant="secondary" className="px-2 py-1">
                        Active
                      </Badge>
                    ) : (
                      <Badge className="px-2 py-1">
                        <Link2 className="w-3 h-3 mr-1" />
                        Connected
                      </Badge>
                    )
                  ) : (
                    <Badge variant="outline" className="px-2 py-1">
                      Not Connected
                    </Badge>
                  )}
                </div>
              </RadioGroup>
            </div>
          </div>

          {/* Notion Integration Card */}
          <div className="overflow-hidden transition-shadow border rounded-lg shadow-sm bg-card border-border/40 hover:shadow-md">
            <div className="p-4 border-b border-border/40">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-primary/10 text-primary">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Notion Integration</h2>
                  <p className="text-sm text-muted-foreground">
                    {notionConnected
                      ? "Manage your Notion connection"
                      : "Connect your Notion account to sync prompts"}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-4 space-y-4">
              {!notionConnected ? (
                <>
                  <div className="space-y-3">
                    <Label
                      htmlFor="notion-api-key"
                      className="text-sm font-medium"
                    >
                      Notion API Key
                    </Label>
                    <div
                      className={`relative rounded-md transition-all duration-200 ${
                        isApiKeyFocused ? "ring-2 ring-primary/20" : ""
                      }`}
                    >
                      <Input
                        id="notion-api-key"
                        type="password"
                        value={notionApiKey}
                        onChange={(e) => setNotionApiKey(e.target.value)}
                        placeholder="secret_xxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className={`font-mono h-10 transition-all border-input/50 focus:border-primary/30 focus:ring-0 ${
                          isApiKeyFocused ? "border-primary/30" : ""
                        }`}
                        onFocus={() => setIsApiKeyFocused(true)}
                        onBlur={() => setIsApiKeyFocused(false)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Create an integration in Notion and copy the "Internal
                      Integration Token"
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label
                      htmlFor="notion-page-id"
                      className="text-sm font-medium"
                    >
                      Notion Database ID
                    </Label>
                    <div
                      className={`relative rounded-md transition-all duration-200 ${
                        isPageIdFocused ? "ring-2 ring-primary/20" : ""
                      }`}
                    >
                      <Input
                        id="notion-page-id"
                        value={notionPageId}
                        onChange={(e) => setNotionPageId(e.target.value)}
                        placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className={`font-mono h-10 transition-all border-input/50 focus:border-primary/30 focus:ring-0 ${
                          isPageIdFocused ? "border-primary/30" : ""
                        }`}
                        onFocus={() => setIsPageIdFocused(true)}
                        onBlur={() => setIsPageIdFocused(false)}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Share a database with your integration and copy its ID
                      from the URL
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button
                      variant="outline"
                      onClick={handleTestConnection}
                      disabled={isTesting || !notionApiKey || !notionPageId}
                      className="gap-2 transition-all hover:bg-accent/50"
                    >
                      {isTesting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        "Test Connection"
                      )}
                    </Button>
                    <Button
                      onClick={handleConnectNotion}
                      disabled={isConnecting || !notionApiKey || !notionPageId}
                      className="gap-2 transition-all shadow-sm hover:shadow-md"
                    >
                      {isConnecting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <Link2 className="w-4 h-4" />
                          Connect Notion
                        </>
                      )}
                    </Button>
                  </div>

                  {connectionStatus !== "idle" && (
                    <div
                      className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                        connectionStatus === "success"
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      {connectionStatus === "success" ? (
                        <CheckCircle className="w-4 h-4" />
                      ) : (
                        <AlertCircle className="w-4 h-4" />
                      )}
                      <span>
                        {connectionStatus === "success"
                          ? "Connection successful! You can now connect to Notion."
                          : "Connection failed. Please check your credentials."}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="space-y-4">
                    <div className="p-4 border rounded-lg bg-muted/30 border-border/40">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-muted-foreground" />
                          <div className="font-medium">Sync Status</div>
                        </div>
                        <Badge
                          variant={
                            syncStatus.error ? "destructive" : "secondary"
                          }
                        >
                          {syncStatus.error ? "Error" : "Connected"}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {syncStatus.inProgress
                          ? "Syncing in progress..."
                          : syncStatus.lastSynced
                          ? `Last synced ${formatLastSyncTime(
                              syncStatus.lastSynced
                            )}`
                          : "Never synced"}
                      </div>
                    </div>

                    {syncStatus.error && (
                      <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
                        <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <div className="text-sm">{syncStatus.error}</div>
                      </div>
                    )}

                    <div className="flex items-center justify-between p-4 border rounded-lg border-border/40">
                      <div>
                        <Label htmlFor="auto-sync" className="font-medium">
                          Automatic Sync
                        </Label>
                        <div className="text-sm text-muted-foreground">
                          Automatically sync changes with Notion
                        </div>
                      </div>
                      <Switch
                        id="auto-sync"
                        checked={autoSync}
                        onCheckedChange={onAutoSyncChange}
                        disabled={storageType !== "notion"}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      className="gap-2 transition-all hover:bg-accent/50"
                      onClick={() => {}}
                    >
                      <RefreshCw className="w-4 h-4" />
                      Sync Now
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDisconnectNotion}
                      disabled={isDisconnecting}
                      className="gap-2"
                    >
                      {isDisconnecting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Disconnecting...
                        </>
                      ) : (
                        <>
                          <Link2Off className="w-4 h-4" />
                          Disconnect Notion
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Appearance Settings Card */}
          <div className="overflow-hidden transition-shadow border rounded-lg shadow-sm bg-card border-border/40 hover:shadow-md">
            <div className="p-4 border-b border-border/40">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-primary/10 text-primary">
                  <Sun className="w-5 h-5 dark:hidden" />
                  <Moon className="hidden w-5 h-5 dark:block" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Appearance</h2>
                  <p className="text-sm text-muted-foreground">
                    Customize the look and feel of the application
                  </p>
                </div>
              </div>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg border-border/40">
                <div className="flex items-center gap-3">
                  {isDarkMode ? (
                    <Moon className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <Sun className="w-5 h-5 text-muted-foreground" />
                  )}
                  <div>
                    <Label htmlFor="dark-mode" className="font-medium cursor-pointer">
                      Dark Mode
                    </Label>
                    <div className="text-sm text-muted-foreground">
                      Switch between light and dark theme
                    </div>
                  </div>
                </div>
                <Switch
                  id="dark-mode"
                  checked={isDarkMode}
                  onCheckedChange={handleThemeChange}
                />
              </div>
            </div>
          </div>

          {/* Privacy Settings Card */}
          <div className="overflow-hidden transition-shadow border rounded-lg shadow-sm bg-card border-border/40 hover:shadow-md">
            <div className="p-4 border-b border-border/40">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-primary/10 text-primary">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Privacy & Data</h2>
                  <p className="text-sm text-muted-foreground">
                    Manage your data and privacy settings
                  </p>
                </div>
              </div>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg border-border/40">
                <div>
                  <Label htmlFor="analytics" className="font-medium">
                    Usage Analytics
                  </Label>
                  <div className="text-sm text-muted-foreground">
                    Allow anonymous usage data collection
                  </div>
                </div>
                <Switch
                  id="analytics"
                  checked={false}
                  onCheckedChange={() => {}}
                />
              </div>

              <div className="space-y-3">
                <Button
                  variant="outline"
                  onClick={handleExportPrompts}
                  className="justify-start w-full h-auto px-4 py-3 text-left gap-3"
                >
                  <Download className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-medium">Export Prompts</div>
                    <div className="text-sm text-muted-foreground">
                      Download all your prompts as a JSON file
                    </div>
                  </div>
                </Button>

                <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      className="justify-start w-full h-auto px-4 py-3 text-left gap-3"
                    >
                      <Upload className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1">
                        <div className="font-medium">Import Prompts</div>
                        <div className="text-sm text-muted-foreground">
                          Import prompts from a JSON file
                        </div>
                      </div>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Import Prompts</DialogTitle>
                      <DialogDescription>
                        Import prompts from a JSON file or paste JSON data directly.
                        Imported prompts will be merged with your existing collection.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor="import-file-upload"
                            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors border rounded-md cursor-pointer bg-secondary text-secondary-foreground hover:bg-secondary/80 border-border"
                          >
                            <FileInput className="w-4 h-4" />
                            Choose File
                          </label>
                          <input
                            id="import-file-upload"
                            type="file"
                            accept=".json,application/json"
                            onChange={handleFileUpload}
                            className="hidden"
                          />
                          {fileName && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <FileCheck className="w-4 h-4 text-green-500" />
                              <span className="truncate max-w-[200px]">{fileName}</span>
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Or paste JSON directly:
                        </p>
                        <Textarea
                          placeholder={`Paste JSON data here...\n\nExample format:\n[\n  {\n    "id": "unique-id",\n    "title": "My Prompt",\n    "content": "...",\n    "tags": ["tag1", "tag2"],\n    "createdAt": 1234567890,\n    "updatedAt": 1234567890\n  }\n]`}
                          value={importData}
                          onChange={(e) => {
                            setImportData(e.target.value);
                            setImportError(null);
                          }}
                          className="min-h-[300px] font-mono text-sm"
                        />
                        {importError && (
                          <div className="p-3 text-sm rounded-md bg-destructive/10 text-destructive">
                            {importError}
                          </div>
                        )}
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsImportDialogOpen(false);
                          setImportData("");
                          setFileName(null);
                          setImportError(null);
                        }}
                        disabled={isImporting}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleImportPrompts}
                        disabled={!importData.trim() || isImporting}
                        className="gap-2"
                      >
                        {isImporting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Importing...
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4" />
                            Import
                          </>
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              <Button
                variant="outline"
                className="justify-start w-full h-auto px-4 py-3 text-left"
              >
                <div>
                  <div className="font-medium">Clear All Data</div>
                  <div className="text-sm text-muted-foreground">
                    Remove all locally stored prompts and settings
                  </div>
                </div>
              </Button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
